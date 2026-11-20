"""一次操作一个版本的 YouTube worker；标准输入/输出为私有 JSON 协议。"""
from __future__ import annotations

import contextlib
import importlib.metadata
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlsplit


def progressive_format(formats):
    """只接受 Chromium 可解码的 HTTP 单文件，清单必须本地准备。"""
    choices = []
    for fmt in formats or []:
        url = fmt.get("url") or ""
        if urlsplit(url).scheme not in ("http", "https"):
            continue
        if fmt.get("protocol", urlsplit(url).scheme) not in ("http", "https"):
            continue
        if urlsplit(url).path.lower().endswith((".m3u8", ".mpd")):
            continue
        video, audio = fmt.get("vcodec") or "", fmt.get("acodec") or ""
        compatible = (
            fmt.get("ext") == "mp4" and video.startswith(("avc1", "h264"))
            and audio.startswith(("mp4a", "aac"))
        ) or (
            fmt.get("ext") == "webm" and video.startswith(("vp8", "vp9", "vp09", "av01"))
            and audio.startswith(("opus", "vorbis"))
        )
        if compatible:
            choices.append(fmt)
    if not choices:
        return None
    preferred = [f for f in choices if f.get("ext") == "mp4" and 0 < (f.get("height") or 0) <= 720]
    return max(preferred or choices, key=lambda f: f.get("height") or 0)


def format_selector(quality, audio="best"):
    video = "worstvideo" if quality == "worst" else "bestvideo"
    combined = "worst" if quality == "worst" else "best"
    height = "" if quality in ("best", "worst") else f"[height<={int(quality[:-1])}]"
    sound = "worstaudio" if audio == "worst" else "bestaudio"
    rate = "" if audio in ("best", "worst") else f"[abr<={int(audio[:-1])}]"
    # 最后一项显式接收合法的无音轨源；随后保留无音轨状态。
    return f"{video}{height}+{sound}{rate}/{video}{height}+{sound}/{combined}{height}/{video}{height}"


def media_probe(path):
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", str(path)],
        capture_output=True, encoding="utf-8", timeout=20,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    if result.returncode:
        raise ValueError("MERGE_FAILED")
    data = json.loads(result.stdout)
    streams = data.get("streams", [])
    if not Path(path).is_file() or not Path(path).stat().st_size or not any(s.get("codec_type") == "video" for s in streams):
        raise ValueError("MERGE_FAILED")
    return data


