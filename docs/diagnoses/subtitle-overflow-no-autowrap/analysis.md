# Bug 分析报告：导出视频后中文字幕过长不自动换行、超出屏幕宽度

- **Bug slug**: `subtitle-overflow-no-autowrap`
- **分析人**: Subtask #0（问题定位与分析）
- **日期**: 2026-06-03
- **本轮上下文**: 第 1 轮已修复"中文字幕显示为方框"（commit `a504a09`，装 CJK 字体）。本轮（第 2 轮）症状：**中文能正常显示了，但字幕太长时不自动换行，整行超出视频宽度**。需求原文："需要考虑多种分辨比例情况下的字幕的自动换行，始终最大宽度为视频的最大宽度"。
- **结论一句话**: 后端**确实有换行逻辑**（`SubtitleService._wrap_text`），但它依赖的"每行最大字符数预算" `_calculate_max_line_width()` 是按**拉丁窄字形**估算的（横屏/方屏按 `font_size*0.6`、竖屏按 `font_size*0.8`），而中文是**全宽字形（≈ `font_size*1.0`）**。预算因此被**高估约 1.5–1.8 倍**，加上一个 **硬编码 100 字符上限**——导致允许的单行宽度**远超视频帧宽**，于是长中文行**根本不触发换行**、烧录后溢出屏幕；`x=(w-text_w)/2` 在 `text_w>w` 时变为负值，文字从两侧出血。

---

## 1. 问题描述（Problem description）

用户在视频编辑器点击"导出视频"，合成成片中：

- 中文字幕已能正常显示（第 1 轮修复见效）。
- 但**当某条字幕文本较长时，它不会被拆成多行**，而是渲染成一整行，**横向超出视频可视宽度**，左右两端文字被截到画面外。
- 期望：字幕在**任意分辨率/宽高比**下都能自动换行，**单行宽度永远不超过视频宽度**。

> 这是典型的"换行阈值过宽"问题：换行逻辑存在，但触发换行的"每行最大字符数"被算得太大，正常长度的中文字幕都达不到阈值，于是从不换行。

---

## 2. 复现步骤（Reproduction steps）

### 2.1 端到端复现（用户视角）

1. 打开视频编辑器，放入一段**横屏**视频（如 1920×1080 或 1280×720）。
2. 添加一条**较长的中文字幕**，例如（约 30–50 字）：
   `这是一段用于测试字幕自动换行是否生效的较长中文字幕内容请注意观察它是否超出画面宽度`
3. 字号保持默认或设为 40。
4. 点击"导出视频"，等待合成完成并播放成片。
5. **现象**：该字幕渲染为**单行**，左右超出画面被截断（不换行）。

> 竖屏（9:16）视频在部分字号下"看起来还行"（见 §3.4），所以问题在横屏/方屏上最明显——这正符合"多种分辨比例需分别考虑"的诉求。

### 2.2 最小可复现（纯数值，零依赖，已实测）

复现脚本与本报告同目录：`docs/diagnoses/subtitle-overflow-no-autowrap/repro_wrap_overflow.py`，它**逐行照搬** `_calculate_max_line_width()` 的算法，再按中文全宽字形（`1.0 em`）估算该预算对应的像素行宽：

```bash
python docs/diagnoses/subtitle-overflow-no-autowrap/repro_wrap_overflow.py
```

实测输出（节选，`max_chars`=允许的每行最大字符数，`est_line_px`=该字符数的中文行像素宽，`frame_px`=视频宽）：

```
aspect                  WxH  fs  max_chars  est_line_px  avail_px  frame_px  verdict
16:9 landscape   1920x1080  24        100         2400      1820      1920  EXCEEDS FULL FRAME
16:9 landscape   1920x1080  40         75         3000      1820      1920  EXCEEDS FULL FRAME
16:9 landscape   1280x 720  40         49         1960      1180      1280  EXCEEDS FULL FRAME
1:1 square       1080x1080  40         32         1280       980      1080  EXCEEDS FULL FRAME
9:16 portrait    1080x1920  40         25         1000       980      1080  overflows margin
9:16 portrait     720x1280  40         19          760       620       720  EXCEEDS FULL FRAME
```

