# SPDX-License-Identifier: AGPL-3.0-only
# Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

"""Selected Unsloth PDF-to-Markdown reader; preserve page and layout boundaries."""

# Modified by OpenResearchTools in 2026: retained only the PDF reader, always enable Markdown extraction.

from __future__ import annotations

import logging
import re
from dataclasses import dataclass


logger = logging.getLogger(__name__)


@dataclass(frozen = True)
class Page:
    """A unit of extracted text. ``page_number`` is 1-based (None if N/A)."""

    text: str
    page_number: int | None = None
    char_count: int = 0


@dataclass(frozen = True)
class ParsedImage:
    """A raster image embedded in a document (PDF only)."""

    image_bytes: bytes
    page_number: int | None
    xref: int


def _page(text: str, page_number: int | None) -> Page:
    return Page(text = text, page_number = page_number, char_count = len(text))


# pymupdf4llm rebuilds text from positioned glyphs, which mangles complex-shaping
# scripts (RTL Arabic/Hebrew emerge as shaped Presentation Forms, Indic matras drop to
# U+FFFD) and can silently drop most of a heavy-RTL page. When Markdown trips these
# signals we fall back to PyMuPDF's logical-order get_text(). Thresholds mirror the chat
# extractor guard (unslothai/unsloth#5351 review).
_SHAPED_PRESENTATION_FORMS = re.compile("[\ufb1d-\ufdff\ufe70-\ufefc]")
_PDF_FALLBACK_MIN_BAD_GLYPHS = 5
_PDF_FALLBACK_BAD_GLYPH_RATIO = 0.0005
_PDF_INCOMPLETE_RATIO = 0.75
_PDF_INCOMPLETE_MIN_LETTERS = 200


def _markdown_corrupted(text: str) -> bool:
    """True when pymupdf4llm's glyph reconstruction mangled the text: shaped RTL
    Presentation Forms or U+FFFD replacements above a small floor/ratio (so a lone
    legitimate shaped glyph does not force the fallback)."""
    if not text:
        return False
    threshold = max(_PDF_FALLBACK_MIN_BAD_GLYPHS, _PDF_FALLBACK_BAD_GLYPH_RATIO * len(text))
    shaped = len(_SHAPED_PRESENTATION_FORMS.findall(text))
    return shaped > threshold or text.count("\ufffd") > threshold


def _markdown_incomplete(markdown: str, plain: str) -> bool:
    """True when ``markdown`` holds far fewer letters than the raw ``get_text`` layer -- a
    coarse guard for heavy-RTL pages pymupdf4llm silently drops without shaped glyphs."""
    plain_letters = sum(1 for c in plain if c.isalnum())
    if plain_letters < _PDF_INCOMPLETE_MIN_LETTERS:
        return False
    markdown_letters = sum(1 for c in markdown if c.isalnum())
    return markdown_letters < _PDF_INCOMPLETE_RATIO * plain_letters


def _pdf_markdown(doc, pages: range | None = None) -> list[str] | None:
    """Per-page layout-aware Markdown (tables, headings, lists) via pymupdf4llm; index
    i maps to page i+1. Returns None when the lib is missing, extraction fails, or the
    page count does not line up, so the caller falls back to plain PyMuPDF text."""
    try:
        import pymupdf4llm
    except Exception:
        return None
    try:
        kwargs = {"page_chunks": True, "show_progress": False}
        if pages is not None:
            kwargs["pages"] = list(pages)
        chunks = pymupdf4llm.to_markdown(doc, **kwargs)
    except Exception:  # noqa: BLE001 - never let Markdown extraction break ingestion
        logger.warning("pymupdf4llm extraction failed; using plain text", exc_info = True)
        return None
    expected_pages = doc.page_count if pages is None else len(pages)
    if not isinstance(chunks, list) or len(chunks) != expected_pages:
        return None
    return [str(c.get("text") or "") for c in chunks]


def _pdf(
    source: str | bytes,
    want_images: bool,
    max_pages: int | None = None,
) -> tuple[list[Page], list[ParsedImage], int]:
    import fitz  # PyMuPDF

    pages: list[Page] = []
    images: list[ParsedImage] = []
    doc = (
        fitz.open(stream = source, filetype = "pdf") if isinstance(source, bytes) else fitz.open(source)
    )
    try:
        if doc.needs_pass:
            raise ValueError("encrypted PDF requires a password")
        total_pages = doc.page_count
        page_numbers = range(total_pages if max_pages is None else min(total_pages, max_pages))
        if max_pages is None:
            md = _pdf_markdown(doc)
        else:
            md = _pdf_markdown(doc, page_numbers)
        for i, page_number in enumerate(page_numbers):
            page = doc[page_number]
            plain = page.get_text("text") or ""
            candidate = md[i] if md else ""
            # Prefer layout-aware Markdown (keeps tables/headings legible for retrieval),
            # but drop to PyMuPDF's logical-order text when Markdown is off/empty or when
            # pymupdf4llm mangled it (RTL/Indic) or dropped most of the page.
            if (
                candidate
                and not _markdown_corrupted(candidate)
                and not _markdown_incomplete(candidate, plain)
            ):
                text = candidate
            else:
                text = plain
            pages.append(_page(text, page_number + 1))
            if want_images:
                for img in page.get_images(full = True):
                    xref = img[0]
                    try:
                        extracted = doc.extract_image(xref)
                    except Exception as exc:  # noqa: BLE001
                        logger.debug("skipping image xref %s: %s", xref, exc)
                        continue
                    image_bytes = extracted.get("image")
                    if image_bytes:
                        images.append(
                            ParsedImage(
                                image_bytes = image_bytes,
                                page_number = page_number + 1,
                                xref = xref,
                            )
                        )
    finally:
        doc.close()
    return pages, images, total_pages


def parse_pdf_bytes(data: bytes, *, max_pages: int | None = None) -> tuple[list[Page], int]:
    """Extract PDF pages from an in-memory download using the ingestion parser.

    Returns the (capped) pages plus the document's full page count, so a caller
    that set ``max_pages`` can tell a fully-read short PDF from a truncated one."""
    pages, _images, total_pages = _pdf(data, want_images = False, max_pages = max_pages)
    return pages, total_pages

