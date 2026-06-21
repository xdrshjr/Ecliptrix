# 字幕导出丢失（Windows 下 ffmpeg drawtext `textfile=` 解析失败）— 根因分析

> Bug slug: `subtitle-export-windows-drawtext-textfile`
> 所属子任务：Subtask #0 问题定位与分析
> 复现环境：Windows 11（win32, 10.0.26200），桌面自包含应用内置后端 + 内置 FFmpeg
> 结论：**Windows 平台上字幕烧录命令必然失败，且失败被静默吞掉**，导致导出成片无字幕。

---

## 1. 问题描述 (Problem description)

用户在剪辑面板中添加了字幕轨道、在轨道里添加了字幕并设置了字幕样式（字体/字号/颜色/位置）。
预览中字幕可见（预览走前端 Canvas `SubtitleLayer`，不经 FFmpeg）。但点击「导出视频」后，
最终导出的 MP4 **没有任何字幕**，也**没有任何报错提示**——导出流程显示成功完成。

关键现象：**预览有字幕、导出无字幕**，且导出「成功」无错误。这把问题指向**后端字幕烧录环节**，
而不是前端时间轴数据或导出请求构建。

---

## 2. 复现步骤 (Reproduction steps)

### 2.1 端到端复现（用户视角）

1. 在 Windows 桌面端打开视频编辑器，向视频轨添加一段视频素材。
2. 添加一条字幕轨道，在其中添加 1 条以上字幕，填写文本并设置样式（默认样式即可）。
3. 预览播放，确认字幕在预览里可见。
4. 点击「导出视频」，等待导出完成并下载成片。
5. 用播放器打开成片：**视频/音频正常，但没有字幕**；前端无错误提示。

### 2.2 最小可复现用例（命令级，已实测）

字幕烧录最终落到一条 `ffmpeg -vf "drawtext=..."` 命令。后端为每行字幕生成
`drawtext=textfile=<临时txt路径>:...`。在 Windows 上，临时 txt 路径是带盘符冒号的绝对路径
（如 `C:\Users\...\AppData\Local\Temp\ecliptrix_subs_xxx\sub_1_line_0.txt`）。

后端对该路径的转义逻辑是「反斜杠→正斜杠、冒号→`\:`、且**不加引号**」
（见 `subtitle_service.py:756-757` 与 `869-870`）。复刻这一行为后实测：

| 用例 | `textfile=` 取值形态 | ffmpeg 结果 |
| --- | --- | --- |
| **A（现状）** | 绝对路径、冒号转义、**不加引号**：`textfile=C\:/Users/.../sub_1_line_0.txt` | **失败** rc≠0 |
| **B（加引号）** | 同上但**用单引号包裹**：`textfile='C\:/Users/.../sub_1_line_0.txt'` | 成功 rc=0 |
| **C（相对路径）** | 切到临时目录、用无盘符相对路径：`textfile=texts/sub_1_line_0.txt` | 成功 rc=0 |

用例 A（即线上现状）的 ffmpeg 报错（实测原文）：

```
[AVFilterGraph] No option name near '/Users/jdqqj/AppData/Local/Temp/sub_repro2_xxx/texts/line.txt:fontfile=C\:/Windows/Fonts/arial.ttf:...'
[AVFilterGraph] Error parsing a filter description around: ,drawtext=textfile=C\:/Users/.../line.txt:...
Error opening output files: Invalid argument
```

> 复刻脚本：生成 1280x720 测试视频 → 按 `create_srt_from_subtitle_items` 写 SRT →
> 按 `_build_standard_drawtext_filters` 构造 `drawtext` 过滤器 → 运行 `_build_ffmpeg_command`
> 等价命令。A 必失败、B/C 必成功，结果稳定可重复。

---

## 3. 根因分析 (Root cause analysis)

### 3.1 数据链路确认（前端→后端均把字幕传到了烧录环节）

字幕数据从前端到后端**完整无丢失**，排除前端/协议层：