**解读**：以 1920×1080、字号 40 为例，预算 `max_chars=75`。也就是说**任何 ≤75 字的中文行都不会被换行**；但 75 个全宽汉字 ≈ 3000px，而画面只有 1920px——所以一条 40–50 字的普通中文字幕（1600–2000px）**既不换行又超出帧宽**。横屏、方屏的每一行都 `EXCEEDS FULL FRAME`，根因得到数值实证。

### 2.3 端到端 ffmpeg 验证（可选，确认渲染真的溢出）

```bash
# 一条长中文字幕，故意只放一行，模拟"未换行"的烧录结果
printf '1\n00:00:00,000 --> 00:00:05,000\n这是一段较长的中文字幕用于验证是否超出视频宽度\n' > /tmp/zh.srt
ffmpeg -y -f lavfi -i color=c=gray:s=1280x720:d=5 /tmp/base.mp4
ffmpeg -y -i /tmp/base.mp4 -vf "subtitles=/tmp/zh.srt:force_style='FontName=Noto Sans CJK SC,Fontsize=40'" /tmp/out.mp4
# 或与服务一致用 drawtext 单行居中：x=(w-text_w)/2，text_w>w 时 x<0 → 文字两侧出血
```

---

## 3. 根因分析（Root cause analysis，含证据）

### 3.1 调用链：导出 → 字幕烧录 → 计算"每行最大字符数" → 换行

导出走 `VideoCompositionService`，两条字幕烧录路径**都**先算 `max_line_width`、再 `_wrap_text`：

- **仅字幕烧录路径**：`_process_subtitle_tracks()` 构造 `SubtitleAddRequest` 时**未传 `max_line_width`**
  — `app/services/video_composition_service.py:2266-2278`（参数列表里没有 `max_line_width`）→ `add_subtitles()`（`:2292-2310`）→ 横屏走 `_build_standard_drawtext_filters`。
- **图片+字幕合并烧录路径**：`_process_overlays_and_subtitles_combined()` 同样**未传 `max_line_width`**
  — `app/services/video_composition_service.py:2490-2506` → `build_drawtext_filters()`。

两条路径里 `max_line_width` 都是 `None`，于是落到自动计算：

- `_build_standard_drawtext_filters`（横屏）：`subtitle_service.py:730-735` → `_calculate_max_line_width(...)`，随后 `:761` `_wrap_text(subtitle.text, max_line_width)`。
- `_build_multiline_centered_drawtext_filters`（竖屏）：`subtitle_service.py:831-836` → 同上，`:845` 换行。

`max_line_width` 默认 `None`、`font_size` 默认 24、`margin_horizontal` 默认 50：
- `app/models/video_models.py:311`（`max_line_width: Optional[int] = Field(None, ...)`）
- `:303`（`font_size=24`）、`:310`（`margin_horizontal=50`）
- 前端 `SubtitleCompositionItem`（`:144-158`）**根本没有 `max_line_width` 字段** → 前端永远不会传，**100% 走自动计算**。

### 3.2 关键缺陷：字符预算按"拉丁窄字形"估算，对中文全宽字形严重高估

`_calculate_max_line_width()`（`subtitle_service.py:141`）按宽高比分三支，每支的"单字符宽度"都按拉丁字形系数估算：

- **横屏**（`aspect>=1.5`，`subtitle_service.py:204-208`）：
  ```python
  char_width = font_size * 0.6
  max_chars  = int(available_width / char_width)
  ```
- **近方形**（`1.0<=aspect<1.5`，`:199-203`）：`char_width = font_size*0.6`，`max_chars = int(available_width/char_width*0.8)`。
- **竖屏**（`aspect<1.0`，`:162-197`）：`char_width = font_size*0.8`，再套硬编码上限（`>=100→10`、`>=72→12`、`>=50→18`、`>=30→25`、否则 `35`）。
- 最后统一：`max_chars = max(min_chars, min(max_chars, 100))`（`:219`，**硬编码 100 上限**；横屏 `min_chars=20`、`:217`）。

