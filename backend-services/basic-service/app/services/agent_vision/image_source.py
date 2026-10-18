"""图像来源闭集解析：枚举来源 + 标识 → 白名单根内的真实文件。

设计基线：docs/plans/agent-visual-review/spec.md §4.4。

**绝不接受任意路径或 URL**。工具参数只给 `source` + 标识，服务端负责把标识
落进六个白名单根（R1–R6）之一，并在读字节之前完成全部越界判定。

白名单根：

| # | 根 | 内容 |
|---|---|---|
| R1 | `<STORAGE_ROOT>/cached_materials/**` | 远程检索/下载缓存 |
| R2 | `<STORAGE_ROOT>/{video,audio,image,images,files}/**` | 本地上传素材 |
| R3 | `<STORAGE_ROOT>/projects/<project_key>/covers/**` | 封面资产 |
| R4 | `<STORAGE_ROOT>/static/video/composed/**` | 导出成品 |
| R5 | `<STORAGE_ROOT>.parent/agent_workspace/**` | 工作区产物 |
| R6 | `<STORAGE_ROOT>.parent/research_artifacts/**` | 研究素材 |

**隐私纪律**（§4.13.4）：`source_ref` 与 `label` 永远不含绝对路径——它们会
进日志、进 `/capabilities`、进模型可见文本。绝对路径只在本模块内部流转。
"""
import os
import re
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

from app.models.agent_vision_models import AgentVisionError

# `storage_key` 的硬约束（§4.4 拒绝规则）：非空、≤256、无盘符、无前导分隔符、
# 无 `..`，且 resolve 后必须落在 R1/R2 内。
MAX_STORAGE_KEY_LENGTH = 256
# R2 的五个子目录；`image` 与 `images` 都要收（历史数据两种都写过）。
UPLOAD_ROOT_NAMES = ("video", "audio", "image", "images", "files")

_DRIVE_PREFIX = re.compile(r"^[A-Za-z]:")
# Windows 非法文件名字符 + 控制字符：出现在相对键里只可能是拼出来的坏值。
_FORBIDDEN_CHARS = re.compile(r'[\x00-\x1f<>:"|?*]')

COMPOSITION_GONE_MESSAGE = (
    "成片已不可探测（应用重启或超过 1 小时）。请重新导出，然后立刻让我自检。"
)


@dataclass(frozen=True)
class ResolvedImage:
    """解析结果；`data` 只在来源本身已读到内存时使用（artifact / frame）。"""

    path: Path
    source_kind: str
    source_ref: str
    label: str
    data: bytes | None = None


# ── 白名单根 ──────────────────────────────────────────────────────────────


def storage_root() -> Path:
    from app.config import settings

    return Path(settings.storage.root).resolve()


def composed_root() -> Path:
    """R4：成品目录必须用 `local_media_resolver` 的口径（它会锚定 SERVICE_ROOT）。"""
    from app.services.local_media_resolver import composed_output_dir

    return Path(composed_output_dir()).resolve()


def whitelist_roots() -> list[tuple[str, Path]]:
    """R1–R6 的当前绝对路径（R2 的五个子目录各占一条）。

    每次调用重算，便于测试 monkeypatch 存储根；返回顺序即优先级。
    """
    root = storage_root()
    parent = root.parent
    entries = [("r1", root / "cached_materials")]
    entries.extend((f"r2:{name}", root / name) for name in UPLOAD_ROOT_NAMES)
    entries.extend([
        ("r3", root / "projects"),
        ("r4", composed_root()),
        ("r5", parent / "agent_workspace"),
        ("r6", parent / "research_artifacts"),
    ])
    return entries


def _material_roots() -> tuple[Path, ...]:
    root = storage_root()
    return (root / "cached_materials",
            *(root / name for name in UPLOAD_ROOT_NAMES))


def _inside(path, roots) -> Path | None:
    """`resolve()` + `realpath()` 双重包含性判定（防符号链接与 8.3 别名）。"""
    try:
        resolved = Path(path).resolve()
        real = Path(os.path.realpath(path))
    except (OSError, ValueError):  # pragma: no cover - 极端路径
        return None
    for root in roots:
        try:
            resolved_root = Path(root).resolve()
            real_root = Path(os.path.realpath(root))
        except (OSError, ValueError):  # pragma: no cover
            continue
        if (resolved.is_relative_to(resolved_root)
                and real.is_relative_to(real_root)):
            return resolved
    return None


# ── 错误构造 ──────────────────────────────────────────────────────────────


