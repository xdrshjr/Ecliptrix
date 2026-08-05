"""生成 `fixtures/overlay-box-golden.json` —— TS 与 Python 孪生函数共用的黄金向量。

两族向量的**真相来源不同**，这是刻意的：

* ``containVectors`` 的真相是 **真实 FFmpeg 的实测读数**，不是任何一侧实现的输出。
  规则若被谁写错，对不上的是 FFmpeg 的实测值。读数取自 **生产像素格式链**
  （``e0b-pad-snap-*.json``：PNG → ``yuva420p`` → 叠在 ``yuv420p`` 上），而**不是**
  E0-b 的 ``format=gray`` 链（``e0b-contain-*.json``）—— gray 无色度二次采样，量出来
  的表在有二次采样的生产链上每轴最多差 1px，Q2 就是被这 1px 卡住的。gray 的读数
  仍然读进来，用途从「真相」降为「交叉校验」：两张表**必须**在无二次采样影响的样
  本上一致，出现第三种读数说明探针本身坏了。
* ``quantiseVectors`` 的真相是 **B0 导出侧既有的量化表达式**（DD-1「导出侧是量化
  真相」）：``int(pos.width * W)`` → ``ensure_even_dimensions`` → ``int(pos.x * W)``，
  **再加上 FFmpeg ``overlay`` 对原点的偶数落格**（节点 #3 实测，见下）。这里直接
  import 生产的 ``ensure_even_dimensions``，不抄一份，免得黄金文件和被测代码一起
  漂移。

  原点落格是 Q2 逼出来的一条真相修正：DD-1 说「导出侧是量化真相」，而导出侧的真相
  不止于命令里的数字，还包括 ``overlay`` 自己怎么消费那个数字。
  ``results/ffmpeg-overlay-alignment.json`` 在两个 FFmpeg 大版本上各测 144 组（含
  72 个负原点），一致给出 ``landing = origin // 2 * 2``、尺寸不变。把它并进量化后，
  **导出像素一个都没动**（FFmpeg 本来就在落格），命令与文件从此说同一句话。

夹具矩阵按计划 §2.3 D1 构造：off-grid 为主，**必须**含越界盒与负坐标盒（L-Q3：
剔除它们等同挑夹具，判本轮不合格）。
"""

from __future__ import annotations

import json
import math
import sys
import types
from pathlib import Path
from typing import Dict, List, Tuple

REPO_ROOT = Path(__file__).resolve().parents[4]
_BACKEND = REPO_ROOT / "backend-services" / "basic-service"
sys.path.insert(0, str(_BACKEND))

# `app/services/__init__.py` eagerly imports VideoCompositionService, which pulls
# in cv2 — and this machine's cv2 install blows up ("recursion is detected during
# loading of binary extensions") outside pytest's import context. We only want one
# 3-line pure function, so short-circuit that package with a namespace stub: the
# real `app.services.composition.video_scaling` still loads from disk, we just
# skip the heavy `__init__`.
_services_stub = types.ModuleType("app.services")
_services_stub.__path__ = [str(_BACKEND / "app" / "services")]
sys.modules.setdefault("app.services", _services_stub)

from app.services.composition.video_scaling import ensure_even_dimensions  # noqa: E402

#: 与 `video_scaling._ASPECT_RATIO_MAP` / 前端 `aspectRatios.ts` 的 id 三方对齐。
EXPORT_RESOLUTIONS: Tuple[Tuple[str, int, int], ...] = (
    ("16:9", 1920, 1080),
    ("9:16", 1080, 1920),
    ("4:3", 1440, 1080),
    ("1:1", 1080, 1080),
    ("21:9", 2560, 1080),
)

_XY = (0.28, 0.3337, 0.5001, 0.7143)
_WH = (0.22, 0.3337, 0.44)


def _build_positions() -> List[Dict[str, float]]:
    """D1 夹具矩阵：24 个 off-grid 组合 + 越界子集 + 负坐标子集。

    两条确定性的对角线（``lane`` 0/1 用不同的错位量选 y/h）把 4×3 的 x/w 组合翻成
    24 个样本，同时让 y/h 也把各自的取值都用到——只测 x/w 会让纵向的量化规则整条
    没有覆盖。
    """
    positions: List[Dict[str, float]] = []
    for lane in (0, 1):
        for xi, x in enumerate(_XY):
            for wi, w in enumerate(_WH):
                y = _XY[(xi + wi + 1 + lane) % len(_XY)]
                h = _WH[(xi + 2 * wi + 2 * lane) % len(_WH)]
                positions.append({"x": x, "y": y, "width": w, "height": h})
    # 负坐标：图片被拖出左 / 上边缘。钳制与不钳制在负方向同样分叉
    # （预览 clamp01 → 0，导出 int(-96) → -96）。
    positions.append({"x": -0.05, "y": 0.3337, "width": 0.44, "height": 0.3337})
    positions.append({"x": 0.28, "y": -0.05, "width": 0.3337, "height": 0.44})
    # 负坐标 × **奇数**原点：上面两个 -0.05 在 1920/1080 上恰好落到 -96 / -54，都是
    # 偶数，于是「负方向怎么取偶」这条分支一个样本都没盖到。-0.0509 在 16:9 上是
    # -97.728 → int() = -97（奇），落格必须给 -98（远离零），截断会给 -96 —— 两种读法
    # 差 2px，正是本轮承诺同源的地方。
    positions.append({"x": -0.0509, "y": 0.3337, "width": 0.3337, "height": 0.22})
    positions.append({"x": 0.3337, "y": -0.0509, "width": 0.22, "height": 0.3337})
    return positions