**矛盾点**：中文是**全宽（fullwidth）字形**，在 Noto Sans CJK / WenQuanYi 等字体中每个汉字的**步进宽度 ≈ 1.0 em = `font_size` 像素**；而代码按 `0.6`（横屏/方屏）或 `0.8`（竖屏）估算 → **把单字宽度低估了 40%（横屏）/20%（竖屏）** → **把"能放多少字"高估了约 1.67 倍（横屏）/1.25 倍（竖屏）**。后续 `_wrap_chinese_text()`（`subtitle_service.py:260-288`）严格按"字符数 < max_line_width 就不换行"来拆行（`:276`），于是预算虚高直接转化为"该换行时不换行"。

### 3.3 决定性证据：预算对应的行宽超过整帧宽度（§2.2 数值复现）

把 §3.2 的 `max_chars` 乘以中文实际字宽（`font_size * 1.0`）得到的像素行宽，在**所有横屏/方屏档位都超过整帧宽度**：

| 分辨率 | 字号 | `max_chars`(代码预算) | 中文行宽估算 | 可用宽(去边距) | 帧宽 | 结论 |
|---|---|---|---|---|---|---|
| 1920×1080 | 24 | 100（撞上限） | 2400px | 1820 | 1920 | 超帧 |
| 1920×1080 | 40 | 75 | 3000px | 1820 | 1920 | 超帧 |
| 1280×720 | 40 | 49 | 1960px | 1180 | 1280 | 超帧 |
| 1080×1080 | 40 | 32 | 1280px | 980 | 1080 | 超帧 |
| 720×1280 | 40 | 19 | 760px | 620 | 720 | 超帧 |

> 结论链：**前端不传 `max_line_width`** → 自动计算按拉丁系数（`0.6`/`0.8`）+ 100 上限 → **预算虚高 1.25–1.67 倍** → 中文长行字符数达不到虚高阈值、**不换行** → 烧录单行 `text_w > video_width` → `x=(w-text_w)/2 < 0`（`subtitle_service.py:792` 横屏、`:910` 竖屏每行居中公式）→ **文字两侧出血、超出屏幕**。证据为对源码算法的逐行实证，非推测。

### 3.4 为什么竖屏"看起来好一点"、但仍未"始终不超过视频宽度"

竖屏分支有**硬编码字符上限**（10/12/18/25/35，`:176-195`），其注释是按"1080 宽竖屏、可用 980px、字宽 0.8em"反推的（例如"100*0.8*10=800<980"）。但这些是**绝对字符数**、**不随实际帧宽缩放**：

- 1080×1920、字号 40：上限 25 字 → 25×40=1000px > 可用 980px（轻微溢出）。
- **720×1280**（更窄的竖屏）、字号 40：上限仍是 25，但 `base_max_chars=int(620/32)=19`，取 19 → 19×40=760px > 可用 620px、> 帧宽 720px（**超帧**）。

即：竖屏的"安全"是**对某一特定分辨率手调**出来的，换一个分辨率就破功——这恰恰违背需求"**多种分辨比例都要换行、始终不超过视频最大宽度**"。

### 3.5 次要放大因素

- **横屏单条 drawtext 居中**：横屏把整段（含换行）写进一个 textfile，用单个 `drawtext ... x=(w-text_w)/2`（`:774`、`:792`）。一旦某行没换、`text_w>w`，`x` 变负，整块从左边界外开始、右侧溢出，左右都被裁。
- **字符模型 ≠ 真实字形度量**：换行只数"字符个数"，从不读取真实字体的 glyph advance；中英混排时（半宽数字/字母 + 全宽汉字）误差更大，wrap 后单行仍可能超宽。
- **100 字符硬上限**（`:219`）：对横屏小字号（如 1920×1080 / 24px）直接撞上限 100，对应 2400px 远超 1920px 帧宽——上限本身没有任何"帧宽相关性"。

---

## 4. 影响面（Impact surface）

- **受影响功能**：所有"烧录式"字幕导出——
  - 视频编辑器"导出视频"（时间轴含字幕，横屏/方屏最严重）；
  - 工作流 `VideoExport` 节点的字幕烧录；
  - `/api/audio/subtitle/add`（`SubtitleService.add_subtitles`）单独烧字幕。