def _unsupported(message: str) -> AgentVisionError:
    return AgentVisionError("source_unsupported", message=message)


def _not_found(message: str) -> AgentVisionError:
    error = AgentVisionError("source_not_found", message=message)
    error.next_step = "用 list_materials 确认素材/封面/成品仍然存在。"
    return error


def _composition_missing() -> AgentVisionError:
    error = AgentVisionError("composition_not_found",
                             message=COMPOSITION_GONE_MESSAGE)
    error.next_step = "先导出，再让 Agent 立刻自检。"
    return error


# ── storage_key 校验（读字节之前） ─────────────────────────────────────────


def validate_storage_key(key: str) -> str:
    """返回归一化的相对键；任一不合规即 `source_unsupported`。

    这是 P0-1 的回归点：v1 直接把前端给的字符串拼进路径，等于把白名单作废。
    """
    if not isinstance(key, str) or not key.strip():
        raise _unsupported("storage_key must be a non-empty string")
    cleaned = key.strip().replace("\\", "/")
    if len(cleaned) > MAX_STORAGE_KEY_LENGTH:
        raise _unsupported(
            f"storage_key must be at most {MAX_STORAGE_KEY_LENGTH} characters")
    if _DRIVE_PREFIX.match(cleaned):
        raise _unsupported("storage_key must not contain a drive letter")
    if cleaned.startswith("/"):
        raise _unsupported("storage_key must not start with a separator")
    if _FORBIDDEN_CHARS.search(cleaned):
        raise _unsupported(
            "storage_key contains characters that are not allowed")
    segments = cleaned.split("/")
    if any(segment in ("", ".", "..") for segment in segments):
        raise _unsupported("storage_key must not contain '.'/'..' segments")
    return cleaned


def _storage_path_for_key(key: str) -> Path:
    """相对键 → R1/R2 内的绝对路径；越界即 `source_unsupported`。"""
    root = storage_root()
    inside = _inside(root / key, _material_roots())
    if inside is None:
        raise _unsupported(
            "storage_key must resolve inside cached_materials/ or "
            "an upload folder")
    return inside


def _relative_ref(path: Path) -> str:
    """去敏标识：尽量给 STORAGE_ROOT 相对路径，绝不回传绝对路径。"""
    root = storage_root()
    try:
        return Path(path).resolve().relative_to(root).as_posix()
    except ValueError:
        return Path(path).name


def _label(prefix: str, name: str) -> str:
    return f"{prefix}：{Path(str(name)).name}"


# ── 数据库入口 ────────────────────────────────────────────────────────────


def _session_factory(session_factory=None):
    if session_factory is not None:
        return session_factory
    from app.database import async_session_factory

    return async_session_factory


async def _cached_material_row(session, material_id: str):
    """先按主键（UUID）查，再退到 `source_id`（前端 materialId 的两种形态）。"""
    from sqlalchemy import select

    from app.models.db_models import CachedMaterial

    row = None
    try:
        row = await session.get(CachedMaterial, UUID(str(material_id)))
    except (ValueError, TypeError, AttributeError):
        row = None
    if row is not None:
        return row
    statement = (select(CachedMaterial)
                 .where(CachedMaterial.source_id == str(material_id))
                 .order_by(CachedMaterial.created_at.desc()))
    return (await session.execute(statement)).scalars().first()


async def _cached_material_path(material_id: str, session_factory=None):
    """路径 B：只有 `material_id` 时按 `cached_materials` 行解析（R1）。"""
    factory = _session_factory(session_factory)
    async with factory() as session:
        row = await _cached_material_row(session, material_id)
    if row is None or (row.status or "") != "ready":
        return None
    local_path = row.local_path or ""
    if not local_path:
        return None
    try:
        path = Path(local_path).resolve()
    except OSError:  # pragma: no cover - 坏路径
        return None
    if not path.is_file():
        return None
    # 缓存行的 local_path 来自下载服务，仍要复核它落在 R1 内。
    return _inside(path, (storage_root() / "cached_materials",))


# ── 各来源解析 ────────────────────────────────────────────────────────────


async def _resolve_material(ref, session_factory=None) -> ResolvedImage:
    """路径 A（`storage_key`）优先，路径 B（`material_id` 查缓存表）回退。"""
    if ref.storage_key:
        key = validate_storage_key(ref.storage_key)
        path = _storage_path_for_key(key)
        if not path.is_file():
            raise _not_found(f"material file not found: {Path(key).name}")
        return ResolvedImage(path, "material", key, _label("素材", key))
    if not ref.material_id:
        raise _unsupported("material source needs material_id or storage_key")
    path = await _cached_material_path(ref.material_id, session_factory)
    if path is None:
        raise _not_found(
            f"material not found in cached_materials: {ref.material_id}")
    reference = _relative_ref(path)
    return ResolvedImage(path, "material", reference, _label("素材", reference))


