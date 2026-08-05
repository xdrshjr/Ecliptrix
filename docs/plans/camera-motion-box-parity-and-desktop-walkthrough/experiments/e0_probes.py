"""E0 前置探针汇总 —— 三项探针的结论逐条落 `results/e0-probes.json`（计划 §2.6）。

E0 是**开工许可**，不是指标：它先于任何代码改动跑，任一项失败都改变本轮的走法
（E0-b 跨版本不一致 → §7.1 风险 1；E0-c 失败 → §7.2 降级且 DoD#9 判未达成）。

用法：先跑 `e0b_contain_probe.py`（开发端 + 打包端各一次）与 `e0c_cdp_probe.mjs`，
再跑本脚本把三份原始产物汇成一份可复核的结论。
"""

from __future__ import annotations

import json
import platform
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict

BASE = Path(__file__).resolve().parent.parent
RESULTS = BASE / "results"


def _probe_e0a() -> Dict[str, Any]:
    """Node ≥22.4 自带全局 WebSocket —— §8 的 CDP 台架零新增依赖的前提。"""
    cmd = ["node", "-e", "console.log(process.version, typeof WebSocket)"]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    out = proc.stdout.strip()
    version, _, ws_type = out.partition(" ")
    return {
        "probe": "E0-a",
        "question": "Node 自带全局 WebSocket 吗（决定 walkthrough 要不要引入 playwright/ws）",
        "command": subprocess.list2cmdline(cmd),
        "rawOutput": out,
        "nodeVersion": version,
        "webSocketType": ws_type,
        "verdict": "PASS" if ws_type == "function" else "FAIL",
        "consequence": "零新增依赖成立，DD-7 的 CDP 路线可行" if ws_type == "function" else "须走 §7.2",
    }


def _load(name: str) -> Dict[str, Any]:
    path = RESULTS / name
    if not path.exists():
        return {"missing": str(path)}
    return json.loads(path.read_text(encoding="utf-8"))


def _probe_e0b() -> Dict[str, Any]:
    dev = _load("e0b-contain-dev.json")
    packaged = _load("e0b-contain-packaged.json")
    same_table = False
    if "cases" in dev and "cases" in packaged:
        by_key = {(tuple(c["natural"]), tuple(c["box"])): c["observed"] for c in packaged["cases"]}
        same_table = all(
            by_key.get((tuple(c["natural"]), tuple(c["box"]))) == c["observed"] for c in dev["cases"]
        )
    ok = bool(dev.get("pass")) and bool(packaged.get("pass")) and same_table
    return {
        "probe": "E0-b",
        "question": "FFmpeg 盒内 contain 的取整规则能否被纯函数精确复现，且跨大版本同表",
        "rule": {
            "tmp_w": "round_half_away(box_h * nat_w / nat_h)",
            "tmp_h": "round_half_away(box_w * nat_h / nat_w)",
            "w": "min(box_w, tmp_w)",
            "h": "min(box_h, tmp_h)",
            "pad_x": "floor((box_w - w) / 2)",
            "pad_y": "floor((box_h - h) / 2)",
        },
        "dev": {"version": dev.get("version"), "agreed": dev.get("agreed"), "total": dev.get("total")},
        "packaged": {
            "version": packaged.get("version"),
            "agreed": packaged.get("agreed"),
            "total": packaged.get("total"),
        },
        "crossVersionIdentical": same_table,
        "verdict": "PASS" if ok else "FAIL",
        "rawArtifacts": ["results/e0b-contain-dev.json", "results/e0b-contain-packaged.json"],
        "note": (
            "计划 R5 记录的测法（pad=black + bbox=min_val=1）在本机复跑时读出的是**假数据**："
            "yuv420p 的 black 是限制范围 Y=16 > 1，pad 边条也被算成内容，16 组读数全部恰好"
            "等于盒尺寸。改成 format=gray + min_val=100 后才真正分得开黑白，规则本身与 R5 的"
            "结论一致（16/16），但判据必须换掉，否则下游会对着一张全是盒尺寸的表判绿。"
        ),
    }


def _probe_e0c() -> Dict[str, Any]:
    raw = _load("e0c-cdp-probe.json")
    attempts = raw.get("attempts", [])
    return {
        "probe": "E0-c",
        "question": "CDP 能否在打包应用里端到端驱动页面（DoD#8 闭不闭合的唯一开关）",
        "criterion": "六步全通：启动 → /json/version → /json/list 页面 target → WS 握手 → Runtime.evaluate 1+1=2 → Page.captureScreenshot 非空",
        "verdict": raw.get("verdict"),
        "neededRemoteAllowOrigins": raw.get("neededRemoteAllowOrigins"),
        "steps": [
            {"step": s["step"], "name": s["name"], "ok": s["ok"]}
            for a in attempts
            for s in a.get("steps", [])
        ],
        "rawArtifacts": ["results/e0c-cdp-probe.json"],
        "consequence": (
            "H4 成立：节点 #3 可以按 §8 用 CDP 真跑 walkthrough，DoD#8 有条件被诚实闭合；"
            "抓帧走 Page.captureScreenshot（DD-11）已随第 6 步一并预验"
            if raw.get("verdict") == "PASS"
            else "H4 不成立，须走 §7.2 降级，且 DoD#9 判未达成"
        ),
    }


def main() -> int:
    probes = [_probe_e0a(), _probe_e0b(), _probe_e0c()]
    payload = {
        "stage": "E0 前置探针（开工许可）",
        "host": {"platform": platform.platform(), "python": sys.version.split()[0]},
        "allPass": all(p["verdict"] == "PASS" for p in probes),
        "probes": probes,
    }
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "e0-probes.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(json.dumps({"allPass": payload["allPass"], "verdicts": [p["verdict"] for p in probes]}))
    return 0 if payload["allPass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