- **受影响内容**：**中文（及任意全宽 CJK）字幕**，且行较长时；尤以**横屏（16:9）与近方形**最严重，**窄竖屏（如 720×1280）**亦超帧。纯英文/拉丁字幕基本不受影响（`0.6` 系数对拉丁大致成立）。
- **受影响用户/环境**：所有导出含中文字幕视频的用户；**与操作系统无关**（这是字符预算算法问题，本地 Windows/macOS 与线上 Linux 同样发生），因此本地也能复现，便于验证修复。
- **数据安全**：无数据损坏，纯渲染/排版缺陷；但成片字幕出血、不可用，需重新导出。

---

## 5. 候选修复方案对比（Candidate fixes）

| # | 方案 | 改动点 | 侵入性 | 风险 | 工作量 | 是否满足"多比例都不超帧" | 备注 |
|---|------|--------|--------|------|--------|---------------------------|------|
| **A** | **`_calculate_max_line_width` 改为 CJK 感知 + 由帧宽推导预算** | 仅改 `subtitle_service.py`：把单字宽度系数对 CJK 取 ~1.0（拉丁仍 ~0.6），`max_chars = floor(available_width / char_width)`（`available_width=video_width-2*margin`）；**去掉/替换硬编码 100 上限与竖屏绝对上限**，统一用帧宽推导；保留一个很小的下限（如 4）防超大字号出现 1 字/行 | 低（单函数 + 让其感知文本是否含中文） | 低 | 小–中 | ✅ 公式直接由 `video_width` 推导，天然适配所有宽高比 | 需把"是否含中文/文本"传入该函数，或对每条字幕按其文本计算 |
| **B** | **按真实字体度量做像素级换行** | 引入 PIL/freetype（或调用 `ffmpeg`/`fc-`）测量每个 glyph 的真实 advance，按"累计像素 ≤ available_width"换行，替换 `_wrap_chinese_text/_wrap_english_text` 的"数字符"逻辑 | 中–高（新增度量依赖 + 重写换行） | 中（依赖/性能/跨平台字体一致性） | 中–大 | ✅ 最精确，中英混排也准 | 最稳但最重；可作为 A 之上的增强 |
| **C** | **改用 libass（`subtitles=` 滤镜 + ASS 样式）烧录** | 用 ASS 样式的 `PlayResX/PlayResY + MarginL/MarginR + WrapStyle` 让 libass 自动按宽度换行（CJK 感知、含 BiDi/标点避头尾） | 高（重写烧录管线，从 `drawtext` 迁到 `subtitles`/ASS） | 中–高（大量样式/定位行为回归） | 大 | ✅ 排版最专业 | 改动面大，超出"最小修复"，列为长期方向 |

补充说明：
- **方案 A 是直击根因的最小修复**：bug 的本质就是"字符预算用错了字宽系数、且上限与帧宽无关"。A 把预算改成"由帧宽 + CJK 全宽字宽推导"，单行宽度自然被钉在 `available_width` 以内，**对任意分辨率/宽高比都成立**，正面满足"始终最大宽度为视频的最大宽度"。
- `_calculate_max_line_width` 当前签名不接收文本（每个 `request` 调一次），而 `_wrap_text` 是按每条字幕检测中文的。落地时建议二选一：① 把 `text`/`has_chinese` 传入该函数（精确）；② 简单稳妥起见，**预算一律按全宽（`char_width≈font_size`）计算**——这只会让纯英文字幕略早换行（仍可读），但保证中文绝不超帧。
- **方案 B/C** 更精确/更专业，但引入依赖或重写管线，风险与工作量都更高，不符合本轮"改动尽量小"的约束；可作为后续增强。

---

## 6. 推荐方案（Recommended fix）及理由

> **推荐 = 方案 A**：在 `subtitle_service.py:_calculate_max_line_width()` 内，把"每行最大字符数"改为**由视频帧宽 + CJK 全宽字宽推导**，并**移除与帧宽无关的硬编码上限**（横屏的 100 上限、竖屏的 10/12/18/25/35 绝对上限）。

**精确落地建议（交接 Subtask #2，改动须最小、勿牵连无关文件）：**