async def _cover_asset_row(session, project_key: str, asset_id: str | None):
    from sqlalchemy import select

    from app.models.db_models import ProjectCoverAsset

    project_uuid = UUID(str(project_key))
    if asset_id:
        row = None
        try:
            row = await session.get(ProjectCoverAsset, UUID(str(asset_id)))
        except (ValueError, TypeError):
            row = None
        if row is None or str(row.project_id) != project_key:
            return None
        return row
    statement = (select(ProjectCoverAsset)
                 .where(ProjectCoverAsset.project_id == project_uuid)
                 .order_by(ProjectCoverAsset.created_at.desc()))
    return (await session.execute(statement)).scalars().first()


async def _resolve_cover(ref, project_id,
                         session_factory=None) -> ResolvedImage:
    """封面资产（R3）；无 `project_id` 或项目无封面 → `source_not_found`。"""
    from app.models.video_cover_v2_models import CoverError
    from app.services.video_cover_asset_service import asset_path, project_key

    if not project_id:
        raise _not_found("cover source needs a project_id")
    try:
        key = project_key(project_id)
    except (ValueError, TypeError):
        raise _not_found("project_id is not a valid project id") from None
    factory = _session_factory(session_factory)
    async with factory() as session:
        row = await _cover_asset_row(session, key, ref.asset_id)
    if row is None:
        raise _not_found("this project has no cover asset yet")
    try:
        path = asset_path(row)
    except CoverError:
        raise _not_found(
            "cover asset path is outside the project covers") from None
    if not path.is_file():
        raise _not_found("cover asset file is missing on disk")
    reference = f"cover/{row.id}"
    return ResolvedImage(path, "cover", reference, _label("封面", reference))


def _resolve_workspace(ref, project_id) -> ResolvedImage:
    """工作区产物（R5）；沿用 `workspace_store` 的 7 步路径安全。"""
    from app.models.agent_toolkit_models import AgentToolkitError
    from app.services.agent_toolkit import workspace_store

    if not ref.name:
        raise _unsupported("workspace source needs a name")
    try:
        path, relative = workspace_store.resolve_file(project_id, ref.name)
    except AgentToolkitError as error:
        if error.error_code in {"workspace_not_found"}:
            raise _not_found(
                f"workspace file not found: {error.message}") from None
        raise _unsupported(f"invalid workspace name: {error.message}") from None
    return ResolvedImage(path, "workspace", f"workspace/{relative}",
                         _label("工作区", relative))


async def _resolve_artifact(ref, project_id,
                            session_factory=None) -> ResolvedImage:
    """研究资料（R6）；用第一轮既有的不可变快照读取（`pinned()`）。"""
    from app.models.agent_toolkit_models import (
        AgentToolkitError,
        normalize_project_id,
    )
    from app.models.web_research_models import WebResearchError

    if not ref.artifact_id:
        raise _unsupported("artifact source needs an artifact_id")
    try:
        normalized = normalize_project_id(project_id)
    except AgentToolkitError as error:
        raise _unsupported(error.message) from None
    store = _artifact_store()
    try:
        async with store.pinned(ref.artifact_id, normalized) as (row, body):
            path = Path(store.root) / row.relative_path
            kind = row.kind
    except WebResearchError as error:
        raise _not_found(
            f"research artifact unavailable: {error.error_code}") from None
    reference = f"artifact/{ref.artifact_id}"
    return ResolvedImage(path, "artifact", reference,
                         _label("研究素材", kind or reference), data=bytes(body))


# ── 视频来源（frame / export） ─────────────────────────────────────────────


def _composition_service():
    """延迟导入：`video_router` 会连带 FastAPI/合成服务，不能进模块导入期。"""
    from app.routers.video_router import video_composition_service

    return video_composition_service


def _artifact_store():
    """延迟导入：研究域自带 DB 单例，不该在视觉域导入期加载。"""
    from app.services.web_research.artifact_store import get_artifact_store

    return get_artifact_store()


