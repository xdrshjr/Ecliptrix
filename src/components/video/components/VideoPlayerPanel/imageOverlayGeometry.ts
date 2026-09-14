/**
 * Image-overlay geometry — pure helpers behind `<ImageOverlay>` (spec
 * docs/plans/image-overlay-fit-and-transform/spec.md §4.1 / §6).
 *
 * Extracted from ImageOverlay.tsx so the clamp-as-single-source (D3), the
 * first-frame display-box alignment (D6) and the equal-ratio resize (D4) are
 * unit-testable. (The project's Vitest config sets tsconfig `jsx: "preserve"`,
 * so a `.tsx` module with JSX cannot be imported into a test — see §10. Keeping
 * the math in this JSX-free `.ts` sibling is the extraction §6 anticipated.)
 *
 * No React, no DOM: positions are normalized [0,1] against the preview frame.
 */

import type { ImagePosition } from '@/types';

/**
 * 居中 80% 默认叠加位置（D1）——单一来源。既作为新建图片写入值，又作为 D6
 * 「首帧对齐」的 sentinel 判定基准：只有 imagePosition 仍等于此默认（用户未调整）
 * 的项，才会在拿到图片自然尺寸后一次性把显示框归一化为图片比例。
 */
export const DEFAULT_IMAGE_POSITION: ImagePosition = {
  x: 0.1,
  y: 0.1,
  width: 0.8,
  height: 0.8,
  zIndex: 10,
};

/** 居中 80% 包络（D6 首帧对齐时显示框可占用的最大归一化宽/高）。 */
export const ALIGN_ENVELOPE = 0.8;

/** 缩放/钳制的归一化最小边长，避免叠加层被缩到不可见。 */
export const MIN_OVERLAY_SIZE = 0.1;

function clampSize(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return MIN_OVERLAY_SIZE;
  if (v > 1) return 1;
  return v;
}

function clampOffset(v: number, size: number): number {
  const max = 1 - size;
  if (!Number.isFinite(v) || v < 0) return 0;
  return v > max ? max : v;
}

/**
 * 把归一化位置钳制到合法区间（D3）：width/height ∈ (0,1]、x ∈ [0,1-width]、
 * y ∈ [0,1-height]。组件入口算一次作为渲染 + 拖拽 + 缩放的**唯一基准**，杜绝
 * 历史/异常 width>1 导致 `1-width<0`、钳制区间反转、拖拽产出负坐标。
 */
export function clampImagePosition(p: ImagePosition): ImagePosition {
  const width = clampSize(p.width);
  const height = clampSize(p.height);
  return {
    ...p,
    width,
    height,
    x: clampOffset(p.x, width),
    y: clampOffset(p.y, height),
  };
}

/** 手势起止位置的比较容差（归一化单位）：低于它的抖动不算一次编辑，不入库也不写历史。 */
export const POSITION_CHANGE_TOLERANCE = 1e-4;

const GEOMETRY_KEYS = ['x', 'y', 'width', 'height'] as const;

/** 两个位置是否实质不同（几何超出容差或层级不同）。 */
export function hasPositionChanged(a: ImagePosition, b: ImagePosition): boolean {
  if (GEOMETRY_KEYS.some((key) => Math.abs(a[key] - b[key]) > POSITION_CHANGE_TOLERANCE)) {
    return true;
  }
  return (a.zIndex ?? DEFAULT_IMAGE_POSITION.zIndex) !== (b.zIndex ?? DEFAULT_IMAGE_POSITION.zIndex);
}

/** 该位置是否仍为新建默认 sentinel（仅比对几何，zIndex 不影响视觉对齐判定）。 */
export function isDefaultSentinel(p: ImagePosition): boolean {
  return (
    p.x === DEFAULT_IMAGE_POSITION.x &&
    p.y === DEFAULT_IMAGE_POSITION.y &&
    p.width === DEFAULT_IMAGE_POSITION.width &&
    p.height === DEFAULT_IMAGE_POSITION.height
  );
}