1. **让预算感知 CJK 字宽**（核心）：把单字宽度系数对中文取约 `1.0`（全宽），拉丁保持约 `0.55–0.6`。最稳妥的最小实现是**一律按全宽计算**（`char_width ≈ font_size`），即
   `max_chars = max(MIN, floor((video_width - 2*margin_horizontal) / font_size))`。
   - 这样**横屏/方屏/竖屏走同一条公式**，由 `video_width` 推导，**任意宽高比单行都 ≤ 可用宽**，无需再为每种比例手调。
2. **删除/替换硬编码上限**：去掉 `:219` 的 `min(max_chars, 100)` 中"100"这一与帧宽无关的魔法值，以及竖屏 `:176-195` 的绝对字符上限；保留一个很小的下限（如 `max(4, ...)`）以防超大字号算出 1 字/行。
3. **（可选增强，非阻断）像素级精度**：若需中英混排也精确，可在 A 之上叠加方案 B 的真实字体度量；本轮非必需。
4. **验证（必须，覆盖多比例）**：复现脚本 `repro_wrap_overflow.py` 应在改后**所有行都回到 `OK`**（`est_line_px <= avail_px`）；并对 1920×1080、1280×720、1080×1080、1080×1920、720×1280 各导出一条 30–50 字中文字幕，确认换行且不出血。

**理由**：
1. **直击根因且最小**：症状=换行阈值过宽，根因=字宽系数对中文用错 + 上限与帧宽脱钩。A 只改一个计算函数即可让阈值正确，无需动烧录/定位逻辑。
2. **正面满足本轮需求**：需求明确要"**多种分辨比例都要自动换行、始终不超过视频宽度**"。A 的公式由 `video_width` 推导，**对所有宽高比成立**，而不是像现状那样靠某分辨率手调的绝对上限（换分辨率就破功，见 §3.4）。
3. **风险低、可回滚**：仅改字符预算计算，纯英文字幕渲染基本不变（最多略早换行，仍可读）；无数据/编码改动。
4. **不回退第 1 轮成果**：与字体（CJK 字形）无关，第 1 轮的字体修复保持不变，二者正交。

> 交接给 Subtask #2 落地时建议范围：仅 `backend-services/basic-service/app/services/subtitle_service.py` 的 `_calculate_max_line_width()`（及必要时让其接收文本/`has_chinese`）。改动应保持最小，勿牵连无关文件；改后跑 `repro_wrap_overflow.py` 与多分辨率导出回归。

---

## 7. 关键证据索引（便于评审复核）

代码：
- `backend-services/basic-service/app/services/subtitle_service.py:141`（`_calculate_max_line_width` 定义）
- `:162-197`（竖屏分支：`char_width=font_size*0.8` + 硬编码字符上限 10/12/18/25/35）
- `:199-203`（近方形：`char_width=font_size*0.6`，再 `*0.8`）
- `:204-208`（横屏：`char_width=font_size*0.6`，`max_chars=available/char_width`）
- `:210-219`（`min_chars` + `min(max_chars, 100)` 硬上限）
- `:224-258`（`_wrap_text`）、`:260-288`（`_wrap_chinese_text`，`:276` "字符数<上限就不换行"）
- `:730-735`、`:761`（横屏：算预算→`_wrap_text`）、`:792`（`x=(w-text_w)/2`）
- `:831-836`、`:845`（竖屏：算预算→`_wrap_text`）、`:910`（每行 `x=(w-text_w)/2`）
- `app/services/video_composition_service.py:2266-2278`（`_process_subtitle_tracks` 构造请求，**无 `max_line_width`**）、`:2292-2310`（`add_subtitles`）
- `app/services/video_composition_service.py:2490-2506`（`_process_overlays_and_subtitles_combined`，**无 `max_line_width`** → `build_drawtext_filters`）
- `app/models/video_models.py:311`（`max_line_width` 默认 `None`）、`:303`（`font_size=24`）、`:310`（`margin_horizontal=50`）、`:144-158`（前端 `SubtitleCompositionItem` 无 `max_line_width` 字段）

