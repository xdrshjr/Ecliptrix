"""FastAPI contracts and SQLite cancellation/deletion/recovery lifecycles."""

import asyncio
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
from datetime import datetime
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.constants import LOCAL_OWNER_ID
from app.database import get_db_session
from app.models.db_models import Base, VideoProject
from app.models.effects_db_models import EffectAsset, EffectDraft, EffectRenderJob
from app.models.effects_models import EffectError, SaveDraftRequest
from app.routers import effects_router
from app.services.effects import asset_service as assets, draft_service as drafts
from app.services.effects.catalog import create_document
from app.services.effects.job_service import (
    EffectRenderService, effect_render_service, job_data,
)
from app.services.effects.runtime_client import EffectsRuntimeClient
from app.services.effects.project_locks import mark_closing
from app.services.video_project_service import video_project_service
from tests.test_effects_jobs import (
    create_project, dormant_service, job_request, prepare_draft,
)


@pytest.mark.asyncio
async def test_recent_drafts_use_stable_descending_cursor(
        db_session, monkeypatch, tmp_path):
    project = await create_project(db_session, monkeypatch, tmp_path)
    identifiers = []
    for index in range(3):
        draft = await prepare_draft(db_session, project)
        row = await db_session.get(EffectDraft, UUID(draft["draft_id"]))
        row.created_at = datetime(2026, 11, 17, 0, 0, index)
        identifiers.append(row.id)
    await db_session.commit()
    rows, cursor = await drafts.list_records(db_session, EffectDraft, project,
                                             {"page_size": 1})
    assert [row.id for row in rows] == [identifiers[2]]
    await prepare_draft(db_session, project)
    rows, cursor = await drafts.list_records(db_session, EffectDraft, project,
        {"page_size": 1, "cursor": cursor})
    assert [row.id for row in rows] == [identifiers[1]]
    rows, cursor = await drafts.list_records(db_session, EffectDraft, project,
        {"page_size": 1, "cursor": cursor})
    assert [row.id for row in rows] == [identifiers[0]]
    assert cursor is None


@pytest.mark.asyncio
async def test_queued_cancel_is_terminal_and_startup_never_rerenders(
        db_session, monkeypatch, tmp_path):
    project_id = await create_project(db_session, monkeypatch, tmp_path)
    draft = await prepare_draft(db_session, project_id)
    service = await dormant_service(db_session)
    first, _ = await service.submit(db_session, project_id, job_request(draft))
    second, _ = await service.submit(db_session, project_id, job_request(draft))
    cancelled = await service.cancel(db_session, project_id, first["job_id"])
    assert cancelled["status"] == "cancelled"
    assert (await service.cancel(db_session, project_id,
        first["job_id"]))["already_terminal"]
    await service.close()
    restored = await dormant_service(db_session)
    try:
        row = await restored.get(db_session, project_id, second["job_id"])
        assert row.status == "interrupted"
        assert row.error_code == "EFFECT_RENDER_INTERRUPTED"
    finally:
        await restored.close()


@pytest.mark.asyncio
async def test_project_closing_blocks_every_writer_and_rollback_releases_guard(
        db_session, monkeypatch, tmp_path):
    project_id = await create_project(db_session, monkeypatch, tmp_path)
    draft = await prepare_draft(db_session, project_id)
    mark_closing(project_id, True)
    try:
        with pytest.raises(EffectError) as error:
            await prepare_draft(db_session, project_id)
        assert error.value.code == "EFFECT_PROJECT_CLOSING"
    finally:
        mark_closing(project_id, False)
    assert (await prepare_draft(db_session, project_id))["draft_id"] \
        != draft["draft_id"]


@pytest.mark.asyncio
async def test_project_delete_removes_effect_rows_and_owned_files_after_commit(
        db_session, monkeypatch, tmp_path):
    project_id = await create_project(db_session, monkeypatch, tmp_path)
    await prepare_draft(db_session, project_id)
    directory = assets.project_directory(project_id)
    directory.mkdir(parents=True)
    (directory / "owned.txt").write_text("owned")
    monkeypatch.setattr(effect_render_service, "session_factory",
        async_sessionmaker(db_session.bind, expire_on_commit=False))
    assert await video_project_service.delete_project(db_session,
        LOCAL_OWNER_ID, project_id)
    assert await db_session.get(VideoProject, UUID(project_id)) is None
    assert not directory.exists()


