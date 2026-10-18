"""成品技术探测：ffprobe 元数据 + 黑帧/冻结/静音/响度滤镜。

设计基线：docs/plans/agent-visual-review/spec.md §4.9。

三条硬纪律：

1. **探测与视觉结论解耦**（P1-5）。技术指标由自己的开关管，没有视觉模型时
   恰恰最需要探测成片；因此本模块既不 import `vision_client`，也不检查
   `enabled`。
2. `ffmpeg`/`ffprobe` 缺失只丢技术探测，视觉抽检仍可走 cv2（§4.12）。
   缺失时抛 `ffmpeg_unavailable` 并带上 `.skipped`，由路由降级成
   "可读的下一步"而不是 500。
3. **没跑的探测器必须记账**（`skipped[]`）。"看起来全绿其实没测"是本轮
   明确禁止的假绿（§10.3 门禁 7）。

命令执行沿用 `silence_removal_service._run_cmd`（`:878-915`）的范式：
`asyncio.create_subprocess_exec` + 超时 + stderr 截断；不新增子进程工具类。
"""
import asyncio
import json
import re
import shutil

from app.models.agent_vision_models import AgentVisionError

# 单条 ffmpeg 滤镜命令的上限；探测是离线动作，可以比模型调用宽松。
PROBE_TIMEOUT_SECONDS = 120
# stderr 只留前 64 KiB（§4.9 的 probe.json 截断口径）。
STDERR_KEEP_BYTES = 64 * 1024
# 黑帧阈值固定（§4.9 表格），可调的只有"多长算问题"（probe.black_min_seconds）。
BLACK_FILTER = "blackdetect=d=0.2:pix_th=0.10"
FREEZE_FILTER = "freezedetect=n=0.001:d=2.0"
SILENCE_FILTER = "silencedetect=noise=-35dB:d=2.0"
LOUDNESS_FILTER = "ebur128=peak=true"
# 黑帧 ≥ 这个长度直接定 blocker，其余按 warning。
BLACK_BLOCKER_SECONDS = 1.0
# 首尾 0.5s 内的静音不算"长静音段"（入点/出点本来就是静音，§4.9）。
SILENCE_EDGE_SECONDS = 0.5

METADATA_SKIP = (
    "metadata", "blackdetect", "freezedetect", "silencedetect", "loudness",
)

_DURATION_TOLERANCE_MIN = 0.3
_DURATION_TOLERANCE_RATIO = 0.005

_BLACK = re.compile(
    r"black_start:\s*(?P<start>-?\d+(?:\.\d+)?)\s*"
    r"black_end:\s*(?P<end>-?\d+(?:\.\d+)?)\s*"
    r"black_duration:\s*(?P<duration>-?\d+(?:\.\d+)?)")
_FREEZE_START = re.compile(
    r"freeze_start:\s*(?P<start>-?\d+(?:\.\d+)?)")
_FREEZE_DURATION = re.compile(
    r"freeze_duration:\s*(?P<duration>-?\d+(?:\.\d+)?)")
_SILENCE_START = re.compile(
    r"silence_start:\s*(?P<start>-?\d+(?:\.\d+)?)")
_SILENCE_END = re.compile(
    r"silence_end:\s*(?P<end>-?\d+(?:\.\d+)?)")
_INTEGRATED = re.compile(r"\bI:\s*(?P<value>-?\d+(?:\.\d+)?)\s*LUFS")
_TRUE_PEAK = re.compile(r"\bPeak:\s*(?P<value>-?\d+(?:\.\d+)?)\s*dBFS")


# ── 环境 ──────────────────────────────────────────────────────────────────


def ffmpeg_binaries() -> tuple[str | None, str | None]:
    """`(ffmpeg, ffprobe)`；缺失为 `None`（打包版内置这两件，dev 机可能没有）。"""
    return shutil.which("ffmpeg"), shutil.which("ffprobe")


def require_ffmpeg() -> tuple[str, str]:
    """两者缺任一即 `ffmpeg_unavailable`；`.skipped` 列出没跑成的探测。"""
    ffmpeg, ffprobe = ffmpeg_binaries()
    if ffmpeg and ffprobe:
        return ffmpeg, ffprobe
    error = AgentVisionError(
        "ffmpeg_unavailable",
        message="ffmpeg/ffprobe not found; technical probing is unavailable",
    )
    error.next_step = (
        "重新安装桌面应用（内置 FFmpeg），或先手动打开导出目录自查。")
    error.skipped = list(METADATA_SKIP)
    raise error


