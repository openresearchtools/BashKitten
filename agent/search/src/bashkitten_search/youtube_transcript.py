# SPDX-License-Identifier: AGPL-3.0-or-later

# Modified by OpenResearchTools in 2026: common unique Markdown saves, bounded preview and explicit empty-transcript errors.

from __future__ import annotations

import html
import json
import math
import pathlib
import re
import unicodedata
from collections.abc import Callable, Iterable, Sequence
from typing import Any
from urllib.parse import parse_qs, urlsplit

from .artifacts import preview, write_markdown


INLINE_CONTENT_LIMIT = 16_000
MAX_INPUT_LENGTH = 4_096
MAX_TITLE_LENGTH = 300
MAX_TITLE_RESPONSE_BYTES = 65_536
MAX_SEGMENTS = 100_000
MAX_TRANSCRIPT_CHARACTERS = 16_000_000
VIDEO_ID_PATTERN = re.compile(r"[A-Za-z0-9_-]{11}")
LANGUAGE_PATTERN = re.compile(r"[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*")
YOUTUBE_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtube-nocookie.com",
    "www.youtube-nocookie.com",
}


class YouTubeTranscriptError(RuntimeError):
    pass


class InvalidYouTubeInput(YouTubeTranscriptError, ValueError):
    pass


def canonicalize_youtube_input(source: str) -> tuple[str, str]:
    if not isinstance(source, str):
        raise InvalidYouTubeInput("YouTube input must be a string")
    value = source.strip()
    if not value or len(value) > MAX_INPUT_LENGTH:
        raise InvalidYouTubeInput("YouTube input is empty or too long")
    if VIDEO_ID_PATTERN.fullmatch(value):
        return value, _canonical_url(value)

    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError as error:
        raise InvalidYouTubeInput("Malformed YouTube URL") from error
    if parsed.scheme.casefold() not in {"http", "https"} or not parsed.netloc:
        raise InvalidYouTubeInput("Expected a YouTube video ID or HTTP(S) URL")
    if parsed.username is not None or parsed.password is not None:
        raise InvalidYouTubeInput(
            "YouTube URLs containing credentials are not accepted"
        )
    if port is not None:
        raise InvalidYouTubeInput(
            "YouTube URLs containing explicit ports are not accepted"
        )
    host = (hostname or "").casefold()

    video_id: str | None = None
    if host == "youtu.be":
        match = re.fullmatch(r"/([A-Za-z0-9_-]{11})/?", parsed.path)
        video_id = match.group(1) if match else None
    elif host in YOUTUBE_HOSTS:
        if parsed.path in {"/watch", "/watch/"}:
            try:
                query = parse_qs(
                    parsed.query,
                    keep_blank_values=True,
                    max_num_fields=32,
                )
            except ValueError as error:
                raise InvalidYouTubeInput("Malformed YouTube query") from error
            candidates = query.get("v", [])
            if len(candidates) == 1 and VIDEO_ID_PATTERN.fullmatch(candidates[0]):
                video_id = candidates[0]
        else:
            match = re.fullmatch(
                r"/(?:shorts|embed|live)/([A-Za-z0-9_-]{11})/?",
                parsed.path,
            )
            video_id = match.group(1) if match else None
    else:
        raise InvalidYouTubeInput("Only YouTube hosts are accepted")

    if video_id is None:
        raise InvalidYouTubeInput("URL does not identify a single YouTube video")
    return video_id, _canonical_url(video_id)