@pytest.mark.asyncio
async def test_failed_delete_keeps_files_and_allows_saving_again(
        db_session, monkeypatch, tmp_path):
    project_id = await create_project(db_session, monkeypatch, tmp_path)
    draft = await prepare_draft(db_session, project_id)
    service = await dormant_service(db_session)
    queued, _ = await service.submit(db_session, project_id, job_request(draft))
    row = await db_session.get(EffectRenderJob, UUID(queued["job_id"]))
    row.status = "running"
    await db_session.commit()
    directory = assets.project_directory(project_id)
    directory.mkdir(parents=True)
    sentinel = directory / "retained.txt"
    sentinel.write_text("retained")
    monkeypatch.setattr(effect_render_service, "session_factory",
        async_sessionmaker(db_session.bind, expire_on_commit=False))
    try:
        with pytest.raises(EffectError):
            await video_project_service.delete_project(db_session,
                LOCAL_OWNER_ID, project_id)
        assert sentinel.read_text() == "retained"
        assert await db_session.get(VideoProject, UUID(project_id)) is not None
        assert (await prepare_draft(db_session, project_id))["version"] == 1
    finally:
        await service.close()


@pytest.mark.asyncio
async def test_real_fastapi_envelopes_cas_etag_and_quota_headers(
        db_session, monkeypatch, tmp_path):
    project_id = await create_project(db_session, monkeypatch, tmp_path)
    service = await dormant_service(db_session)
    monkeypatch.setattr(effects_router, "effect_render_service", service)
    app = FastAPI()
    app.include_router(effects_router.router, prefix="/api")
    app.add_exception_handler(EffectError, effects_router.effect_error_handler)

    async def get_test_db():
        yield db_session

    app.dependency_overrides[get_db_session] = get_test_db
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                               base_url="http://test")
    try:
        libraries = await client.get("/api/effects/libraries")
        assert len(libraries.json()["data"]) == 12
        cached = await client.get("/api/effects/libraries", headers={
            "If-None-Match": libraries.headers["etag"]})
        assert cached.status_code == 304 and cached.content == b""
        summaries = (await client.get("/api/effects/templates")).json()["data"]
        assert len(summaries["items"]) == 12 and summaries["next_cursor"]
        assert "parameter_schema" not in summaries["items"][0]
        await _assert_http_drafts(client, project_id)
    finally:
        await client.aclose()
        await service.close()


async def _assert_http_drafts(client, project_id):
    path = f"/api/effects/projects/{project_id}"
    document = create_document()
    incomplete = await client.post(path + "/drafts", json={"document": document})
    assert incomplete.status_code == 201
    draft = incomplete.json()["data"]
    assert not draft["renderability"]["ready"]
    document["content"]["title"] = "新作品"
    saved = await client.put(path + "/drafts/" + draft["draft_id"], json={
        "expected_version": 1, "name": "", "document": document})
    assert saved.status_code == 200
    stale = await client.put(path + "/drafts/" + draft["draft_id"], json={
        "expected_version": 1, "name": "", "document": document})
    assert stale.status_code == 409
    assert stale.json()["error_code"] == "EFFECT_VERSION_CONFLICT"
    for _ in range(5):
        assert (await client.post(path + "/jobs", json=job_request(
            saved.json()["data"]).model_dump())).status_code == 202
    limited = await client.post(path + "/jobs", json=job_request(
        saved.json()["data"]).model_dump())
    assert limited.status_code == 429 and limited.headers["retry-after"] == "5"
    assert limited.json()["error_details"]["retry_after"] == 5


CONTROLLER_DRIVER = r"""
const {spawn} = require('node:child_process');
const child = spawn(process.env.EFFECTS_SMOKE_ELECTRON,
  [process.env.EFFECTS_SMOKE_SERVER], {
    cwd: process.env.EFFECTS_SMOKE_CWD,
    env: {...process.env, ELECTRON_RUN_AS_NODE:'1'},
    windowsHide:true, stdio:['ignore','ignore','pipe','ipc']
  });
child.stderr.on('data', chunk => process.stderr.write(chunk));
const timer = setInterval(() => {
  if (child.connected) child.send({type:'heartbeat',
    nonce:process.env.EFFECTS_PARENT_NONCE});
}, 1000);
process.stdin.resume();
process.stdin.on('end', () => { if (child.connected) child.disconnect(); });
child.once('exit', code => { clearInterval(timer); process.exit(code || 0); });
child.once('error', () => process.exit(1));
"""


