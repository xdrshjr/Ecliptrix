"""overlay_box —— Python 侧孪生函数的守卫测试（收官轮 §4.1）。

与 ``src/components/video/playback/__tests__/overlayBoxQuantise.test.ts`` **共用
同一份黄金文件**，这才是「跨语言一致」的判据：两边各自对着同一个外部真相验收，
而不是互相拿对方的输出当期望值（那样一起错也一起绿）。

黄金文件里 ``containVectors`` 是真实 FFmpeg 在**生产像素格式链**上的读数
（``e0b-pad-snap-*.json``，开发端与打包端 8.1.1 各 19/19 同表），``quantiseVectors``
是 B0 导出侧表达式 + 实测 ``overlay`` 原点落格的镜像（DD-1）。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

import pytest

from app.services.composition.overlay_box import (
    DEFAULT_IMAGE_POSITION,
    ContainRect,
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
    # 19 而不是探针跑的 20 组：其中一组是**奇数盒**，yuv420p 直接拒收，生产也永远产不
    # 出它（尺寸先过 ``ensure_even_dimensions``）。没有读数就没有期望值——这不是放宽
    # 阈值，是 FFmpeg 拒绝回答的一道题。见探针 JSON 的 ``productionRealisable``。
    assert len(vectors) >= 19
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


def test_same_ratio_box_still_loses_pixels() -> None:
    """「盒比例等于图片比例 ⇒ contain 恰好填满」这个直觉是错的。

    信了它就会省掉预览侧的量化，于是又回到「碰巧相等」。632 而不是 634、也不是 gray
    链的 633：``av_rescale`` 先拿走 1px，色度二次采样再拿走 1px。
    """
    rect = contain_rect_in_box(1920, 1080, 634, 356)
    assert rect.width == 632
    assert rect.x == 0  # floor(2/2)=1 再落偶 → 0：缝全在右边，画面左偏


def test_centering_offset_floors_to_the_even_grid() -> None:
    """生产链的另一半规则：居中偏移 floor 之后还要再落偶。

    1440×1080 进 238×476 盒，原始内容高 179，``(476-179)//2 = 148``。
    """
    rect = contain_rect_in_box(1440, 1080, 238, 476)
    assert (rect.x, rect.y, rect.width, rect.height) == (0, 148, 238, 178)


def test_centering_uses_the_raw_size_then_snaps() -> None:
    """Q2 的 neg-top / oob-bottom 逼出来的那一条：居中在**落偶之前**。

    1440×1080 进 422×360 盒，原始内容高 317 → 偏移 ``(360-317)//2 = 21`` → 落偶 20。
    若改成拿落偶后的 316 重新居中会得到 22，静图就比成片低 2px。最初 16 组在两种读法
    下**都**全中，那种 15/15 是漂亮的假绿；补到 20 组才把它们分开（见探针 JSON 的
    ``casesSeparatingEvenFromProduction``）。
    """
    assert contain_rect_in_box(1440, 1080, 422, 360) == ContainRect(x=0, y=20, width=422, height=316)
    assert contain_rect_in_box(1501, 1000, 422, 476) == ContainRect(x=0, y=96, width=422, height=280)


def test_contain_vectors_are_pinned_to_the_production_chain(golden: Dict[str, Any]) -> None:
    """黄金文件必须保留「两条链读数不同」的样本，否则它退化成自证。

    若哪天有人把 ``gen_overlay_box_golden.py`` 改回读 gray 链，这条当场变红，而不是
    悄悄把 Q2 卡住的那 1px 放回去。
    """
    shifted = [v for v in golden["containVectors"] if v["subsamplingShiftsIt"]]
    assert len(shifted) >= 8
    for vector in shifted:
        nat_w, nat_h = vector["natural"]
        box_w, box_h = vector["box"]
        rect = contain_rect_in_box(nat_w, nat_h, box_w, box_h)
        assert {
            "w": rect.width,
            "h": rect.height,
            "pad_x": rect.x,
            "pad_y": rect.y,
        } != vector["grayChainReading"], f"natural={vector['natural']} box={vector['box']}"


def test_centering_is_floor_not_rounding() -> None:
    assert contain_rect_in_box(1234, 567, 321, 123).x == 26  # 26.5 → 26


def test_degenerate_input_falls_back_to_the_box() -> None:
    rect = contain_rect_in_box(0, 0, 100, 50)
    assert (rect.x, rect.y, rect.width, rect.height) == (0, 0, 100, 50)


def test_quantise_matches_every_golden_vector(golden: Dict[str, Any]) -> None:
    for vector in golden["quantiseVectors"]:
        pos = vector["position"]
        box = quantise_overlay_box(
            (pos["x"], pos["y"], pos["width"], pos["height"]), vector["outW"], vector["outH"]
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
            (pos["x"], pos["y"], pos["width"], pos["height"]), vector["outW"], vector["outH"]
        )
        assert box.width % 2 == 0, vector["id"]
        assert box.height % 2 == 0, vector["id"]


def test_out_of_bounds_box_is_not_clamped() -> None:
    """DD-9 的回归向量：预览侧取消钳制后，两侧必须都给 844。

    B0 上后端就是 844、预览是 548.5px —— 295.5px 的分歧。这条断言钉住后端这一半
    不许为了「对齐预览」反过来加钳制（那会改变所有历史工程的成片画面）。
    """
    box = quantise_overlay_box((0.7143, 0.2, 0.44, 0.3), 1920, 1080)
    assert box.width == 844
    assert box.x == 1370  # int(0.7143*1920) = 1371，再落到偶数格
    assert box.x + box.width > 1920  # 越界部分交给 overlay 在帧边界裁掉


def test_origin_lands_on_the_even_grid_overlay_actually_uses() -> None:
    """Q2 的回归向量：命令里的原点必须是像素真正落的那一格。

    ``results/ffmpeg-overlay-alignment.json`` 实测（两个大版本各 144/144）：
    ``overlay=537:302`` 把图画在 ``536,302``。B0 发的就是 537，于是预览照命令画在
    537、成片在 536 —— Q1 绿、Q2 红。落格并进量化后两句话合一。
    """
    box = quantise_overlay_box((0.28, 0.28, 0.22, 0.22), 1920, 1080)
    assert (box.x, box.y) == (536, 302)  # int() 给 537/302
    assert box.x % 2 == 0 and box.y % 2 == 0


def test_negative_origin_truncates_then_floors_away_from_zero() -> None:
    """两步取整，顺序不能换：先 ``int()`` 截断，再向下取偶。

    ``int()`` 截断而非向下取整 —— TS 侧必须用 ``Math.trunc`` 才能对上；随后的落偶在
    负方向是**远离零**（-97 → -98），这是实测的 72 个负原点样本给的，不是推的。若把
    落偶写成「向零取偶」会得到 -96，与成片差 2px。
    """
    assert quantise_overlay_box((-0.05, 0.0, 0.4, 0.4), 1920, 1080).x == -96
    assert quantise_overlay_box((-0.0509, 0.0, 0.4, 0.4), 1920, 1080).x == -98


def test_default_position_is_the_frontend_eighty_percent() -> None:
    """DD-6：这是一次**显式的行为变更**，不是静默修复。

    后端兜底停在 0.3/0.3 而前端三处早已是 0.8/0.8。正常路径总会下发 position，所以
    今天打不着；但一旦某个请求不带 position（外部调用、旧工程数据、未来的批处理
    入口），预览按 80% 画、导出按 30% 画，运镜盒跟着差 2.67 倍。
    """
    assert DEFAULT_IMAGE_POSITION == (0.1, 0.1, 0.8, 0.8)
    box = quantise_overlay_box(DEFAULT_IMAGE_POSITION, 1920, 1080)
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
