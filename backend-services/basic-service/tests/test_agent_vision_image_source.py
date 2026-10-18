"""图像来源闭集：6 种来源 + 越界拒绝（AC-08，含 P0-1 的 storage_key 回归）。"""
import uuid
from types import SimpleNamespace

import pytest

from app.models.agent_vision_models import AgentVisionError, ImageRef
from app.services.agent_vision import image_source
from tests.agent_vision_support import (  # noqa: F401  (pytest fixtures)
    png_bytes,
    vision_engine,
    vision_storage,
    vision_workspace,
    wire_database,
)


def ref(**kwargs):
    return ImageRef(**kwargs)


async def resolve(image_ref, project_id=None):
    return await image_source.resolve_image(image_ref, project_id)


# ── material：路径 A（storage_key） ───────────────────────────────────────


@pytest.mark.asyncio
async def test_material_storage_key_inside_cached_materials(vision_storage):
    target = vision_storage / "cached_materials" / "pexels" / "1234.jpg"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(png_bytes(20, 20))
    resolved = await resolve(ref(source="material",
                                 storage_key="cached_materials/"
                                 "pexels/1234.jpg"))
    assert resolved.path == target.resolve()
    assert resolved.source_ref == "cached_materials/pexels/1234.jpg"


@pytest.mark.asyncio
async def test_material_storage_key_inside_upload_folder(vision_storage):
    target = vision_storage / "video" / "user_ab12" / "clip.png"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(png_bytes(20, 20))
    resolved = await resolve(ref(source="material",
                                 storage_key="video/user_ab12/clip.png"))
    assert resolved.path.name == "clip.png"


@pytest.mark.asyncio
async def test_material_storage_key_missing_file_is_not_found(vision_storage):
    with pytest.raises(AgentVisionError) as info:
        await resolve(ref(source="material",
                          storage_key="cached_materials/pexels/none.png"))
    assert info.value.error_code == "source_not_found"


@pytest.mark.asyncio
@pytest.mark.parametrize("key", [
    "C:/Windows/system32/evil.png",       # 盘符
    "/etc/passwd",                         # 前导分隔符
    "cached_materials/../../secret.png",   # 上跳
    "data:image/png;base64,AAA",           # data: 不接受
    "cached_materials/pexels\\..\\evil.png",
    "projects/x/covers/a.png",              # 白名单根外（R3 不属 material）
    "",
])
async def test_material_rejects_unsafe_storage_keys(vision_storage, key):
    """AC-08 的 3 类 storage_key 越界必须在读字节前被拒。"""
    with pytest.raises(AgentVisionError) as info:
        await resolve(ref(source="material", storage_key=key))
    assert info.value.error_code == "source_unsupported"


@pytest.mark.asyncio
async def test_material_rejects_too_long_storage_key(vision_storage):
    # 请求模型在 256 处已拦一次；这里绕过模型校验，钉住服务层的第二道闸。
    oversized = ImageRef.model_construct(
        source="material", storage_key="video/" + "a" * 300 + ".png")
    with pytest.raises(AgentVisionError) as info:
        await resolve(oversized)
    assert info.value.error_code == "source_unsupported"


@pytest.mark.asyncio
async def test_material_requires_an_identifier(vision_storage):
    with pytest.raises(AgentVisionError) as info:
        await resolve(ref(source="material"))
    assert info.value.error_code == "source_unsupported"


# ── material：路径 B（cached_materials 回退） ──────────────────────────────


@pytest.mark.asyncio
async def test_material_id_resolves_from_cached_materials(vision_storage,
                                                         wire_database):
    target = vision_storage / "cached_materials" / "pexels" / "9.jpg"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(png_bytes(20, 20))
    await _insert_cached_material(wire_database, target)
    resolved = await resolve(ref(source="material", material_id="m9"))
    assert resolved.path == target.resolve()
    assert resolved.source_ref == "cached_materials/pexels/9.jpg"


@pytest.mark.asyncio
async def test_material_id_miss_is_not_found(vision_storage, wire_database):
    with pytest.raises(AgentVisionError) as info:
        await resolve(ref(source="material", material_id="m-missing"))
    assert info.value.error_code == "source_not_found"


