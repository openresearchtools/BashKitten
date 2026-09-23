# SPDX-License-Identifier: AGPL-3.0-only
# Derived from Buzzard Search and Unsloth Studio; see THIRD_PARTY_NOTICES.md.

"""One DDGS query or URL read, with complete private Markdown artifacts."""

from __future__ import annotations

from pathlib import Path
import time
from typing import Any

from ._upstream import search_runtime
from ._upstream.web_access_policy import check_url_access
from .artifacts import MAX_PAGE_CHARS, document_directory, ensure_private_directory, preview, title_for_document, write_markdown
from .github_repository import fetch_github_repository
from .network_compat import validate_and_resolve_public_host
from .youtube_transcript import InvalidYouTubeInput, canonicalize_youtube_input, fetch_youtube_transcript

search_runtime._validate_and_resolve_host = validate_and_resolve_public_host


def _integer(value: Any, name: str, low: int) -> int:
    if type(value) is not int or value < low:
        raise ValueError(f"{name} must be an integer at least {low}")
    return value


def validate(request: Any) -> dict[str, Any]:
    if not isinstance(request, dict):
        raise ValueError("Input must be one JSON object")
    unknown = set(request) - {"query", "url", "maxResults", "timeoutSeconds", "outputDirectory", "languages", "timestamped"}
    if unknown:
        raise ValueError(f"Unsupported fields: {', '.join(sorted(unknown))}")
    if ("query" in request) == ("url" in request):
        raise ValueError("Supply exactly one query or url")
    field = "query" if "query" in request else "url"
    value = request[field]
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a non-empty string")
    request = dict(request, **{field: value.strip()})
    request["timeoutSeconds"] = _integer(request["timeoutSeconds"], "timeoutSeconds", 1) if request.get("timeoutSeconds") is not None else None
    if field == "query":
        if set(request) & {"outputDirectory", "languages", "timestamped"}:
            raise ValueError("outputDirectory, languages and timestamped apply only to URL reads")
        request["maxResults"] = _integer(request.get("maxResults", 5), "maxResults", 1)
    else:
        if "maxResults" in request:
            raise ValueError("maxResults applies only to searches")
        if "outputDirectory" in request and (not isinstance(request["outputDirectory"], str) or not request["outputDirectory"].strip()):
            raise ValueError("outputDirectory must be a non-empty path")
        if "timestamped" in request and type(request["timestamped"]) is not bool:
            raise ValueError("timestamped must be a boolean")
        if "languages" in request and (not isinstance(request["languages"], list) or not all(isinstance(x, str) for x in request["languages"])):
            raise ValueError("languages must be a list of language codes")
    return request


def _collapsed(value: Any) -> str:
    return " ".join(str(value or "").split())


def _search(request: dict[str, Any]) -> dict[str, Any]:
    from ddgs import DDGS

    try:
        raw = DDGS(timeout=request["timeoutSeconds"]).text(request["query"], max_results=request["maxResults"])
    except Exception as error:
        # DDGS also raises its generic exception for an empty engine sweep;
        # preserve that distinction instead of inventing successful results.
        raise RuntimeError(search_runtime._search_failure_message(error, request["timeoutSeconds"])) from error
    results = []
    for item in raw or []:
        url = str(item.get("href") or "").strip()
        if not check_url_access(url, None)[0]:
            continue
        results.append({"title": _collapsed(item.get("title")) or url, "url": url, "snippet": _collapsed(item.get("body"))})
        if len(results) >= request["maxResults"]:
            break
    content = "\n\n".join(f"Title: {item['title']}\nURL: {item['url']}\nSnippet: {item['snippet']}" for item in results)
    return {"ok": True, "query": request["query"], "content": preview(content or "No results found."), "results": results}


def _read(request: dict[str, Any]) -> dict[str, Any]:
    url = request["url"]
    allowed, reason, _ = check_url_access(url, None)
    if not allowed:
        raise ValueError(reason)
    # Never chmod a user's project root to make it an artifact directory.
    output = request.get("outputDirectory")
    directory = ensure_private_directory(Path(output).expanduser().absolute() / "bashkitten-search") if output else document_directory()
    try:
        canonicalize_youtube_input(url)
        youtube = True
    except InvalidYouTubeInput:
        youtube = False
    if youtube:
        transcript = fetch_youtube_transcript(url, output_directory=directory, languages=request.get("languages"), timestamped=request.get("timestamped", False))
        return {"ok": True, "url": transcript["url"], "title": transcript["title"], "content": transcript["content"], "fullMarkdownPath": transcript["path"], "contentLength": transcript["content_length"], "truncated": transcript["truncated"], "language": transcript["language"], "segmentCount": transcript["segment_count"]}
    if "languages" in request or "timestamped" in request:
        raise ValueError("languages and timestamped apply only to YouTube transcripts")
    document = fetch_github_repository(url, timeout=request["timeoutSeconds"])
    details: dict[str, Any] = {}
    if document is not None:
        markdown, title = document.markdown, document.title
        details.update(canonicalUrl=document.canonical_url, immutableUrl=document.pinned_url, commit=document.commit)
    else:
        error, body, content_type = search_runtime._fetch_url_raw(url, timeout=request["timeoutSeconds"], deadline=time.monotonic() + request["timeoutSeconds"] if request["timeoutSeconds"] is not None else None, read_info=details)
        if error:
            raise RuntimeError(error)
        if "html" in content_type or search_runtime._looks_like_html(body):
            from ._upstream._html_to_md import html_to_markdown
            markdown = html_to_markdown(body, main_content=True)
        else:
            markdown = body.strip()
        if not markdown.strip():
            raise RuntimeError("Page returned no readable text; use the browser skill for JavaScript-only content")
        details["contentType"] = content_type
        title = title_for_document(markdown, url)
        markdown = f"Source: <{url}>\n\n{markdown}"
    if not markdown.strip():
        raise RuntimeError("Resource returned no readable content")
    # Write the complete extraction.
    # The inline preview is produced only after the complete file is saved.
    path = write_markdown(title, markdown, output_directory=directory)
    return {"ok": True, "url": url, "title": title, "content": preview(markdown), "fullMarkdownPath": str(path), "contentLength": len(markdown), "truncated": len(markdown) > MAX_PAGE_CHARS, **details}


def execute(request: dict[str, Any]) -> dict[str, Any]:
    return _search(request) if "query" in request else _read(request)
