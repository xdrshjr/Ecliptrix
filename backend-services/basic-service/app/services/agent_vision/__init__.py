"""Agent 视觉审阅与成品自检服务域。

设计基线：docs/plans/agent-visual-review/spec.md §8.2。

**导入纪律**：本包的 `__init__` 刻意**不** import 任何子模块，而是用
PEP 562 的模块级 `__getattr__` 懒加载。原因有二：

1. 子模块会连带 Pillow / httpx / OpenCV。路由注册、设置面板、`create_all`
   这些纯文本路径不该因为"有没有装好 OpenCV"而失败（桌面端曾因 cv2 二进制
   损坏导致 `app.services` 整个包不可导入）。
2. 抽帧（cv2）与探测（ffmpeg）都必须**只在函数内**导入，本文件是这道纪律
   的第一道闸。

`from app.services.agent_vision import image_source` 照常可用。
"""
from importlib import import_module

_SUBMODULES = (
    "image_source",
    "image_encode",
    "vision_client",
    "frame_sampler",
    "contact_sheet",
    "export_probe",
    "observation_store",
    "capabilities",
)

__all__ = list(_SUBMODULES)


def __getattr__(name: str):
    """按需加载子模块（`import app.services.agent_vision.image_encode` 同效）。"""
    if name in _SUBMODULES:
        module = import_module(f"{__name__}.{name}")
        globals()[name] = module
        return module
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def __dir__():
    return sorted(__all__)