async def _insert_cached_material(factory, path, source_id="m9"):
    from app.models.db_models import CachedMaterial

    async with factory() as session:
        session.add(CachedMaterial(
            id=uuid.uuid4(), source="pexels", source_id=source_id,
            source_url="https://cdn.example/x.jpg",
            local_path=str(path), status="ready"))
        await session.commit()


# ── cover ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_cover_resolves_current_asset(vision_storage, wire_database):
    project_id = str(uuid.uuid4())
    relative = f"projects/{project_id}/covers/assets/a1.png"
    target = vision_storage / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(png_bytes(30, 30))
    await _insert_cover_asset(wire_database, project_id, relative)
    resolved = await resolve(ref(source="cover"), project_id)
    assert resolved.path.name == "a1.png"
    assert resolved.label.startswith("封面：")
    assert str(vision_storage) not in resolved.label


@pytest.mark.asyncio
async def test_cover_without_project_id_is_not_found(vision_storage):
    with pytest.raises(AgentVisionError) as info:
        await resolve(ref(source="cover"))
    assert info.value.error_code == "source_not_found"


@pytest.mark.asyncio
async def test_cover_for_project_without_asset_is_not_found(
        vision_storage, wire_database):
    with pytest.raises(AgentVisionError) as info:
        await resolve(ref(source="cover"), str(uuid.uuid4()))
    assert info.value.error_code == "source_not_found"


async def _insert_cover_asset(factory, project_id, relative):
    from app.models.db_models import ProjectCoverAsset

    async with factory() as session:
        session.add(ProjectCoverAsset(
            id=uuid.uuid4(), project_id=uuid.UUID(project_id), kind="render",
            relative_path=relative, sha256="0" * 64, width=30, height=30,
            byte_size=128))
        await session.commit()


# ── workspace / artifact ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_workspace_source_resolves_and_rejects_traversal(
        vision_storage, vision_workspace):
    from app.services.agent_toolkit import workspace_store

    directory = workspace_store.ensure_layout(
        workspace_store.project_directory("p1"))
    target = directory / "files" / "out" / "chart.png"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(png_bytes(10, 10))
    resolved = await resolve(
        ref(source="workspace", name="out/chart.png"), "p1")
    assert resolved.path == target
    assert resolved.source_ref == "workspace/out/chart.png"
    with pytest.raises(AgentVisionError) as info:
        await resolve(ref(source="workspace", name="../escape.png"), "p1")
    assert info.value.error_code == "source_unsupported"


@pytest.mark.asyncio
async def test_workspace_missing_file_is_not_found(vision_storage,
                                                   vision_workspace):
    with pytest.raises(AgentVisionError) as info:
        await resolve(ref(source="workspace", name="nope.png"), "p1")
    assert info.value.error_code == "source_not_found"


@pytest.mark.asyncio
async def test_artifact_missing_is_not_found(vision_storage, monkeypatch):
    monkeypatch.setattr(image_source, "_artifact_store",
                        lambda: FakeArtifactStore(vision_storage, {}))
    with pytest.raises(AgentVisionError) as info:
        await resolve(ref(source="artifact", artifact_id="art_9"))
    assert info.value.error_code == "source_not_found"


@pytest.mark.asyncio
async def test_artifact_reads_bytes_from_the_immutable_snapshot(
        vision_storage, monkeypatch):
    rows = {"art_1": SimpleNamespace(relative_path="snap.png", kind="image")}
    (vision_storage / "snap.png").write_bytes(png_bytes(8, 8))
    monkeypatch.setattr(image_source, "_artifact_store",
                        lambda: FakeArtifactStore(vision_storage, rows))
    resolved = await resolve(ref(source="artifact", artifact_id="art_1"))
    assert resolved.data is not None and resolved.source_ref == "artifact/art_1"
    assert str(vision_storage) not in resolved.label


