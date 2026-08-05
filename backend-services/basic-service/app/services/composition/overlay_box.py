"""Overlay-box geometry —— 静图放置盒的量化与盒内 contain（收官轮 §4.1）。

TypeScript 孪生：``src/components/video/playback/internal/overlayBoxQuantise.ts``。
两侧钉在同一份黄金向量上（``docs/plans/camera-motion-box-parity-and-desktop-
walkthrough/fixtures/overlay-box-golden.json``），改了一边不改另一边，两边的测试
一起变红，而不是悄悄漂移。

这里只是把 ``VideoCompositionService._overlay_placement`` 里既有的量化表达式**原样
搬出来**，成为「每种语言只有一处实现」（L-Q1）的那一处。行为不变是硬要求：Q6 用
逐字符比对钉死后端输出。唯一的行为变更是缺省位置 0.3 → 0.8（DD-6），单独一条测试
固定、并在报告里显式声明。
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Tuple

from .video_scaling import ensure_even_dimensions

#: 缺省归一化位置。前端三处（imageOverlayGeometry / ImageOverlayLayer /
#: useVideoExport）早已统一到居中 80%，后端这处停留在 30% —— 一条沉默的、方向明确
#: 的分叉：一旦某个请求不带 position，预览按 80% 画、导出按 30% 画，运镜盒跟着差
#: 2.67 倍。DD-6 把它并过来。
DEFAULT_IMAGE_POSITION: Tuple[float, float, float, float] = (0.1, 0.1, 0.8, 0.8)


@dataclass(frozen=True)
class QuantisedOverlayBox:
    """已落在输出像素栅格上的放置盒。``x``/``y`` 可为负、可越界（DD-9）。"""

    x: int
    y: int
    width: int
    height: int


@dataclass(frozen=True)
class ContainRect:
    """盒内 contain 的结果，单位是输出像素，原点相对盒的左上角。"""

    x: int
    y: int
    width: int
    height: int


def quantise_overlay_box(
    x: float, y: float, width: float, height: float, out_w: int, out_h: int
) -> QuantisedOverlayBox:
    """把归一化位置量化到输出像素栅格。

    保留原实现的**不对称**：原点是截断（``int()``），尺寸是先截断再向上取偶。两者
    取整方向相反、误差不抵消 —— 这正是预览必须复刻规则而不能近似的原因。

    盒**不做钳制**（DD-9）：越界部分交给 FFmpeg ``overlay`` 在帧边界自然裁掉，这与
    预览量化路径的行为一致。

    Args:
        x: 归一化左边缘（可为负）。
        y: 归一化上边缘（可为负）。
        width: 归一化宽度。
        height: 归一化高度。
        out_w: 输出帧宽（像素）。
        out_h: 输出帧高（像素）。

    Returns:
        输出像素空间的整数盒。
    """
    even_w, even_h = ensure_even_dimensions(int(width * out_w), int(height * out_h))
    return QuantisedOverlayBox(
        x=int(x * out_w), y=int(y * out_h), width=even_w, height=even_h
    )


def _round_half_away(value: float) -> int:
    """``av_rescale`` 的取整语义：四舍五入，平局远离零。"""
    return int(math.floor(value + 0.5)) if value >= 0 else -int(math.floor(-value + 0.5))


def contain_rect_in_box(nat_w: int, nat_h: int, box_w: int, box_h: int) -> ContainRect:
    """复刻 FFmpeg ``scale=…decrease`` + ``pad=…:(ow-iw)/2:(oh-ih)/2`` 的整数运算。

    规则是**实测**出来的，不是查文档得来的（L-Q4 —— Iteration 2 有过「文档说
    perspective 的 t 可用、实测 Invalid argument」的教训）：E0-b 在开发端与打包端
    8.1.1 上各跑 16 组真实 FFmpeg，两张表逐值相同。两条反直觉的结论值得写下来：
    盒比例**等于**图片比例时 contain 仍会掉 1px（1920×1080 进 634×356 实得
    633×356），且居中是 ``floor`` 不是四舍五入，1px 的缝全落在右边（``pad_x=0``）。

    本函数不参与后端发射（FFmpeg 自己算），它存在是为了让**预览**能精确复刻同一
    张表；后端这份是它的可执行规范与跨语言对拍基准。

    Args:
        nat_w: 图片自然宽。
        nat_h: 图片自然高。
        box_w: 盒宽（输出像素）。
        box_h: 盒高（输出像素）。

    Returns:
        输出像素空间、相对盒左上角的 contain 矩形。
    """
    if nat_w <= 0 or nat_h <= 0 or box_w <= 0 or box_h <= 0:
        return ContainRect(x=0, y=0, width=box_w, height=box_h)
    w = min(box_w, _round_half_away(box_h * nat_w / nat_h))
    h = min(box_h, _round_half_away(box_w * nat_h / nat_w))
    return ContainRect(x=(box_w - w) // 2, y=(box_h - h) // 2, width=w, height=h)


def build_contain_pad_filter(box_w: int, box_h: int) -> str:
    """盒内 contain 的 FFmpeg 实现串（``scale`` + ``pad``）。

    与 :func:`contain_rect_in_box` 放在一起是有意的：那是规则的可执行规范，这是真正
    发给 FFmpeg 的实现，两者必须描述同一件事，隔开就迟早对不上。

    ``pad`` 用 **透明** 黑边（``black@0``）：运镜正是作用在这张"盒图"上，与预览的
    contain-then-transform 顺序一一对应，不透明边条会在运镜下露成黑框。

    Warning:
        输出字符串是 Q6「逐字符不变」的判据，改一个字符就是行为变更。
    """
    return (
        f"scale={box_w}:{box_h}:force_original_aspect_ratio=decrease,"
        f"pad={box_w}:{box_h}:(ow-iw)/2:(oh-ih)/2:black@0"
    )
