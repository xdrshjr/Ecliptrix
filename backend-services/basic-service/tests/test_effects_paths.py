"""Real directory-link regressions for project writes and reclamation."""

import os
import subprocess
import time
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from PIL import Image

from app.models.effects_models import AttachInputRequest, EffectError
from app.services.effects import asset_service as assets, recovery
from app.services.effects.catalog import create_document
from tests.test_effects_jobs import create_project


def link_directory(link, target):
    link.parent.mkdir(parents=True, exist_ok=True)
    target.mkdir(parents=True, exist_ok=True)
    if os.name == "nt":
        script = ("New-Item -ItemType Junction -Path '"
                  + str(link).replace("'", "''") + "' -Target '"
                  + str(target).replace("'", "''") + "' | Out-Null")
        result = subprocess.run([
            "powershell", "-NoProfile", "-Command", script,
        ], capture_output=True, check=False)
        assert result.returncode == 0, result.stderr.decode(errors="replace")
    else:
        link.symlink_to(target, target_is_directory=True)


@pytest.mark.asyncio
async def test_input_snapshot_rejects_junction_before_writing(
        db_session, monkeypatch, tmp_path):
    project = await create_project(db_session, monkeypatch, tmp_path)
    Image.new("RGB", (80, 80)).save(tmp_path / "source.png")
    outside = tmp_path / "outside"
    link_directory(assets.project_directory(project) / "inputs", outside)
    with pytest.raises(EffectError) as error:
        await assets.attach_input(db_session, project,
            AttachInputRequest(source_ref="/api/storage/files/source.png"))
    assert error.value.code == "EFFECT_INPUT_NOT_LOCAL"
    assert list(outside.iterdir()) == []


@pytest.mark.asyncio
@pytest.mark.parametrize("nested_input", [False, True])
async def test_work_snapshot_rejects_junction_before_copying(
        db_session, monkeypatch, tmp_path, nested_input):
    project = await create_project(db_session, monkeypatch, tmp_path)
    Image.new("RGB", (80, 80)).save(tmp_path / "source.png")
    asset, _ = await assets.attach_input(db_session, project,
        AttachInputRequest(source_ref="/api/storage/files/source.png"))
    job = SimpleNamespace(id=uuid4(), project_id=UUID(project), request_json={
        "render_snapshot": {"inputs": [asset]}})
    outside = tmp_path / "outside"
    link = assets.project_directory(project) / ".work"
    if nested_input:
        link = link / str(job.id) / "inputs"
    link_directory(link, outside)
    with pytest.raises(EffectError) as error:
        recovery.prepare_work(job, time.monotonic() + 30)
    assert error.value.code == "EFFECT_INPUT_NOT_LOCAL"
    assert list(outside.iterdir()) == []


@pytest.mark.asyncio
async def test_publication_rejects_junction_before_moving_files(
        db_session, monkeypatch, tmp_path):
    project = await create_project(db_session, monkeypatch, tmp_path)
    job = SimpleNamespace(id=uuid4(), project_id=UUID(project),
        draft_id=uuid4(), draft_version=1, result_asset_id=None,
        input_hash="a" * 64, runtime_fingerprint="b" * 64, request_json={
            "render_snapshot": {"document": create_document(),
                                "document_hash": "c" * 64}})
    directory = assets.project_directory(project)
    work = directory / ".work" / str(job.id)
    work.mkdir(parents=True)
    (work / "video.part.mp4").write_bytes(b"video sentinel")
    (work / "thumbnail.jpg.part").write_bytes(b"thumbnail sentinel")
    outside = tmp_path / "outside"
    link_directory(directory / "outputs", outside)
    with pytest.raises(EffectError) as error:
        recovery._publish_files(job, {})
    assert error.value.code == "EFFECT_INPUT_NOT_LOCAL"
    assert (work / "video.part.mp4").read_bytes() == b"video sentinel"
    assert list(outside.iterdir()) == []


@pytest.mark.asyncio
async def test_work_cleanup_never_follows_junction(
        db_session, monkeypatch, tmp_path):
    project = await create_project(db_session, monkeypatch, tmp_path)
    job = SimpleNamespace(id=uuid4(), project_id=UUID(project))
    outside = tmp_path / "outside"
    link_directory(assets.project_directory(project) / ".work", outside)
    protected = outside / str(job.id) / "retained.txt"
    protected.parent.mkdir()
    protected.write_text("keep")
    await recovery.cleanup_work(job)
    assert protected.read_text() == "keep"


@pytest.mark.asyncio
async def test_recovery_ignores_manifest_under_junction(
        db_session, monkeypatch, tmp_path):
    project = await create_project(db_session, monkeypatch, tmp_path)
    job = SimpleNamespace(id=uuid4(), project_id=UUID(project))
    outside = tmp_path / "outside"
    link_directory(assets.project_directory(project) / "outputs", outside)
    assert recovery.read_complete(job) is None


@pytest.mark.asyncio
@pytest.mark.parametrize("linked_group", [".work", "outputs", ".staging"])
async def test_stale_cleanup_never_follows_junction(
        db_session, monkeypatch, tmp_path, linked_group):
    project = await create_project(db_session, monkeypatch, tmp_path)
    directory = assets.project_directory(project)
    root = tmp_path / "effects" if linked_group == ".staging" else directory
    outside = tmp_path / "outside"
    link_directory(root / linked_group, outside)
    stale = outside / str(uuid4())
    stale.mkdir()
    protected = stale / "retained.txt"
    protected.write_text("keep")
    os.utime(stale, (time.time() - 172800, time.time() - 172800))
    recovery._cleanup_stale_files(set(), set())
    assert protected.read_text() == "keep"