async def _start_real_controller(monkeypatch, store: Path):
    root = Path(__file__).resolve().parents[3]
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    environment = {
        "EFFECTS_RUNTIME_URL": f"http://127.0.0.1:{port}",
        "EFFECTS_RUNTIME_PORT": str(port),
        "EFFECTS_RUNTIME_TOKEN": secrets.token_urlsafe(32),
        "EFFECTS_PARENT_NONCE": secrets.token_urlsafe(32),
        "EFFECTS_RESOURCE_ROOT": str(root / "desktop/build/effects"),
        "EFFECTS_PROJECTS_ROOT": str(store / "effects/projects"),
        "EFFECTS_SMOKE_ELECTRON": str(root /
            "desktop/node_modules/electron/dist/electron.exe"),
        "EFFECTS_SMOKE_SERVER": str(root / "effects-runtime/dist/server.js"),
        "EFFECTS_SMOKE_CWD": str(root / "effects-runtime"),
    }
    for key, value in environment.items():
        monkeypatch.setenv(key, value)
    driver = subprocess.Popen(["node", "-e", CONTROLLER_DRIVER],
        stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        creationflags=0x08000000 if os.name == "nt" else 0)
    runtime = EffectsRuntimeClient()
    for _ in range(60):
        try:
            await runtime.health()
            return driver, runtime
        except EffectError:
            if driver.poll() is not None:
                raise AssertionError(driver.stderr.read().decode(errors="replace"))
            await asyncio.sleep(0.5)
    driver.stdin.close()
    raise AssertionError("Runtime did not become ready within 30 seconds")


async def _wait_job(service, factory, project_id: str, job_id: str):
    for _ in range(240):
        async with factory() as db:
            row = await service.get(db, project_id, job_id)
            if row.status in ("succeeded", "failed", "cancelled", "interrupted"):
                return await job_data(db, row)
        await asyncio.sleep(0.5)
    raise AssertionError("Real backend render exceeded two minutes")


@pytest.mark.asyncio
@pytest.mark.skipif(os.getenv("ECLIPTRIX_EFFECTS_RUNTIME_TEST") != "1",
                    reason="requires prepared Electron/browser/native resources")
async def test_real_worker_publish_restart_recovery_and_cancel(monkeypatch):
    root = Path(__file__).resolve().parents[3]
    store = root / "desktop/build/effects/backend-smoke" / str(uuid4())
    store.mkdir(parents=True)
    engine = create_async_engine("sqlite+aiosqlite:///" +
                                 (store / "effects.db").as_posix())
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    driver, runtime = await _start_real_controller(monkeypatch, store)
    service = EffectRenderService(factory, runtime=runtime)
    try:
        await service.start()
        async with factory() as db:
            project = await create_project(db, monkeypatch, store)
            draft = await prepare_draft(db, project, duration_frames=30,
                canvas={"width": 640, "height": 360, "fps": 30})
            job, _ = await service.submit(db, project, job_request(draft))
        completed = await _wait_job(service, factory, project, job["job_id"])
        assert completed["status"] == "succeeded", completed
        assert completed["output_asset"]["provenance"]["duration_frames"] == 30
        await _assert_real_recovery(service, factory, project, completed)
        await _assert_real_cancel(service, factory, project, draft)
        (store / "report.json").write_text(json.dumps({"passed": True,
            "job_id": job["job_id"], "output_asset": completed["output_asset"],
            "checks": ["real-remotion", "ffprobe", "faststart", "publish",
                       "crash-manifest-recovery", "running-cancel"]},
            ensure_ascii=False, indent=2), encoding="utf-8")
    finally:
        await service.close()
        driver.stdin.close()
        await asyncio.to_thread(driver.wait, 12)
        await engine.dispose()


async def _assert_real_recovery(service, factory, project, completed):
    asset_id = completed["output_asset"]["asset_id"]
    async with factory() as db:
        await db.execute(delete(EffectAsset).where(EffectAsset.id == UUID(asset_id)))
        row = await db.get(EffectRenderJob, UUID(completed["job_id"]))
        row.result_asset_id = None
        row.status, row.phase, row.progress = "running", "publishing", 0.99
        await db.commit()
    service._ready = False
    assert (await service.refresh_runtime())["ready"]
    recovered = await _wait_job(service, factory, project, completed["job_id"])
    assert recovered["status"] == "succeeded"
    assert recovered["output_asset"]["asset_id"] == asset_id
    assert recovered["output_asset"]["sha256"] == completed["output_asset"]["sha256"]


async def _assert_real_cancel(service, factory, project, draft):
    async with factory() as db:
        job, _ = await service.submit(db, project, job_request(draft))
    for _ in range(120):
        async with factory() as db:
            row = await service.get(db, project, job["job_id"])
            if row.phase == "frames":
                cancelled = await service.cancel(db, project, job["job_id"])
                assert cancelled["status"] in ("cancelling", "cancelled")
                break
        await asyncio.sleep(0.1)
    else:
        raise AssertionError("Real worker did not reach frames")
    final = await _wait_job(service, factory, project, job["job_id"])
    assert final["status"] == "cancelled" and final["output_asset"] is None
