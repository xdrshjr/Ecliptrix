"""真实联网诊断：读取项目预览选项，以独立进程限时调用 yt-dlp，不保存视频。"""

from __future__ import annotations

import ast
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "backend-services/basic-service/app/services/youtube_service.py"


def preview_options() -> dict:
    """读取源码中的选项字面量，避免导入整个后端产生初始化副作用。"""
    tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            if any(isinstance(t, ast.Name) and t.id == "robust_opts"
                   for t in node.targets):
                opts = ast.literal_eval(node.value)
                opts["extractor_args"]["youtube"]["player_client"] = ["web", "ios"]
                opts["quiet"] = True
                return opts
    raise RuntimeError("未找到 robust_opts，请核查源码是否已变更")


class DiagnosticLogger:
    """只报告已知错误类别，不保存第三方原始输出中的敏感地址。"""

    def debug(self, message: str) -> None:
        pass

    def warning(self, message: str) -> None:
        for marker in ["PO Token", "SABR", "JavaScript", "signature", "nsig"]:
            if marker.lower() in message.lower():
                print("诊断警告类别:", marker, flush=True)

    def error(self, message: str) -> None:
        pass


def worker() -> None:
    """输出可公开的摘要；不输出代理地址、签名直链或 Cookie。"""
    import yt_dlp

    opts = preview_options()
    if "--default-clients" in sys.argv:
        opts["extractor_args"]["youtube"].pop("player_client", None)
    proxy = os.environ.get("YOUTUBE_PROXY", "")
    # 与项目一致，从后端 .env 补充；不覆盖调用者显式环境变量。
    try:
        from dotenv import dotenv_values
        if not proxy:
            proxy = dotenv_values(ROOT / "backend-services/basic-service/.env").get("YOUTUBE_PROXY", "")
    except ImportError:
        pass
    if proxy:
        opts["proxy"] = proxy
    opts["logger"] = DiagnosticLogger()
    print("诊断环境:", json.dumps({
        "yt_dlp版本": yt_dlp.version.__version__,
        "已配置YouTube代理": bool(proxy),
        "客户端": opts["extractor_args"]["youtube"].get("player_client", "库默认"),
        "显式JS运行时": opts.get("js_runtimes"),
    }, ensure_ascii=False), flush=True)
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info("https://www.youtube.com/watch?v=jNQXAC9IVRw", download=False)
        formats = (info or {}).get("formats", [])
        combined = [f for f in formats if f.get("url")
                    and f.get("acodec") not in (None, "none")
                    and f.get("vcodec") not in (None, "none")]
        print("诊断结果:", json.dumps({
            "格式数量": len(formats), "合流格式数量": len(combined),
            "合流格式ID": [f.get("format_id") for f in combined],
        }, ensure_ascii=False), flush=True)
    except Exception as exc:
        message = str(exc).lower()
        markers = [m for m in ["403", "429", "timed out", "sign in", "requested format", "certificate"] if m in message]
        print("诊断失败:", json.dumps({
            "异常类型": type(exc).__name__, "错误类别": markers,
            "反机器人提示": "sign in to confirm" in message,
        }, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    if "--worker" in sys.argv:
        worker()
    else:
        # 25 秒后杀死独立诊断进程，避免生产选项中的重试长时间挂起。
        try:
            run = subprocess.run(
                [sys.executable, "-B", "-X", "utf8", str(Path(__file__).resolve()),
                 "--worker", *sys.argv[1:]],
                capture_output=True, timeout=25, env={**os.environ, "PYTHONNOUSERSITE": "1"}
                if "--isolated-user-site" in sys.argv else os.environ.copy(),
            )
            print(run.stdout.decode("utf-8", errors="replace"))
            print("诊断进程退出码:", run.returncode)
            if run.returncode and run.stderr:
                print("诊断导入错误:", run.stderr.decode("utf-8", errors="replace").splitlines()[-1])
        except subprocess.TimeoutExpired as exc:
            print((exc.stdout or b"").decode("utf-8", errors="replace"))
            print("诊断结果: 达到 25 秒上限，进程已终止；未下载媒体。")
