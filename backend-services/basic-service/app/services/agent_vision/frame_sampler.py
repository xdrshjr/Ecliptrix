"""按时间点抽帧（`cv2.VideoCapture` + `CAP_PROP_POS_MSEC` seek）。

设计基线：docs/plans/agent-visual-review/spec.md §4.8。

三条纪律：

1. **cv2 只在函数内 import**（`_load_cv2`）。模块导入期不得连带加载 OpenCV，
   否则路由注册、`/capabilities` 这些纯文本路径都会把 OpenCV 二进制拖进来
   （测试环境里它是坏的，见 `tests/conftest.py`）。
2. 时间点公式固定 `t_i = start + (i+0.5)·(end-start)/n`，并避开首尾各
   `EDGE_SKIP_SECONDS`（黑场/转场过渡）。
3. 单帧超过 `FRAME_TIMEOUT_SECONDS` 未解出即**跳过并记账**（`skipped[]`），
   绝不让一帧坏画面把整次审阅拖成超时。
"""
import asyncio
import time

from app.models.agent_vision_models import AgentVisionError

# 避开首尾各 0.2s：黑场淡入、转场叠化最容易出现在这两段。
EDGE_SKIP_SECONDS = 0.2
# 单帧 3s 上限（§4.8）。cv2 `read()` 无法中断，故这里做**事后**判定：超时
# 就丢弃该帧并记账，而不是假装成功。
FRAME_TIMEOUT_SECONDS = 3.0
FRAME_MAX_SIDE = 1280
FRAME_MAX_BYTES = 1024 * 1024
DEFAULT_FRAME_COUNT = 4
MAX_FRAME_COUNT = 6


def _load_cv2():
    """延迟导入：模块导入期绝不加载 OpenCV（见模块 docstring 第 1 条）。

    OpenCV 缺失/二进制损坏时 `import cv2` 抛 `ImportError`，绝不能让它以 500
    冒出去：§4.12 要求这种情况落到闭集码 `inspect_unavailable`（抽帧与探测
    都不可用时用户仍要知道"下一步做什么"）。
    """
    try:
        import cv2
    except ImportError as error:  # pragma: no cover - 依赖缺失环境
        raise AgentVisionError(
            "inspect_unavailable",
            message="frame sampling needs OpenCV, which is unavailable in this "
                    "installation",
        ) from error

    return cv2


# ── 时间点选择（纯函数，可单测） ──────────────────────────────────────────


def sample_times(
    start: float,
    end: float,
    count: int,
    *,
    edge_skip: float = EDGE_SKIP_SECONDS,
) -> list[float]:
    """返回 `count` 个时间点；区间为 0 时退化为单点（§4.8）。"""
    start = max(0.0, float(start))
    end = float(end)
    if count < 1:
        raise AgentVisionError("invalid_argument",
                              message="count must be at least 1")
    span = end - start
    if span <= 0:
        return [round(start, 3)]
    usable_start = start + min(edge_skip, span / 4.0)
    usable_end = end - min(edge_skip, span / 4.0)
    if usable_end <= usable_start:
        return [round((start + end) / 2.0, 3)]
    step = (usable_end - usable_start) / float(count)
    return [round(usable_start + (index + 0.5) * step, 3)
            for index in range(count)]


def format_timecode(seconds: float) -> str:
    """`MM:SS.s`（联系表烧入用，§4.8）。"""
    # 先按 0.1s 取整再拆分：否则 59.97s 会拆成 `00:60.0`，而这个时间码是
    # 模型在 `issues[].evidence` 里回引 `#3` 时唯一能对上的坐标。
    total = round(max(0.0, float(seconds)), 1)
    minutes, remainder = divmod(total, 60.0)
    return f"{int(minutes):02d}:{remainder:04.1f}"


# ── 时长探测 ──────────────────────────────────────────────────────────────


def _duration_seconds(cv2_module, capture) -> float | None:
    """`FRAME_COUNT / FPS` 优先；不可用时用"跳到末尾"读 POS_MSEC。"""
    try:
        fps = float(capture.get(cv2_module.CAP_PROP_FPS) or 0.0)
        frames = float(capture.get(cv2_module.CAP_PROP_FRAME_COUNT) or 0.0)
    except (RuntimeError, TypeError):  # pragma: no cover - cv2 stub 路径
        return None
    if fps > 0 and frames > 0:
        return frames / fps
    return None


