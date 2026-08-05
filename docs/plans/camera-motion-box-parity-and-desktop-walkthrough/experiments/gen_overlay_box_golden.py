"""生成 `fixtures/overlay-box-golden.json` —— TS 与 Python 孪生函数共用的黄金向量。

两族向量的**真相来源不同**，这是刻意的：

* ``containVectors`` 的真相是 **真实 FFmpeg 的实测读数**（E0-b，两个大版本各 16/16
  一致），不是任何一侧实现的输出。规则若被谁写错，对不上的是 FFmpeg 的实测值。
* ``quantiseVectors`` 的真相是 **B0 导出侧既有的量化表达式**（DD-1「导出侧是量化
  真相」）：``int(pos.width * W)`` → ``ensure_even_dimensions`` → ``int(pos.x * W)``。
  这里直接 import 生产的 ``ensure_even_dimensions``，不抄一份，免得黄金文件和被
  测代码一起漂移。

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
    return positions


def _quantise_reference(pos: Dict[str, float], out_w: int, out_h: int) -> Dict[str, object]:
    """B0 导出侧的量化，逐字复刻 `_overlay_placement` 的表达式与求值顺序。

    求值顺序必须与 TS 孪生**逐字**相同：两侧都是 IEEE754 双精度，同样的表达式给出
    同样的 double，`trunc` 于是逐值相等——跨语言一致是构造出来的，不是碰巧。
    """
    even_w, even_h = ensure_even_dimensions(
        int(pos["width"] * out_w), int(pos["height"] * out_h)
    )
    return {
        "xPx": int(pos["x"] * out_w),
        "yPx": int(pos["y"] * out_h),
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


def build(contain_dev: Path, contain_packaged: Path) -> Dict[str, object]:
    dev = json.loads(contain_dev.read_text(encoding="utf-8"))
    packaged = json.loads(contain_packaged.read_text(encoding="utf-8"))
    if not dev["pass"] or not packaged["pass"]:
        raise SystemExit("E0-b 未在两个 FFmpeg 版本上全通，拒绝生成黄金文件")

    by_key = {
        (tuple(c["natural"]), tuple(c["box"])): c["observed"] for c in packaged["cases"]
    }
    contain_vectors = []
    for case in dev["cases"]:
        key = (tuple(case["natural"]), tuple(case["box"]))
        if by_key.get(key) != case["observed"]:
            raise SystemExit(f"两个 FFmpeg 版本对 {key} 给出不同读数，H1 的跨版本前提不成立")
        contain_vectors.append({
            "natural": case["natural"],
            "box": case["box"],
            "expect": case["observed"],
        })

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
            "containVectors are REAL FFmpeg readings (E0-b, agreed across dev "
            "git-2025-05-15 and packaged 8.1.1); quantiseVectors mirror the B0 "
            "export-side expressions (DD-1). Regenerate with "
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
        base / "results" / "e0b-contain-dev.json",
        base / "results" / "e0b-contain-packaged.json",
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
