"""overlay_box —— Python 侧孪生函数的守卫测试（收官轮 §4.1）。

与 ``src/components/video/playback/__tests__/overlayBoxQuantise.test.ts`` **共用
同一份黄金文件**，这才是「跨语言一致」的判据：两边各自对着同一个外部真相验收，
而不是互相拿对方的输出当期望值（那样一起错也一起绿）。

黄金文件里 ``containVectors`` 是真实 FFmpeg 的读数（E0-b，开发端与打包端 8.1.1 各
16/16 同表），``quantiseVectors`` 是 B0 导出侧表达式的镜像（DD-1）。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

import pytest

from app.services.composition.overlay_box import (
    DEFAULT_IMAGE_POSITION,
    build_contain_pad_filter,
    contain_rect_in_box,
    quantise_overlay_box,
)

_REPO_ROOT = Path(__file__).resolve().parents[3]
_FIXTURE = (
    _REPO_ROOT
    / "docs"
    / "plans"
    / "camera-motion-box-parity-and-desktop-walkthrough"
    / "fixtures"
    / "overlay-box-golden.json"
)


@pytest.fixture(scope="module")
def golden() -> Dict[str, Any]:
    assert _FIXTURE.exists(), f"黄金文件缺失: {_FIXTURE}"
    return json.loads(_FIXTURE.read_text(encoding="utf-8"))


def test_contain_rect_reproduces_every_real_ffmpeg_reading(golden: Dict[str, Any]) -> None:
    vectors: List[Dict[str, Any]] = golden["containVectors"]
    assert len(vectors) >= 16
    for vector in vectors:
        nat_w, nat_h = vector["natural"]
        box_w, box_h = vector["box"]
        rect = contain_rect_in_box(nat_w, nat_h, box_w, box_h)
        assert {
            "w": rect.width,
            "h": rect.height,
            "pad_x": rect.x,
            "pad_y": rect.y,
        } == vector["expect"], f"natural={vector['natural']} box={vector['box']}"


def test_same_ratio_box_still_loses_a_pixel() -> None:
    """「盒比例等于图片比例 ⇒ contain 恰好填满」这个直觉是错的。

    信了它就会省掉预览侧的量化，于是又回到「碰巧相等」。
    """
    rect = contain_rect_in_box(1920, 1080, 634, 356)
    assert rect.width == 633
    assert rect.x == 0  # floor(1/2)：1px 的缝全在右边，画面左偏


def test_centering_is_floor_not_rounding() -> None:
    assert contain_rect_in_box(1234, 567, 321, 123).x == 26  # 26.5 → 26


def test_degenerate_input_falls_back_to_the_box() -> None:
    rect = contain_rect_in_box(0, 0, 100, 50)
    assert (rect.x, rect.y, rect.width, rect.height) == (0, 0, 100, 50)


def test_quantise_matches_every_golden_vector(golden: Dict[str, Any]) -> None:
    for vector in golden["quantiseVectors"]:
        pos = vector["position"]
        box = quantise_overlay_box(
            pos["x"], pos["y"], pos["width"], pos["height"], vector["outW"], vector["outH"]
        )
        assert {
            "xPx": box.x,
            "yPx": box.y,
            "boxW": box.width,
            "boxH": box.height,
        } == vector["expect"], vector["id"]


def test_quantised_box_dimensions_are_even(golden: Dict[str, Any]) -> None:
    for vector in golden["quantiseVectors"]:
        pos = vector["position"]
        box = quantise_overlay_box(
            pos["x"], pos["y"], pos["width"], pos["height"], vector["outW"], vector["outH"]
        )
        assert box.width % 2 == 0, vector["id"]
        assert box.height % 2 == 0, vector["id"]


def test_out_of_bounds_box_is_not_clamped() -> None:
    """DD-9 的回归向量：预览侧取消钳制后，两侧必须都给 844。

    B0 上后端就是 844、预览是 548.5px —— 295.5px 的分歧。这条断言钉住后端这一半
    不许为了「对齐预览」反过来加钳制（那会改变所有历史工程的成片画面）。
    """
    box = quantise_overlay_box(0.7143, 0.2, 0.44, 0.3, 1920, 1080)
    assert box.width == 844
    assert box.x == 1371
    assert box.x + box.width > 1920  # 越界部分交给 overlay 在帧边界裁掉


def test_negative_origin_truncates_toward_zero() -> None:
    """``int()`` 截断而非向下取整 —— TS 侧必须用 ``Math.trunc`` 才能对上。"""
    assert quantise_overlay_box(-0.05, 0.0, 0.4, 0.4, 1920, 1080).x == -96


def test_default_position_is_the_frontend_eighty_percent() -> None:
    """DD-6：这是一次**显式的行为变更**，不是静默修复。

    后端兜底停在 0.3/0.3 而前端三处早已是 0.8/0.8。正常路径总会下发 position，所以
    今天打不着；但一旦某个请求不带 position（外部调用、旧工程数据、未来的批处理
    入口），预览按 80% 画、导出按 30% 画，运镜盒跟着差 2.67 倍。
    """
    assert DEFAULT_IMAGE_POSITION == (0.1, 0.1, 0.8, 0.8)
    box = quantise_overlay_box(*DEFAULT_IMAGE_POSITION, 1920, 1080)
    assert (box.x, box.y, box.width, box.height) == (192, 108, 1536, 864)


def test_contain_pad_filter_string_is_byte_stable() -> None:
    """Q6 的逐字符判据。改一个字符就是行为变更，必须显式决策。"""
    assert build_contain_pad_filter(844, 474) == (
        "scale=844:474:force_original_aspect_ratio=decrease,"
        "pad=844:474:(ow-iw)/2:(oh-ih)/2:black@0"
    )


def test_fixture_keeps_its_mandatory_subsets(golden: Dict[str, Any]) -> None:
    """L-Q3：夹具本身要被测，剔除越界/负坐标样本等同挑夹具。"""
    vectors = golden["quantiseVectors"]
    positions = {v["id"].split("-")[0] for v in vectors}
    out_of_bounds = {v["id"].split("-")[0] for v in vectors if v["outOfBounds"]}
    negative = {v["id"].split("-")[0] for v in vectors if v["negative"]}
    assert len(positions) >= 24
    assert len(out_of_bounds) >= 4
    assert len(negative) >= 2
    assert all(v["offGrid"] for v in vectors)
