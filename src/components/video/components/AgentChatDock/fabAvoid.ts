import type { FabPosition } from './useDraggableFab';

export interface ClientRect { left: number; top: number; right: number; bottom: number }

/** 与 useDraggableFab 的 FAB 边长 / 边距一致。 */
const FAB_SIZE = 56;
const EDGE_MARGIN = 8;
const CLEARANCE = 12;

function overlaps(a: ClientRect, b: ClientRect): boolean {
  return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0
    && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0;
}

/**
 * 浏览器 Dock 的原生视图永远盖在 DOM 之上：FAB 被拖到视图上方会被遮住。
 * 拖动结束时若 FAB 与视图矩形相交，就吸附到矩形外「位移最小」且仍在工作区内的一边。
 *
 * 坐标：`parent` 是 FAB 的定位父元素（工作区）的 client rect，`position` 为距其右/下边距离。
 * 四边都放不下（视图占满工作区）时原样返回，由遮挡冻结帧兜底。
 */
export interface PanelBox { width: number; height: number }
export interface AnchorHint { right: number; bottom: number }

/**
 * 悬浮助手面板首次打开时避开浏览器 Dock 的原生视图（spec agent-browser-workspace-r3
 * §2.4）。视图永远盖在 DOM 之上，面板压在视图上只会看到冻结帧，「边聊边看
 * Agent 浏览」这条核心旅程默认就断了。
 *
 * **坐标系（P0-2，本函数唯一的坑）**：`dockRect` 来自
 * `getBoundingClientRect()`，是**视口坐标**（相对窗口内容区左上角）；而
 * `anchor/panel/parent` 全是**父容器边框盒**坐标（`right/bottom` 表示距父容器
 * 右/下边的距离）。两者相差父容器的视口原点，工作区不是全窗口（顶栏 + 竖向栏），
 * 这个偏移是几百像素量级。因此换算必须在函数内用 `dockRectOffset` 完成——调用方
 * **不得**预先换算后再传 `{x:0,y:0}`，否则坐标系回归用例就失去意义。
 *
 * **纵向基准（`fabHalf`）**：调用方拿到本函数的返回值后写的是
 * `bottom + fabHalf`——面板挂在 FAB 圆心上方。所以面板下边缘恒在
 * `parent.height - hint.bottom - fabHalf`，不是 `parent.height - hint.bottom`。
 * 少了这一项，纵向相交判定整体偏 28px，候选④「上移」会多占 28px、候选⑤「下移」
 * 会返回一个实际仍压进视口的位置（gap=12 时重叠 16px），也就是「该避让时不避让」。
 *
 * 候选序列：原位 → 左移 → 右移 → 上移 → 下移，取第一个「面板矩形与 dockRect
 * 不相交且仍在父容器内」者。五者皆不可行时返回原锚点（退化为迭代 2 行为，
 * 绝不把面板摆到屏幕外），由遮挡冻结帧兜底。
 */