数值复现（零依赖，本目录 `repro_wrap_overflow.py`，已实测）：
- 横屏/方屏所有档位：`est_line_px > frame_px`（`EXCEEDS FULL FRAME`）
- 720×1280 竖屏：亦 `EXCEEDS FULL FRAME`；1080×1920 字号 40：`overflows margin`

---

## 8. 评审补充证据（Reviewer-added evidence，Subtask #1 复核时补全）

> 本节由 Subtask #1（分析报告评审）补入，目的是把"**被引代码确实在失败路径上被执行**"和"**不存在被遗漏的其他字幕路径**"这两点钉死，使证据链无懈可击。所有行号已对当前工作区源码逐一复核，与 §3/§7 一致。

### 8.1 导出入口 → 字幕烧录的完整执行链（已逐帧复核）

点击"导出视频"最终进入 `VideoCompositionService.compose_video`，其字幕分支位于 `video_composition_service.py:1335-1393`：

```python
# video_composition_service.py:1335-1393（节选）
if has_images and has_subtitles:                       # :1335
    success = self._process_overlays_and_subtitles_combined(  # :1340  → build_drawtext_filters
        all_image_items, request.subtitle_items, ...)
    ...
elif has_subtitles:                                    # :1379
    subtitle_processed_path = self._process_subtitle_tracks(  # :1382  → add_subtitles
        request.subtitle_items, str(output_path), temp_dir)
```

两条分支**都**最终汇入 `_calculate_max_line_width()` + `_wrap_text()`：

- **图片+字幕合并**（`:1340`）→ `_process_overlays_and_subtitles_combined`（`:2417`，构造 `SubtitleAddRequest` 于 `:2490-2502`，**无 `max_line_width`**）→ `subtitle_service.build_drawtext_filters`（`:2506`）→ 按 `is_portrait=aspect<1.0` 分派（`subtitle_service.py:632-642`）→ `_build_*_drawtext_filters` → `_calculate_max_line_width`（`:733`/`:834`）。
- **纯字幕**（`:1382`）→ `_process_subtitle_tracks`（`:2209`，构造请求于 `:2266-2278`，**无 `max_line_width`**）→ `add_subtitles`（`:2303`）→ `_build_ffmpeg_command`（`:646`）→ 同样按 `is_portrait` 分派（`:670-687`）→ `_calculate_max_line_width`。

> 结论：§3 引用的 `_calculate_max_line_width` 不是"可能被调用"，而是**导出主路径上两条字幕分支唯一的换行预算来源**，必经。"被引代码是否真的在失败路径上执行"——**是**。

### 8.2 反例排查：是否存在被遗漏的"另一条字幕渲染路径"？（已排除）

对 `backend-services/basic-service/app` 全量检索 `subtitles=`、`libass`、`.ass`、`force_style`、`max_line_width`（见 §7 命令复刻）结果：

- **没有任何 libass / ASS / `subtitles=` 滤镜烧录路径**——全平台字幕烧录都走 `drawtext`。因此"libass 本会自动按宽换行、所以问题在别处"这一**替代解释不成立**。
- `max_line_width` 在整个后端**仅出现于**：模型默认值 `None`（`video_models.py:311`）、以及 `subtitle_service.py:731-733` / `:832-834` 的"为 None 则自动计算"。**没有任何调用方显式赋值**（前端 `SubtitleCompositionItem` 也无此字段，`video_models.py:144-158`）。→ **100% 落入自动计算**，§3.1 的"前端永不传 → 必走自算"得到全代码库级佐证。
- `_wrap_chinese_text` 的判定是 `if len(current_line) < max_line_width`（`:276`），即**每行至多 `max_line_width` 个字符**；故 `max_chars` 预算就是单行字符数硬上限——预算虚高 1:1 转化为"该断不断"。换行逻辑本身无 bug，**bug 完全定位在预算计算**。

> 反例与替代解释均被排除：症状（中文长行不换行、溢出帧宽）**有且只有**"字符预算用错字宽系数 + 上限与帧宽脱钩"这一个成因。证据链闭合。

### 8.3 修复后数值验证（推荐公式实测，零依赖）