def _recent_completed_id(service) -> str | None:
    """本进程内最近一次 `completed` 的合成 id。

    `VideoCompositionRequest` **不带 project id**（见 `app/models/video_models.py`），
    因此"本项目最近一次完成"在本进程内只能退化为"本进程内最近一次完成"
    ——spec §4.4 已记录该退化。它只用于定位，不是权限凭证：随后仍走
    `get_download_info()` 的状态与存在性校验。
    """
    best = None
    for composition_id, info in list((service.compositions or {}).items()):
        if (info or {}).get("status") != "completed":
            continue
        started = float(info.get("start_time") or 0.0)
        if best is None or started > best[0]:
            best = (started, composition_id)
    return best[1] if best else None


def resolve_composition_path(composition_id=None, project_id=None):
    """返回 `(成品路径, 去敏标识)`；只允许 R4 内的文件。

    **绝不**把 `output_file_path` 暴露到本函数之外（`video_router.py:287` 的
    状态白名单也没有它）。
    """
    service = _composition_service()
    resolved_id = composition_id or _recent_completed_id(service)
    if not resolved_id:
        raise _composition_missing()
    info = service.get_download_info(resolved_id)
    if not info or not info.get("file_path"):
        raise _composition_missing()
    inside = _inside(info["file_path"], (composed_root(),))
    if inside is None or not inside.is_file():
        raise _composition_missing()
    return inside, f"composition/{resolved_id}"


async def _resolve_frame(ref, project_id,
                         session_factory=None) -> ResolvedImage:
    """单一时刻画面：先解析出视频文件，再抽该时刻单帧（§4.4 `frame`）。"""
    from app.services.agent_vision import frame_sampler

    kind = "composition" if ref.composition_id else "material"
    path, reference = await resolve_video_path(
        kind, material_id=ref.material_id, storage_key=ref.storage_key,
        composition_id=ref.composition_id, project_id=project_id,
        session_factory=session_factory)
    at_seconds = float(ref.at_seconds) if ref.at_seconds is not None else None
    moment, jpeg = await frame_sampler.sample_single(path, at_seconds)
    return ResolvedImage(
        path, "frame", f"{reference}@{moment:.2f}s",
        f"画面：{frame_sampler.format_timecode(moment)}", data=jpeg)


async def resolve_video_path(
    kind: str,
    *,
    material_id: str | None = None,
    storage_key: str | None = None,
    composition_id: str | None = None,
    name: str | None = None,
    project_id=None,
    session_factory=None,
):
    """`(视频路径, 去敏标识)`——抽帧端点与 `frame`/`export` 来源共用。

    `kind='composition'` 时 `composition_id` 可省：退化为"本进程内最近一次
    `completed`"（§4.4 已记录的退化，见 `_recent_completed_id`）。
    """
    from types import SimpleNamespace

    if kind == "composition":
        return resolve_composition_path(composition_id, project_id)
    if kind == "workspace":
        if not name:
            raise _unsupported("workspace source needs a name")
        resolved = _resolve_workspace(SimpleNamespace(name=name), project_id)
        return resolved.path, resolved.source_ref
    if kind != "material":
        raise _unsupported(f"unsupported frame source: {kind}")
    material = await _resolve_material(
        SimpleNamespace(storage_key=storage_key, material_id=material_id),
        session_factory)
    return material.path, material.source_ref


async def _resolve_export(ref, project_id) -> ResolvedImage:
    """成品抽检：`get_download_info()` 内部解析路径，只把一帧交给视觉。"""
    from app.services.agent_vision import frame_sampler

    path, reference = resolve_composition_path(ref.composition_id, project_id)
    at_seconds = float(ref.at_seconds) if ref.at_seconds is not None else None
    moment, jpeg = await frame_sampler.sample_single(path, at_seconds)
    return ResolvedImage(
        path, "export", f"{reference}@{moment:.2f}s",
        f"成品：{frame_sampler.format_timecode(moment)}", data=jpeg)


# ── 公共入口 ──────────────────────────────────────────────────────────────


async def resolve_image(ref, project_id=None, *,
                        session_factory=None) -> ResolvedImage:
    """把 `ImageRef` 解析成白名单内的真实图像；否则抛闭集错误。"""
    kind = getattr(ref, "source", None)
    if kind == "material":
        return await _resolve_material(ref, session_factory)
    if kind == "cover":
        return await _resolve_cover(ref, project_id, session_factory)
    if kind == "workspace":
        return _resolve_workspace(ref, project_id)
    if kind == "artifact":
        return await _resolve_artifact(ref, project_id, session_factory)
    if kind == "frame":
        return await _resolve_frame(ref, project_id, session_factory)
    if kind == "export":
        return await _resolve_export(ref, project_id)
    raise _unsupported(f"unsupported image source: {kind}")
