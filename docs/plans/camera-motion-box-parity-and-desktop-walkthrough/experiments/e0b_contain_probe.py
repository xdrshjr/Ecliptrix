"""E0-b —— 用真实 FFmpeg 测定「盒内 contain」的整数规则（计划 §2.6 / R5）。

计划把 H1（导出侧盒量化可被前端纯函数精确复现）整轮押在这条规则上，而
Iteration 2 已经有过一次「文档说 perspective 的 t 可用、实测 Invalid argument」
的教训，所以这里一律实测、不查文档（L-Q4）。

方法：``color`` 造一张已知自然尺寸的白图 → ``scale=<盒>:force_original_aspect_ratio
=decrease`` → ``pad=<盒>:(ow-iw)/2:(oh-ih)/2`` 填黑 → ``bbox`` 把实际内容矩形读
回来。一次同时拿到「缩放后的整数尺寸」与「pad 的居中偏移」两个量。

探针用不透明 ``black`` 填充只是为了让 ``bbox`` 读得出边界；生产用 ``black@0``
（透明）。pad 的几何与填充色无关，两者等价。

两个必须踩过才知道的坑（节点 #2 实测，计划 R5 的写法会直接读出假数据）：

1. ``bbox=min_val=1`` 会把整张图判成内容。yuv420p 的 ``black`` 是**限制范围**的
   Y=16，不是 0，16 ≥ 1 于是 pad 边条也算"非黑"，每一组的读数都恰好等于盒尺寸
   ——一个看起来很整齐、实则完全没测到东西的假绿。阈值取 100（白 235 与黑 16 的
   中间），两者才分得开。
2. 奇数尺寸的盒（如 321×123）在 ``-f null`` 下会被 wrapped_avframe 以
   ``Invalid argument (-22)`` 拒收，因为 yuv420p 要求偶数维度。收尾加
   ``format=gray`` 去掉色度二次采样即可，顺带让 bbox 只读单平面。
"""

from __future__ import annotations

import json
import math
import re
import subprocess
from pathlib import Path
from typing import Dict, List, Optional, Tuple

#: (natural_w, natural_h, box_w, box_h)。前三组是评审 R5 钉死的关键情形：
#: 同比例盒也会缩 1px、奇数自然宽、以及证明居中是 floor 而非四舍五入的 26.5→26。
PROBE_CASES: Tuple[Tuple[int, int, int, int], ...] = (
    (1920, 1080, 634, 356),
    (1501, 1000, 434, 288),
    (1234, 567, 321, 123),
    (1920, 1080, 844, 474),
    (1920, 1080, 422, 238),
    (1920, 1080, 640, 360),
    (1440, 1080, 640, 360),
    (1440, 1080, 476, 358),
    (1440, 1080, 238, 476),
    (1501, 1000, 844, 322),
    (1501, 1000, 240, 240),
    (1501, 1000, 1140, 476),
    (1920, 1080, 240, 640),
    (1920, 1080, 1140, 240),
    (1440, 1080, 1126, 360),
    (1234, 567, 240, 476),
    # —— 以下 4 组由 Q2 的 oob-bottom / neg-top 反推补上（节点 #4）——
    # 上面 16 组有一个共同的盲区：居中偏移在向下取偶**之前**是不是奇数。只有它是奇
    # 数时，「用取偶前的内容尺寸算居中」与「用取偶后的算」才会差 2px；上面 16 组恰好
    # 全落在两种读法一致的那一半，于是探针无法区分，黄金文件就把其中一种当真相钉了
    # 下来。这 4 组每一组都能把两种读法分开——夹具的盲区正是这样被下游指标逼出来的。
    (1440, 1080, 422, 360),   # 内容高 317（奇），(360-317)//2 = 21（奇）
    (1501, 1000, 422, 476),   # 内容高 281（奇），(476-281)//2 = 97（奇）
    (1080, 1920, 638, 360),   # 换到宽这一侧：内容宽 203（奇），(638-203)//2 = 217（奇）
    (1920, 1080, 422, 240),   # 偏移小到 0/2 的边界，取偶方向在这里最容易看错
)