class FakeArtifactStore:
    """只实现 `pinned()` 的最小替身：避免测出 `get_artifact_store()` 的全局状态。"""

    def __init__(self, root, rows):
        self.root = root
        self.rows = rows

    def pinned(self, identifier, project_id):
        from contextlib import asynccontextmanager

        from app.models.web_research_models import WebResearchError

        @asynccontextmanager
        async def _pinned():
            row = self.rows.get(identifier)
            if row is None:
                raise WebResearchError("artifact_not_found")
            yield row, (self.root / row.relative_path).read_bytes()

        return _pinned()


# ── export / composition ──────────────────────────────────────────────────


class FakeCompositionService:
    def __init__(self, compositions=None):
        self.compositions = compositions or {}

    def get_download_info(self, composition_id):
        info = self.compositions.get(composition_id) or {}
        if info.get("status") != "completed":
            return None
        return {"file_path": info["output_file_path"],
                "composition_id": composition_id}


@pytest.mark.asyncio
async def test_composition_not_found_uses_user_wording(vision_storage,
                                                       monkeypatch):
    monkeypatch.setattr(
        image_source, "_composition_service",
        lambda: FakeCompositionService({}))
    with pytest.raises(AgentVisionError) as info:
        image_source.resolve_composition_path(None, None)
    assert info.value.error_code == "composition_not_found"
    assert "1 小时" in info.value.message
    assert info.value.next_step


def test_recent_completed_degrades_to_process_wide(vision_storage, monkeypatch):
    """`VideoCompositionRequest` 无 project id → 只能取本进程最近一次完成。"""
    target = vision_storage / "static" / "video" / "composed" / "out.mp4"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"fake")
    service = FakeCompositionService({
        "old": {"status": "completed", "start_time": 10.0,
                "output_file_path": str(target)},
        "new": {"status": "completed", "start_time": 20.0,
                "output_file_path": str(target)},
        "running": {"status": "processing", "start_time": 30.0},
    })
    monkeypatch.setattr(image_source, "_composition_service", lambda: service)
    path, reference = image_source.resolve_composition_path(None, "any-project")
    assert path == target.resolve()
    assert reference == "composition/new"


def test_composition_outside_r4_is_refused(vision_storage, monkeypatch,
                                           tmp_path):
    outsider = tmp_path / "elsewhere.mp4"
    outsider.write_bytes(b"fake")
    service = FakeCompositionService({
        "x": {"status": "completed", "start_time": 1.0,
              "output_file_path": str(outsider)},
    })
    monkeypatch.setattr(image_source, "_composition_service", lambda: service)
    with pytest.raises(AgentVisionError) as info:
        image_source.resolve_composition_path("x", None)
    assert info.value.error_code == "composition_not_found"


# ── 去敏 ──────────────────────────────────────────────────────────────────


def test_whitelist_roots_cover_r1_to_r6(vision_storage, tmp_path, monkeypatch):
    from app.services.agent_vision import observation_store

    monkeypatch.setattr(observation_store, "observation_root",
                        lambda: tmp_path / "agent_vision")
    names = [name for name, _ in image_source.whitelist_roots()]
    assert names[0] == "r1"
    upload_roots = {"r2:video", "r2:audio", "r2:image", "r2:images",
                    "r2:files"}
    assert upload_roots <= set(names)
    assert {"r3", "r4", "r5", "r6"} <= set(names)


@pytest.mark.asyncio
async def test_source_ref_and_label_never_contain_absolute_paths(
        vision_storage, vision_workspace):
    from app.services.agent_toolkit import workspace_store

    directory = workspace_store.ensure_layout(
        workspace_store.project_directory("p1"))
    target = directory / "files" / "chart.png"
    target.write_bytes(png_bytes(10, 10))
    resolved = await resolve(ref(source="workspace", name="chart.png"), "p1")
    for text in (resolved.source_ref, resolved.label):
        assert str(vision_storage) not in text
        assert ":" not in text
        assert not text.startswith(("/", "\\"))


@pytest.mark.asyncio
async def test_unknown_source_is_unsupported(vision_storage):
    with pytest.raises(AgentVisionError) as info:
        await resolve(SimpleNamespace(source="dvd"))
    assert info.value.error_code == "source_unsupported"
