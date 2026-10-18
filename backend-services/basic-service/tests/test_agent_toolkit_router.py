"""REST 端点：信封、Origin、`x-tool-call-id`、幂等重放、错误码/HTTP 映射。

覆盖 AC-19、AC-26、AC-35（端点 × 闸门矩阵）。
"""
import io
import json

import pytest
from starlette.datastructures import UploadFile

from app.models.agent_toolkit_models import AgentToolkitError
from app.models.base_models import ErrorResponse
from app.routers import agent_toolkit_router as router_module
from app.services.agent_toolkit import workspace_store
from tests.agent_toolkit_support import (  # noqa: F401  (pytest fixtures)
    FakeRequest,
    origin_headers,
    toolkit_engine,
    toolkit_settings_override,
    toolkit_workspace,
)


@pytest.fixture(autouse=True)
def wire_database(monkeypatch, toolkit_engine):
    """把 capability/usage 用到的默认 session factory 指到测试库。"""
    import app.database as database

    monkeypatch.setattr(database, "async_session_factory", toolkit_engine)


def body_of(response):
    return json.loads(response.body)


def envelope_of(error):
    return body_of(router_module.error_response(error))


def tool_request(**extra):
    return FakeRequest(origin_headers(**{
        "content-type": "application/json",
        "x-tool-call-id": "call-1",
        **extra,
    }))


# ── 能力 / 用量 ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_capabilities_exposes_limits(toolkit_workspace):
    response = await router_module.get_capabilities(
        FakeRequest(origin_headers()), project_id="p1")
    data = response.data
    assert set(data["limits"]) == {
        "max_file_mb", "document_max_pages", "document_max_chars",
        "analysis_timeout_seconds"}
    assert ".pdf" in data["documents"]["formats"]
    assert sum(data["workspace"]["used_by_kind"].values()) == \
        data["workspace"]["used_bytes"]


@pytest.mark.asyncio
async def test_usage_reports_five_trees(toolkit_workspace):
    response = await router_module.get_usage(
        FakeRequest(origin_headers()), project_id="p1")
    assert set(response.data["used_by_kind"]) == {
        "files", "uploads", "extracted", "digest", "out"}


# ── 闸门矩阵 ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_write_without_origin_is_forbidden(toolkit_workspace):
    request = FakeRequest({"content-type": "application/json",
                           "x-tool-call-id": "call-1"})
    with pytest.raises(AgentToolkitError) as info:
        await router_module.write_workspace(
            router_module.WorkspaceWriteRequest(name="a.txt", content="x"),
            request)
    assert info.value.error_code == "origin_forbidden"
    assert info.value.status_code == 403


@pytest.mark.asyncio
async def test_write_requires_json_content_type(toolkit_workspace):
    request = FakeRequest(origin_headers(**{
        "content-type": "text/plain", "x-tool-call-id": "call-1"}))
    with pytest.raises(AgentToolkitError) as info:
        await router_module.write_workspace(
            router_module.WorkspaceWriteRequest(name="a.txt", content="x"),
            request)
    assert info.value.error_code == "json_required"
    assert info.value.status_code == 415


@pytest.mark.asyncio
async def test_write_requires_call_id(toolkit_workspace):
    request = FakeRequest(origin_headers(**{"content-type": "application/json"}))
    with pytest.raises(AgentToolkitError) as info:
        await router_module.write_workspace(
            router_module.WorkspaceWriteRequest(name="a.txt", content="x"),
            request)
    assert info.value.error_code == "invalid_call_id"
    assert info.value.status_code == 400


@pytest.mark.asyncio
async def test_call_id_longer_than_128_is_rejected(toolkit_workspace):
    request = FakeRequest(origin_headers(**{
        "content-type": "application/json", "x-tool-call-id": "c" * 129}))
    with pytest.raises(AgentToolkitError) as info:
        await router_module.write_workspace(
            router_module.WorkspaceWriteRequest(name="a.txt", content="x"),
            request)
    assert info.value.error_code == "invalid_call_id"


@pytest.mark.asyncio
async def test_upload_without_origin_reports_origin_not_json(toolkit_workspace):
    """multipart 端点不得因为「不是 JSON」而 415（R-01 回归）。"""
    request = FakeRequest({"content-type": "multipart/form-data; boundary=x"})
    upload = UploadFile(file=io.BytesIO(b"hello"), filename="a.txt")
    with pytest.raises(AgentToolkitError) as info:
        await router_module.upload_document(request, upload, None)
    assert info.value.error_code == "origin_forbidden"
    assert info.value.error_code != "json_required"


@pytest.mark.asyncio
async def test_download_does_not_need_call_id(toolkit_workspace):
    await workspace_store.write_file("p1", "a.txt", b"hello")
    response = await router_module.download_workspace(
        FakeRequest(origin_headers()), name="a.txt", project_id="p1")
    assert response.filename == "a.txt"


@pytest.mark.asyncio
async def test_cross_site_is_forbidden(toolkit_workspace):
    request = FakeRequest(origin_headers(**{
        "content-type": "application/json", "x-tool-call-id": "call-1",
        "sec-fetch-site": "cross-site"}))
    with pytest.raises(AgentToolkitError) as info:
        await router_module.write_workspace(
            router_module.WorkspaceWriteRequest(name="a.txt", content="x"),
            request)
    assert info.value.error_code == "origin_forbidden"