_BBOX_RE = re.compile(r"x1:(-?\d+).*?x2:(-?\d+).*?y1:(-?\d+).*?y2:(-?\d+).*?w:(\d+)\s+h:(\d+)")


def _round_half_away(value: float) -> int:
    """``av_rescale`` 的取整语义：四舍五入，平局远离零。"""
    return int(math.floor(value + 0.5)) if value >= 0 else -int(math.floor(-value + 0.5))


def predict(nat_w: int, nat_h: int, box_w: int, box_h: int) -> Dict[str, int]:
    """假设的纯函数——本探针要做的就是证伪或证实它。"""
    tmp_w = _round_half_away(box_h * nat_w / nat_h)
    tmp_h = _round_half_away(box_w * nat_h / nat_w)
    w = min(box_w, tmp_w)
    h = min(box_h, tmp_h)
    return {
        "w": w,
        "h": h,
        "pad_x": (box_w - w) // 2,
        "pad_y": (box_h - h) // 2,
    }


def measure(
    ffmpeg: str, nat_w: int, nat_h: int, box_w: int, box_h: int
) -> Tuple[Optional[Dict[str, int]], str, str]:
    """跑一次 FFmpeg，返回 (实测值 | None, 命令行, bbox 原始输出行)。

    Returns:
        实测的 ``{w, h, pad_x, pad_y}``；FFmpeg 失败或 bbox 无输出时为 ``None``。
    """
    vf = (
        f"scale={box_w}:{box_h}:force_original_aspect_ratio=decrease,"
        f"pad={box_w}:{box_h}:(ow-iw)/2:(oh-ih)/2:black,"
        f"format=gray,bbox=min_val=100"
    )
    cmd = [
        ffmpeg, "-hide_banner", "-nostdin",
        "-f", "lavfi", "-i", f"color=white:s={nat_w}x{nat_h}:d=1",
        "-vf", vf, "-frames:v", "1", "-f", "null", "-",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    line = next((ln for ln in proc.stderr.splitlines() if "Parsed_bbox" in ln and "w:" in ln), "")
    hit = _BBOX_RE.search(line)
    if proc.returncode != 0 or not hit:
        return None, subprocess.list2cmdline(cmd), (line or proc.stderr[-400:])
    x1, _x2, y1, _y2, w, h = (int(g) for g in hit.groups())
    return {"w": w, "h": h, "pad_x": x1, "pad_y": y1}, subprocess.list2cmdline(cmd), line.strip()


def run(ffmpeg: str, label: str) -> Dict[str, object]:
    """跑完整批组合，返回可直接落 JSON 的结论。"""
    cases: List[Dict[str, object]] = []
    agree = 0
    for nat_w, nat_h, box_w, box_h in PROBE_CASES:
        expected = predict(nat_w, nat_h, box_w, box_h)
        observed, cmd, raw = measure(ffmpeg, nat_w, nat_h, box_w, box_h)
        matched = observed == expected
        agree += 1 if matched else 0
        cases.append({
            "natural": [nat_w, nat_h],
            "box": [box_w, box_h],
            "predicted": expected,
            "observed": observed,
            "match": matched,
            "command": cmd,
            "rawBbox": raw,
        })
    return {
        "label": label,
        "ffmpeg": ffmpeg,
        "version": _ffmpeg_version(ffmpeg),
        "total": len(PROBE_CASES),
        "agreed": agree,
        "pass": agree == len(PROBE_CASES),
        "cases": cases,
    }


def _ffmpeg_version(ffmpeg: str) -> str:
    proc = subprocess.run([ffmpeg, "-version"], capture_output=True, text=True, timeout=60)
    return proc.stdout.splitlines()[0] if proc.stdout else "<unknown>"


if __name__ == "__main__":
    import sys

    binary = sys.argv[1] if len(sys.argv) > 1 else "ffmpeg"
    tag = sys.argv[2] if len(sys.argv) > 2 else "dev"
    result = run(binary, tag)
    out = Path(sys.argv[3]) if len(sys.argv) > 3 else None
    if out:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({k: v for k, v in result.items() if k != "cases"}, ensure_ascii=False))