- 导出入口：`VideoPlayerPanel` → `useVideoExport.handleExport()`。
- 前端按 `item.type === 'subtitle'` 收集字幕并放入 `subtitle_items`：
  `src/components/video/hooks/useVideoExport.ts:425-461`、合成请求体含 `subtitle_items`：`:614`。
- BFF 透传 `/api/video-compose` → 后端 `POST /api/video/compose`，字段名一一对应。
- 后端 Pydantic 模型 `SubtitleCompositionItem` 字段与前端完全一致：
  `backend-services/basic-service/app/models/video_models.py:194-209`；请求体含 `subtitle_items`：`:279`。
- 后端入口日志会打印 `Subtitle items: N`：`app/routers/video_router.py:154`。
- 合成主流程进入字幕分支：`app/services/video_composition_service.py:1397`（`has_subtitles`）、
  `:1443-1450`（`elif has_subtitles: _process_subtitle_tracks(...)`）。

预览同样基于同一份时间轴数据（`currentTimelineState` 既喂 `useVideoExport` 也镜像进 store 供预览），
所以「预览有、导出无」并非数据源分叉，而是**烧录命令本身在 Windows 上执行失败**。

### 3.2 直接根因：`textfile=` 未加引号，Windows 盘符冒号破坏 filtergraph 解析

字幕烧录过滤器在两处以**相同方式**构造，均把 `textfile=` 的值**未加引号**直接拼接：

`app/services/subtitle_service.py:755-757`（横屏/方屏 `_build_standard_drawtext_filters`）：

```python
# Escape path separators and colons for ffmpeg filter syntax
escaped_path = text_file_path.replace('\\', '/').replace(':', '\\:')
drawtext_filter = f"drawtext=textfile={escaped_path}"   # ← 未加引号
```

`app/services/subtitle_service.py:869-870`（竖屏 `_build_multiline_centered_drawtext_filters`）：

```python
escaped_path = text_file_path.replace('\\', '/').replace(':', '\\:')
drawtext_filter = f"drawtext=textfile={escaped_path}"   # ← 同样未加引号
```

在 Windows 上，`text_file_path` 形如 `C:\Users\...\Temp\ecliptrix_subs_xxx\sub_1_line_0.txt`，
经上面转义后变成 `C\:/Users/.../sub_1_line_0.txt`。由于**没有引号包裹**，ffmpeg 的 filtergraph
选项解析器在遇到 `\:` 后无法把整段当作单个 `textfile` 值，于是报
`No option name near '/Users/...txt:fontfile=...'` 并整体解析失败（见 §2.2 实测）。

对照之下，同一段代码里 **`fontfile=` 是用单引号包裹的**（`:758-763` / `:874-877`：
`drawtext_filter += f":fontfile='{escaped_font_path}'"`），所以字体路径的盘符冒号能被正确容纳——
这恰好反证了「`textfile=` 缺引号」就是问题所在。

### 3.3 放大根因：失败被静默吞掉，导出仍标记「成功」

烧录失败本可暴露，但被两层吞掉，最终用户只看到「没有字幕的成片」而无任何报错：

1. `add_subtitles` 在 ffmpeg 返回非零时只返回 `success=False`，不抛异常：
   `app/services/subtitle_service.py:984-990`。
2. `_process_subtitle_tracks` 据此 `return None`：`video_composition_service.py:2311-2313`。
3. 合成主流程对返回 `None` 仅打 warning 并**继续输出无字幕成片**：
   `video_composition_service.py:1454-1458`
   （`logger.warning("Subtitle processing failed - continuing without subtitles")`）；
   图片+字幕合并路径的 `try/except` 亦是「失败→回退→吞掉」：`:1418-1424`。

因此 Windows 平台上 **每一次** 含字幕的导出都会走「烧录失败→静默继续」，成片必无字幕。

### 3.4 为什么线上 Linux 没暴露、桌面端才暴露