def normalize_media(source, destination, *, expected_audio, start=None, duration=None, end=None):
    """核验真实容器/轨道，必要时转换，完成后原子发布确定路径。"""
    data = media_probe(source)
    streams = data["streams"]
    video = next(s for s in streams if s.get("codec_type") == "video")
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if expected_audio and audio is None:
        raise ValueError("MERGE_FAILED")
    ext = Path(destination).suffix[1:]
    codecs = {"mp4": ("h264", "aac"), "webm": ("vp9", "opus")}
    target_video, target_audio = codecs.get(ext, (video.get("codec_name"), audio.get("codec_name") if audio else "aac"))
    temporary = Path(destination).with_name("publishing." + ext)
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-y"]
    if start:
        cmd += ["-ss", start]
    cmd += ["-i", str(source)]
    if duration:
        cmd += ["-t", duration]
    elif end:
        cmd += ["-t", str(float_time(end) - float_time(start or "0"))]
    cmd += ["-map", "0:v:0", "-map", "0:a:0?", "-sn"]
    copy_video = (video.get("codec_name") == target_video and not any((start, duration, end))
                  and (target_video != "h264" or video.get("pix_fmt") in ("yuv420p", "yuvj420p")))
    cmd += ["-c:v", "copy" if copy_video else {"h264": "libx264", "vp9": "libvpx-vp9"}.get(target_video, "libx264")]
    if not copy_video:
        cmd += ["-pix_fmt", "yuv420p"]
        if target_video == "h264":
            cmd += ["-preset", "veryfast", "-crf", "23"]
    if audio:
        cmd += ["-c:a", "copy" if audio.get("codec_name") == target_audio else {"opus": "libopus"}.get(target_audio, "aac")]
    if ext == "mp4":
        cmd += ["-movflags", "+faststart"]
    result = subprocess.run(cmd + [str(temporary)], capture_output=True, timeout=240,
                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    if result.returncode:
        raise ValueError("MERGE_FAILED")
    final = media_probe(temporary)
    actual = final["format"].get("format_name", "")
    if not any(name in actual for name in {"mp4": ["mp4"], "webm": ["webm"], "mkv": ["matroska"]}[ext]):
        raise ValueError("MERGE_FAILED")
    if expected_audio and not any(s.get("codec_type") == "audio" for s in final["streams"]):
        raise ValueError("MERGE_FAILED")
    os.replace(temporary, destination)
    return {"file_path": str(destination), "file_size": Path(destination).stat().st_size,
            "has_audio": any(s.get("codec_type") == "audio" for s in final["streams"])}


def float_time(value):
    seconds = 0.0
    for part in str(value).split(":"):
        seconds = seconds * 60 + float(part)
    return seconds


def error_code(error):
    value = str(error).lower()
    if "sign in to confirm" in value or "sign_in_required" in value or "login" in value or "age-restricted" in value or "confirm your age" in value or "private video" in value:
        return "SIGN_IN_REQUIRED"
    if "429" in value or "too many requests" in value:
        return "RATE_LIMITED"
    if "limit" in value or "large" in value:
        return "PREVIEW_LIMIT"
    if "unsupported" in value or "live" in value or "drm" in value:
        return "UNSUPPORTED_MEDIA"
    if "merge_failed" in value or "ffmpeg" in value:
        return "MERGE_FAILED"
    return "NETWORK_ERROR"


class QuietLogger:
    def debug(self, message): pass
    def warning(self, message): pass
    def error(self, message): pass


def dispatch(message):
    import yt_dlp
    operation = message["operation"]
    node = message.get("node")
    if operation == "selftest":
        ejs = None
        challenge_ok = False
        try:
            import yt_dlp_ejs
            ejs = importlib.metadata.version("yt-dlp-ejs")
        except ImportError:
            if message.get("require_ejs"):
                raise ValueError("缺少匹配的 EJS 脚本")
        node_ok = False
        if node:
            check = subprocess.run([node, "-e", "process.stdout.write(String(6*7))"], capture_output=True, timeout=10,
                                   creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            node_ok = check.returncode == 0 and check.stdout == b"42"
        if message.get("require_ejs") and not node_ok:
            raise ValueError("Node 运行时不可用")
        if ejs and node_ok:
            import yt_dlp_ejs.yt.solver as solver
            challenge = dict(type="preprocessed", preprocessed_player='_result.sig = x => x.split("").reverse().join("");',
                             requests=[dict(type="sig", challenges=["abc"])])
            script = solver.lib() + "\nObject.assign(globalThis, lib);\n" + solver.core()
            script += "\nconsole.log(JSON.stringify(jsc(" + json.dumps(challenge) + ")));"
            result = subprocess.run([node, "-"], input=script, capture_output=True, text=True, encoding="utf-8", timeout=15,
                                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            challenge_ok = result.returncode == 0 and json.loads(result.stdout)["responses"][0]["data"]["abc"] == "cba"
            if not challenge_ok:
                raise ValueError("EJS 挑战脚本自检失败")
        return {"version": yt_dlp.version.__version__, "ejs_version": ejs, "node_available": node_ok, "ejs_challenge_ok": challenge_ok,
                "module_path": str(Path(yt_dlp.__file__).resolve())}
    opts = dict(message.get("options") or {})
    opts.update(quiet=True, noprogress=True, no_warnings=True, logger=QuietLogger(),
                noplaylist=True, socket_timeout=15, retries=1, fragment_retries=1)
    if node:
        opts["js_runtimes"] = {"node": {"path": node}}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(message["url"], download=False)
        if not info:
            raise ValueError("UNSUPPORTED_MEDIA")
        if operation == "extract":
            return ydl.sanitize_info(info)
        if info.get("is_live") or info.get("live_status") in ("is_live", "is_upcoming") or info.get("has_drm"):
            raise ValueError("UNSUPPORTED_MEDIA")
        formats = info.get("formats") or [info]
        if operation == "preview":
            fmt = progressive_format(formats)
            if fmt:
                return {"url": fmt["url"], "http_headers": fmt.get("http_headers") or info.get("http_headers") or {},
                        "ext": fmt["ext"], "filesize": fmt.get("filesize"), "format_id": str(fmt.get("format_id", ""))}
            if not info.get("duration") or info["duration"] > 600:
                raise ValueError("PREVIEW_LIMIT")
    output = Path(message["output_dir"]).resolve()
    output.mkdir(parents=True, exist_ok=True)
    request = message.get("request") or {}
    preview = operation == "preview"
    quality = "480p" if preview else request.get("video_quality", "720p")
    container = "mp4" if preview else request.get("format_type", "mp4")
    final_paths = []
    opts.update(format=format_selector(quality, request.get("audio_quality", "best")),
                outtmpl=str(output / "source.%(ext)s"), merge_output_format="mkv",
                writesubtitles=bool(request.get("subtitle")), writeautomaticsub=bool(request.get("subtitle")),
                post_hooks=[lambda filename: final_paths.append(filename)],
                max_filesize=128 * 1024**2 if preview else 2 * 1024**3)
    with yt_dlp.YoutubeDL(opts) as ydl:
        result = ydl.process_ie_result(info, download=True)
    if not final_paths:
        raise ValueError("MERGE_FAILED")
    source = Path(final_paths[-1]).resolve()
    if not source.is_relative_to(output) or not source.is_file():
        raise ValueError("MERGE_FAILED")
    expected_audio = result.get("acodec") not in (None, "none") or any(
        f.get("acodec") not in (None, "none") for f in result.get("requested_formats", []))
    media = normalize_media(source, output / ("media." + container), expected_audio=expected_audio,
                            start=request.get("start_time"), duration=request.get("duration"), end=request.get("end_time"))
    # 中间文件只属于本任务；字幕随正式下载保留。
    for part in output.iterdir():
        if part.name.startswith("source.") and part.suffix in (".mp4", ".mkv", ".webm", ".m4a", ".part", ".ytdl"):
            part.unlink(missing_ok=True)
    return dict(media, local_path=media["file_path"], ext=container)


def main():
    try:
        message = json.load(sys.stdin)
        with contextlib.redirect_stdout(sys.stderr):
            data = dispatch(message)
        response = {"success": True, "data": data}
    except Exception as error:
        response = {"success": False, "code": error_code(error)}
    print(json.dumps(response, ensure_ascii=True))


if __name__ == "__main__":
    main()
