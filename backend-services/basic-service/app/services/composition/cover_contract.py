"""严格封面导出：锁内解析版本，固定请求快照，租约保护整个导出。"""
from __future__ import annotations

import asyncio
import hashlib
import math
import threading
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image

from app.models.video_models import VideoCompositionRequest
from app.services import video_cover_asset_service as assets
from app.services import video_cover_v2_service as covers
from app.services.composition.composition_outcome import CompositionStageError


class CoverCompositionError(CompositionStageError):
    code = 'COVER_EXPORT_FAILED'

    def __init__(self, message: str) -> None:
        super().__init__('cover', message)


@dataclass
class PreparedCover:
    request: VideoCompositionRequest
    path: Path
    lease: assets.AssetLease
    loop: asyncio.AbstractEventLoop
    _released: bool = False
    _release_lock: threading.Lock = field(default_factory=threading.Lock)

    def release(self) -> None:
        """资产计数只在创建它的事件循环更新，工作线程不得并发写字典。"""
        with self._release_lock:
            if self._released:
                return
            self._released = True
        try:
            same_loop = asyncio.get_running_loop() is self.loop
        except RuntimeError:
            same_loop = False
        if same_loop or not self.loop.is_running():
            self.lease.release()
        else:
            self.loop.call_soon_threadsafe(self.lease.release)


def _near(value: float, expected: float) -> bool:
    return math.isfinite(value) and abs(value - expected) <= 1e-6


def _validate_timeline(request: VideoCompositionRequest):
    required = request.required_cover
    matching = [item for item in request.image_items
                if item.id == required.image_item_id]
    all_items = (request.image_items + request.video_items
                 + request.audio_items + request.subtitle_items)
    if len(matching) != 1 or sum(item.id == required.image_item_id
                                for item in all_items) != 1:
        raise CoverCompositionError('封面图片引用缺失或重复')
    item = matching[0]
    frames = item.duration * 30
    if (request.output_fps != 30 or not math.isfinite(frames)
            or not 3 <= round(frames) <= 150 or not _near(frames, round(frames))):
        raise CoverCompositionError('封面只支持 30fps 和 3–150 个整数帧')
    pos = item.position
    if (not _near(item.start_time, 0) or not _near(item.opacity, 1)
            or not all(_near(value, expected) for value, expected in (
                (pos.x, 0), (pos.y, 0), (pos.width, 1), (pos.height, 1),
                (pos.rotation, 0), (item.fade_in_duration, 0),
                (item.fade_out_duration, 0))) or item.camera_motion is not None):
        raise CoverCompositionError('封面须在首帧全画幅、不透明且无动画')
    if not math.isfinite(request.total_duration) or request.total_duration < item.duration:
        raise CoverCompositionError('导出长度不能截断封面')
    for other in all_items:
        if other is item:
            continue
        if other in request.image_items and other.opacity <= 0.001:
            continue
        if other in request.subtitle_items and not other.text.strip():
            continue
        if other in request.audio_items and other.volume <= 0:
            continue
        if (not math.isfinite(other.start_time) or not math.isfinite(other.duration)
                or other.start_time < item.duration - 1e-6):
            raise CoverCompositionError('其他内容侵入封面片头区间')
    return item


def _verify_png(path: Path, asset, request: VideoCompositionRequest) -> None:
    data = assets.read_limited(path)
    if hashlib.sha256(data).hexdigest() != asset.sha256:
        raise CoverCompositionError('封面 PNG 校验值不匹配')
    resolution = request.output_resolution
    with Image.open(path) as image:
        if image.format != 'PNG' or getattr(image, 'n_frames', 1) != 1:
            raise CoverCompositionError('封面必须是有效静态 PNG')
        expected = (resolution['width'], resolution['height'])
        if image.size != expected or image.size != (asset.width, asset.height):
            raise CoverCompositionError('封面版本尺寸与导出尺寸不一致')
        image.load()


async def prepare_required_cover(db, request: VideoCompositionRequest) -> PreparedCover | None:
    """路由在线程启动前调用；非封面请求保留原有宽容策略。"""
    if request.required_cover is None:
        return None
    snapshot = request.model_copy(deep=True)
    required = snapshot.required_cover
    try:
        item = _validate_timeline(snapshot)
        async with assets.project_locks(required.project_id):
            await assets.require_project(db, required.project_id)
            revision = await covers.get_revision(db, required.project_id, required.revision_id)
            asset = await assets.get_asset(db, required.project_id, revision.asset_id)
            path = assets.asset_path(asset)
            if (required.sha256 != asset.sha256
                    or assets.local_source_path(item.url) != path):
                raise CoverCompositionError('封面引用与不可变版本不一致')
            await assets.run_blocking(_verify_png, path, asset, snapshot)
            return PreparedCover(snapshot, path, assets.AssetLease(required.project_id),
                                 asyncio.get_running_loop())
    except CoverCompositionError:
        raise
    except Exception as exc:
        raise CoverCompositionError(f'封面不可导出：{exc}') from exc


def require_strict_images(info: dict | None, items, reason: str) -> None:
    strict = (info or {}).get('strict_image_ids', set())
    if any(getattr(item, 'id', None) in strict for item in items):
        raise CoverCompositionError(reason)