def probe_thresholds(settings: dict | None = None) -> dict:
    """从 `agent_vision.probe.*` 读阈值；缺项用出厂值（§6.4）。"""
    if settings is None:
        from app.services.system_settings_service import agent_vision_settings

        settings = agent_vision_settings()
    block = (settings or {}).get("probe") or {}
    return {
        "black_min_seconds": float(block.get("black_min_seconds", 0.3)),
        "silence_min_seconds": float(block.get("silence_min_seconds", 2.0)),
        "loudness_target_lufs": float(
            block.get("loudness_target_lufs", -16)),
        "loudness_tolerance": float(block.get("loudness_tolerance", 4)),
        "true_peak_max_dbtp": float(block.get("true_peak_max_dbtp", -1.0)),
    }


# ── 命令执行（silence_removal `_run_cmd` 范式） ─────────────────────────────


class DetectorFailed(Exception):
    """单个探测器没跑成（非零退出/超时）；由调用方记进 `skipped[]`。"""


async def _run_cmd(cmd, label, *, timeout_seconds=PROBE_TIMEOUT_SECONDS):
    """返回 `(stdout, stderr)`；零退出以外一律 `DetectorFailed`。

    非零退出**绝不**当成"探测通过"：ffmpeg 失败时 stderr 里同样没有
    `black_start`/`silence_start`，静默放过就是假绿（§10.3 门禁 7）。
    """
    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(
            process.communicate(), timeout_seconds)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
        raise DetectorFailed(f"{label}: timed out") from None
    text = stderr.decode("utf-8", errors="replace")[:STDERR_KEEP_BYTES]
    if process.returncode != 0:
        raise DetectorFailed(f"{label}: exit {process.returncode}")
    return stdout.decode("utf-8", errors="replace"), text


# ── 解析器（纯函数，单测直接喂 stderr 文本） ───────────────────────────────


def parse_ffprobe(payload: str) -> dict:
    """`ffprobe -of json` → 时长/分辨率/是否有音轨。"""
    try:
        data = json.loads(payload or "{}")
    except ValueError:
        return {"duration": None, "width": None, "height": None,
                "has_audio": None, "parse_error": True}
    streams = data.get("streams") or []
    video = next((item for item in streams
                  if item.get("codec_type") == "video"), None)
    audio = any(item.get("codec_type") == "audio" for item in streams)
    raw_duration = (data.get("format") or {}).get("duration")
    try:
        duration = float(raw_duration) if raw_duration is not None else None
    except (TypeError, ValueError):
        duration = None
    return {
        "duration": duration,
        "width": (video or {}).get("width"),
        "height": (video or {}).get("height"),
        "has_audio": audio,
        "parse_error": False,
    }


def parse_blackdetect(stderr: str) -> list[dict]:
    return [{"start": float(match.group("start")),
             "end": float(match.group("end")),
             "duration": float(match.group("duration"))}
            for match in _BLACK.finditer(stderr or "")]


def parse_freezedetect(stderr: str) -> list[dict]:
    starts = [float(match.group("start"))
              for match in _FREEZE_START.finditer(stderr or "")]
    durations = [float(match.group("duration"))
                 for match in _FREEZE_DURATION.finditer(stderr or "")]
    segments = []
    for index, start in enumerate(starts):
        duration = durations[index] if index < len(durations) else None
        segments.append({"start": start,
                         "duration": duration,
                         "end": (start + duration
                                 if duration is not None else None)})
    return segments


def parse_silencedetect(stderr: str,
                        duration: float | None = None) -> list[dict]:
    """尾部静音没有 `silence_end`：用总时长补齐（同 silence_removal 口径）。"""
    segments, pending = [], None
    for line in (stderr or "").splitlines():
        start = _SILENCE_START.search(line)
        if start:
            pending = float(start.group("start"))
            continue
        end = _SILENCE_END.search(line)
        if end and pending is not None:
            segments.append({"start": pending, "end": float(end.group("end"))})
            pending = None
    if pending is not None:
        segments.append({"start": pending, "end": duration})
    for segment in segments:
        if segment["end"] is None:
            continue
        segment["duration"] = segment["end"] - segment["start"]
    return segments


