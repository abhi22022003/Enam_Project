import pypdfium2 as pdfium

from .. import cache
from ..http import client

MAX_BYTES = 40 * 1024 * 1024


def download(url: str) -> bytes:
    hit = cache.get_bytes("pdf", url)
    if hit is not None:
        return hit
    headers = {}
    if "nseindia.com" in url:
        headers["Referer"] = "https://www.nseindia.com/"
    if "bseindia.com" in url:
        headers["Referer"] = "https://www.bseindia.com/"
    r = client().get(url, headers=headers, timeout=90)
    r.raise_for_status()
    data = r.content
    if len(data) > MAX_BYTES:
        raise ValueError("PDF too large")
    cache.set_bytes("pdf", url, data)
    return data


def pages(url: str, max_pages: int | None = None) -> list[str]:
    """Text per page. Cached separately from the bytes so re-reads are free."""
    key = f"{url}|{max_pages}"
    hit = cache.get_json("pdf_text", key)
    if hit is not None:
        return hit
    doc = pdfium.PdfDocument(download(url))
    try:
        n = len(doc) if max_pages is None else min(len(doc), max_pages)
        texts = []
        for i in range(n):
            page = doc[i]
            textpage = page.get_textpage()
            texts.append(textpage.get_text_bounded().replace("\r\n", "\n"))
            textpage.close()
            page.close()
    finally:
        doc.close()
    cache.set_json("pdf_text", key, texts)
    return texts


def text(url: str, max_pages: int | None = None, max_chars: int | None = None) -> str:
    out = "\n".join(f"[page {i + 1}]\n{t}" for i, t in enumerate(pages(url, max_pages)))
    return out[:max_chars] if max_chars else out