Linux 部署里临时目录是 `/tmp/ecliptrix_subs_xxx/...`，**没有盘符冒号**，转义后是
`textfile=/tmp/.../sub_1_line_0.txt`，filtergraph 能正常解析（§2.2 用例 C 同理）。
macOS 临时目录 `/var/folders/...` 同样无盘符冒号。**只有 Windows 的盘符冒号 `C:` 才触发该解析失败**。
而本项目是「self-contained local desktop app」，主要分发即 Windows 桌面端（用户当前环境 win32），
所以这是桌面端必现、服务器端不现的平台相关 Bug。

---

## 4. 影响面 (Impact surface)

- **受影响**：所有在 **Windows 桌面端** 导出**含字幕**的视频。无论横屏/竖屏/方屏（两个 builder 同源缺陷）、
  无论纯字幕路径（`_process_subtitle_tracks`）还是图片+字幕合并路径（`build_drawtext_filters` →
  同一对 builder，失败后回退 `_process_overlays_sequential` 仍走 `_process_subtitle_tracks`，再次失败）。
- **现象**：成片有视频/音频但无字幕；前端无报错；导出标记成功。
- **不受影响**：Linux 服务器部署、macOS（临时路径无盘符冒号）；以及不含字幕的导出。
- **次生**：`§3.3` 的静默吞掉使任何字幕烧录失败都不可见，掩盖了本问题并会掩盖未来同类问题。

---

## 5. 候选修复方案 (Candidate fixes)

| 方案 | 改动点 | 侵入性 | 风险 | 工作量 | 备注 |
| --- | --- | --- | --- | --- | --- |
| **F1：给 `textfile=` 加单引号** | `subtitle_service.py:757` 与 `:870` 改为 `f"drawtext=textfile='{escaped_path}'"`，与同处 `fontfile='...'` 对齐 | 极小（2 行） | 极低 | 极小 | §2.2 用例 B 实测通过；临时 txt 路径由服务自生成（mkdtemp + `sub_N_line_M.txt`），不含单引号，无新转义风险 |
| **F2：切到临时目录用无盘符相对路径** | 运行 ffmpeg 时 `cwd=text_files_dir`，`textfile=` 用相对文件名 | 中（需调 `_build_ffmpeg_command` / `add_subtitles` 的 cwd 与所有路径基准） | 中（其它输入/输出/字体均为绝对路径，cwd 变更需逐一核对） | 中 | §2.2 用例 C 通过，但牵动面大 |
| **F3：统一改用 ffmpeg `subtitles`/`ass` 滤镜烧录 SRT/ASS** | 用 `subtitles=filename=...:force_style=...` 取代逐行 `drawtext` | 大（重写整套样式/换行/定位逻辑） | 高（样式映射、CJK 自动换行、位置与预览对齐都要重做并对拍） | 大 | 架构更干净但远超本 Bug 范围 |
| **F4（叠加项）：让字幕烧录失败不再静默** | `video_composition_service.py:1454-1458` / `1418-1424` 在烧录失败时上报为硬错误或在响应里标注 | 小 | 低-中（会把过去被掩盖的失败变为可见错误，需配合 F1 一起上） | 小 | 防御性硬化，建议与 F1 同时落地，避免“悄悄丢字幕” |

---

## 6. 推荐方案 (Recommended fix)

**F1（给 `textfile=` 加单引号）为主修，叠加 F4（失败不再静默）作为防御性硬化。**

理由：

1. **直击根因且最小化破坏面**：缺陷就是「`textfile=` 值未加引号导致 Windows 盘符冒号破坏 filtergraph
   解析」。F1 只改 2 行，与同函数里已经正确加引号的 `fontfile='...'` 写法对齐，是「补齐遗漏的引号」
   而非引入新机制。
2. **已被实测验证**：§2.2 用例 B 用与线上完全一致的转义 + 单引号包裹，ffmpeg 返回 0、成片含字幕。
3. **跨平台安全**：单引号在 Linux/macOS 路径（无盘符冒号）上同样合法，不会回归既有平台。
4. **无新转义风险**：`textfile` 指向的临时文件路径由后端 `tempfile.mkdtemp` + `sub_{index}_line_{i}.txt`
   生成，不含单引号等需二次转义字符。