def probe_duration(path) -> float | None:
    """同步时长探测；打不开文件返回 `None`（调用方决定是否报错）。"""
    cv2_module = _load_cv2()
    capture = cv2_module.VideoCapture(str(path))
    try:
        if not capture or not capture.isOpened():
            return None
        return _duration_seconds(cv2_module, capture)
    finally:
        capture.release()


# ── 抽帧 ──────────────────────────────────────────────────────────────────


def _grab_frame(cv2_module, capture, at_seconds: float, label: str):
    """seek 到 `at_seconds` 并编码；失败或超时返回 `(None, reason)`。"""
    started = time.monotonic()
    try:
        capture.set(cv2_module.CAP_PROP_POS_MSEC, float(at_seconds) * 1000.0)
        ok, frame = capture.read()
    except Exception as error:  # noqa: BLE001 - cv2 抛什么都要降级成记账
        return None, f"{label}: decoder error ({type(error).__name__})"
    elapsed = time.monotonic() - started
    if elapsed > FRAME_TIMEOUT_SECONDS:
        return None, (f"{label}: seek exceeded {FRAME_TIMEOUT_SECONDS:.0f}s "
                      f"({elapsed:.1f}s)")
    if not ok or frame is None:
        return None, f"{label}: no decodable frame at {at_seconds:.2f}s"
    return frame, None


def _encode_frame(cv2_module, frame) -> bytes:
    """先 cv2 编码，再走既有规范化管道保证 ≤1280px / ≤1 MiB。"""
    from app.services.agent_vision import image_encode

    ok, buffer = cv2_module.imencode(
        ".jpg", frame, [int(cv2_module.IMWRITE_JPEG_QUALITY), 90])
    if not ok:
        raise AgentVisionError("image_encode_failed",
                              message="cv2 could not encode the frame")
    # 编码失败由 `_sample_sync` 记进 skipped[]，不在这里吞掉。
    return image_encode.encode_bytes(
        bytes(buffer), max_side=FRAME_MAX_SIDE,
        max_bytes=FRAME_MAX_BYTES, max_input_bytes=32 * 1024 * 1024).data


def _sample_sync(path, times: list[float]):
    cv2_module = _load_cv2()
    capture = cv2_module.VideoCapture(str(path))
    frames, skipped = [], []
    try:
        if not capture or not capture.isOpened():
            raise AgentVisionError(
                "image_invalid",
                message="video could not be opened for frame sampling")
        for index, at_seconds in enumerate(times, start=1):
            label = f"frame {index} @ {at_seconds:.2f}s"
            frame, reason = _grab_frame(cv2_module, capture, at_seconds, label)
            if frame is None:
                skipped.append(reason)
                continue
            try:
                frames.append((at_seconds, _encode_frame(cv2_module, frame)))
            except AgentVisionError as error:
                skipped.append(f"{label}: {error.error_code}")
    finally:
        capture.release()
    return frames, skipped


async def sample_frames(
    path,
    start: float,
    end: float,
    count: int = DEFAULT_FRAME_COUNT,
):
    """`(times, frames, skipped)`；`frames` 是 `[(t, jpeg_bytes)]`。"""
    if count > MAX_FRAME_COUNT:
        count = MAX_FRAME_COUNT
    times = sample_times(start, end, count)
    frames, skipped = await asyncio.to_thread(_sample_sync, path, times)
    return times, frames, skipped


async def video_duration(path) -> float | None:
    """`asyncio.to_thread` 版本，供路由/服务层直接 await。"""
    return await asyncio.to_thread(probe_duration, path)


async def sample_single(path, at_seconds: float | None = None):
    """单帧抽取；`at_seconds=None` 时取中点（export/frame 来源用）。

    返回 `(t, jpeg_bytes)`；解不出即 `image_invalid`（这是硬失败，不是记账项）。
    """
    if at_seconds is None:
        duration = await video_duration(path)
        if not duration:
            raise AgentVisionError(
                "image_invalid",
                message="video duration is unknown; pass at_seconds",
            )
        at_seconds = duration / 2.0
    frames, skipped = await asyncio.to_thread(
        _sample_sync, path, [float(at_seconds)])
    if not frames:
        reason = skipped[0] if skipped else "no decodable frame"
        raise AgentVisionError("image_invalid", message=reason)
    return frames[0]
