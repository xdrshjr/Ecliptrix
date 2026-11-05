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


@pytest.fixture
def workspace_downloads(monkeypatch, toolkit_engine, tmp_path):
    import asyncio
    from app.services import material_download_service as downloads
    service = downloads.MaterialDownloadService.__new__(downloads.MaterialDownloadService)
    service.cache_dir = tmp_path / 'cache'
    service._session_factory = toolkit_engine
    service._research_locks = {}
    service._ensure_loop = asyncio.get_running_loop
    monkeypatch.setattr(downloads, 'get_material_download_service', lambda: service)
    return service


@pytest.mark.asyncio
async def test_real_workspace_audio_import_keeps_duration_and_cache_url(
        toolkit_workspace, workspace_downloads):
    import wave
    from pathlib import Path
    from sqlalchemy import select
    from app.models.db_models import CachedMaterial
    target = workspace_store.project_directory('audio-test') / 'files/bgm.wav'
    target.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(target), 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(8000)
        wav.writeframes(b'\x00\x00' * 480000)
    body = router_module.WorkspaceImportRequest(project_id='audio-test', name='bgm.wav')
    first = await router_module.import_workspace(
        body, tool_request(**{'x-tool-call-id': 'audio-first'}))
    second = await router_module.import_workspace(
        body, tool_request(**{'x-tool-call-id': 'audio-second'}))
    assert first.data['duration'] == pytest.approx(60)
    assert second.data['duration'] == pytest.approx(60)
    assert second.data['id'] == first.data['id']
    assert second.data['metadata']['reused'] is True
    async with workspace_downloads._session_factory() as session:
        row = (await session.execute(select(CachedMaterial))).scalar_one()
        assert row.source_url == first.data['local_url']
        assert Path(row.local_path).read_bytes() == target.read_bytes()


@pytest.mark.asyncio
async def test_damaged_audio_is_not_cached(toolkit_workspace, workspace_downloads):
    from sqlalchemy import select
    from app.models.db_models import CachedMaterial
    target = workspace_store.project_directory('bad-audio') / 'files/bad.wav'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b'not audio')
    with pytest.raises(AgentToolkitError) as caught:
        await router_module._import_material(router_module.WorkspaceImportRequest(
            project_id='bad-audio', name='bad.wav'))
    assert caught.value.error_code == 'media_probe_failed'
    async with workspace_downloads._session_factory() as session:
        assert not list((await session.execute(select(CachedMaterial))).scalars())
    assert not list(workspace_downloads.cache_dir.rglob('*.part'))
    assert target.read_bytes() == b'not audio'


@pytest.mark.asyncio
@pytest.mark.parametrize('extension', ['mp3', 'mp4', 'svg'])
async def test_real_import_http_entry(toolkit_workspace, workspace_downloads, extension):
    import asyncio
    import shutil
    import subprocess
    import httpx
    from fastapi import FastAPI
    target = workspace_store.project_directory('http-import') / ('files/media.' + extension)
    target.parent.mkdir(parents=True, exist_ok=True)
    if extension == 'svg':
        target.write_text('<svg width="640" height="360"></svg>', encoding='utf-8')
    else:
        media = ('anullsrc=r=8000:cl=mono' if extension == 'mp3'
                 else 'color=c=red:s=64x36:r=10')
        subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-f', 'lavfi',
                        '-i', media, '-t', '1.5', str(target)],
                       capture_output=True, check=True, timeout=10)
    app = FastAPI()
    app.include_router(router_module.router, prefix='/api')

    @app.exception_handler(AgentToolkitError)
    async def handle_error(request, error):
        return router_module.error_response(error)

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://localhost:3000') as client:
        async def invoke(call_id, name):
            return await client.post('/api/agent-toolkit/workspace/import',
                                     headers={'origin': 'http://localhost:3000', 'x-tool-call-id': call_id},
                                     json={'project_id': 'http-import', 'name': name})
        a, b = await asyncio.gather(invoke(extension + '-a', target.name),
                                    invoke(extension + '-b', target.name))
        assert a.status_code == b.status_code == 200
        first, second = a.json()['data'], b.json()['data']
        assert first['id'] == second['id']
        assert first['local_url'] == second['local_url']
        if extension == 'svg':
            assert (first['width'], first['height'], first['duration']) == (640, 360, 0)
        else:
            assert first['duration'] == pytest.approx(1.5, abs=0.2)
            if extension == 'mp4':
                assert (first['width'], first['height']) == (64, 36)
        missing = await invoke(extension + '-missing', 'missing.wav')
        assert missing.status_code == 404
        assert missing.json()['error_code'] == 'workspace_not_found'