def parse_ebur128(stderr: str) -> dict | None:
    """只取 Summary 段：`I`（LUFS）与 `Peak`（dBTP）。"""
    integrated = _INTEGRATED.search(stderr or "")
    peak = _TRUE_PEAK.search(stderr or "")
    if not integrated and not peak:
        return None
    return {
        "integrated_lufs": (float(integrated.group("value"))
                            if integrated else None),
        "true_peak_dbtp": float(peak.group("value")) if peak else None,
    }


# ── 判定 ──────────────────────────────────────────────────────────────────


def _issue(code: str, severity: str, note: str, at_seconds=None) -> dict:
    return {"code": code, "severity": severity, "at_seconds": at_seconds,
            "note": note}


def _metadata_issues(meta: dict, expected, timeline_duration) -> list[dict]:
    issues = []
    if meta.get("has_audio") is False:
        issues.append(_issue("missing_audio", "blocker",
                             "成片没有音频轨，整片会静音"))
    measured = meta.get("duration")
    if (timeline_duration is not None and measured is not None
            and timeline_duration > 0):
        tolerance = max(_DURATION_TOLERANCE_MIN,
                        timeline_duration * _DURATION_TOLERANCE_RATIO)
        if abs(measured - timeline_duration) > tolerance:
            issues.append(_issue(
                "duration_mismatch", "warning",
                f"成片 {measured:.2f}s，时间线 {timeline_duration:.2f}s"))
    if expected is not None:
        want = (getattr(expected, "width", None),
                getattr(expected, "height", None))
        got = (meta.get("width"), meta.get("height"))
        if all(want) and all(got) and tuple(want) != tuple(got):
            issues.append(_issue(
                "resolution_mismatch", "warning",
                f"成片 {got[0]}x{got[1]}，期望 {want[0]}x{want[1]}"))
    return issues


def _black_issues(segments, thresholds) -> list[dict]:
    issues = []
    for segment in segments:
        if segment["duration"] < thresholds["black_min_seconds"]:
            continue
        severity = ("blocker" if segment["duration"] >= BLACK_BLOCKER_SECONDS
                    else "warning")
        issues.append(_issue(
            "black_frames", severity,
            f"黑帧 {segment['duration']:.2f}s",
            at_seconds=round(segment["start"], 3)))
    return issues


def _silence_issues(segments, thresholds, duration) -> list[dict]:
    issues = []
    limit = thresholds["silence_min_seconds"]
    for segment in segments:
        if segment.get("duration") is None or segment["duration"] < limit:
            continue
        if segment["start"] <= SILENCE_EDGE_SECONDS:
            continue
        if duration is not None and segment["end"] is not None:
            if segment["end"] >= duration - SILENCE_EDGE_SECONDS:
                continue
        issues.append(_issue(
            "long_silence", "warning",
            f"静音 {segment['duration']:.2f}s",
            at_seconds=round(segment["start"], 3)))
    return issues


def _loudness_issues(loudness, thresholds) -> list[dict]:
    if not loudness:
        return []
    issues = []
    integrated = loudness.get("integrated_lufs")
    target = thresholds["loudness_target_lufs"]
    tolerance = thresholds["loudness_tolerance"]
    if integrated is not None and abs(integrated - target) > tolerance:
        issues.append(_issue(
            "loudness_out_of_range", "warning",
            f"整体响度 {integrated:.1f} LUFS（目标 {target:.0f}"
            f"±{tolerance:.0f}）"))
    peak = loudness.get("true_peak_dbtp")
    ceiling = thresholds["true_peak_max_dbtp"]
    if peak is not None and peak > ceiling:
        issues.append(_issue(
            "true_peak_clipping", "warning",
            f"真峰值 {peak:.1f} dBTP 超过 {ceiling:.1f} dBTP，可能削波"))
    return issues


def _freeze_issues(segments) -> list[dict]:
    return [_issue("freeze_frames", "note",
                   f"画面冻结 {segment['duration']:.1f}s"
                   if segment.get("duration") else "画面冻结",
                   at_seconds=round(segment["start"], 3))
            for segment in segments
            if segment.get("duration") and segment["duration"] >= 2.0]


