import { describe, expect, it } from 'vitest';
import { avoidDockRect, snapFabClearOf } from '../fabAvoid';

/** 工作区 1200×700，位于窗口 (80,40) 处。 */
const PARENT = { left: 80, top: 40, right: 1280, bottom: 740 };

describe('snapFabClearOf', () => {
  it('leaves_the_position_alone_without_a_view_or_without_overlap', () => {
    const position = { right: 24, bottom: 48 };
    expect(snapFabClearOf(position, PARENT, null)).toBe(position);
    expect(snapFabClearOf(position, PARENT, { left: 80, top: 80, right: 600, bottom: 500 })).toBe(position);
  });

  it('moves_a_fab_dropped_on_the_view_to_the_nearest_free_side', () => {
    // 视图占左侧 80..700；FAB 落在视图右缘内侧 (right=600 → FAB 左缘 = 1280-600-56 = 624)
    const next = snapFabClearOf({ right: 600, bottom: 300 }, PARENT, { left: 80, top: 80, right: 700, bottom: 500 });
    // 最近且放得下：贴到视图右侧外 12px → FAB 左缘 712，right = 1280 - (712 + 56) = 512
    expect(next).toEqual({ right: 512, bottom: 300 });
    const fabLeft = PARENT.right - next.right - 56;
    expect(fabLeft).toBeGreaterThanOrEqual(700);
  });

  it('prefers_a_vertical_exit_when_that_is_the_smaller_move', () => {
    // 视图很宽（80..1270），只能向上/下走；FAB 在其下缘附近
    const next = snapFabClearOf({ right: 100, bottom: 250 }, PARENT, { left: 80, top: 80, right: 1270, bottom: 500 });
    expect(next.right).toBe(100);
    const fabTop = PARENT.bottom - next.bottom - 56;
    expect(fabTop).toBeGreaterThanOrEqual(500);
  });

  it('gives_up_when_the_view_fills_the_workspace', () => {
    const position = { right: 300, bottom: 300 };
    expect(snapFabClearOf(position, PARENT, { left: 80, top: 40, right: 1280, bottom: 740 })).toBe(position);
  });
});

/**
 * 悬浮助手面板默认避让 Dock 视口（spec agent-browser-workspace-r3 §2.4.2，
 * AC-R3-7）。工作区 1200×700，面板 380×560，锚点在右下角。
 */
const PARENT_BOX = { width: 1200, height: 700 };
const PANEL_BOX = { width: 380, height: 560 };
const ANCHOR = { right: 24, bottom: 24 };
const NO_OFFSET = { x: 0, y: 0 };
/** 与 usePanelGeometry 的 FAB_HALF 一致：面板挂在 FAB 圆心上方。 */
const FAB_HALF = 28;

function avoid(dockRect: { left: number; top: number; right: number; bottom: number } | null,
  overrides: Partial<Parameters<typeof avoidDockRect>[0]> = {}) {
  return avoidDockRect({
    anchor: ANCHOR, panel: PANEL_BOX, parent: PARENT_BOX, dockRect,
    dockRectOffset: NO_OFFSET, fabHalf: FAB_HALF, safe: 8, gap: 12, ...overrides,
  });
}

/**
 * 面板矩形（父容器坐标）。**必须与 usePanelGeometry 的最终落位同口径**：
 * 组件写的是 `bottom + FAB_HALF`，所以面板下边缘在 `height - bottom - FAB_HALF`。
 * 旧版本这里漏了 FAB_HALF，于是把「纵向偏 28px」的 bug 当成了正确答案钉死。
 */
function panelRect(hint: { right: number; bottom: number }, panel = PANEL_BOX) {
  return {
    left: PARENT_BOX.width - hint.right - panel.width,
    top: PARENT_BOX.height - hint.bottom - FAB_HALF - panel.height,
    right: PARENT_BOX.width - hint.right,
    bottom: PARENT_BOX.height - hint.bottom - FAB_HALF,
  };
}

function intersects(a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number }) {
  return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0
    && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0;
}