对推荐公式 `max_chars = max(1, floor((video_width - 2*margin_horizontal) / font_size))`（`char_width = font_size`，即按 CJK 全宽最坏情形）在全分辨率矩阵实测（中文行宽按 `1.0 em` 估算）：

```
       WxH  fs  max_chars  line_px  avail  frame  verdict
 1920x1080  24        75     1800   1820   1920  OK
 1920x1080  40        45     1800   1820   1920  OK
 1920x1080  72        25     1800   1820   1920  OK
  1280x720  40        29     1160   1180   1280  OK
  1080x1080 40        24      960    980   1080  OK
  1080x1920 40        24      960    980   1080  OK
   720x1280 40        15      600    620    720  OK
   480x854 200         1      200    380    480  OK   ← 极端大字号亦不溢出
```

**所有档位 `line_px ≤ avail_px`**（含 §2.2 原本全红的横屏/方屏/窄竖屏，以及 200px 超大字号的退化情形），即"单行宽度永远不超过视频可用宽"在**任意宽高比**下成立——正面满足本轮需求"始终最大宽度为视频的最大宽度"。

### 8.4 ⚠️ 关键边界发现（推荐方案必须处理，否则仍会溢出）

§6 仅笼统提到"保留一个很小的下限（如 `max(4, ...)`）"。评审实测发现**下限设置本身是一个会复发 bug 的边界**：

- **横屏现有 `min_chars=20`（`subtitle_service.py:217`）必须降低/移除**。反证（实测）：
  - `1280×720, font=72`：`floor((1280-100)/72)=16`，但被 `max(20, 16)=20` 抬高 → `20×72 = 1440px > 1280px 帧宽` → **仍溢出**。
  - `1280×720, font=100`：`floor(1180/100)=11` → 被抬到 20 → `2000px`，溢出更甚。
- 即：若只改字宽系数、却保留 `min_chars=20`，**大字号 + 较小横屏**场景会绕过修复继续出血。
- **正确做法**：下限取 1（或至少保证 `下限 ≤ floor(available/font_size)`），即 `max_chars = max(1, floor(available/font_size))`。退化时最多"一行一字"（仅在 `available < font_size` 的荒谬字号下出现，`font_size` 已被模型限制在 `8..200`，正常自动/40px 永不触发），但**绝不溢出**——宁可一行一字，不可出血。

---

## 9. 评审结论（Review Verdict）

**评审判定：根因成立、证据充分、推荐方向（方案 A）正确**；在落地公式与边界处理上**收敛为一个明确的最小修复**，并补一条 §8.4 的必处理边界。逐条结论如下：

### 9.1 根因证据审计——通过

- **被引代码确在失败路径执行**：✅ 导出主路径两条字幕分支（`video_composition_service.py:1340`/`:1382`）均必经 `_calculate_max_line_width`（§8.1）。
- **是否有反例/替代解释**：✅ 已排除。全代码库无 libass/ASS 路径、无任何处赋值 `max_line_width`，唯一成因即字符预算（§8.2）。
- **证据是否解释症状**：✅ §2.2 与 §8.3 的数值实测把"预算虚高 → 不换行 → `text_w>w` → `x=(w-text_w)/2<0` → 两侧出血"整条因果用可执行脚本钉死，非推测。

### 9.2 候选方案审计——采纳方案 A（收敛版），否决 B/C 作为本轮方案

- **B（真实字体度量像素换行）**：精度最高、可处理中英混排，但需引入 PIL/freetype 依赖、重写换行函数，跨平台字体度量一致性带来新回归面，**超出本轮"改动尽量小"**——列为后续增强，非本轮。
- **C（迁 libass/ASS）**：重写整条烧录管线，回归面最大，**否决**为本轮方案。
- **A（CJK 感知 + 由帧宽推导预算）**：直击根因、单函数改动、风险可控、对所有宽高比天然成立——**采纳**。在 A 内部，相较"让函数感知文本/`has_chinese`"（更精确但需把 text 下沉/穿参、改动面更大），评审推荐**更稳妥的最小实现：预算一律按全宽计算**，理由见 9.3。

### 9.3 最终推荐修复（唯一方案，交接 Subtask #2）

