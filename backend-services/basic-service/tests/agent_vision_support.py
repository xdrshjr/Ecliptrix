"""Agent Vision 测试共用支撑：临时存储根 + 独立 SQLite + 假 Request + 假图。

刻意与 `tests/agent_toolkit_support.py` 分开（不复用其夹具）：两个域的夹具
语义不同，混用会让"这个 tmp 目录是谁的"变得不可读。
"""
import io
import sys
import types

import pytest
import pytest_asyncio
from PIL import Image
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

import app.models.agent_vision_db_models  # noqa: F401  (注册两张新表)
import app.models.research_db_models  # noqa: F401  (artifact 来源的表)
from app.models.db_models import Base


class FakeRequest:
    """最小 Request 替身：闸门只看 headers（与 toolkit 测试同构）。"""

    def __init__(self, headers=None):
        self.headers = dict(headers or {})


def origin_headers(**extra):
    headers = {"origin": "http://localhost:3000"}
    headers.update(extra)
    return headers


def write_request(**extra):
    """写类端点的合规请求头：Origin + JSON + call id。"""
    return FakeRequest(origin_headers(**{
        "content-type": "application/json",
        "x-tool-call-id": "call-1",
        **extra,
    }))


# ── 图像素材 ──────────────────────────────────────────────────────────────


def png_bytes(width=64, height=48, color=(200, 40, 40), mode="RGB",
              alpha=None) -> bytes:
    image = Image.new(mode, (width, height), color)
    if alpha is not None and mode == "RGBA":
        image.putalpha(alpha)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def jpeg_bytes(width=64, height=48, color=(20, 120, 200)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), color).save(buffer, format="JPEG")
    return buffer.getvalue()


def exif_oriented_jpeg(width=120, height=60) -> bytes:
    """带 EXIF Orientation=6（顺时针 90°）的横向 JPEG；正立化后应变成纵向。"""
    image = Image.new("RGB", (width, height), (10, 10, 10))
    exif = Image.Exif()
    exif[274] = 6
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", exif=exif)
    return buffer.getvalue()


def noise_jpeg_bytes(width=400, height=300, seed=7) -> bytes:
    """高频噪声图：JPEG 压不动，用来逼出"质量阶梯 + 尺寸回退"。"""
    import random

    generator = random.Random(seed)
    image = Image.new("RGB", (width, height))
    image.putdata([(generator.randrange(256), generator.randrange(256),
                    generator.randrange(256))
                   for _ in range(width * height)])
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=95)
    return buffer.getvalue()


def image_size(body: bytes) -> tuple[int, int]:
    with Image.open(io.BytesIO(body)) as image:
        return image.size


# ── 存储根 ────────────────────────────────────────────────────────────────


@pytest.fixture
def vision_storage(tmp_path, monkeypatch):
    """把 STORAGE_ROOT / 成品目录 / 视觉产物目录全指到 tmp_path。"""
    from app.services import storage_service as storage_module
    from app.services.agent_vision import image_source, observation_store

    root = tmp_path / "uploads"
    for name in ("cached_materials", "video", "images", "files"):
        (root / name).mkdir(parents=True, exist_ok=True)
    (root / "static" / "video" / "composed").mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(storage_module.storage_service, "root", root)
    monkeypatch.setattr(image_source, "storage_root", lambda: root)
    monkeypatch.setattr(
        image_source, "composed_root",
        lambda: root / "static" / "video" / "composed")
    monkeypatch.setattr(
        observation_store, "observation_root",
        lambda: tmp_path / "agent_vision")
    return root


@pytest.fixture
def vision_workspace(tmp_path, monkeypatch):
    """工作区根（R5）指到 tmp_path/agent_workspace。"""
    from app.services.agent_toolkit import workspace_store

    root = tmp_path / "agent_workspace"
    root.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(workspace_store, "workspace_root", lambda: root)
    return root


# ── 设置 ──────────────────────────────────────────────────────────────────


@pytest.fixture
def vision_settings(monkeypatch):
    """按需覆盖 `agent_vision_settings()`；`probe` 块逐键合并。"""
    from app.services import system_settings_service as module

    def apply(**overrides):
        base = dict(module.AGENT_VISION_DEFAULTS)
        probe = dict(module.AGENT_VISION_DEFAULTS["probe"])
        probe.update(overrides.pop("probe", {}))
        base.update(overrides)
        base["probe"] = probe
        monkeypatch.setattr(module, "agent_vision_settings", lambda: base)
        return base

    return apply


# ── 数据库 ────────────────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def vision_engine():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False)
    try:
        yield factory
    finally:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
        await engine.dispose()


@pytest.fixture
def wire_database(monkeypatch, vision_engine):
    """把服务层默认的 session factory 指到测试库。"""
    import app.database as database

    monkeypatch.setattr(database, "async_session_factory", vision_engine)
    return vision_engine


# ── cv2 替身（真实 OpenCV 在本机是坏的，见 conftest.py） ────────────────────


class FakeCapture:
    """最小 VideoCapture 替身：按 seek 的位置返回纯色帧。"""

    def __init__(self, frames=None, duration=4.0, opened=True):
        self.frames = frames if frames is not None else [1, 2, 3, 4]
        self.duration = duration
        self.opened = opened
        self.position_ms = 0.0
        self.released = False

    def isOpened(self):  # noqa: N802 - 模仿 cv2 命名
        return self.opened

    def set(self, prop, value):  # noqa: N802
        self.position_ms = float(value)
        return True

    def read(self):
        seconds = self.position_ms / 1000.0
        if seconds > self.duration:
            return False, None
        # 帧内容随时刻变化，便于断言"不同时间点拿到不同图"。
        return True, {"seconds": seconds}

    def get(self, prop):  # noqa: N802
        return {"fps": 10.0, "count": 40.0}.get(
            "fps" if prop == 5 else "count", 0.0)

    def release(self):  # noqa: N802
        self.released = True


def fake_cv2_module(capture=None):
    """装一个能过 `frame_sampler` 全部调用的 cv2 替身模块。"""
    module = types.ModuleType("cv2")
    holder = {"capture": capture or FakeCapture()}
    module.CAP_PROP_POS_MSEC = 0
    module.CAP_PROP_FPS = 5
    module.CAP_PROP_FRAME_COUNT = 7
    module.IMWRITE_JPEG_QUALITY = 1
    module.VideoCapture = lambda _path: holder["capture"]
    module.imencode = lambda _ext, frame, _params=None: (
        True, jpeg_bytes(320, 180, (60, 60, 60)))
    module.holder = holder
    return module


@pytest.fixture
def fake_cv2(monkeypatch):
    """把 `frame_sampler._load_cv2` 换成替身，绕开损坏的真实 OpenCV。"""
    from app.services.agent_vision import frame_sampler

    capture = FakeCapture()
    module = fake_cv2_module(capture)
    monkeypatch.setattr(frame_sampler, "_load_cv2", lambda: module)
    return {"module": module, "capture": capture}


def install_fake_cv2(monkeypatch, module=None):
    """给需要真实 `import cv2` 的路径铺一个 sys.modules 条目。"""
    module = module or fake_cv2_module()
    monkeypatch.setitem(sys.modules, "cv2", module)
    return module