describe('avoidDockRect', () => {
  it('keeps_the_anchor_when_the_dock_does_not_overlap', () => {
    // 视图在左上角，面板在右下角：原位即可用，一个像素都不该动。
    expect(avoid({ left: 0, top: 0, right: 500, bottom: 400 })).toEqual(ANCHOR);
  });

  it('keeps_the_anchor_when_the_dock_is_null', () => {
    expect(avoid(null)).toEqual(ANCHOR);
  });

  it('moves_the_panel_left_of_a_dock_that_covers_the_right_side', () => {
    const next = avoid({ left: 700, top: 0, right: 1200, bottom: 700 });
    // 面板右缘贴到视图左缘外 gap=12：parent.width - dock.left + gap
    expect(next).toEqual({ right: 512, bottom: 24 });
    expect(intersects(panelRect(next), { left: 700, top: 0, right: 1200, bottom: 700 })).toBe(false);
  });

  it('moves_the_panel_above_a_dock_that_covers_the_bottom_strip', () => {
    const shortPanel = { width: 380, height: 200 };
    const next = avoidDockRect({
      anchor: ANCHOR, panel: shortPanel, parent: PARENT_BOX,
      dockRect: { left: 0, top: 500, right: 1200, bottom: 700 },
      dockRectOffset: NO_OFFSET, fabHalf: FAB_HALF, safe: 8, gap: 12,
    });
    // 面板下缘必须落在视图上缘之上（含 fabHalf，见 panelRect 的注释）
    expect(panelRect(next, shortPanel).bottom).toBeLessThanOrEqual(500);
    expect(next.right).toBe(ANCHOR.right);
  });

  it('moves_the_panel_below_a_dock_that_covers_the_top_strip', () => {
    // 候选⑤ 的回归：旧实现少减一个 fabHalf，返回的落点会实际压进视口 16px。
    // 视图是顶部通栏（0..172），面板 480 高只能下移；②③ 被通栏否掉、④ 上方放不下。
    const panel = { width: 380, height: 480 };
    const dock = { left: 0, top: 0, right: 1200, bottom: 172 };
    const next = avoidDockRect({
      anchor: ANCHOR, panel, parent: PARENT_BOX, dockRect: dock,
      dockRectOffset: NO_OFFSET, fabHalf: FAB_HALF, safe: 8, gap: 12,
    });
    expect(next).toEqual({ right: ANCHOR.right, bottom: 8 });
    // 面板上缘 = 视图下缘 + gap，一像素都不能压进去
    const rect = panelRect(next, panel);
    expect(rect.top).toBe(184);
    expect(intersects(rect, dock)).toBe(false);
  });

  it('falls_back_to_the_anchor_when_the_dock_fills_the_workspace', () => {
    // 五候选全不可行：退化到迭代 2 行为，绝不把面板摆到屏幕外。
    expect(avoid({ left: 0, top: 0, right: 1200, bottom: 700 })).toEqual(ANCHOR);
  });

  it('never_returns_a_position_outside_the_parent', () => {
    const dock = { left: 620, top: 0, right: 1200, bottom: 700 };
    const next = avoid(dock);
    const rect = panelRect(next);
    expect(rect.left).toBeGreaterThanOrEqual(8);
    expect(rect.top).toBeGreaterThanOrEqual(8);
    expect(rect.right).toBeLessThanOrEqual(PARENT_BOX.width - 8);
    expect(rect.bottom).toBeLessThanOrEqual(PARENT_BOX.height - 8);
  });

  it('converts_the_viewport_rectangle_into_parent_coordinates', () => {
    // P0-2：dockViewportRect 是 getBoundingClientRect 的视口坐标，面板几何是
    // 父容器坐标。父容器 origin=(240,128) 时，同一个视口矩形换算后是
    // 700..1200/0..700（即上一个用例的布局），避让结果必须与之相同。
    const viewportRect = { left: 940, top: 128, right: 1440, bottom: 828 };
    const converted = avoid(viewportRect, { dockRectOffset: { x: 240, y: 128 } });
    expect(converted).toEqual({ right: 512, bottom: 24 });

    // 反之：把 offset 当 0 用（即不做换算）会算出一个偏出几百像素的锚点，
    // 结果必然不同——这就是坐标系 bug 的表现，现有测试拦不住，所以钉在这里。
    const unconverted = avoid(viewportRect, { dockRectOffset: NO_OFFSET });
    expect(unconverted).not.toEqual(converted);
  });
});