> **在 `backend-services/basic-service/app/services/subtitle_service.py` 的 `_calculate_max_line_width()` 内，用一条与宽高比无关、由帧宽推导、按 CJK 全宽取最坏情形的统一公式替换现有三分支逻辑，并删除所有与帧宽无关的硬编码上限/下限：**

```python
def _calculate_max_line_width(self, video_width, font_size, margin_horizontal, video_height=None):
    available_width = video_width - (2 * margin_horizontal)
    char_width = font_size            # CJK 全宽步进 ≈ 1.0 em（最坏情形，保证中文不溢出）
    max_chars = max(1, int(available_width / char_width))
    return max_chars
```

落地清单（**改动须最小，仅限此函数；勿牵连无关文件**）：

1. **删除三条 aspect 分支**（`:162-208`）的 `0.6`/`0.8` 拉丁系数与近方形 `*0.8`，统一为 `char_width = font_size`。
2. **删除 `:219` 的 `min(max_chars, 100)`**（与帧宽无关的魔法值）。
3. **删除竖屏绝对上限 10/12/18/25/35（`:176-195`）**——它们是对单一分辨率手调、换比例即破功（§3.4）。
4. **下限取 1**（替换 `:212-217` 的 `min_chars=20`/`2`）：`max(1, floor(...))`。**这是 §8.4 的必处理项**——保留 `min_chars=20` 会让大字号横屏（如 1280×720/72px）继续溢出。
5. `video_height` 参数可保留（签名兼容/日志），逻辑上不再需要按比例分派。

**为何选"一律全宽"而非"按 has_chinese 区分"**：
- 本轮需求的硬约束是"**中文**字幕**始终**不超帧"。按全宽 = 按最坏字形给预算 → 对 CJK / 拉丁 / 中英混排**一律**满足 `line_px ≤ available_width`（拉丁/半宽字形比全宽更窄，同样字符数只会更短，不可能反超）——**一个公式覆盖所有输入与所有宽高比**，§8.3 已全绿实测。
- 代价仅是**纯英文行会比理论上限略早换行**（约 0.6×），是可读性层面的轻微保守，**非正确性问题**；且 `_calculate_max_line_width` 当前是"每请求算一次、不接触文本"，强行让它感知文本需把 text 下沉到 per-subtitle 计算或穿参，**徒增改动面与风险**，不符合最小修复原则。若日后要让英文行更长，再叠加方案 B 的像素级度量（本轮不做）。

### 9.4 回归与边界确认（交接验收口径）

- **不回退第 1 轮成果**：本修复与 CJK 字体安装（commit `a504a09`）正交，不触碰字体逻辑。✅
- **已覆盖边界**：超大字号退化（§8.3，480×854/200px → 1 字/行、不溢出）；大字号横屏（§8.4，已通过降下限解决）；中英混排（全宽预算保守安全）；竖屏/方屏/横屏统一公式（§8.3 全绿）。
- **遗留（非本 bug、不阻断、建议留注释）**：① `_wrap_english_text` 不硬断超长单词，理论上一条超过 `max_chars` 的连续拉丁串仍可能溢出——属既有限制、与本轮中文 bug 无关，**不在本轮范围**；② 合并路径失败回退 `_process_overlays_sequential`（`:1356/1360`）只处理图片、会丢字幕——独立隐患，**不在本轮范围**。两者仅作记录，勿在本轮顺手扩大改动面。
- **验收（必须）**：改后运行 `python docs/diagnoses/subtitle-overflow-no-autowrap/repro_wrap_overflow.py` 时（若同步更新脚本预算函数）所有行应回到 `OK`；并对 `1920×1080 / 1280×720 / 1080×1080 / 1080×1920 / 720×1280` 各导出一条 30–50 字中文字幕，确认换行且左右不出血。

> **一句话最终裁定**：采纳方案 A 的收敛实现——把 `_calculate_max_line_width` 改为 `max_chars = max(1, floor((video_width - 2*margin_horizontal) / font_size))`，删除全部 aspect 分支与 `100`/竖屏绝对上限/`min_chars=20` 等与帧宽脱钩的常量。这是唯一直击根因、对所有分辨率/宽高比成立、且改动面最小的修复。