def _quantise_reference(pos: Dict[str, float], out_w: int, out_h: int) -> Dict[str, object]:
    """导出侧的量化：B0 的表达式 + 实测的 `overlay` 原点落格。

    求值顺序必须与 TS 孪生**逐字**相同：两侧都是 IEEE754 双精度，同样的表达式给出
    同样的 double，`trunc` 于是逐值相等——跨语言一致是构造出来的，不是碰巧。

    这里刻意**不** import 被测的 `overlay_box.quantise_overlay_box`：黄金向量若由被
    测函数生成，改错了实现也会连带改出「对得上」的期望值，测试就只剩自证。尺寸那
    半边 import 生产的 `ensure_even_dimensions` 是可以的——它不是本轮改动面。
    """
    even_w, even_h = ensure_even_dimensions(
        int(pos["width"] * out_w), int(pos["height"] * out_h)
    )
    return {
        "xPx": int(pos["x"] * out_w) // 2 * 2,
        "yPx": int(pos["y"] * out_h) // 2 * 2,
        "boxW": even_w,
        "boxH": even_h,
    }


def _frac(v: float) -> float:
    return abs(v - math.floor(v))


def _is_off_grid(pos: Dict[str, float], out_w: int, out_h: int) -> bool:
    """至少一项的小数部分落在 (0.15, 0.85) 才算真的 off-grid（§2.3 D1）。"""
    return any(
        0.15 < _frac(v) < 0.85
        for v in (
            pos["x"] * out_w,
            pos["width"] * out_w,
            pos["y"] * out_h,
            pos["height"] * out_h,
        )
    )


def build(contain_dev: Path, contain_packaged: Path, gray_dev: Path) -> Dict[str, object]:
    dev = json.loads(contain_dev.read_text(encoding="utf-8"))
    packaged = json.loads(contain_packaged.read_text(encoding="utf-8"))
    if not dev["pass"] or not packaged["pass"]:
        raise SystemExit("E0-b′ 未在两个 FFmpeg 版本上全通，拒绝生成黄金文件")

    gray_by_key = {
        (tuple(c["natural"]), tuple(c["box"])): c["observed"]
        for c in json.loads(gray_dev.read_text(encoding="utf-8"))["cases"]
    }
    by_key = {
        (tuple(c["natural"]), tuple(c["box"])): c["observed"] for c in packaged["cases"]
    }
    contain_vectors = []
    for case in dev["cases"]:
        key = (tuple(case["natural"]), tuple(case["box"]))
        if by_key.get(key) != case["observed"]:
            raise SystemExit(f"两个 FFmpeg 版本对 {key} 给出不同读数，H1 的跨版本前提不成立")
        # 奇数盒在 yuv420p 下编码不出来，生产也永远不会产生它（尺寸先过
        # ensure_even_dimensions）；没有读数的样本不进黄金文件，否则期望值就成了 null。
        if not case["productionRealisable"] or case["observed"] is None:
            continue
        contain_vectors.append({
            "natural": case["natural"],
            "box": case["box"],
            "expect": case["observed"],
            "grayChainReading": gray_by_key.get(key),
            "subsamplingShiftsIt": gray_by_key.get(key) != case["observed"],
        })
    shifted = sum(1 for v in contain_vectors if v["subsamplingShiftsIt"])
    if shifted == 0:
        raise SystemExit(
            "生产链与 gray 链读数完全相同——探针失去了区分力，黄金文件会退化成自证"
        )

    positions = _build_positions()
    quantise_vectors = []
    for index, pos in enumerate(positions):
        for ratio_id, out_w, out_h in EXPORT_RESOLUTIONS:
            quantise_vectors.append({
                "id": f"p{index:02d}-{ratio_id}",
                "position": pos,
                "outW": out_w,
                "outH": out_h,
                "offGrid": _is_off_grid(pos, out_w, out_h),
                "outOfBounds": pos["x"] + pos["width"] > 1 or pos["y"] + pos["height"] > 1,
                "negative": pos["x"] < 0 or pos["y"] < 0,
                "expect": _quantise_reference(pos, out_w, out_h),
            })

    return {
        "_comment": (
            "Golden vectors shared by the TS and Python overlay-box twins. "
            "containVectors are REAL FFmpeg readings taken on the PRODUCTION "
            "pixel-format chain (e0b-pad-snap-*.json, agreed across dev "
            "git-2025-05-15 and packaged 8.1.1); `grayChainReading` is the "
            "no-subsampling E0-b value kept only as contrast. quantiseVectors "
            "mirror the B0 export-side expressions plus the measured `overlay` "
            "origin snap (DD-1). Regenerate with "
            "experiments/gen_overlay_box_golden.py."
        ),
        "exportResolutions": [
            {"id": rid, "width": w, "height": h} for rid, w, h in EXPORT_RESOLUTIONS
        ],
        "containVectors": contain_vectors,
        "quantiseVectors": quantise_vectors,
    }


if __name__ == "__main__":
    base = REPO_ROOT / "docs" / "plans" / "camera-motion-box-parity-and-desktop-walkthrough"
    payload = build(
        base / "results" / "e0b-pad-snap-dev.json",
        base / "results" / "e0b-pad-snap-packaged.json",
        base / "results" / "e0b-contain-dev.json",
    )
    out = base / "fixtures" / "overlay-box-golden.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    vectors = payload["quantiseVectors"]
    print(json.dumps({
        "containVectors": len(payload["containVectors"]),
        "quantiseVectors": len(vectors),
        "positions": len(vectors) // len(EXPORT_RESOLUTIONS),
        "offGrid": sum(1 for v in vectors if v["offGrid"]),
        "outOfBounds": sum(1 for v in vectors if v["outOfBounds"]),
        "negative": sum(1 for v in vectors if v["negative"]),
        "written": str(out),
    }, ensure_ascii=False))