/**
 * D6 首帧对齐（纯几何）：把仍为默认 sentinel 的显示框归一化为「居中 80% 包络内、
 * 与图片自然比例一致」的内嵌矩形。对齐后显示框像素比例 == 图片自然比例，canvas 的
 * `object-contain` 退化为「填满框」→ 可见图片、DOM `<img>`、蓝色选中边框三者完全
 * 重合（验收 #5），等比缩放语义自洽。
 *
 * 仅命中默认 sentinel；历史/用户已调整项返回 `null`（守 R6，不被误改）。
 *
 * @param p        当前归一化显示框
 * @param naturalW 图片自然像素宽（> 0）
 * @param naturalH 图片自然像素高（> 0）
 * @param frameAR  显示框像素宽高比 = containerWidth / containerHeight（> 0）
 * @returns 归一化后的显示框；无需对齐时返回 null
 */
export function alignDefaultBoxToImage(
  p: ImagePosition,
  naturalW: number,
  naturalH: number,
  frameAR: number,
): ImagePosition | null {
  if (!isDefaultSentinel(p)) return null;
  if (!(naturalW > 0) || !(naturalH > 0) || !(frameAR > 0)) return null;

  // 显示框归一化 width/height 之比，使其像素宽高比 == 图片自然比例：
  // (width*W_px)/(height*H_px) = r → width/height = r / frameAR。
  const imageAspect = naturalW / naturalH;
  const boxAR = imageAspect / frameAR;

  let width: number;
  let height: number;
  if (boxAR >= 1) {
    // 框更宽：宽顶满包络。
    width = ALIGN_ENVELOPE;
    height = ALIGN_ENVELOPE / boxAR;
  } else {
    // 框更高：高顶满包络。
    height = ALIGN_ENVELOPE;
    width = ALIGN_ENVELOPE * boxAR;
  }
  return {
    ...p,
    width,
    height,
    x: (1 - width) / 2,
    y: (1 - height) / 2,
  };
}

/**
 * 等比缩放求解（D4）：把鼠标产生的自由宽/高换算为保持「显示框像素比例 == 图片自然
 * 比例」且 ≥ 最小尺寸、≤ 可用空间的 `{width, height}`。`imageAspect` 为 null
 * （naturalW/H 未就绪）时退化为自由改框 + 画布 contain（不失真，仅可能短暂留白）。
 *
 * @param rawWidth   鼠标推导的自由归一化宽度（缩放主驱动轴）
 * @param rawHeight  鼠标推导的自由归一化高度（仅退化路径使用）
 * @param maxWidth   可用宽度上限 = 1 - x
 * @param maxHeight  可用高度上限 = 1 - y
 * @param imageAspect 图片自然比例 naturalW/naturalH，未就绪传 null
 * @param frameAR    显示框像素宽高比 containerWidth/containerHeight
 */
export function resizeKeepingAspect(
  rawWidth: number,
  rawHeight: number,
  maxWidth: number,
  maxHeight: number,
  imageAspect: number | null,
  frameAR: number,
): { width: number; height: number } {
  let newWidth = Math.max(MIN_OVERLAY_SIZE, Math.min(maxWidth, rawWidth));

  if (!imageAspect || imageAspect <= 0 || !(frameAR > 0)) {
    // 退化：自由改框，宽高各自钳制。
    const newHeight = Math.max(MIN_OVERLAY_SIZE, Math.min(maxHeight, rawHeight));
    return { width: newWidth, height: newHeight };
  }

  // 等比：高度由宽度按比例推导，保持显示框像素比例 == 图片自然比例。
  let newHeight = (newWidth * frameAR) / imageAspect;
  if (newHeight > maxHeight) {
    // 高度触顶 → 改由高度反推宽度，仍保持比例。
    newHeight = maxHeight;
    newWidth = (newHeight * imageAspect) / frameAR;
  }
  // 沿受约束更紧的一轴兜底最小尺寸，保持比例不被破坏。
  if (newWidth < MIN_OVERLAY_SIZE) {
    newWidth = MIN_OVERLAY_SIZE;
    newHeight = (newWidth * frameAR) / imageAspect;
  }
  if (newHeight < MIN_OVERLAY_SIZE) {
    newHeight = MIN_OVERLAY_SIZE;
    newWidth = (newHeight * imageAspect) / frameAR;
  }
  return { width: newWidth, height: newHeight };
}