5. **F4 配套**：单独修 F1 已能让 Windows 字幕恢复；叠加 F4 可避免「未来任意字幕烧录失败仍被悄悄丢弃」，
   让此类问题第一时间暴露而非再次伪装成「导出成功但无字幕」。建议 F1 与 F4 同批提交。

> 落地提示（交由 Subtask #2 实施）：两处 builder 同源缺陷必须**一并修改**
> （`subtitle_service.py:757` 与 `:870`），否则竖屏视频仍会复现。

---

## 7. 评审补充证据 (Reviewer-added evidence)

> 本节由评审节点（Subtask #1）补入，目的是把根因与修复的证据链补到「无懈可击」。
> 下列引用均已逐行核对当前仓库源码；ffmpeg 复测由评审者独立重跑（非沿用原报告结论）。

### 7.1 失败路径的代码确为线上执行路径（已逐行核对）

字幕烧录从入口到 ffmpeg，三条调用路径**全部**汇聚到同一对 buggy builder，因此「该代码确在失败路径中执行」成立：

1. **纯字幕路径**：`video_composition_service.py:1443-1450`（`elif has_subtitles:`）→
   `_process_subtitle_tracks`（`:2195`）→ `subtitle_service.add_subtitles`（`:2289/2293/2296`）→
   `_build_ffmpeg_command`（`subtitle_service.py:600`）→ 横屏走 `_build_standard_drawtext_filters`（`:639`）、
   竖屏走 `_build_multiline_centered_drawtext_filters`（`:633`）→ 即 §3.2 两处 `textfile=` 无引号代码。
   过滤器以 `','.join(...)` 作为**单个** `-vf` argv（`:653`），由 `subprocess.run(..., shell 缺省=False)`（`:977-982`）
   直接交给 ffmpeg —— **无 shell 引号层**，故引号问题纯粹是 ffmpeg filtergraph 解析层面的事。
2. **图片+字幕合并路径**：`video_composition_service.py:1399-1411`→ `_process_overlays_and_subtitles_combined`
   →`build_drawtext_filters`（`:2441`，等价路由到同两个 builder：`subtitle_service.py:590/594`）→
   过滤器拼进 `-filter_complex`（`:2463` `[0:v]{','.join(drawtext_filters)}[vout]`）→ rc≠0 时 `return False`（`:2482-2483`）。
3. **顺序回退路径**：合并失败回退 `_process_overlays_sequential`（`:1420/1424`）→ 内部再调
   `_process_subtitle_tracks`（`:2343`）= 同第 1 条，**再次以同样方式失败**。

> **覆盖性结论（评审重点）**：缺陷在 builder 层（`subtitle_service.py:757` 与 `:870`）。
> 只改这两行即可**同时**修好上述全部三条路径，无需改动任意调用点。横屏(standard)与竖屏(multiline)
> 两个 builder 必须**同时**改，否则竖屏复现。

### 7.2 数据链路完整（排除「前端没传字幕」这一替代解释）

- 前端按 `item.type === 'subtitle'` 收集并 `subtitleItems.push({...})`：`src/components/video/hooks/useVideoExport.ts:425-461`，
  `text: item.text || item.name`；请求体含 `subtitle_items: subtitleItems`：`:614`。
- 后端模型 `SubtitleCompositionItem` 字段与前端一一对应：`app/models/video_models.py:194-209`；
  `VideoCompositionRequest.subtitle_items`（`default_factory=list`）：`:279`。
- **反证替代解释**：若是「前端没传字幕」，则三平台都不会有字幕，与「Linux 有、Windows 无」的平台差异矛盾；
  实测（§7.3）证明纯属 Windows 盘符冒号触发的 ffmpeg 解析失败。故「前端/协议层丢字幕」被排除。

### 7.3 评审者独立 ffmpeg 复测（结论与原报告一致）

