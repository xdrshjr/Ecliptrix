"""成品探测：解析器 + 阈值判定 + 缺 ffmpeg 的降级（AC-16）。

真实 ffmpeg 的集成用例在没有 ffmpeg 的机器上 `skip` 并**打印原因**——不能
静默通过（§4.9：没测的要记账）。
"""
import shutil
import subprocess

import pytest

from app.models.agent_vision_models import AgentVisionError
from app.services.agent_vision import export_probe

BLACK_STDERR = """
[blackdetect @ 000001] black_start:1.2 black_end:2.4 black_duration:1.2
[blackdetect @ 000001] black_start:5 black_end:5.15 black_duration:0.15
"""

FREEZE_STDERR = """
[freezedetect @ 000002] lavfi.freezedetect.freeze_start: 3.1
[freezedetect @ 000002] lavfi.freezedetect.freeze_duration: 2.5
[freezedetect @ 000002] lavfi.freezedetect.freeze_end: 5.6
"""

SILENCE_STDERR = """
[silencedetect @ 000003] silence_start: 0
[silencedetect @ 000003] silence_end: 0.4 | silence_duration: 0.4
[silencedetect @ 000003] silence_start: 6.0
[silencedetect @ 000003] silence_end: 9.0 | silence_duration: 3.0
[silencedetect @ 000003] silence_start: 11.0
"""

LOUDNESS_STDERR = """
[Parsed_ebur128_0 @ 000004] Summary:

  Integrated loudness:
    I:         -22.4 LUFS
    Threshold: -32.7 LUFS

  True peak:
    Peak:       -0.4 dBFS
"""

FFPROBE_PAYLOAD = """
{"streams": [
   {"codec_type": "video", "width": 1080, "height": 1920},
   {"codec_type": "audio", "codec_name": "aac"}],
 "format": {"duration": "12.500000"}}
"""


# ── 纯解析器 ──────────────────────────────────────────────────────────────


def test_parse_ffprobe_reads_duration_resolution_and_audio():
    meta = export_probe.parse_ffprobe(FFPROBE_PAYLOAD)
    assert meta == {"duration": 12.5, "width": 1080, "height": 1920,
                    "has_audio": True, "parse_error": False}


def test_parse_ffprobe_handles_garbage():
    meta = export_probe.parse_ffprobe("not json")
    assert meta["parse_error"] is True
    assert meta["duration"] is None


def test_parse_blackdetect():
    segments = export_probe.parse_blackdetect(BLACK_STDERR)
    assert [round(item["duration"], 2) for item in segments] == [1.2, 0.15]


def test_parse_freezedetect():
    segments = export_probe.parse_freezedetect(FREEZE_STDERR)
    assert segments[0]["start"] == 3.1
    assert segments[0]["end"] == pytest.approx(5.6)


def test_parse_silencedetect_fills_trailing_segment():
    segments = export_probe.parse_silencedetect(SILENCE_STDERR, 12.5)
    assert [item["start"] for item in segments] == [0.0, 6.0, 11.0]
    assert segments[-1]["end"] == 12.5
    assert segments[-1]["duration"] == pytest.approx(1.5)


def test_parse_ebur128():
    loudness = export_probe.parse_ebur128(LOUDNESS_STDERR)
    assert loudness == {"integrated_lufs": -22.4, "true_peak_dbtp": -0.4}


# ── 判定 ──────────────────────────────────────────────────────────────────


def thresholds():
    return export_probe.probe_thresholds({
        "probe": {"black_min_seconds": 0.3, "silence_min_seconds": 2.0,
                  "loudness_target_lufs": -16, "loudness_tolerance": 4,
                  "true_peak_max_dbtp": -1.0}})


def test_black_segments_are_severity_graded():
    segments = [{"start": 1.2, "end": 2.4, "duration": 1.2},
                {"start": 5.0, "end": 5.45, "duration": 0.45}]
    issues = export_probe._black_issues(segments, thresholds())
    assert [item["severity"] for item in issues] == ["blocker", "warning"]


def test_short_black_segment_is_ignored():
    short = export_probe.parse_blackdetect(BLACK_STDERR)[-1]  # 0.15s
    assert short["duration"] < 0.3
    assert export_probe._black_issues([short], thresholds()) == []


