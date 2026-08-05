"""E0-b′ —— 在**生产的像素格式链**上复测「盒内 contain」，而不是在 gray 上。

为什么要有这个探针：E0-b 为了让 ``bbox`` 读得出边界，在收尾加了 ``format=gray``
（见 e0b_contain_probe.py 的坑 2：奇数盒在 yuv420p 下会被 wrapped_avframe 以 -22
拒收）。gray 没有色度二次采样，``hsub = vsub = 0``。生产链里这张图是 **PNG(rgba)
→ 与 yuv420p 主画面 overlay**，协商出来的是 **yuva420p**，``hsub = vsub = 1``。

这个差别不是学术的：Q2 在原点落偶之后，横向已经完全对齐，纵向却在 **恰好那些
pad 偏移为奇数** 的样本上仍差 1px。若 ``pad`` 的 x/y 在有色度二次采样的格式下会被
向下取到偶数格，读数就完全解释得通 —— 但那是**推理**，L-Q4 要的是实测。

方法：把 E0-b 的同一批 16 组组合，改用生产的链形跑一遍 ——

    [1:v]scale=<盒>:force_original_aspect_ratio=decrease,pad=<盒>:(ow-iw)/2:(oh-ih)/2:black@0[img]
    [0:v][img]overlay=0:0[v]        # 原点取 0（偶），把原点落格这一步排除在外
    [v]format=gray,bbox=min_val=100

底片是黑色 yuv420p，pad 是**透明**（生产用的就是 ``black@0``），所以透出的是底片
的黑，白色内容矩形的 bbox 直接给出 ``w, h, pad_x, pad_y``。overlay 在 0:0，因此读
到的偏移就是 pad 自己的偏移，与上一条已经钉死的原点规则互不污染。

用法：
    python e0b_pad_snap_probe.py [ffmpeg] [label] [out.json]
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from e0b_contain_probe import _BBOX_RE, PROBE_CASES, _ffmpeg_version, predict


def _round_to_sub(value: int) -> int:
    """向下取到偶数格 —— 有色度二次采样时 ``ff_draw_round_to_sub`` 的取整方向。"""
    return value // 2 * 2


def predict_subsampled(nat_w: int, nat_h: int, box_w: int, box_h: int) -> Dict[str, int]:
    """假设 A（**已被本探针证伪**）：尺寸照旧，只有 pad 偏移向下取偶。

    16 组里它只对了 7 组：凡是 gray 规则算出**奇数**内容尺寸的样本（1920×1080 进
    634×356 得 633）它都对不上，因为它没管 ``scale`` 那一半。留在这里是作为对照
    —— 三条规则同时记分，才看得出观测到底判了谁出局。
    """
    base = predict(nat_w, nat_h, box_w, box_h)
    return {
        "w": base["w"],
        "h": base["h"],
        "pad_x": _round_to_sub(base["pad_x"]),
        "pad_y": _round_to_sub(base["pad_y"]),
    }


def predict_even_size_centred(nat_w: int, nat_h: int, box_w: int, box_h: int) -> Dict[str, int]:
    """假设 B：内容尺寸与 pad 偏移都向下取偶，且**居中由取偶之后的尺寸**算。

    直觉上这条更"对"：``pad`` 的 ``(ow-iw)/2`` 里的 ``iw`` 就是 ``scale`` 真正交出来
    的那个（偶数）尺寸。它在最早那 16 组上 15/15 全中——但那 16 组恰好全落在它与假设
    C 一致的那一半，见 :data:`PROBE_CASES` 末尾补的 4 组。
    """
    base = predict(nat_w, nat_h, box_w, box_h)
    w = _round_to_sub(base["w"])
    h = _round_to_sub(base["h"])
    return {
        "w": w,
        "h": h,
        "pad_x": _round_to_sub((box_w - w) // 2),
        "pad_y": _round_to_sub((box_h - h) // 2),
    }


def predict_production(nat_w: int, nat_h: int, box_w: int, box_h: int) -> Dict[str, int]:
    """假设 C（**本探针的实测结论**）：尺寸向下取偶，但居中用**取偶前**的尺寸算。

    有色度二次采样时（生产链协商出 ``yuva420p``，``hsub = vsub = 1``），``scale`` 的
    输出尺寸与 ``pad`` 的居中偏移都要落在偶数格上，但两步不是串行的：

    1. 先按 gray 那张表（``av_rescale`` 四舍五入 + ``min``）算出内容尺寸 ``s``；
    2. 落地的内容尺寸是 ``floor_even(s)``（633 → 632）；
    3. 居中偏移由 **``s`` 本身** 而非 ``floor_even(s)`` 算：``floor_even((box - s) // 2)``。

    第 3 步是被 Q2 的两个纵向出框样本逼出来的：``pad`` 的表达式在滤镜图里是先按未
    对齐的尺寸求值、再由 ``ff_draw_round_to_sub`` 落格，不是拿落格后的尺寸重算。两种
    读法只在 ``(box - s) // 2`` 为奇数时相差 2px —— 最初那 16 组一个这样的样本都没有，
    于是探针无法区分，而 Q2 的 ``neg-top`` / ``oob-bottom`` 一次撞上两个。
    """
    base = predict(nat_w, nat_h, box_w, box_h)
    return {
        "w": _round_to_sub(base["w"]),
        "h": _round_to_sub(base["h"]),
        "pad_x": _round_to_sub(base["pad_x"]),
        "pad_y": _round_to_sub(base["pad_y"]),
    }


def _white_png(ffmpeg: str, work: Path, nat_w: int, nat_h: int) -> Path:
    """一张自然尺寸的白 PNG —— 走真实的 rgba 解码路径，与生产同源。"""
    path = work / f"white-{nat_w}x{nat_h}.png"
    if not path.exists():
        subprocess.run(
            [ffmpeg, "-y", "-hide_banner", "-v", "error", "-f", "lavfi",
             "-i", f"color=white:s={nat_w}x{nat_h}:d=1", "-frames:v", "1", str(path)],
            capture_output=True, text=True, timeout=120, check=False,
        )
    return path


def measure(
    ffmpeg: str, work: Path, nat_w: int, nat_h: int, box_w: int, box_h: int
) -> Tuple[Optional[Dict[str, int]], str, str]:
    """生产链形跑一次，读回内容矩形。"""
    still = _white_png(ffmpeg, work, nat_w, nat_h)
    base_w = box_w + (box_w % 2)
    base_h = box_h + (box_h % 2)
    graph = (
        f"[1:v]scale={box_w}:{box_h}:force_original_aspect_ratio=decrease,"
        f"pad={box_w}:{box_h}:(ow-iw)/2:(oh-ih)/2:black@0[img];"
        f"[0:v][img]overlay=0:0[ov];[ov]format=gray,bbox=min_val=100[v]"
    )
    cmd = [
        ffmpeg, "-hide_banner", "-nostdin",
        "-f", "lavfi", "-i", f"color=black:s={base_w}x{base_h}:d=1,format=yuv420p",
        "-i", str(still),
        "-filter_complex", graph, "-map", "[v]", "-frames:v", "1", "-f", "null", "-",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    line = next((ln for ln in proc.stderr.splitlines() if "Parsed_bbox" in ln and "w:" in ln), "")
    hit = _BBOX_RE.search(line)
    if proc.returncode != 0 or not hit:
        return None, subprocess.list2cmdline(cmd), (line or proc.stderr[-400:])
    x1, _x2, y1, _y2, w, h = (int(g) for g in hit.groups())
    return {"w": w, "h": h, "pad_x": x1, "pad_y": y1}, subprocess.list2cmdline(cmd), line.strip()


def run(ffmpeg: str, label: str, work: Path) -> Dict[str, Any]:
    """整批组合，同时对三条假设记分：gray 表 / 只取偶 pad / 尺寸与 pad 都取偶。"""
    work.mkdir(parents=True, exist_ok=True)
    cases: List[Dict[str, Any]] = []
    scored = 0
    agree_gray = 0
    agree_sub = 0
    agree_even = 0
    agree_prod = 0
    for nat_w, nat_h, box_w, box_h in PROBE_CASES:
        gray_rule = predict(nat_w, nat_h, box_w, box_h)
        sub_rule = predict_subsampled(nat_w, nat_h, box_w, box_h)
        even_rule = predict_even_size_centred(nat_w, nat_h, box_w, box_h)
        prod_rule = predict_production(nat_w, nat_h, box_w, box_h)
        observed, cmd, raw = measure(ffmpeg, work, nat_w, nat_h, box_w, box_h)
        # 奇数盒在 yuv420p 下根本编码不出来（FFmpeg 直接拒收），生产也永远不会产生
        # 它——`quantise_overlay_box` 的尺寸先过 `ensure_even_dimensions`。这类样本
        # 没有读数，记为「生产不可达」而不是算进任何一条规则的分母，否则分母里混进
        # 一个谁都答不出的题，三条规则就都不可能满分（而那与规则对不对无关）。
        realisable = box_w % 2 == 0 and box_h % 2 == 0
        if realisable and observed is not None:
            scored += 1
            agree_gray += 1 if observed == gray_rule else 0
            agree_sub += 1 if observed == sub_rule else 0
            agree_even += 1 if observed == even_rule else 0
            agree_prod += 1 if observed == prod_rule else 0
        cases.append({
            "natural": [nat_w, nat_h],
            "box": [box_w, box_h],
            "productionRealisable": realisable,
            "grayRule": gray_rule,
            "subsampledRule": sub_rule,
            "evenSizeCentredRule": even_rule,
            "productionRule": prod_rule,
            "observed": observed,
            "matchesGrayRule": observed == gray_rule,
            "matchesSubsampledRule": observed == sub_rule,
            "matchesEvenSizeCentredRule": observed == even_rule,
            "matchesProductionRule": observed == prod_rule,
            "rulesDiffer": len({json.dumps(r, sort_keys=True)
                                for r in (gray_rule, sub_rule, even_rule, prod_rule)}) > 1,
            "separatesEvenFromProduction": even_rule != prod_rule,
            "command": cmd,
            "rawBbox": raw,
        })
    differing = [c for c in cases if c["rulesDiffer"] and c["productionRealisable"]]
    separating = [
        c for c in cases if c["separatesEvenFromProduction"] and c["productionRealisable"]
    ]
    return {
        "probe": "e0b-pad-snap",
        "question": (
            "In the PRODUCTION pixel-format chain (PNG -> yuva420p -> overlay on "
            "yuv420p), where does the contained picture actually land — and is the "
            "gray-format E0-b table still the right one to hold the preview to?"
        ),
        "answer": (
            "No. With chroma subsampling the scaled size floors to the even grid "
            "(1920x1080 into a 634x356 box measures 632 wide, not the 633 gray "
            "reported) and so does the centring offset — but the offset is computed "
            "from the size BEFORE that snap, then floored: a raw 21.5 offset lands "
            "at 20, not at the 22 you get by centring the snapped size. The preview "
            "has to replay THIS table, because it is the one the shipped file is "
            "rendered with."
        ),
        "label": label,
        "ffmpeg": ffmpeg,
        "version": _ffmpeg_version(ffmpeg),
        "total": len(PROBE_CASES),
        "scoredCases": scored,
        "notProductionRealisable": len(PROBE_CASES) - scored,
        "agreedWithGrayRule": agree_gray,
        "agreedWithSubsampledRule": agree_sub,
        "agreedWithEvenSizeCentredRule": agree_even,
        "agreedWithProductionRule": agree_prod,
        "casesWhereRulesDiffer": len(differing),
        "casesSeparatingEvenFromProduction": len(separating),
        "discriminating": len(differing) > 0,
        # 判据里加上 `separating > 0`：只有当这批组合里真有能把假设 B 和假设 C 分开的
        # 样本时，"C 全中"才说明了什么。最初那 16 组 B 和 C 全中，正因为一个这样的样本
        # 都没有——那种 15/15 是漂亮的假绿。
        "pass": (
            scored > 0
            and agree_prod == scored
            and len(differing) > 0
            and len(separating) > 0
        ),
        "cases": cases,
    }


if __name__ == "__main__":
    binary = sys.argv[1] if len(sys.argv) > 1 else "ffmpeg"
    tag = sys.argv[2] if len(sys.argv) > 2 else "dev"
    scratch = Path(sys.argv[4]) if len(sys.argv) > 4 else Path.cwd() / ".pad-snap-work"
    result = run(binary, tag, scratch)
    out = Path(sys.argv[3]) if len(sys.argv) > 3 else None
    if out:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({k: v for k, v in result.items() if k != "cases"}, ensure_ascii=False))