环境：本机 `ffmpeg 2025-05-15 git full build`；以 §3.2 完全相同的转义
（`path.replace('\\','/').replace(':','\\:')`）构造 `drawtext`，`subprocess.run` 列表参数、无 shell，临时目录
取真实 `C:\Users\...\AppData\Local\Temp\ecliptrix_subs_*`（含盘符冒号）。

| 用例 | `textfile=` 形态 | 结果 |
| --- | --- | --- |
| **A（现状，无引号）** | `textfile=C\:/Users/.../sub_1_line_0.txt` | **rc=4294967274（=-22 EINVAL）失败** |
| **B（F1，单引号）** | `textfile='C\:/Users/.../sub_1_line_0.txt'` | **rc=0 成功** |
| **C（相对+cwd）** | `textfile=sub_1_line_0.txt`（cwd=临时目录） | rc=0 成功 |

用例 A 实测报错（评审者本机原文，与 §2.2 一致）：

```
[AVFilterGraph] No option name near '/Users/jdqqj/AppData/Local/Temp/ecliptrix_subs_xxx/sub_1_line_0.txt:fontsize=48:...'
[AVFilterGraph] Error parsing filterchain 'drawtext=textfile=C\:/Users/.../sub_1_line_0.txt:...'
Error opening output files: Invalid argument
```

**「成功」不止于 rc=0——已证字幕真的被渲染**：对同一确定性 `testsrc` 渲染两份——无 drawtext 的 baseline
与 F1（单引号）带 drawtext 的输出——计算整帧 PSNR：

```
PSNR y:27.52 u:30.80 v:32.19 average:28.48 (min 28.24 / max 28.83)  ← 有限值，非 inf
```

PSNR 为有限值即「像素发生变化」⇒ 字幕文本**确被画入画面**。若 F1 把路径错读成字面 `C\:/...`（带反斜杠），
drawtext 在 init 阶段打不开文件会 rc≠0；rc=0 且 PSNR 有限，双重证明 F1 把路径正确解析为 `C:/Users/...` 并渲染了字幕。

### 7.4 F1 为什么成立（机制说明）+ 与 fontfile 同构

ffmpeg filtergraph 有两级转义：第二级按 `:` 切分滤镜选项，**单引号**能保护其中的 `:` 不被当作分隔符；
第一级再对选项值做 `\:`→`:` 反转义。于是 `textfile='C\:/...'` 中：单引号挡住第二级的 `:` 切分，
第一级把 `\:` 还原成 `:`，最终打开 `C:/...`。这与本函数里**早已正确工作的** `fontfile='...'`
（`subtitle_service.py:762-763 / :876-877`，同样单引号 + `\:`）**机制完全相同**——
所以 F1 本质是「把 `textfile=` 补齐成与 `fontfile=` 一致的写法」，而非引入新机制。这也解释了
「同一行字体路径的盘符冒号能正常工作、唯独 textfile 失败」的现象。

### 7.5 边界与回归审计（评审者）

- **并发**：每次烧录各自 `tempfile.mkdtemp(prefix='ecliptrix_subs_'/'ecliptrix_merged_subs_')`
  （`subtitle_service.py:954`、`video_composition_service.py:2439`）⇒ 临时目录互不冲突；F1 不改变并发语义。✓
- **错误路径**：F1 使 rc=0 → `add_subtitles` 返回 `success=True` → `_process_subtitle_tracks` 返回有效路径
  → `os.replace` 换入成片（`video_composition_service.py:1451-1452`）。✓
- **跨平台无回归**：Linux/macOS 的 `escaped_path` 形如 `/tmp/.../sub.txt`（无盘符冒号、无反斜杠），
  加单引号后 `'/tmp/.../sub.txt'` ffmpeg 正常解析（等价于这些平台上早已加引号且工作的 fontfile）。✓
