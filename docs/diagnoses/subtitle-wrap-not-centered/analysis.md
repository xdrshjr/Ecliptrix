# Bug 分析报告：导出视频后中文字幕自动换行，但换行后未居中

- **Bug slug**: `subtitle-wrap-not-centered`
- **分析人**: Subtask #0（问题定位与修复）
- **日期**: 2026-06-04
- **本轮上下文**: 第 1 轮修复"中文字幕显示为方框"（commit `a504a09`，装 CJK 字体）；第 2 轮修复"长字幕不自动换行、整行溢出屏幕"（commit `6f612ad`，按帧宽重算每行字符预算）。本轮（第 3 轮）症状：**自动换行已生效，但换行后的多行不是居中的**。需求原文："没好，自动换行，换行后应该也是居中的，现在没居中"。
- **结论一句话**: 横屏/方屏走的 `_build_standard_drawtext_filters()` 把**整条字幕的多行换行结果写进同一个 `drawtext`**（`'\n'.join(wrapped_lines)` + 单个 `x=(w-text_w)/2`）。ffmpeg 的 `drawtext` 对一个文本框内的多行**默认左对齐**（`text_w` 取最宽行的宽度，整框居中，但框内每行各自靠左）——于是较短的换行行会**贴在长行的左边缘下方**而非居中。竖屏路径 `_build_multiline_centered_drawtext_filters()` 早已对**每一行单独生成一个居中的 `drawtext`**，所以竖屏没问题、横屏/方屏才暴露此 bug。

---

## 1. 问题描述（Problem description）

用户在视频编辑器点击"导出视频"，合成成片中：

- 长中文字幕已能自动换行（第 2 轮修复见效）。
- 但**换行后的若干行没有水平居中**：第一行（最长）看起来居中，第二行（较短）却靠左，整体呈"左对齐"观感。
- 期望：换行后**每一行都水平居中**。

---

## 2. 根因（Root cause）

导出合成的字幕烧录有两条渲染路径（`build_drawtext_filters()` / `_build_ffmpeg_command()` 按宽高比分流）：

| 路径 | 适用 | 多行渲染方式 | 换行居中是否正确 |
|---|---|---|---|
| `_build_multiline_centered_drawtext_filters` | 竖屏 `aspect<1.0` | **每行一个** `drawtext`，逐行 `x=(w-text_w)/2` | ✅ 正确 |
| `_build_standard_drawtext_filters` | 横屏/方屏 `aspect>=1.0` | **整条一个** `drawtext`，`\n` 连接所有行 + 单个 `x=(w-text_w)/2` | ❌ 每行框内左对齐 |

ffmpeg `drawtext` 的语义：当 `textfile`/`text` 含换行时，它把整块文本当作一个边界框来摆放，`x` 决定**整框**左上角，`text_w` 是**最宽那一行**的宽度。框内每一行都从同一个 `x` 起笔（左对齐），没有逐行居中。因此 `x=(w-text_w)/2` 只让"整框"居中，短行仍靠左。

> ffmpeg 7.0 起 `drawtext` 新增了 `text_align=center` 可让框内多行居中，但生产环境（Ubuntu 24.04）默认 ffmpeg 为 6.x，不支持该选项，故不能依赖它。

---

## 3. 修复（Fix）

把横屏/方屏路径 `_build_standard_drawtext_filters()` 改为与竖屏路径一致的**逐行居中**：每条字幕先 `_wrap_text()` 拆行，再为**每一行单独生成一个 `drawtext`**，每行各自 `x=(w-text_w)/2`（这样每行都按自己的宽度独立居中），纵向用数值堆叠（`line_height = font_size + 5`，逐行 `y = start_y + i*line_height`）。`start_y` 的各 `position`（top / upper-3/4 / center / lower-3/4 / bottom）算法与竖屏路径完全一致，纵向位置保持不变。

- 文件：`backend-services/basic-service/app/services/subtitle_service.py`
- 函数：`_build_standard_drawtext_filters`
- 与之前相比：单行短字幕行为不变（仍 1 个居中 `drawtext`）；多行字幕从"1 个左对齐框"变为"N 个逐行居中 `drawtext`"。
- 调用点（`build_drawtext_filters` / `_build_ffmpeg_command`）和竖屏路径**均未改动**，把改动面控制在唯一有问题的函数内。

为什么不直接让两条路径合并/复用：保持最小改动面、不动已正确工作的竖屏路径与分流逻辑，降低回归风险。两个函数现在算法一致，但语义上仍分别对应"横屏/方屏"与"竖屏"。

---

## 4. 验证（Verification）

数值验证（绕过 `__init__` 的 ffmpeg 探测，直接调函数）：

- 1920×1080、字号 48、`margin_horizontal=50` → 每行预算 37 字；一条约 50 字的中文字幕被拆成 **2 行**，生成 **2 个** `drawtext`，每个都含 `x=(w-text_w)/2`。
- 逐行 `y = [924, 977]`，递增且互不相同；`bottom` 位置下整块底部 `977 + (48+5) = 1030 = 1080 - 50`，纵向边距正确。
- 单行短字幕仍只生成 1 个居中 `drawtext`（无回归）。

`ast.parse` 通过，语法无误。