@pytest.mark.asyncio
async def test_disabled_capability_is_403(toolkit_workspace,
                                          toolkit_settings_override):
    toolkit_settings_override(workspace_enabled=False)
    with pytest.raises(AgentToolkitError) as info:
        await router_module.read_workspace(
            tool_request(), name="a.txt", project_id="p1")
    assert info.value.error_code == "workspace_disabled"
    assert info.value.status_code == 403


# ── 工作区端点 ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_write_then_replay_is_idempotent(toolkit_workspace):
    request = tool_request()
    body = router_module.WorkspaceWriteRequest(
        project_id="p1", name="notes.md", content="hello")
    first = await router_module.write_workspace(body, request)
    second = await router_module.write_workspace(body, request)
    assert first.data == second.data
    target = workspace_store.project_directory("p1") / "files" / "notes.md"
    assert target.read_bytes() == b"hello"


@pytest.mark.asyncio
async def test_workspace_list_separates_documents(
        toolkit_workspace, toolkit_engine):
    from app.services.agent_toolkit import document_extract

    await workspace_store.write_file("p1", "agent.txt", b"x")
    await document_extract.ingest(
        "news.txt", "hello world".encode("utf-8"), "p1",
        session_factory=toolkit_engine)
    response = await router_module.list_workspace(
        tool_request(), project_id="p1", prefix=None, limit=50)
    data = response.data
    assert [item["name"] for item in data["files"]] == ["agent.txt"]
    assert len(data["documents"]) == 1
    document_id = data["documents"][0]["document_id"]
    page = await router_module.read_document(
        tool_request(), document_id=document_id, project_id="p1",
        page=1, offset=0, max_chars=4000)
    assert "hello world" in page.data["content"]


@pytest.mark.asyncio
async def test_document_delete_removes_entry_and_files(
        toolkit_workspace, toolkit_engine):
    from app.services.agent_toolkit import document_extract

    result = await document_extract.ingest(
        "a.txt", b"body text", "p1", session_factory=toolkit_engine)
    await router_module.delete_document(
        result["document_id"], tool_request(), project_id="p1")
    listing = await router_module.list_documents(
        tool_request(), project_id="p1", limit=50)
    assert listing.data["documents"] == []
    directory = workspace_store.project_directory("p1")
    assert not list((directory / "uploads").glob("*.txt"))


@pytest.mark.asyncio
async def test_import_material_rejects_non_media(toolkit_workspace):
    await workspace_store.write_file("p1", "notes.md", b"hi")
    with pytest.raises(AgentToolkitError) as info:
        await router_module.import_workspace(
            router_module.WorkspaceImportRequest(
                project_id="p1", name="notes.md"), tool_request())
    assert info.value.error_code == "invalid_argument"
    assert "mp4" in info.value.supported


# ── 记忆端点 ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_memory_endpoints_round_trip(toolkit_workspace):
    request = tool_request()
    created = await router_module.write_memory(
        router_module.MemoryWriteRequest(
            project_id="p1", text="偏好男声解说", kind="preference"),
        request)
    assert created.data["deduplicated"] is False
    listing = await router_module.list_memory(
        tool_request(), project_id="p1", scope="all", limit=50)
    assert listing.data["count"] == 1
    found = await router_module.search_memory(
        tool_request(), q="男声", project_id="p1", scope="all", limit=5)
    assert found.data["entries"][0]["text"] == "偏好男声解说"
    # `GET /memory*` 与其它记忆读取同属一格：必须带 x-tool-call-id（§4.1.1）。
    digest = await router_module.memory_digest(tool_request(), project_id="p1")
    assert "[preference]" in digest.data["text"]
    await router_module.forget_memory(
        created.data["memory_id"], tool_request(), project_id="p1")
    after = await router_module.list_memory(
        tool_request(), project_id="p1", scope="all", limit=50)
    assert after.data["count"] == 0


# ── 错误信封 ─────────────────────────────────────────────────────────────


def test_error_envelope_matches_error_response_fields():
    payload = envelope_of(AgentToolkitError("binary_file"))
    assert set(payload) == set(ErrorResponse.model_fields)
    assert "failure_class" not in payload
    assert payload["error_details"]["failure_class"] == "user_input"
    assert payload["error_details"]["retryable"] is False


def test_policy_error_carries_settings_hint():
    error = AgentToolkitError("analysis_disabled")
    payload = envelope_of(error)
    assert payload["error_details"]["settings_path"] == "agent_toolkit"
    assert payload["error_details"]["settings_hint"]


def test_every_status_code_has_a_failure_class():
    from app.models.agent_toolkit_models import (
        FAILURE_CLASS_BY_CODE,
        STATUS,
    )

    assert set(STATUS) == set(FAILURE_CLASS_BY_CODE)


def test_transient_codes_are_retryable():
    payload = envelope_of(AgentToolkitError("analysis_timeout"))
    assert payload["error_details"]["failure_class"] == "transient"
    assert payload["error_details"]["retryable"] is True
