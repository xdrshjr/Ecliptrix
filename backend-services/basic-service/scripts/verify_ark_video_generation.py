"""通过本地应用验证一次真实视频；默认离线、不提交、不读取秘密。"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import shutil
import subprocess
import sys
import time
import math
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

import httpx


def validate_local_file(video: Path) -> dict:
    """现场脚本独立复查，不借用应用的成功状态作为文件证据。"""
    with video.open('rb') as source:
        header = source.read(16)
    if len(header) < 12 or header[4:8] != b'ftyp' or header[8:12] == b'qt  ':
        raise ValueError("invalid_video_artifact")
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(video)], timeout=15, check=True, capture_output=True)
    data = json.loads(probe.stdout)
    stream = next(item for item in data["streams"] if item.get("codec_type") == "video" and not item.get("disposition", {}).get("attached_pic"))
    duration = float(stream.get("duration") or data["format"]["duration"])
    if not math.isfinite(duration) or duration <= 0 or stream["width"] <= 0 or stream["height"] <= 0:
        raise ValueError("invalid_video_artifact")
    decoded = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-xerror", "-err_detect", "explode", "-protocol_whitelist", "file,pipe", "-i", str(video), "-map", f"0:{stream['index']}", "-map", "0:a?", "-fps_mode", "passthrough", "-progress", "pipe:1", "-f", "null", "-"], timeout=120, check=True, capture_output=True)
    frames = [int(line.split("=", 1)[1]) for line in decoded.stdout.decode("ascii").splitlines() if line.startswith("frame=")]
    if not frames or max(frames) < 2:
        raise ValueError("invalid_video_artifact")
    return {"duration": duration, "width": stream["width"], "height": stream["height"]}


def write_evidence(path: Path, evidence: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")


def controlled_error(response: httpx.Response) -> dict:
    try:
        body = response.json()
        details = body.get("error_details") or {}
        code = body.get("error_code", "invalid_response")
        import re
        if not isinstance(code, str) or not re.fullmatch(r"[A-Za-z0-9_]{1,80}", code):
            code = "invalid_response"
        result = {"http_status": response.status_code, "error_code": code}
        request_id = details.get("provider_request_id")
        if isinstance(request_id, str) and re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", request_id):
            result["provider_request_id"] = request_id
        return result
    except (ValueError, AttributeError):
        return {"http_status": response.status_code, "error_code": "invalid_response"}


async def verify(args) -> int:
    base = urlsplit(args.base_url)
    if base.scheme != "http" or base.hostname not in ("127.0.0.1", "localhost", "::1") or base.username or base.password:
        print("验收仅允许本地应用地址。")
        return 2
    if not args.allow_billed_generation:
        print("离线检查清单：在隔离设置界面配置视频 Key；确认模型；检查 FFmpeg；显式启用后仅提交一次，随后验证本地 MP4。未联网、未提交。")
        return 0
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        print("缺少 ffmpeg 或 ffprobe。")
        return 2
    path = Path(args.output).resolve()
    evidence_root = Path(__file__).resolve().parents[1] / "data" / "ark-video-acceptance"
    if not path.is_relative_to(evidence_root.resolve()):
        print("证据必须写入被忽略的 data/ark-video-acceptance 目录。")
        return 2
    evidence = {"run_id": str(uuid4()), "states": [], "preview": "not_run", "timeline_export": "not_run", "offline_restart": "not_run"}
    if path.is_file():
        previous = json.loads(path.read_text(encoding="utf-8"))
        if previous.get("submission_attempted"):
            evidence = previous
            if not evidence.get("task_id"):
                print("此前已尝试提交且受理状态未知；禁止自动再次创建。")
                return 1
            if evidence.get("error"):
                evidence.setdefault("previous_errors", []).append(evidence.pop("error"))
    async with httpx.AsyncClient(base_url=args.base_url, timeout=25, trust_env=False) as client:
        response = await client.get("/api/ark-video/models", timeout=5)
        if response.status_code != 200:
            evidence["error"] = controlled_error(response)
            write_evidence(path, evidence)
            return 2
        configuration = response.json().get("data", {})
        if not configuration.get("configured"):
            evidence["error"] = {"error_code": "configuration_unavailable"}
            write_evidence(path, evidence)
            return 2
        model = next((item for item in configuration["models"] if item["id"] == configuration["default_model"]), None)
        if not model or "description" not in model["modes"] or "720p" not in model["resolutions"] or not model["duration_min"] <= 5 <= model["duration_max"]:
            evidence["error"] = {"error_code": "video_parameters_unsupported"}
            write_evidence(path, evidence)
            return 2
        if not evidence.get("task_id"):
            evidence.update(model=model["id"], config_revision=configuration["config_revision"], submission_attempted=True)
            write_evidence(path, evidence)
            response = await client.post("/api/ark-video/generate", timeout=120, json={
                "prompt": "固定构图，一只红色纸船在清澈水面缓慢漂动，水面有连续自然涟漪，无文字",
                "duration": 5, "resolution": "720p", "aspect_ratio": "16:9",
                "expected_config_revision": configuration["config_revision"],
            })
            if response.status_code != 200 or not response.json().get("ark_task_id"):
                evidence["error"] = controlled_error(response)
                write_evidence(path, evidence)
                print("生成未完成，已保存脱敏错误；不会再次提交。")
                return 1
            evidence["task_id"] = response.json()["ark_task_id"]
            evidence["model"] = response.json().get("model")
            write_evidence(path, evidence)
        deadline = time.monotonic() + 600
        retries = 0
        while time.monotonic() < deadline:
            response = await client.get(f"/api/ark-video/status/{evidence['task_id']}")
            if response.status_code != 200:
                data = response.json()
                details = data.get("error_details") or {}
                retries += 1
                delay = details.get("retry_after_seconds", (5, 10, 20)[min(retries - 1, 2)])
                if not details.get("retryable") or retries > 3 or delay > 60:
                    evidence["error"] = controlled_error(response)
                    write_evidence(path, evidence)
                    return 1
                await asyncio.sleep(delay)
                continue
            retries = 0
            status = response.json()
            evidence["states"].append({"status": status.get("status"), "phase": status.get("phase"), "http_status": response.status_code})
            write_evidence(path, evidence)
            print(f"视频阶段：{status.get('status')} / {status.get('phase')}", flush=True)
            if status.get("status") in ("failed", "timeout"):
                evidence["error"] = {"error_code": status.get("error_code", "video_generation_failed")}
                write_evidence(path, evidence)
                return 1
            if status.get("status") == "succeeded" and status.get("phase") == "ready":
                url = status.get("video_url", "")
                if not url.startswith("/api/storage/files/"):
                    return 1
                result = await client.get(url, timeout=120)
                result.raise_for_status()
                video = path.parent / "generated.mp4"
                video.write_bytes(result.content)
                metadata = await asyncio.to_thread(validate_local_file, video)
                evidence.update(metadata, sha256=hashlib.sha256(result.content).hexdigest(), bytes=len(result.content), decode_exit_code=0)
                for index, fraction in enumerate((0.1, 0.5, 0.9)):
                    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-ss", str(metadata["duration"] * fraction), "-i", str(video), "-frames:v", "1", "-y", str(path.parent / f"frame-{index + 1}.jpg")], timeout=30, check=True, capture_output=True)
                write_evidence(path, evidence)
                print("真实视频文件已通过完整解码。界面播放、时间线导出和离线重启仍需独立记录。")
                return 0
            await asyncio.sleep(5)
        evidence["error"] = {"error_code": "local_wait_timeout"}
        write_evidence(path, evidence)
        return 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:18321")
    parser.add_argument("--allow-billed-generation", action="store_true")
    parser.add_argument("--output", default="data/ark-video-acceptance/live-evidence.json")
    args = parser.parse_args()
    try:
        return asyncio.run(verify(args))
    except Exception:
        # 不输出 httpx 异常全文，避免签名地址等内容进入现场日志。
        print("验收中断；已尝试提交时不可自动新建任务，请检查本地证据。")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