@pytest.mark.asyncio
@pytest.mark.parametrize('failure', ['database', 'permission', 'disk_full', 'changed', 'disappeared'])
async def test_import_failures_preserve_source_and_clean_cache(
        toolkit_workspace, workspace_downloads, monkeypatch, caplog, failure):
    import errno
    from pathlib import Path
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
    from app.models.db_models import CachedMaterial
    from app.services import material_download_service as downloads
    target = workspace_store.project_directory('failure') / 'files/image.png'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b'image-content')
    original_copy = downloads.shutil.copyfile

    class FailedCommit(AsyncSession):
        async def commit(self):
            raise RuntimeError('private SQL and secret parameter')

    def copy(source, destination):
        if failure == 'permission':
            raise PermissionError(errno.EACCES, 'private path')
        if failure == 'disk_full':
            raise OSError(errno.ENOSPC, 'private path')
        if failure == 'disappeared':
            raise FileNotFoundError(errno.ENOENT, 'private path')
        if failure == 'changed':
            Path(destination).write_bytes(b'different content')
            return
        return original_copy(source, destination)

    monkeypatch.setattr(downloads.shutil, 'copyfile', copy)
    if failure == 'database':
        workspace_downloads._session_factory = async_sessionmaker(
            workspace_downloads._session_factory.kw['bind'], class_=FailedCommit,
            expire_on_commit=False)
    with pytest.raises(AgentToolkitError) as caught:
        await router_module._import_material(router_module.WorkspaceImportRequest(
            project_id='failure', name=target.name))
    expected = {'database': ('cache_commit_failed', 500),
                'permission': ('storage_unavailable', 503),
                'disk_full': ('storage_full', 507),
                'changed': ('cache_integrity_error', 500),
                'disappeared': ('workspace_not_found', 404)}[failure]
    assert (caught.value.error_code, caught.value.status_code) == expected
    envelope = envelope_of(caught.value)
    assert envelope['success'] is False
    assert 'private' not in str(envelope) + caplog.text
    if failure == 'database':
        assert envelope['error_details']['request_id'] in caplog.text
        assert 'RuntimeError' in caplog.text
    async with workspace_downloads._session_factory() as session:
        assert not list((await session.execute(select(CachedMaterial))).scalars())
    assert not list(workspace_downloads.cache_dir.rglob('*.*'))
    assert target.read_bytes() == b'image-content'


@pytest.mark.asyncio
async def test_probe_uses_copied_bytes_even_if_source_changes(
        toolkit_workspace, workspace_downloads, monkeypatch):
    import wave
    from pathlib import Path
    from sqlalchemy import select
    from app.models.db_models import CachedMaterial
    from app.services.composition import media_probe
    target = workspace_store.project_directory('snapshot') / 'files/bgm.wav'
    target.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(target), 'wb') as wav:
        wav.setparams((1, 2, 8000, 0, 'NONE', 'not compressed'))
        wav.writeframes(b'\x00\x00' * 12000)
    original = target.read_bytes()
    probe = media_probe.probe_workspace_media

    async def mutate_source(path, extension):
        target.write_bytes(b'new source contents')
        return await probe(path, extension)

    monkeypatch.setattr(media_probe, 'probe_workspace_media', mutate_source)
    result = await router_module._import_material(router_module.WorkspaceImportRequest(
        project_id='snapshot', name='bgm.wav'))
    assert result['duration'] == pytest.approx(1.5)
    async with workspace_downloads._session_factory() as session:
        row = (await session.execute(select(CachedMaterial))).scalar_one()
        assert Path(row.local_path).read_bytes() == original