- **唯一新增边界（需在 §评审结论中交代）**：`textfile` 落在**用户可控的临时根目录**
  （`tempfile.gettempdir()`，Windows 通常是 `C:\Users\<用户名>\AppData\Local\Temp`）。
  若**用户名本身含单引号**（如 `O'Brien` ⇒ `TEMP=C:\Users\O'Brien\...`），F1 的外层单引号会被路径里的 `'`
  提前闭合而再次失败。此为极罕见情形，且当前代码对**所有** Windows 用户 100% 失败，F1 严格优于现状。
  注意 `fontfile` 指向系统目录 `C:\Windows\Fonts`（不含用户名）故无此风险——这是 textfile 比 fontfile
  多出的唯一边界。**建议（非阻塞）**：实现时顺手对 `escaped_path` 内的单引号做 ffmpeg 转义
  （`'` → `'\''`），即可彻底消除该残留；若不做，也不构成对现状的回归。

### 7.6 对 F4 的评审意见

F4 与根因**正交**：它只把「静默丢字幕」变为「显式报错」，并不修复也不引入字幕渲染。单独上 F1 即可让
Windows 字幕恢复。需要注意：F4 会把过去被 §3.3 掩盖的失败**暴露成可见错误**，因此必须确保 F1 先（或同批）
落地，否则会把「当前 100% 静默失败」转成「导出直接报错」。结论：F4 是**可选的观测性硬化**，建议与 F1 同批，
但**不属于**「修复本 bug 的最小必需改动」。

---

## 评审结论 (Review Verdict)

**最终推荐的单一修复 = F1**：将 `subtitle_service.py:757` 与 `:870` 两处的
`f"drawtext=textfile={escaped_path}"` 改为 `f"drawtext=textfile='{escaped_path}'"`（即给 `textfile=` 的值套单引号，
**保留**现有 `\:` 转义不动），与同函数内已正确工作的 `fontfile='{escaped_font_path}'` 写法对齐。两处 builder
（横屏 standard / 竖屏 multiline）**必须同时改**。

判定理由（证据已在 §7 补齐）：

1. **直击根因、改动最小**：缺陷就是「`textfile=` 值缺引号 → Windows 盘符冒号破坏 filtergraph 第二级解析」。
   F1 仅 2 行、不新增机制，只是补齐与 `fontfile=` 一致的引号（§7.4 机制同构）。
2. **证据闭环且经独立复测**：评审者本机重跑——用例 A 复现原始报错、用例 B(F1) `rc=0`，且 PSNR 有限值
   **证明字幕真被渲染**（§7.3）；非仅「命令不报错」。
3. **覆盖全部失败路径**：F1 落在 builder 层，纯字幕 / 图片+字幕合并 / 顺序回退三条路径同时修好，
   无需改任何调用点（§7.1）。
4. **跨平台零回归**：Linux/macOS 无盘符冒号，加引号同样合法（§7.5）。
5. **无常规新转义风险**：临时文件名由 `mkdtemp + sub_{index}_line_{i}.txt` 生成，正常不含单引号
   （唯一例外是「用户名含单引号」这一极罕见边界，见 §7.5，可由可选转义彻底消除，不阻塞本修复）。

**关于 F4**：作为**可选的、建议与 F1 同批**的防御性硬化（把字幕烧录失败从「静默吞掉」改为「显式上报」，
对应 `video_composition_service.py:1454-1458` 与 `1418-1424`），用于避免未来同类失败再次伪装成「导出成功但无字幕」。
但它**不是**修复本 bug 所必需——本 bug 的最小充分修复就是 F1。**否决** F2（牵动 cwd/全部路径基准，破坏面大）
与 F3（重写整套样式/换行/定位，远超本 bug 范围）。

**交付给 Subtask #2 的落地清单**：
- 必做：`subtitle_service.py:757`、`:870` 两处 `textfile=` 加单引号（保留 `\:` 转义）。
- 建议同批（可选）：F4 失败不再静默；以及对 `escaped_path` 内单引号做 `'`→`'\''` 转义以消除 §7.5 残留边界。
- 验证：复跑 §2.1 复现步骤（Windows 桌面端，横屏与竖屏各一条字幕），导出成片应可见字幕；并保留 §7.3 的
  ffmpeg 命令级回归用例（A 应失败、B 应成功）作为护栏。