/** 四角缩放手柄 id：`tl/tr/bl/br` = 左上/右上/左下/右下（D2）。 */
export type HandleId = 'tl' | 'tr' | 'bl' | 'br';

/** 单个缩放手柄的渲染元数据（角居中定位 + 对角线光标），驱动四角手柄渲染。 */
export interface ResizeHandleMeta {
  id: HandleId;
  /** Tailwind 定位类，使手柄中心精确对齐 box 对应角。 */
  positionClass: string;
  /** 光标类（对角线方向）。 */
  cursorClass: string;
}

/**
 * 四角手柄元数据（D2，C4 统一为角居中 `-translate-*-1/2`）：tl/br 走 nwse 光标、
 * tr/bl 走 nesw 光标。ImageOverlay 直接 map 此表渲染四个手柄。
 */
export const RESIZE_HANDLES: readonly ResizeHandleMeta[] = [
  { id: 'tl', positionClass: 'top-0 left-0 -translate-x-1/2 -translate-y-1/2', cursorClass: 'cursor-nwse-resize' },
  { id: 'tr', positionClass: 'top-0 right-0 translate-x-1/2 -translate-y-1/2', cursorClass: 'cursor-nesw-resize' },
  { id: 'bl', positionClass: 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2', cursorClass: 'cursor-nesw-resize' },
  { id: 'br', positionClass: 'bottom-0 right-0 translate-x-1/2 translate-y-1/2', cursorClass: 'cursor-nwse-resize' },
];

/**
 * 每角「固定哪两条边」（C5 数据表）：fixLeft=左边(x)固定、否则右边(x+width)固定；
 * fixTop=上边(y)固定、否则下边(y+height)固定。被拖角追随鼠标，对角恒定不动。
 */
const HANDLE_ANCHORS: Record<HandleId, { fixLeft: boolean; fixTop: boolean }> = {
  br: { fixLeft: true, fixTop: true },
  bl: { fixLeft: false, fixTop: true },
  tr: { fixLeft: true, fixTop: false },
  tl: { fixLeft: false, fixTop: false },
};

/**
 * 多角等比缩放求解（D2/C5 数据表化）：按 `handle` 固定对角，鼠标驱动被拖角，复用
 * `resizeKeepingAspect` 保持「显示框像素比例 == 图片自然比例」（`imageAspect` 为
 * null 时退化为自由改框），按固定对角反推 `{x,y}`，最后 `clampImagePosition`
 * 钳制。返回完整归一化显示框。
 *
 * @param handle      被拖的角
 * @param base        当前显示框（= safePosition，已 clamp）
 * @param mouseXNorm  鼠标归一化 x（内部按可用空间钳制）
 * @param mouseYNorm  鼠标归一化 y
 * @param imageAspect 图片自然比例 naturalW/naturalH，未就绪传 null
 * @param frameAR     显示框像素宽高比 containerWidth/containerHeight
 */
export function resizeFromHandle(
  handle: HandleId,
  base: ImagePosition,
  mouseXNorm: number,
  mouseYNorm: number,
  imageAspect: number | null,
  frameAR: number,
): ImagePosition {
  const { fixLeft, fixTop } = HANDLE_ANCHORS[handle];
  const right = base.x + base.width;
  const bottom = base.y + base.height;

  const rawWidth = fixLeft ? mouseXNorm - base.x : right - mouseXNorm;
  const rawHeight = fixTop ? mouseYNorm - base.y : bottom - mouseYNorm;
  const maxWidth = fixLeft ? 1 - base.x : right;
  const maxHeight = fixTop ? 1 - base.y : bottom;

  const { width, height } = resizeKeepingAspect(
    rawWidth,
    rawHeight,
    maxWidth,
    maxHeight,
    imageAspect,
    frameAR,
  );

  return clampImagePosition({
    ...base,
    x: fixLeft ? base.x : right - width,
    y: fixTop ? base.y : bottom - height,
    width,
    height,
  });
}