def fetch_youtube_transcript(
    source: str,
    *,
    output_directory: pathlib.Path,
    languages: Sequence[str] | None = None,
    timestamped: bool = False,
    api: Any | None = None,
    title_fetcher: Callable[[str], str | None] | None = None,
) -> dict[str, object]:
    video_id, canonical_url = canonicalize_youtube_input(source)
    requested_languages = _validate_languages(languages)
    client = api if api is not None else _new_transcript_api()
    try:
        fetched = client.fetch(
            video_id,
            languages=requested_languages,
            preserve_formatting=False,
        )
    except Exception as error:
        detail = _one_line(str(error), 500) or type(error).__name__
        raise YouTubeTranscriptError(
            f"Could not retrieve the transcript for {video_id}: {detail}"
        ) from error

    transcript_video_id = getattr(fetched, "video_id", video_id)
    if transcript_video_id != video_id:
        raise YouTubeTranscriptError(
            "Transcript response video ID did not match the request"
        )
    language = _one_line(getattr(fetched, "language", ""), 100)
    language_code = _one_line(getattr(fetched, "language_code", ""), 35)
    if not language or not language_code:
        raise YouTubeTranscriptError("Transcript response omitted language metadata")
    is_generated = bool(getattr(fetched, "is_generated", False))
    segments = _collect_segments(fetched)
    if not any(str(segment["text"]).strip() for segment in segments):
        raise YouTubeTranscriptError("Transcript contains no readable text")

    fetch_title = title_fetcher or _fetch_oembed_title
    try:
        title = _one_line(fetch_title(canonical_url), MAX_TITLE_LENGTH)
    except Exception:
        title = ""
    if not title:
        title = f"YouTube video {video_id}"

    render = _render_timestamped_markdown if timestamped else _render_clean_markdown
    markdown = render(
        title=title,
        canonical_url=canonical_url,
        video_id=video_id,
        language=language,
        language_code=language_code,
        is_generated=is_generated,
        segments=segments,
    )
    output_path = write_markdown(title, markdown, output_directory=output_directory)
    content = preview(markdown)
    return {
        "type": "youtube_transcript",
        "video_id": video_id,
        "url": canonical_url,
        "title": title,
        "language": {
            "name": language,
            "code": language_code,
            "generated": is_generated,
        },
        "segment_count": len(segments),
        "timestamped": timestamped,
        "format": "timestamped-segments" if timestamped else "clean-text",
        "content": content,
        "content_length": len(markdown),
        "truncated": len(markdown) > INLINE_CONTENT_LIMIT,
        "path": str(output_path),
    }


