"""把「搜索在线视频」弹窗布局错位的报告数字重新算一遍。

用法（在仓库根目录）：
    python docs/diagnoses/video-search-modal-layout-misalignment/measure_screenshot.py
    python docs/diagnoses/video-search-modal-layout-misalignment/measure_screenshot.py <图片路径>

默认读取用户附件 .agentmesh/attachments/paste-1795506718248.png。
只依赖 Pillow，不连网络、不启动应用。输出即 analysis.md §3.1 / §3.2 / §3.3 引用的实测值：

  [1] 弹窗外框与三栏横向切分
  [2] 弹窗内整宽分隔线 → 各区块实测高度（可与代码里的 padding/行高逐项对账）
  [3] 三栏各自的纵向色带 → 三栏“第一行正文”的 y（错位的直接量化）
  [4] 三栏正文区着墨率 → 空转区块（左栏预览下方的大片空白、中栏空列表）
  [5] 中栏滚动条 / 滚动容器 / 分页条的位置

输出刻意用 ASCII 标签：Windows 控制台默认 GBK 代码页，中文标签会乱码。
"""
from __future__ import annotations

import statistics
import sys
from pathlib import Path

from PIL import Image

DEFAULT_IMAGE = '.agentmesh/attachments/paste-1795506718248.png'

WHITE_FLOOR = 246     # --card  #FFFFFF（截图里可能被轻压到 250~254）
MUTED_RANGE = (236, 245)   # --muted #F0F0F0
BORDER_RANGE = (218, 234)  # --border #E0E0E0


def classify(c):
    r, g, b = c
    if r >= WHITE_FLOOR and g >= WHITE_FLOOR and b >= WHITE_FLOOR:
        return 'card-white'
    if all(MUTED_RANGE[0] <= v <= MUTED_RANGE[1] for v in c):
        return 'muted'
    if all(BORDER_RANGE[0] <= v <= BORDER_RANGE[1] for v in c):
        return 'border'
    return 'ink%s' % (c,)


def is_light(c, floor=224):
    return c[0] >= floor and c[1] >= floor and c[2] >= floor


def modal_box(px, w, h):
    rows, cols = [], []
    for y in range(h):
        n = sum(1 for x in range(0, w) if is_light(px[x, y]))
        if n > w * 0.5:
            rows.append(y)
    y0, y1 = rows[0], rows[-1]
    for x in range(w):
        n = sum(1 for y in range(y0, y1 + 1) if is_light(px[x, y]))
        if n > (y1 - y0) * 0.5:
            cols.append(x)
    return cols[0], cols[-1], y0, y1


