"""修复后的离线复跑：真实分离流下载/合并，及 HLS、Range、错误保留反例。

修复前的输出仍保存在 offline-output.txt。仅站点抽取边界使用夹具，
HTTP 小媒体下载、yt-dlp 格式选择、FFmpeg 合并与 ffprobe 校验均实际执行。
"""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
BACKEND = ROOT / "backend-services/basic-service"

if __name__ == "__main__":
    print("开始离线修复验证；不访问 YouTube。", flush=True)
    checks = [
        "tests/test_youtube_runtime.py::test_real_separate_download_merge_exact_output_and_audio",
        "tests/test_youtube_runtime.py::test_format_selection_accepts_separate_tracks_and_height",
        "tests/test_youtube_runtime.py::test_download_does_not_lose_classified_worker_error",
        "tests/test_youtube_preview_stream.py::test_manifest_and_incompatible_codecs_are_not_direct_mp4",
        "tests/test_youtube_preview_stream.py::test_local_prepared_media_preserves_range_identity_and_reader_release",
    ]
    result = subprocess.run([
        sys.executable, "-B", "-X", "utf8", "-m", "pytest", *checks,
        "-q", "-p", "no:cacheprovider", "--tb=short", "--disable-warnings",
        "--basetemp=" + str(ROOT / ".agentmesh/youtube-implementation/repro-temp"),
    ], cwd=BACKEND)
    if result.returncode == 0:
        print("修复验证通过：分离流可下载并得到 H.264/AAC MP4；清单不会作为直链；Range 和错误原因已保留。")
    raise SystemExit(result.returncode)
