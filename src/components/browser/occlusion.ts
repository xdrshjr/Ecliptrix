/**
 * Native-view occlusion (spec §4.2.3, R1-5): a WebContentsView always paints
 * above the DOM, so anything that pops up over the Dock's viewport would be
 * hidden behind the page. The decision is GEOMETRIC — an occluder counts when
 * its rectangle overlaps the viewport rectangle — never "is it inside the Dock".
 * That is what makes Dock-internal menus (profile switcher, signed-in sites)
 * work: they overlap the viewport, so they trigger the frozen frame like any
 * dialog would.
 */

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Roles / markers that denote a floating layer. New portals MUST carry one (AC-D13). */
export const OCCLUDER_SELECTOR = [
  '[role="dialog"]', '[role="alertdialog"]', '[role="menu"]', '[role="listbox"]',
  '[role="tooltip"]', '[data-overlay="true"]', '[data-native-occluder]',
  '[data-sonner-toaster]', '[data-radix-popper-content-wrapper]',
  '[role="status"][data-overlay]',
].join(',');

/** In-flow elements laid out outside the viewport rectangle (approval bar, start page). */
export const INFLOW_ATTRIBUTE = 'data-native-inflow';
export const DOCK_ROOT_ATTRIBUTE = 'data-browser-dock-root';

/** True when any occluder rectangle overlaps the view with positive area. */
export function computeOcclusion(view: Rect, occluders: readonly Rect[]): boolean {
  if (view.right - view.left <= 0 || view.bottom - view.top <= 0) return false;
  return occluders.some((rect) => {
    const width = Math.min(view.right, rect.right) - Math.max(view.left, rect.left);
    const height = Math.min(view.bottom, rect.bottom) - Math.max(view.top, rect.top);
    return width > 0 && height > 0;
  });
}

function isExempt(element: Element): boolean {
  return element.hasAttribute(DOCK_ROOT_ATTRIBUTE)
    || element.closest(`[${INFLOW_ATTRIBUTE}]`) !== null;
}

function toRect(box: DOMRect): Rect {
  return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
}

/** Visible occluder rectangles under `root`, minus the two documented exemptions. */
export function collectOccluderRects(root: ParentNode = document): Rect[] {
  const rects: Rect[] = [];
  root.querySelectorAll(OCCLUDER_SELECTOR).forEach((element) => {
    if (isExempt(element)) return;
    const box = element.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    rects.push(toRect(box));
  });
  return rects;
}

export function rectOf(element: Element): Rect {
  return toRect(element.getBoundingClientRect());
}