# ── 主入口 ────────────────────────────────────────────────────────────────


async def _ffprobe_metadata(ffprobe: str, path, skipped: list[str]) -> dict:
    try:
        stdout, _ = await _run_cmd(
            [ffprobe, "-v", "error", "-show_format", "-show_streams",
             "-of", "json", str(path)],
            "ffprobe (metadata)")
    except DetectorFailed as failure:
        skipped.append(str(failure))
        return {}
    return parse_ffprobe(stdout)


async def _run_detector(ffmpeg, path, extra, detector, skipped):
    """跑一条滤镜并返回 stderr；失败即记账并返回 `None`。"""
    try:
        _, stderr = await _run_cmd(
            [ffmpeg, "-hide_banner", "-nostats", "-i", str(path), *extra],
            f"ffmpeg ({detector})")
    except DetectorFailed as failure:
        skipped.append(str(failure))
        return None
    return stderr


_BLACK_CMD = ["-an", "-vf", BLACK_FILTER, "-f", "null", "-"]
_FREEZE_CMD = ["-an", "-vf", FREEZE_FILTER, "-f", "null", "-"]
_SILENCE_CMD = ["-vn", "-af", SILENCE_FILTER, "-f", "null", "-"]
_LOUDNESS_CMD = ["-vn", "-af", LOUDNESS_FILTER, "-f", "null", "-"]


async def _audio_probes(ffmpeg, path, metadata, thresholds, result, skipped,
                        check_audio):
    """静音 + 响度；没跑的一项都要进 `skipped[]`。"""
    duration = metadata.get("duration")
    if not (check_audio and metadata.get("has_audio")):
        reason = "check_audio=false" if not check_audio else "no_audio_stream"
        skipped.append(f"silencedetect:{reason}")
        skipped.append(f"loudness:{reason}")
        return
    stderr = await _run_detector(
        ffmpeg, path, _SILENCE_CMD, "silencedetect", skipped)
    if stderr is not None:
        result["silence"] = parse_silencedetect(stderr, duration)
        result["issues"] += _silence_issues(
            result["silence"], thresholds, duration)
    stderr = await _run_detector(
        ffmpeg, path, _LOUDNESS_CMD, "loudness", skipped)
    if stderr is None:
        return
    result["loudness"] = parse_ebur128(stderr)
    if result["loudness"] is None:
        skipped.append("loudness: no ebur128 summary in stderr")
        return
    result["issues"] += _loudness_issues(result["loudness"], thresholds)


async def probe_export(
    path,
    *,
    settings: dict | None = None,
    expected=None,
    timeline_duration: float | None = None,
    check_audio: bool = True,
) -> dict:
    """返回 `{metadata, black, freeze, silence, loudness, issues, skipped}`。"""
    ffmpeg, ffprobe = require_ffmpeg()
    thresholds = probe_thresholds(settings)
    skipped: list[str] = []
    result = {"available": True, "issues": [], "skipped": skipped,
              "metadata": {}, "black": [], "freeze": [], "silence": [],
              "loudness": None, "thresholds": thresholds}

    metadata = await _ffprobe_metadata(ffprobe, path, skipped)
    if not metadata:
        # 连容器都读不出来：后续滤镜探测没有意义，全部记账。
        skipped.extend(f"{name}: metadata unavailable"
                       for name in METADATA_SKIP[1:])
        result["issues"].append(_issue(
            "decode_failed", "blocker", "成片无法被 ffprobe 解析"))
        return result
    result["metadata"] = metadata
    result["issues"] += _metadata_issues(
        metadata, expected, timeline_duration)

    stderr = await _run_detector(
        ffmpeg, path, _BLACK_CMD, "blackdetect", skipped)
    if stderr is not None:
        result["black"] = parse_blackdetect(stderr)
        result["issues"] += _black_issues(result["black"], thresholds)

    stderr = await _run_detector(
        ffmpeg, path, _FREEZE_CMD, "freezedetect", skipped)
    if stderr is not None:
        result["freeze"] = parse_freezedetect(stderr)
        result["issues"] += _freeze_issues(result["freeze"])

    await _audio_probes(ffmpeg, path, metadata, thresholds, result, skipped,
                        check_audio)
    return result