@pytest.mark.asyncio
@pytest.mark.parametrize('extension', ['svg', 'wav'])
async def test_import_uses_real_background_loop(
        tmp_path, monkeypatch, toolkit_workspace, extension):
    import asyncio
    import threading
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from app.models.db_models import CachedMaterial
    from app.services import material_download_service as downloads
    service = downloads.MaterialDownloadService.__new__(downloads.MaterialDownloadService)
    service.cache_dir = tmp_path / 'cache'
    service._research_locks = {}
    service._loop_lock = threading.Lock()
    service._loop = None

    async def init():
        service._engine = create_async_engine('sqlite+aiosqlite:///' + str(tmp_path / 'background.db'))
        async with service._engine.begin() as conn:
            await conn.run_sync(CachedMaterial.__table__.create)
        service._session_factory = async_sessionmaker(service._engine, expire_on_commit=False)

    service._init_runtime = init
    monkeypatch.setattr(downloads, 'get_material_download_service', lambda: service)
    target = (workspace_store.project_directory('background')
              / ('files/test.' + extension))
    target.parent.mkdir(parents=True, exist_ok=True)
    if extension == 'svg':
        target.write_text('<svg width="2" height="2"/>', encoding='utf-8')
    else:
        import wave
        with wave.open(str(target), 'wb') as wav:
            wav.setparams((1, 2, 8000, 0, 'NONE', 'not compressed'))
            wav.writeframes(b'\x00\x00' * 12000)
    try:
        result = await router_module._import_material(router_module.WorkspaceImportRequest(
            project_id='background', name=target.name))
        assert result['duration'] == (0 if extension == 'svg' else 1.5)
        assert service._loop is not asyncio.get_running_loop()
        assert service._research_locks == {}

        async def check_row():
            async with service._session_factory() as session:
                row = (await session.execute(select(CachedMaterial))).scalar_one()
                assert row.source_url == result['local_url']
        await service._dispatch(check_row())
    finally:
        if service._loop:
            await service._dispatch(service._engine.dispose())
            service._loop.call_soon_threadsafe(service._loop.stop)
            service._loop_thread.join(timeout=3)
            service._loop.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('phase', ['before_commit', 'after_commit', 'reuse'])
async def test_failed_or_cancelled_import_preserves_committed_files(
        toolkit_workspace, workspace_downloads, monkeypatch, phase):
    import asyncio
    from pathlib import Path
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
    from app.models.db_models import CachedMaterial
    from app.services.composition import media_probe
    target = workspace_store.project_directory('cancel-import') / 'files/test.svg'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text('<svg width="2" height="2"/>', encoding='utf-8')
    body = router_module.WorkspaceImportRequest(project_id='cancel-import', name=target.name)
    if phase == 'reuse':
        await router_module._import_material(body)

    async def cancelled_probe(*args):
        raise asyncio.CancelledError

    class FailedRefresh(AsyncSession):
        async def refresh(self, *args, **kwargs):
            raise RuntimeError('response failed after commit')

    if phase == 'after_commit':
        workspace_downloads._session_factory = async_sessionmaker(
            workspace_downloads._session_factory.kw['bind'], class_=FailedRefresh,
            expire_on_commit=False)
    else:
        monkeypatch.setattr(media_probe, 'probe_workspace_media', cancelled_probe)
    with pytest.raises(AgentToolkitError if phase == 'after_commit' else asyncio.CancelledError):
        await router_module._import_material(body)
    async with workspace_downloads._session_factory() as session:
        rows = list((await session.execute(select(CachedMaterial))).scalars())
        assert len(rows) == (0 if phase == 'before_commit' else 1)
        for row in rows:
            assert Path(row.local_path).read_bytes() == target.read_bytes()
    assert target.is_file()
    assert workspace_downloads._research_locks == {}
    assert not list(workspace_downloads.cache_dir.rglob('*.part'))


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