def dominant(px, x0, x1, y, step=3):
    counts = {}
    for x in range(x0, x1 + 1, step):
        c = px[x, y]
        q = (c[0] // 2 * 2, c[1] // 2 * 2, c[2] // 2 * 2)
        counts[q] = counts.get(q, 0) + 1
    return max(counts.items(), key=lambda kv: kv[1])


def full_width_bands(px, x0, x1, y0, y1):
    rows = []
    for y in range(y0, y1 + 1):
        col, cov = dominant(px, x0, x1, y)
        if cov > 0.985 and classify(col) != 'card-white':
            rows.append((y, classify(col)))
    bands = []
    for y, kind in rows:
        if bands and y == bands[-1][1] + 1 and bands[-1][2] == kind:
            bands[-1] = (bands[-1][0], y, kind)
        else:
            bands.append((y, y, kind))
    return bands


def pane_bands(px, x0, x1, y0, y1, min_h=5):
    bands = []
    prev = None
    start = y0
    for y in range(y0, y1 + 1):
        rs, gs, bs = [], [], []
        for x in range(x0, x1 + 1, 3):
            r, g, b = px[x, y]
            rs.append(r); gs.append(g); bs.append(b)
        med = (int(statistics.median(rs)), int(statistics.median(gs)), int(statistics.median(bs)))
        kind = classify(med)
        if kind != prev:
            if prev is not None and y - start >= min_h:
                bands.append((start, y - 1, prev))
            prev = kind
            start = y
    if y1 - start + 1 >= min_h:
        bands.append((start, y1, prev))
    return bands


def ink(px, x0, x1, y0, y1):
    total = 0
    inked = 0
    minx, maxx, miny, maxy = 10 ** 6, -1, 10 ** 6, -1
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            total += 1
            if classify(px[x, y]) == 'ink':
                pass
            if px[x, y] != (255, 255, 255) and classify(px[x, y]) != 'card-white':
                inked += 1
                minx = min(minx, x); maxx = max(maxx, x)
                miny = min(miny, y); maxy = max(maxy, y)
    pct = 100.0 * inked / max(total, 1)
    return pct, (minx, maxx, miny, maxy)


def main(path: str) -> int:
    if not Path(path).exists():
        print('image not found: %s' % path)
        return 2
    im = Image.open(path).convert('RGB')
    w, h = im.size
    px = im.load()
    print('image %s  %dx%d' % (path, w, h))

    mx0, mx1, my0, my1 = modal_box(px, w, h)
    print('\n[1] modal box   x %d..%d (w=%d)   y %d..%d (h=%d)'
          % (mx0, mx1, mx1 - mx0 + 1, my0, my1, my1 - my0 + 1))

    span = (mx1 - mx0 + 1) // 3
    panes = [
        ('left  preview', mx0 + 1, mx0 + span - 2),
        ('mid   results', mx0 + span + 1, mx0 + 2 * span - 2),
        ('right selected', mx0 + 2 * span + 1, mx1 - 1),
    ]
    for name, x0, x1 in panes:
        print('    %-15s x %d..%d (w=%d)' % (name, x0, x1, x1 - x0 + 1))

    print('\n[2] full-width dividers / full-width colour bands (measured heights)')
    bands = full_width_bands(px, mx0 + 2, mx1 - 2, my0 + 1, my1 - 1)
    for s, e, kind in bands:
        if s == e and kind == 'border':
            print('    y=%4d                      1px divider' % s)
        else:
            print('    y=%4d..%4d  h=%3d  %s' % (s, e, e - s + 1, kind))

    print('\n[3] per-pane colour bands -> where each pane\'s first content row starts')
    pane_bands_cache = {}
    for name, x0, x1 in panes:
        pane_bands_cache[name] = pane_bands(px, x0 + 4, x1 - 4, my0 + 1, my1 - 1)

    # 三栏栏头 = 三栏都判为 muted、且其后一栏内容带的结束 y 三栏互不相同的那个整宽 muted 带。
    header = None
    for s, e, kind in bands:
        if kind != 'muted' or not (30 <= e - s + 1 <= 60) or s < my0 + 150:
            continue
        ends = []
        for name, _x0, _x1 in panes:
            pb = pane_bands_cache[name]
            nxt = next(((bs, be) for bs, be, k in pb if bs > e and k != 'muted'), None)
            if nxt is None:
                ends = []
                break
            ends.append(nxt[0])
        if len(ends) == 3 and max(ends) - min(ends) >= 10:
            header = (s, e)
            break
    if header is None:
        # 退路：结构与本截图不完全一致（例如 repro_layout.html 的渲染件）时，
        # 只给三栏色带序列与着墨率，不硬推“共享栏头”，避免给出错误的对齐结论。
        print('    note: no single shared header band found (structure differs from the app screenshot);'
              ' printing per-pane band sequences only')
        for name, x0, x1 in panes:
            pb = pane_bands_cache[name]
            seq = ['y%d..%d(h%d,%s)' % (s, e, e - s + 1, k) for s, e, k in pb if s >= my0 + 140]
            print('  - %s\n      %s' % (name, '  '.join(seq)))
        print('\n    first content row per pane: skipped (see the sequences above)')
        return _tails(px, panes, {n: None for n, _a, _b in panes}, my0, my1, w)

    print('    shared header band y=%d..%d (h=%d)  [三栏此后各自分叉]'
          % (header[0], header[1], header[1] - header[0] + 1))

    first = {}
    for name, x0, x1 in panes:
        pb = pane_bands_cache[name]
        seq = ['y%d..%d(h%d,%s)' % (s, e, e - s + 1, k) for s, e, k in pb if s >= header[0] - 4]
        print('  - %s\n      %s' % (name, '  '.join(seq)))
        first[name] = None
        for s, e, k in pb:
            if k == 'card-white' and s > header[1]:
                first[name] = s
                break

    print('\n    first content row per pane:')
    for name, x0, x1 in panes:
        print('      %-15s y=%s' % (name, first[name]))
    ys = [v for v in first.values() if v]
    if len(ys) >= 2:
        print('      -> max spread %dpx  (this is the "misalignment" in pixels)' % (max(ys) - min(ys)))

    return _tails(px, panes, first, my0, my1, w)


def _tails(px, panes, first, my0, my1, w):
    """[4] 着墨率 + [5] 中栏滚动容器 / 分页条。"""
    print('\n[4] ink coverage of each pane body (non-white pixels / area)')
    for name, x0, x1 in panes:
        top = first[name] or my0 + 1
        pct, (bx0, bx1, by0, by1) = ink(px, x0 + 2, x1 - 2, top, my1 - 2)
        print('    %-15s y%d..%d  ink %.1f%%  bbox x%d..%d y%d..%d'
              % (name, top, my1 - 2, pct, bx0, bx1, by0, by1))
        if pct < 3:
            print('       ^ almost empty: this pane rendered no card at all')

    print('\n[5] mid pane: scrollbar / scroll box / pager')
    mid_x0, mid_x1 = panes[1][1], panes[1][2]
    body_top = first['mid   results'] or my0 + 1
    thumb = None
    for x in range(mid_x1 - 40, mid_x1 + 1):
        n = sum(1 for y in range(body_top, my1 - 2) if classify(px[x, y]) == 'border')
        if n > (my1 - 2 - body_top) * 0.6:
            thumb = x
    print('    scrollbar thumb column: %s' % (('x=%d (#E0E0E0)' % thumb) if thumb else 'not detected'))
    for s, e, k in pane_bands(px, mid_x0 + 4, mid_x1 - 4, body_top, my1 - 1):
        if k == 'muted' and e - s + 1 >= 30 and s < my1 - 80:
            print('    y=%d..%d (h=%d) muted band at the bottom of the scroll box'
                  ' -> pager sits INSIDE the overflow container (code 846-899 < 684)'
                  % (s, e, e - s + 1))
            print('       scroll box = y%d..%d, list viewport = %dpx,'
                  ' the other panes run to y=%d' % (body_top, e, s - body_top, my1 - 2))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_IMAGE))