export function avoidDockRect(input: {
  anchor: AnchorHint; panel: PanelBox; parent: PanelBox;
  dockRect: ClientRect | null;
  /** 父容器边框盒的视口原点（`parent.getBoundingClientRect().left/top`）。 */
  dockRectOffset: { x: number; y: number };
  fabHalf: number; safe: number; gap: number;
}): AnchorHint {
  const { anchor, panel, parent, dockRect, dockRectOffset, fabHalf, safe, gap } = input;
  if (!dockRect) return anchor;

  // 视口坐标 → 父容器坐标（唯一的换算点）。
  const dock: ClientRect = {
    left: dockRect.left - dockRectOffset.x,
    top: dockRect.top - dockRectOffset.y,
    right: dockRect.right - dockRectOffset.x,
    bottom: dockRect.bottom - dockRectOffset.y,
  };

  // 面板矩形：与 `usePanelGeometry` 的**最终**落位同一口径（right/bottom 距父容器
  // 右/下边，且 bottom 已含 `fabHalf`，见上方「纵向基准」）。
  const panelRectFor = (hint: AnchorHint): ClientRect => ({
    right: parent.width - hint.right,
    bottom: parent.height - hint.bottom - fabHalf,
    left: parent.width - hint.right - panel.width,
    top: parent.height - hint.bottom - fabHalf - panel.height,
  });
  const fits = (hint: AnchorHint) => {
    const rect = panelRectFor(hint);
    return rect.left >= safe - 0.5 && rect.top >= safe - 0.5
      && rect.right <= parent.width - safe + 0.5
      && rect.bottom <= parent.height - safe + 0.5;
  };

  const original = panelRectFor(anchor);
  if (!overlaps(original, dock) && fits(anchor)) return anchor;

  const candidates: AnchorHint[] = [
    // ② 左移到视图左侧：面板右缘贴到视图左缘外 gap（横向不含 fabHalf）
    { right: parent.width - dock.left + gap, bottom: anchor.bottom },
    // ③ 右移到视图右侧：面板左缘贴到视图右缘外 gap
    { right: parent.width - dock.right - panel.width - gap, bottom: anchor.bottom },
    // ④ 上移到视图上方：面板下缘贴到视图上缘外 gap
    { right: anchor.right, bottom: parent.height - dock.top + gap - fabHalf },
    // ⑤ 下移到视图下方：面板上缘贴到视图下缘外 gap
    { right: anchor.right, bottom: parent.height - dock.bottom - panel.height - gap - fabHalf },
  ];

  for (const candidate of candidates) {
    const clamped: AnchorHint = {
      right: Math.round(clampHint(candidate.right, safe, parent.width - panel.width - safe)),
      bottom: Math.round(clampHint(candidate.bottom, safe, parent.height - panel.height - safe)),
    };
    if (!fits(clamped)) continue;
    if (overlaps(panelRectFor(clamped), dock)) continue;
    return clamped;
  }
  return anchor;
}

/** `safe` 与 max 可能倒挂（面板比父容器宽）时以 `safe` 为准，和组件里的 clamp 同义。 */
function clampHint(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function snapFabClearOf(
  position: FabPosition, parent: ClientRect, avoid: ClientRect | null,
): FabPosition {
  if (!avoid) return position;
  const fabRight = parent.right - position.right;
  const fabBottom = parent.bottom - position.bottom;
  const fab: ClientRect = {
    right: fabRight, bottom: fabBottom, left: fabRight - FAB_SIZE, top: fabBottom - FAB_SIZE,
  };
  if (!overlaps(fab, avoid)) return position;
  const width = parent.right - parent.left;
  const height = parent.bottom - parent.top;
  const fitsRight = (value: number) => value >= EDGE_MARGIN && value <= width - FAB_SIZE - EDGE_MARGIN;
  const fitsBottom = (value: number) => value >= EDGE_MARGIN && value <= height - FAB_SIZE - EDGE_MARGIN;
  // 移到视图的右侧 / 左侧 / 上方 / 下方，各自的 FAB 右下边缘目标位置：
  const targets = [
    { x: avoid.right + CLEARANCE + FAB_SIZE, y: fabBottom },
    { x: avoid.left - CLEARANCE, y: fabBottom },
    { x: fabRight, y: avoid.top - CLEARANCE },
    { x: fabRight, y: avoid.bottom + CLEARANCE + FAB_SIZE },
  ];
  const candidates = targets
    .map((target) => ({
      right: parent.right - target.x,
      bottom: parent.bottom - target.y,
      cost: Math.abs(target.x - fabRight) + Math.abs(target.y - fabBottom),
    }))
    .filter((candidate) => fitsRight(candidate.right) && fitsBottom(candidate.bottom));
  if (candidates.length === 0) return position;
  const best = candidates.reduce((a, b) => (b.cost < a.cost ? b : a));
  return { right: Math.round(best.right), bottom: Math.round(best.bottom) };
}