def _canonical_url(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"


def _validate_languages(languages: Sequence[str] | None) -> tuple[str, ...]:
    if languages is None:
        return ("en",)
    if isinstance(languages, (str, bytes)) or not isinstance(languages, Sequence):
        raise InvalidYouTubeInput("languages must be a list of language codes")
    if not 1 <= len(languages) <= 10:
        raise InvalidYouTubeInput("languages must contain between one and ten codes")
    validated: list[str] = []
    for language in languages:
        if not isinstance(language, str) or not LANGUAGE_PATTERN.fullmatch(language):
            raise InvalidYouTubeInput(f"Invalid transcript language code: {language!r}")
        if language not in validated:
            validated.append(language)
    return tuple(validated)


def _new_http_session() -> Any:
    from requests import Session

    class BoundedSession(Session):
        def request(self, method: str, url: str, **kwargs: Any) -> Any:
            kwargs.setdefault("timeout", (5, 30))
            return super().request(method, url, **kwargs)

    session = BoundedSession()
    session.trust_env = False
    session.proxies.clear()
    return session


def _new_transcript_api() -> Any:
    from youtube_transcript_api import YouTubeTranscriptApi

    return YouTubeTranscriptApi(http_client=_new_http_session())


def _fetch_oembed_title(canonical_url: str) -> str | None:
    session = _new_http_session()
    try:
        response = session.get(
            "https://www.youtube.com/oembed",
            params={"url": canonical_url, "format": "json"},
            allow_redirects=False,
            stream=True,
            timeout=(5, 10),
        )
        if response.status_code != 200:
            return None
        content_type = response.headers.get("Content-Type", "").casefold()
        if "application/json" not in content_type:
            return None
        content_length = response.headers.get("Content-Length")
        if content_length is not None:
            try:
                if int(content_length) > MAX_TITLE_RESPONSE_BYTES:
                    return None
            except ValueError:
                return None
        body = bytearray()
        for chunk in response.iter_content(8_192):
            body.extend(chunk)
            if len(body) > MAX_TITLE_RESPONSE_BYTES:
                return None
        payload = json.loads(body.decode("utf-8"))
        title = payload.get("title") if isinstance(payload, dict) else None
        return title if isinstance(title, str) else None
    finally:
        session.close()


def _collect_segments(fetched: Iterable[Any]) -> list[dict[str, object]]:
    segments: list[dict[str, object]] = []
    text_characters = 0
    for snippet in fetched:
        if len(segments) >= MAX_SEGMENTS:
            raise YouTubeTranscriptError("Transcript exceeded the safe segment limit")
        text = getattr(snippet, "text", None)
        if not isinstance(text, str):
            raise YouTubeTranscriptError("Transcript segment omitted text")
        text = _clean_segment_text(text)
        text_characters += len(text)
        if text_characters > MAX_TRANSCRIPT_CHARACTERS:
            raise YouTubeTranscriptError("Transcript exceeded the safe text limit")
        start = _nonnegative_number(getattr(snippet, "start", None), "start")
        duration = _nonnegative_number(
            getattr(snippet, "duration", None), "duration"
        )
        segments.append({"start": start, "duration": duration, "text": text})
    return segments


def _nonnegative_number(value: object, name: str) -> float:
    if isinstance(value, bool):
        raise YouTubeTranscriptError(f"Transcript segment {name} was invalid")
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise YouTubeTranscriptError(
            f"Transcript segment {name} was invalid"
        ) from error
    if not math.isfinite(number) or number < 0:
        raise YouTubeTranscriptError(f"Transcript segment {name} was invalid")
    return number


def _clean_segment_text(value: str) -> str:
    normalized = value.replace("\r\n", "\n").replace("\r", "\n")
    return "".join(
        character
        for character in normalized
        if character in {"\n", "\t"} or ord(character) >= 32
    )


def _render_clean_markdown(
    *,
    title: str,
    canonical_url: str,
    video_id: str,
    language: str,
    language_code: str,
    is_generated: bool,
    segments: Sequence[dict[str, object]],
) -> str:
    del video_id, language, language_code, is_generated
    transcript = " ".join(
        " ".join(str(segment["text"]).split())
        for segment in segments
        if str(segment["text"]).strip()
    )
    return f"# {_markdown_text(title)}\n\nSource: <{canonical_url}>\n\n{transcript}\n"


def _render_timestamped_markdown(
    *,
    title: str,
    canonical_url: str,
    video_id: str,
    language: str,
    language_code: str,
    is_generated: bool,
    segments: Sequence[dict[str, object]],
) -> str:
    caption_type = "automatically generated" if is_generated else "human-created"
    lines = [
        f"# {_markdown_text(title)}",
        "",
        f"- Video: [{_markdown_text(video_id)}]({canonical_url})",
        f"- Language: {_markdown_text(language)} (`{_markdown_text(language_code)}`)",
        f"- Captions: {caption_type}",
        f"- Segments: {len(segments)}",
        "",
        "## Transcript",
        "",
    ]
    for segment in segments:
        timestamp = _format_timestamp(float(segment["start"]))
        text = _markdown_text(str(segment["text"])).replace("\n", "\n    ")
        lines.extend((f"- **{timestamp}**  {text}", ""))
    return "\n".join(lines).rstrip() + "\n"


def _format_timestamp(seconds: float) -> str:
    milliseconds = int(round(seconds * 1_000))
    total_seconds, milliseconds = divmod(milliseconds, 1_000)
    minutes, seconds = divmod(total_seconds, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}.{milliseconds:03d}"


def _markdown_text(value: str) -> str:
    escaped = html.escape(value, quote=False).replace("\\", "\\\\")
    for character in ("`", "*", "_", "[", "]", "#", "|", ">"):
        escaped = escaped.replace(character, f"\\{character}")
    return escaped


def _one_line(value: object, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    normalized = unicodedata.normalize("NFKC", value)
    printable = "".join(
        character
        for character in normalized
        if not unicodedata.category(character).startswith("C")
    )
    return " ".join(printable.split())[:limit].strip()

