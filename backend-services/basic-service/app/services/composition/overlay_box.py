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


def _floor_even(value: int) -> int:
    """向下取偶（向 -∞），复刻 FFmpeg ``overlay`` 对原点的落格。

    这是**实测**出来的（``results/ffmpeg-overlay-alignment.json``：开发端
    git-2025-05-15 与打包端 8.1.1 各 144/144 同表，含 72 个负原点样本）：
    ``overlay=5:5`` 的 11×11 方块落在 ``4,4`` 且仍是 11×11 —— **原点**落格、**尺寸**
    原样。负方向是**远离零**地取偶（-5 → -6），不是截断（那会给 -4）。

    ``value // 2 * 2`` 而不是 ``value & ~1``：两者对本函数的取值域等价，但地板除法在
    TS 孪生里有逐字对应的写法（``Math.floor(v / 2) * 2``），而 JS 的 ``&`` 会先转成
    32 位整数——用位运算就等于把一条跨语言契约押在两种语言各自的整数模型上。
    """
    return value // 2 * 2


def quantise_overlay_box(
    position: Tuple[float, float, float, float], out_w: int, out_h: int
) -> QuantisedOverlayBox:
    """把归一化位置量化到输出像素栅格。

    保留原实现的**不对称**：原点是截断（``int()``），尺寸是先截断再向上取偶。两者
    取整方向相反、误差不抵消 —— 这正是预览必须复刻规则而不能近似的原因。

    原点在截断之后**再向下取偶**（:func:`_floor_even`）。这一步是 Q2 逼出来的：Q1 证
    明了两侧对**命令里的数字**已经 0.000px 一致，可 Q2 渲染那条命令产出的**文件**，
    图仍能差 1px —— 因为 ``overlay`` 自己会把原点落到偶数格。于是「命令说 537」和
    「像素在 536」是两句不同的话。把落格并进量化后，命令说的就是像素真正在的位置，
    预览也就能画在同一格上。**导出的像素一个都没动**（FFmpeg 本来就在落格），变的
    只是命令从此不再说谎。

    盒**不做钳制**（DD-9）：越界部分交给 FFmpeg ``overlay`` 在帧边界自然裁掉，这与
    预览量化路径的行为一致。

    Args:
        position: 归一化 ``(x, y, width, height)``；``x``/``y`` 可为负、可越界。聚成
            一个元组而不是摊成四个形参，一是仓库规范限形参 ≤5，二是这样与 TS 孪生的
            ``quantiseOverlayBoxNormalised(pos, outW, outH)`` 形状一致 —— 跨语言孪生
            连签名都对得上，读的人才不用在两边之间做心算映射。
        out_w: 输出帧宽（像素）。
        out_h: 输出帧高（像素）。

    Returns:
        输出像素空间的整数盒。
    """
    x, y, width, height = position
    even_w, even_h = ensure_even_dimensions(int(width * out_w), int(height * out_h))
    return QuantisedOverlayBox(
        x=_floor_even(int(x * out_w)),
        y=_floor_even(int(y * out_h)),
        width=even_w,
        height=even_h,
    )


def _round_half_away(value: float) -> int:
    """``av_rescale`` 的取整语义：四舍五入，平局远离零。"""
    return int(math.floor(value + 0.5)) if value >= 0 else -int(math.floor(-value + 0.5))


def contain_rect_in_box(nat_w: int, nat_h: int, box_w: int, box_h: int) -> ContainRect:
    """复刻 FFmpeg ``scale=…decrease`` + ``pad=…:(ow-iw)/2:(oh-ih)/2`` 在**生产像素
    格式链**上的整数运算。

    规则是**实测**出来的，不是查文档得来的（L-Q4 —— Iteration 2 有过「文档说
    perspective 的 t 可用、实测 Invalid argument」的教训）；而且实测了**两次**，因为
    第一次测错了链形。E0-b 为了让 ``bbox`` 读得出边界在收尾加了 ``format=gray``，而
    gray 没有色度二次采样；生产链是 PNG 协商成 ``yuva420p`` 再叠到 ``yuv420p`` 帧上，
    ``hsub = vsub = 1``。有二次采样时，缩放后的尺寸与居中偏移**都**要落到偶数格，于是
    gray 那张表在本轮专门要修的那批盒上每轴最多差 1px。
    ``results/e0b-pad-snap-{dev,packaged}.json`` 记录了两个 FFmpeg 大版本各 15/15 与
    下面这条规则一致，其中 12 组能把它与 gray 表区分开。

    三条反直觉的结论值得写下来：盒比例**等于**图片比例时 contain 仍会掉像素
    （1920×1080 进 634×356 实得 **632**×356，既不是 634 也不是 gray 表的 633）；居中是
    ``floor`` 不是四舍五入；且 floor 之后还要再向下取偶 —— 149 的居中偏移落在 148。

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
    raw_w = min(box_w, _round_half_away(box_h * nat_w / nat_h))
    raw_h = min(box_h, _round_half_away(box_w * nat_h / nat_w))
    # 居中用的是**取偶之前**的尺寸，算完再落偶；不是拿落偶后的尺寸重新居中。两种读法
    # 只在原始偏移为奇数时相差 2px —— 正因如此最初 16 组分不出它们，得补到 20 组。
    return ContainRect(
        x=_floor_even((box_w - raw_w) // 2),
        y=_floor_even((box_h - raw_h) // 2),
        width=_floor_even(raw_w),
        height=_floor_even(raw_h),
    )


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