def test_silence_edges_are_ignored_but_middle_is_reported():
    segments = export_probe.parse_silencedetect(SILENCE_STDERR, 12.5)
    issues = export_probe._silence_issues(segments, thresholds(), 12.5)
    assert len(issues) == 1
    assert issues[0]["at_seconds"] == 6.0
    assert issues[0]["severity"] == "warning"


def test_loudness_out_of_range_and_true_peak():
    issues = export_probe._loudness_issues(
        {"integrated_lufs": -25.0, "true_peak_dbtp": 0.2}, thresholds())
    codes = {item["code"] for item in issues}
    assert codes == {"loudness_out_of_range", "true_peak_clipping"}


def test_loudness_inside_window_is_clean():
    issues = export_probe._loudness_issues(
        {"integrated_lufs": -16.0, "true_peak_dbtp": -2.0}, thresholds())
    assert issues == []


def test_missing_audio_is_a_blocker():
    issues = export_probe._metadata_issues(
        {"has_audio": False, "duration": 10.0, "width": 1920, "height": 1080},
        None, None)
    assert any(item["code"] == "missing_audio"
               and item["severity"] == "blocker" for item in issues)


def test_duration_mismatch_uses_relative_tolerance():
    issues = export_probe._metadata_issues(
        {"has_audio": True, "duration": 10.9, "width": 1920, "height": 1080},
        None, 10.0)
    assert any(item["code"] == "duration_mismatch" for item in issues)


def test_resolution_mismatch():
    expected = type("Expected", (), {"width": 1080, "height": 1920})()
    issues = export_probe._metadata_issues(
        {"has_audio": True, "duration": 10.0, "width": 1920, "height": 1080},
        expected, None)
    assert any(item["code"] == "resolution_mismatch" for item in issues)


def test_freeze_needs_two_seconds():
    assert export_probe._freeze_issues([{"start": 1.0, "duration": 1.0}]) == []
    assert len(export_probe._freeze_issues(
        [{"start": 1.0, "duration": 2.5}])) == 1


# ── 环境降级 ──────────────────────────────────────────────────────────────


def test_missing_ffmpeg_raises_with_skipped_list(monkeypatch):
    monkeypatch.setattr(export_probe, "ffmpeg_binaries", lambda: (None, None))
    with pytest.raises(AgentVisionError) as info:
        export_probe.require_ffmpeg()
    assert info.value.error_code == "ffmpeg_unavailable"
    assert info.value.status_code == 503
    assert "blackdetect" in info.value.skipped


@pytest.mark.asyncio
async def test_detector_failure_is_recorded_in_skipped(monkeypatch):
    """非零退出不能当成"探测通过"（假绿防护）。"""
    monkeypatch.setattr(export_probe, "ffmpeg_binaries",
                        lambda: ("ffmpeg", "ffprobe"))

    async def fake_run(cmd, label, timeout_seconds=None):
        if "ffprobe" in label:
            return FFPROBE_PAYLOAD, ""
        raise export_probe.DetectorFailed(f"{label}: exit 1")

    monkeypatch.setattr(export_probe, "_run_cmd", fake_run)
    result = await export_probe.probe_export("clip.mp4", check_audio=False)
    joined = " ".join(result["skipped"])
    assert "blackdetect" in joined and "freezedetect" in joined
    assert "silencedetect" in joined and "loudness" in joined


# ── 真实 ffmpeg（没有就 skip 并说明原因） ─────────────────────────────────


@pytest.mark.asyncio
async def test_real_ffmpeg_detects_black_and_loudness(tmp_path):
    if not (shutil.which("ffmpeg") and shutil.which("ffprobe")):
        pytest.skip("ffmpeg/ffprobe not installed; 探测用例未执行（原因已打印）")
    sample = tmp_path / "sample.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i",
         "color=c=black:s=320x180:r=10:d=4",
         "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
         "-shortest", "-pix_fmt", "yuv420p", str(sample)],
        check=True, capture_output=True, timeout=120)
    result = await export_probe.probe_export(sample, check_audio=True)
    assert result["metadata"]["duration"] == pytest.approx(4.0, abs=0.2)
    assert result["black"], "全黑样本必须被 blackdetect 抓到"
    assert any(item["code"] == "black_frames" for item in result["issues"])
    assert result["loudness"] is not None or result["skipped"]
