"""文档摄取：PDF/DOCX/文本/CSV/HTML/字幕、页偏移、截断、摘要降级。

覆盖 AC-11、AC-12、AC-35（错误码闭集的一部分）。
"""
import pytest

from app.models.agent_toolkit_models import AgentToolkitError
from app.services.agent_toolkit import document_digest, document_extract
from tests.agent_toolkit_support import (  # noqa: F401  (pytest fixtures)
    toolkit_engine,
    toolkit_settings_override,
    toolkit_workspace,
)


def make_pdf(pages):
    """生成一个最小但结构合法的多页 PDF（无外部依赖）。"""
    objects = []
    page_ids = []
    content_ids = []
    total = len(pages)
    # 1 catalog, 2 pages, 3..(2+n) page, then content objects, then font.
    next_id = 3
    for _ in range(total):
        page_ids.append(next_id)
        content_ids.append(next_id + 1)
        next_id += 2
    font_id = next_id

    kids = " ".join(f"{page_id} 0 R" for page_id in page_ids)
    objects.append(f"<< /Type /Catalog /Pages 2 0 R >>")
    objects.append(f"<< /Type /Pages /Kids [{kids}] /Count {total} >>")
    for index, page in enumerate(pages):
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Contents {content_ids[index]} 0 R "
            f"/Resources << /Font << /F1 {font_id} 0 R >> >> >>")
        stream = f"BT /F1 18 Tf 72 700 Td ({page}) Tj ET"
        objects.append(f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream")
    objects.append("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

    buffer = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(buffer))
        buffer += f"{number} 0 obj\n{body}\nendobj\n".encode("latin-1")
    xref_at = len(buffer)
    buffer += f"xref\n0 {len(objects) + 1}\n".encode("latin-1")
    buffer += b"0000000000 65535 f \n"
    for offset in offsets:
        buffer += f"{offset:010d} 00000 n \n".encode("latin-1")
    buffer += (f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
               f"startxref\n{xref_at}\n%%EOF\n").encode("latin-1")
    return bytes(buffer)


def test_pdf_pages_become_physical_pages(toolkit_workspace):
    data = make_pdf(["Alpha", "Beta", "Gamma"])
    text, source_pages = document_extract.extract(data, ".pdf")
    assert source_pages == 3
    assert "Alpha" in text and "Gamma" in text
    offsets = document_extract.build_page_offsets(
        text, physical_pages=document_extract.split_pdf_pages(data))
    assert [item["page"] for item in offsets] == [1, 2, 3]


def test_text_pages_are_3000_char_chunks():
    text = "x" * 6500
    offsets = document_extract.build_page_offsets(text)
    assert len(offsets) == 3
    assert offsets[0]["end"] - offsets[0]["start"] == 3000


def test_docx_paragraphs_and_tables_are_extracted():
    import docx

    document = docx.Document()
    document.add_paragraph("first paragraph")
    table = document.add_table(rows=1, cols=2)
    table.rows[0].cells[0].text = "left"
    table.rows[0].cells[1].text = "right"
    import io

    buffer = io.BytesIO()
    document.save(buffer)
    text, _ = document_extract.extract(buffer.getvalue(), ".docx")
    assert "first paragraph" in text
    assert "left | right" in text


def test_html_drops_scripts_and_styles():
    body = b"<html><head><style>.x{}</style></head><body><p>visible</p>" \
           b"<script>bad()</script></body></html>"
    text, _ = document_extract.extract(body, ".html")
    assert "visible" in text
    assert "bad()" not in text


def test_srt_keeps_only_caption_text():
    body = "1\n00:00:01,000 --> 00:00:02,000\nhello\n\n2\n00:00:03,000 --> " \
           "00:00:04,000\nworld\n".encode("utf-8")
    text, _ = document_extract.extract(body, ".srt")
    assert text.splitlines() == ["hello", "world"]


def test_csv_decodes_verbatim():
    text, _ = document_extract.extract("a,b\n1,2\n".encode("utf-8"), ".csv")
    assert text == "a,b\n1,2\n"


def test_unsupported_format_lists_supported():
    with pytest.raises(AgentToolkitError) as info:
        document_extract.ensure_extension("notes.xyz")
    assert info.value.error_code == "document_unsupported_format"
    assert ".pdf" in info.value.supported


def test_truncate_reports_dropped_chars():
    text, truncated, dropped = document_extract.truncate_text("a" * 100, 40)
    assert (len(text), truncated, dropped) == (40, True, 60)


def test_slice_page_returns_next_offset_for_long_page():
    text = "y" * 9000
    offsets = [{"page": 1, "start": 0, "end": 9000}]
    first = document_extract.slice_page(text, offsets, 1, 0, 8000)
    assert first["next_offset"] == 8000
    assert first["truncated"] is True
    second = document_extract.slice_page(
        text, offsets, 1, first["next_offset"], 8000)
    assert first["content"] + second["content"] == text


def test_page_out_of_range_carries_pages():
    offsets = [{"page": 1, "start": 0, "end": 3}]
    with pytest.raises(AgentToolkitError) as info:
        document_extract.slice_page("abc", offsets, 5)
    assert info.value.error_code == "page_out_of_range"
    assert info.value.pages == 1


@pytest.mark.asyncio
async def test_ingest_and_read_one_page_at_a_time(
        toolkit_workspace, toolkit_engine):
    data = make_pdf([f"Page{i}" for i in range(1, 301)])
    result = await document_extract.ingest(
        "news.pdf", data, "p1", session_factory=toolkit_engine)
    assert result["pages"] == 300
    assert result["kind"] == "pdf"
    page = await document_extract.read_document(
        "p1", result["document_id"], page=2, session_factory=toolkit_engine)
    assert page["pages"] == 300
    assert page["page"] == 2
    assert page["next_page"] == 3
    assert len(page["content"]) <= 4000
    assert page["digest_is_summary"] is True
    # 整篇文本从不出现在单次结果里。
    assert len(page["content"]) < result["chars"]


@pytest.mark.asyncio
async def test_document_too_large_when_pages_exceed_limit(
        toolkit_workspace, toolkit_engine, toolkit_settings_override):
    toolkit_settings_override(document_max_pages=2)
    data = make_pdf(["A", "B", "C"])
    with pytest.raises(AgentToolkitError) as info:
        await document_extract.ingest(
            "a.pdf", data, "p1", session_factory=toolkit_engine)
    assert info.value.error_code == "document_too_large"
    assert info.value.pages == 3
    assert info.value.limit == 2


@pytest.mark.asyncio
async def test_digest_failure_does_not_block_reading(
        toolkit_workspace, toolkit_engine, monkeypatch):
    from app.models.agent_toolkit_db_models import AgentDocument

    text = "z" * 70_000
    offsets = document_extract.build_page_offsets(text)
    directory = toolkit_workspace / "project-x"
    document_extract_doc = AgentDocument(
        id="doc-1", project_id="p1", name="big.txt", kind="text",
        pages=len(offsets), chars=len(text),
        text_path="project-x/extracted/doc-1.txt", page_offsets=offsets,
        sha256="0" * 64, created_at=document_extract.utcnow().replace(tzinfo=None),
        digest_state="running")
    (directory / "extracted").mkdir(parents=True, exist_ok=True)
    (directory / "extracted" / "doc-1.txt").write_text(text, encoding="utf-8")
    async with toolkit_engine() as session:
        session.add(document_extract_doc)
        await session.commit()

    async def broken_config():
        raise RuntimeError("provider_not_configured")

    monkeypatch.setattr(document_digest, "_model_config", broken_config)
    await document_digest._summarise(
        "doc-1", text, offsets, directory, toolkit_engine)
    async with toolkit_engine() as session:
        stored = await session.get(AgentDocument, "doc-1")
        assert stored.digest_state == "failed"
    # 摘要失败不影响按页读取。
    page = await document_extract.read_document(
        "p1", "doc-1", page=1, session_factory=toolkit_engine)
    assert page["digest_status"] == "failed"
    assert page["content"]
