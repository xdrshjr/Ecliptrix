# Camera Motion —— 盒基准同源（G4 收口）与打包端真实 walkthrough（实验与实现计划）

> **feature** = `camera-motion-box-parity-and-desktop-walkthrough`
> **environment: local**（全部在本机 Windows 11 执行；不涉及远程主机、不涉及任何 SSH 私钥）
> **迭代**：Iteration 3 / 3（本项目 2D/3D 运镜功能的收官轮）
> **基线提交 B0**：`d4df938`（Iteration 2 终态，`feat/remove-user-system` 分支 HEAD）
> **上游契约**：`docs/plans/timeline-camera-motion/experiment-plan.md`（Iter 1）、`docs/plans/camera-motion-stills-and-desktop-gate/experiment-plan.md`（Iter 2）
> **一句话目标**：把「静图运镜盒」的预览侧与导出侧从「在挑好的夹具上碰巧相等」变成「**在任意归一化位置上按构造相等**」，并把 Iteration 1/2 连续两轮欠下的 DoD#8（打包端 GUI walkthrough）用**可复跑的自动化**真正闭合；不再新增功能面。

---

## 评审记录（节点 #1，v1 → v2）

> 评审方式：**不接受本文件的任何断言为真**。§1 的每一条源码断言逐条回读工作树核对；DD-2/DD-3/DD-4 的可实现性用**真实 FFmpeg 实测**验证（不查文档）；DoD 逐条做「能不能失败」测试。下表 `已修复` 表示本文件对应章节已就地改写。

### R0 前置：feature 定位规则本身有歧义（P1，已修复）

节点 #1 的输入规则写的是「`ls docs/plans/*/experiment-plan.md` 若匹配 0 或 >1 个目录就立即 `fail`」。实测该命令**匹配 3 个目录**（`timeline-camera-motion`、`camera-motion-stills-and-desktop-gate`、本轮），因为前两轮的计划书按规矩留档。机械执行该规则会让收官轮在第一步空转失败。

本轮按**上游节点 #0 的产出声明**（`feature=camera-motion-box-parity-and-desktop-walkthrough`）锁定目标文件，无歧义。已在 §十 补上定位规则：**下游一律以上游节点输出的 `feature=` 为准**，`ls` 只作交叉校验。

### R1 源码断言复核结论：§1 全部属实

逐条回读，**未发现任何虚构 API 或错行**（这是 Iteration 2 评审抓到过的问题类型，本轮不复现）：

| 断言 | 复核结果 |
|---|---|
| `video_composition_service.py:2629-2630` `int(pos.x*W)` 截断 | ✅ 属实，行号精确 |
| 同文件 `:2624-2626` 先 `int()` 再 `_ensure_even_dimensions` | ✅ 属实；`:476-478` 委托到 `video_scaling.ensure_even_dimensions`（`:36-40`，奇数加一） |
| 同文件 `:2649-2652` `scale=...decrease` + `pad=(ow-iw)/2:(oh-ih)/2:black@0` | ✅ 属实 |
| 同文件 `:2621-2623` 兜底 `0.3/0.3` | ✅ 属实 |
| `video_scaling.py:22-28` `_ASPECT_RATIO_MAP` 是导出分辨率唯一真相 | ✅ 属实；与 `video_models.py:306-312` `AspectRatio` 五枚举值一一对应 |
| `CanvasCompositor._baseFit` 取「第一个 readyState≥2 的视频图层」 | ✅ 属实（`:271-288`） |
| `buildImageLayersAt` 的 `imageFit` 在 `src/` 无生产调用点 | ✅ 属实：全仓仅 2 处命中，均在 `assembleLayers.ts`（`:64` 声明、`:204` 透传），实际取 `FULL_RECT` |
| `fitContain` `EPS=1e-6` 与三分支 | ✅ 属实（`:35,63-74`） |
| 前端三处默认 `0.1/0.1/0.8/0.8` | ✅ 属实（`imageOverlayGeometry.ts:21-27`、`ImageOverlayLayer.ts:89-95`、`useVideoExport.ts:242-247`） |
| `desktop/main/index.js` 只识别 `--dev`/`--user-data-dir=`，不过滤 Chromium 开关 | ✅ 属实（`:18,31-34`） |
| `smoke-test.js` `readPorts` + 健康轮询可作宿主骨架 | ✅ 属实（`:62-71,113-128`） |
| `results/n0-box-baseline.json` box-c `1.166 / pass:false / 图像级 4px` | ✅ 属实（实读 `1.16619`，`downstreamFixtureRule` 确实限制下游只用 on-grid 盒） |
| L-Q1「量化只有一处实现」可被 grep 判定 | ✅ 可判定：全后端 `int(pos.*)` 仅 `:2625,2629,2630` 三行，`_overlay_placement` 仅 `:2593` 一个调用点 |

**E0-a 已由本次评审预先证实**：本机 `node -v` = `v22.18.0`，`typeof WebSocket` = `function`。§8 的零依赖前提成立，E0-a 降为确认性复跑。

### R2 P0 问题（阻断级，必须修复后下游才能开工）

| ID | 严重度 | 问题 | 证据 | 状态 |
|---|---|---|---|---|
| **P0-1** | P0 | **Q1 的「0.000px 恒等」在计划自己规定的 D1 夹具矩阵上按构造不可能达成**：预览侧 `computeImageBounds`（`ImageOverlayLayer.ts:141-152`）对盒做了**钳制** —— `x=clamp01(...)`、`w=Math.min(clamp01(p.width*fit.w), 1-x)`；后端 `_overlay_placement` **完全不钳制**。D1 取 `x∈{…,0.7143}`、`w∈{0.22,0.3337,0.44}`，其中 `0.7143+0.3337=1.048`、`0.7143+0.44=1.1543` 均越界。以 `x=0.7143,w=0.44,W=1920` 实算：预览 `w=0.2857`（548.5px）vs 导出 `even_w=844px`，**分歧 295.5px**，比本轮要修的 1.166px 大两个数量级 | 逐行回读 + 手算 | **已修复**（新增 DD-9；§2.3 D1、§4.2、§六 DoD#1 同步改写） |
| **P0-2** | P0 | **Q7 的「新增/改动文件 ≤800 行」对 §4.2 强制要修改的文件按构造不可满足**：`video_composition_service.py` 在 B0 已是 **3024 行**、`useVideoExport.ts` **817 行**，两者都在阈值之上且本轮必须改；`VideoPlayerPanel.tsx` **764 行**，按 §4.2 加解析逻辑极易越线。照原文判定，本轮必然「DoD#7 不达标」，下游只能二选一：判本轮失败，或**偷偷放宽指标**——后者正是 L-Q7 要防的事 | `wc -l` 实测 | **已修复**（§2.2 Q7、§六 DoD#7 改为「新增文件 ≤800；存量超标文件不得增长」，并把解析逻辑挪出面板） |
| **P0-3** | P0 | **E0-c 的判据不足以证明 H4，而它是 DoD#8 闭不闭合的唯一开关**：原文只要求 `GET /json/version` 返回 200 且含 `webSocketDebuggerUrl`。该 HTTP 端点存活**不等于** WebSocket 升级会被接受 —— Chromium 会拒绝 `Origin` 不在 `--remote-allow-origins` 白名单内的 DevTools 连接；且 `/json/version` 给的是 **browser 级** target，驱动页面还需要 `/json/list` 或 `Target.attachToTarget`。E0-c 绿灯却 E9 卡死是最坏结局：它**授权本轮开工**，然后把 DoD#8 第三次悬空 | CDP 协议语义 + 原文判据比对 | **已修复**（E0-c 改为端到端探针，必须真跑通一次 `Runtime.evaluate`） |

### R3 P1 问题（须修复）

| ID | 问题 | 证据 | 状态 |
|---|---|---|---|
| **P1-1** | **W3 抓画布像素若走 `canvas.toDataURL()` 会有污染风险**：`CanvasCompositor.ts:710` 给图片设了 `crossOrigin='anonymous'`，但合成器的解码 `<video>` 元素**没有**设（全仓 `crossOrigin` 命中只在 `extractVideoThumbnail.ts`、`FrameExtractorLayout.tsx`、`MotionPreview*`，播放池不在其中）。打包端前端 `:18320` 与后端 `:18321` 属不同源，一旦解析出的播放 URL 不是同源 Next 代理路径，画布被污染，`toDataURL()` 抛 `SecurityError`。把 DoD#8 押在这个前提上不合适 | grep + 同源规则 | **已修复**（§8/§2.2 W3 强制走 CDP `Page.captureScreenshot` + `clip`） |
| **P1-2** | **量化后盒的 aspect 基准错位，会让运镜几何又分叉一次**：`MultiTrackPlaybackEngine._assemble`（`:374-390`）喂的是 `canvasAspect = canvas.width/canvas.height`，即**预览画布**比（853/480 = 1.777083），而后端运镜盒比是 `even_w/even_h`。`boxAspectOf` 把它乘进去，残差约 3.9e-4 —— 数值小，但性质正是本轮要铲除的「靠碰巧相等」 | 回读 `ImageOverlayLayer.ts:169-175` + `_assemble` | **已修复**（DD-10：量化路径的 box aspect 一律以输出分辨率为基准） |
| **P1-3** | **Q1 主指标带逃生门**：原文「四角偏差恒等 0.000px；**容许的唯一例外须逐例登记并解释**」——任何非零读数都可以被「登记并解释」成通过，主指标不可证伪 | 原文 §2.2 | **已修复**（D1 矩阵上例外数必须为 0；登记只用于诊断，不构成通过） |
| **P1-4** | **DoD#9 有一条使其永远可判「达成」的逃生门**：原文「若 E0-c 失败，按 §7.2 降级，并写明未闭合」，读法上降级也算满足 #9；而 §7.2 第 3 条却写「一律记为未闭合」。两处自相矛盾 | 原文 §六 vs §7.2 | **已修复**（DoD#9 仅当 W2+W3 全绿才判达成；降级 ⇒ DoD#9 判**未达成**，如实记账） |
| **P1-5** | **§4.2③ 对 `_drawOverlays` 老路径给的是「同步**或**标注」的模糊指令**，且实测该路径**已无生产调用点**：`drawFrame` 全仓仅被 `types.ts:339`（接口声明）和 5 个测试文件引用；`_drawOverlays`（`:578-587`）用 `drawImage(img,x,y,w,h)` 拉伸绘制、无 contain、无运镜。对一条测试专用死路「同步」量化规则是纯浪费，而「标注」又与 DoD#11「无僵尸代码」打架 | grep 调用点 | **已修复**（改为单一明确动作：不同步、显式标注为 test-only 且排除在量化契约外、登记进移交清单，并加一条防复活的 grep 守卫） |
| **P1-6** | **`containRectInBox` 的求值像素空间未定义，两种读法有一种必然让 Q2 超阈**：预览盒是预览画布像素，导出盒是输出像素并做整除居中。若预览用预览空间尺寸调用该函数，取整落在错误栅格上，Q2 必超 1px | 原文 §4.1/§4.2 未规定 | **已修复**（§4.1 明确签名与求值空间：一律在**输出像素空间**求值，再按 `previewW/outW` 缩放绘制） |
| **P1-7** | **E0-b 的结论本可以现在就拿到，不该留给下游再猜**：H1 是否成立整轮押在「FFmpeg contain 取整能否被纯函数复现」上。本次评审已用**真实 FFmpeg 实测 16 组**把规则钉死（见下 R5），计划应固化实测结论，E0-b 降级为「双版本确认复跑」 | 本次实测 | **已修复**（§2.6 E0-b 写入实测规则与证据） |

### R4 P2 问题（登记，不阻断）

| ID | 问题 | 处理 |
|---|---|---|
| P2-1 | §1.2 的「约 0.19px 偏置」不精确：853×480 对 16:9 时 `sourceRatio-destRatio=6.94e-4 > EPS`，走「source 更宽」分支，高度少 **0.1875px**、居中偏置 **0.09375px** | 已就地改精确 |
| P2-2 | 若干行号与工作树有 ±5 行漂移：`MultiTrackPlaybackEngine` 实为 `:374-390`（原文 `:379-390`）、`assembleLayers` 入参实为 `:63-73`（原文 `:60-70`） | 已就地更正 |
| P2-3 | DD-3 的跨语言测试要读 `.py` 源文件，未规定路径解析方式，换 cwd 即脆 | 已在 §4.1 补「从仓库根解析」 |
| P2-4 | D3 新增夹具命名 `still_3x2_odd.png` 但 1501×1000 = 1.501:1，并非 3:2 | 已改名为 `still_odd_1501x1000.png` |
| P2-5 | 预览与导出必须用**同一自然尺寸**做 contain，否则规则再一致也会分叉 | 已在 D3 补断言 |
| P2-6 | Q6 只写「视频侧 16/16 逐字符」，图片链的逐字符不变只隐含在 Q5 | 已在 Q6 显式覆盖图片链 |
| P2-7 | §4.1 称 `results/logs/` 已被 `.gitignore` 覆盖「须复核」 | 已复核：`.gitignore` 有 `*.log` 全局规则，覆盖成立 |
| P2-8 | DD-6 要求「确认无任何现存测试依赖 0.3」 | 已复核：后端测试目录内 `0.3` 与 overlay/placement 相关命中数为 **0**，`_overlay_placement` 无测试引用，改动无阻力 |

### R5 本次评审的实测证据（把 H1 从「假设」变成「已知」）

E0-b 想测的规则，评审阶段已用**真实 FFmpeg**（`2025-05-15-git-12b853530a-full_build`，与 §2.5 记录的开发端一致）跑完。方法：`color=white:s=<自然尺寸>` → `scale=<盒>:force_original_aspect_ratio=decrease` → `pad=<盒>:(ow-iw)/2:(oh-ih)/2` → `bbox` 读回实际内容矩形，一次拿到「缩放整数尺寸 + pad 居中偏移」两个量。

**假设的纯函数**（源自 `vf_scale.c` 的 `av_rescale` 语义）：

```
tmp_w = round_half_away(box_h * nat_w / nat_h)      # av_rescale = 四舍五入、平局远离零
tmp_h = round_half_away(box_w * nat_h / nat_w)
w = min(box_w, tmp_w)
h = min(box_h, tmp_h)
pad_x = floor((box_w - w) / 2)                       # pad 表达式求值后截断为 int
pad_y = floor((box_h - h) / 2)
```

**结果：16/16 组全部与预测逐值相等**，含三类关键情形：

| 自然尺寸 | 盒 | 实测 `w,h,pad_x,pad_y` | 说明 |
|---|---|---|---|
| 1920×1080 | 634×356 | `633,356,0,0` | **同比例的盒也会缩 1px**（`round(356*1920/1080)=633<634`），且 `pad_x=floor(1/2)=0` → 画面**左偏**不居中 |
| 1501×1000 | 434×288 | `432,288,1,0` | 奇数自然宽 + 偶数盒，`pad_x=1` |
| 1234×567 | 321×123 | `268,123,26,0` | `(321-268)/2=26.5` → 实测 **26**，证明是 `floor` 而非四舍五入 |

**结论**：H1 成立，DD-4 可实现，规则是纯函数、可跨语言复现。两条推论必须写进施工单：①「盒比例等于图片比例时 contain 恰好填满」这个直觉**是错的**（第一行反例），预览不能靠它省掉量化；②居中是 `floor` 不是四舍五入，浮点居中天然差半像素。

> 注：探针用不透明 `black` 填充以便 `bbox` 读数，生产用 `black@0`（透明）。pad 的**几何**与填充色无关，两者等价；E0-b 复跑时须在打包端 FFmpeg 8.1.1 上再确认一次（§7.1 风险 1 仍然有效）。

---

## 一、背景：本轮为什么只做「收口」而不是「加功能」

2D/3D 运镜的功能面在前两轮已经全部落地并提交：

| 轮次 | 提交 | 交付 |
|---|---|---|
| Iter 1 | `6d0fa57`、`8c702ec` | 视频片段的 2D/3D 运镜全链路：内核（TS `CameraMotionLayer` + Python `camera_motion`）→ 预览（Canvas 合成 + WebGL 透视）→ 导出（FFmpeg `perspective`）→ UI（16 预设、右键入口、参数面板、en/zh） |
| Iter 2 | `81428c2`、`d4df938` | **静态图片**片段的运镜（Ken Burns 这一最经典用法在 Iter 1 里是静默无效的）、面板内 3D 真透视预览、`GUARD_CANVAS` 硬编码 16:9 门禁改为真实画布 |

所以本轮（收官轮）的正确目标不是再加按钮，而是把两轮评审留下的**已登记、未闭合**的账一次性结清。Iteration 2 终审报告（`docs/plans/camera-motion-stills-and-desktop-gate/results/report.md` §五）按「会不会咬人」排了 9 条风险，其中前 3 条是本轮的全部内容，其余保持登记不动。

### 1.1 G4 / L15：预览盒与导出盒不同源（**已实测**，本轮主线）

Iteration 2 的 N0 前置基线是**带着一条红线通过**的。回读 `results/n0-box-baseline.json`：

```
box-a-16x9-still  position 0.1/0.1/0.3/0.3   maxBoxCornerDeltaPx 0.000   pass true   (gating)
box-b-wide-box    position 0.5/0.2/0.4/0.3   maxBoxCornerDeltaPx 0.000   pass true   (gating)
box-c-tall-box    position 0.28/0.42/0.22/0.44  maxBoxCornerDeltaPx 1.166  pass false (evidence-only)
                  renderedPicture maxEdgeDeltaPx 4
```

`box-c` 的判定是 `pass: false`，JSON 自己写着 `"…NOT fixed this round"`，并给 N1/N2/N3 立了一条 `downstreamFixtureRule`：**只准用落在整像素上的盒**。也就是说，Iteration 2 的全部像素级指标，都是在「刻意避开缺陷」的夹具上取得的。这在当轮是诚实的（缺陷与运镜无关，不该由运镜那轮承担），但对功能整体而言，它意味着**用户随手拖到一个非整像素位置的图片，预览与成片就差几个像素**；一旦这张图片上还挂着运镜，盒即运镜的作用域，偏差会被运镜的缩放/透视放大。

回读两侧源码，分歧有**四**处独立机理（第 4 条由节点 #1 评审新查出，见 P0-1），全部可定位：

1. **原点截断**：`backend-services/basic-service/app/services/video_composition_service.py:2629-2630` —— `int(pos.x * video_width)` / `int(pos.y * video_height)`，是**截断**不是四舍五入；预览侧 `src/components/video/playback/CanvasCompositor.ts:370-373` 全程浮点。
2. **盒尺寸先截断再向上取偶**：同文件 `:2624-2626` `_ensure_even_dimensions(int(pos.width * video_width), int(pos.height * video_height))`，而 `ensure_even_dimensions`（`app/services/composition/video_scaling.py:36-40`）是**奇数加一**（向上取偶）。截断与向上取偶方向相反，误差不抵消。
3. **盒内 contain 的取整规则不同**：导出侧 `:2649-2652` 是 `scale=W:H:force_original_aspect_ratio=decrease` 再 `pad=W:H:(ow-iw)/2:(oh-ih)/2:black@0` —— FFmpeg 的整数缩放 + **整数除法**居中；预览侧 `CanvasCompositor._containRect`（`:416-445`）是浮点 contain + 浮点居中。这一条正是 `box-c` 的盒级 1.166px 被放大成图像级 4px 的原因。
4. **越界盒的处置相反（P0-1，节点 #1 新查出，量级最大）**：预览侧 `computeImageBounds`（`ImageOverlayLayer.ts:141-152`）对盒做**钳制** —— `x = clamp01(fit.x + p.x*fit.w)`、`w = Math.min(clamp01(p.width*fit.w), 1 - x)`；后端 `_overlay_placement` 对 `x/y/w/h` **不做任何钳制**，越界部分交给 FFmpeg `overlay` 在帧边界自然裁掉。于是同一个「被拖出右边缘」的图片：**预览把它缩小塞回画面内，导出把它裁掉一角**。以 `x=0.7143, w=0.44, W=1920` 实算，预览盒宽 `0.2857×1920 = 548.5px`，导出盒宽 `even(int(0.44×1920)) = 844px`，**相差 295.5px**。

  这条不只是夹具问题，它本身就是**用户可见的真实缺陷**：拖到边缘的图片，所见与所得根本不是一回事。它同时决定了 §2.3 D1 夹具矩阵能否达成 Q1 —— D1 的 `x=0.7143` 配 `w∈{0.3337,0.44}` 都越界（`1.048`、`1.1543`），照 v1 写法 Q1 的「0.000px」按构造不可能成立。

**这四处都不是运镜引入的**（N0 是在完全无运镜下测的），但它们**决定运镜的作用域**，因此必须由运镜这条线收口 —— 没有别的人会来修它。

### 1.2 图层放置基准依赖「第一个就绪视频图层」（**回读源码，属结构性脆弱**）

`CanvasCompositor.renderFrame` 把 `fit = this._baseFit(sorted, canvas)` 一路传给 `_drawLayer` → `_drawImageLayer`，而 `_baseFit`（`:271-288`）返回的是**第一个 readyState≥2 的视频图层**的 contain 矩形。图片图层的归一化 bounds 本身是**画布归一化**的（`buildImageLayersAt` 的 `imageFit` 参数在整个 `src/` 里没有任何生产调用点，实际取默认 `FULL_RECT`，见 `ImageOverlayLayer.ts:80-81, 199-209`），却被再投影到视频矩形上。

今天之所以没出事，是因为 `_baseFit` 传了 `targetAspectRatio: this._viewport?.aspectRatio`，而 `viewport` 由 `useCompositionPlayback.ts:413` 从 `VideoPlayerPanel.tsx:152/187` 的 `aspectRatioToNumber(selectedAspectRatio.ratio)` 得到 —— 五个预设比例都能解析成数，于是 `viewport` 恒非空，`fitContain` 的 `sourceRatio == destRatio` 分支命中，返回整块画布。**这是一个靠三处远距离条件同时成立才成立的等式**：只要 `viewport` 为空（`aspectRatio` 未传 / 解析失败），或者画布像素比与目标比因取整而偏离超过 `EPS=1e-6`（`fitContain.ts:35,63-74`），图片盒就会**整体缩进到视频的 letterbox 区域里**，与导出（永远按整帧归一化）分叉一个 letterbox 的量级。

> **P2-1 已修正的精确数字**：以 853×480 画布对 16:9 为例，`sourceRatio(1.777778) - destRatio(1.777083) = 6.94e-4 > EPS`，命中「source 更宽 → 上下加边」分支，绘制高度 479.8125（比画布少 **0.1875px**），居中偏置 `y = 0.09375px`。原文写的「约 0.19px 偏置」把高度亏损当成了偏置，量级对、口径错，已按实算口径更正。

另外 `drawFrame` 的老路径 `:212` `this._drawOverlays(ctx, canvas, fit, …)` 用的 `fit` 是**不带 targetAspectRatio** 的视频固有比例矩形，与 `renderFrame` 的语义不同源。

结论：**图片盒必须显式地以画布为基准，而不是碰巧等于画布**。这是本轮要钉死的第二件事，代价极小（一个显式矩形 + 一条守卫测试），收益是把一个「今天不咬人、改一行就咬人」的隐雷拆掉。

### 1.3 `ImagePosition` 兜底默认值两侧不一致（**回读源码，已确认**）

| 位置 | 值 |
|---|---|
| `src/components/video/components/VideoPlayerPanel/imageOverlayGeometry.ts:21-27` `DEFAULT_IMAGE_POSITION` | `0.1 / 0.1 / 0.8 / 0.8` |
| `src/components/video/playback/ImageOverlayLayer.ts:89-95` `DEFAULT_POSITION` | `0.1 / 0.1 / 0.8 / 0.8` |
| `src/components/video/hooks/useVideoExport.ts:242-247` 导出兜底 | `0.1 / 0.1 / 0.8 / 0.8` |
| `backend-services/.../video_composition_service.py:2621-2623` `_overlay_placement` 兜底 | `0.1 / 0.1 / **0.3 / 0.3**` |

前端三处已在历史轮次统一到 80%，后端这处停留在 30%。正常路径下编辑器总会下发 `position`，所以今天打不着；但它是一条**沉默的、方向明确的**分叉：一旦某个请求不带 `position`（外部调用、旧工程数据、未来的批处理入口），预览按 80% 画、导出按 30% 画，而且运镜盒会跟着差 2.67 倍。改它等于变更一条既有导出默认值，属于「小改动、需要显式决策」，Iteration 2 明确把它推给了本轮。

### 1.4 DoD#8 连续两轮未闭合（**两轮 JSON 自认 `dodEightClosed: false`**）

Iteration 1 留下 DoD#8（打包端 walkthrough），Iteration 2 把它列为 DoD#5 并写明 **未达成**：`results/n6-desktop-walkthrough.json` 的 `dodEightClosed: false`，§8.4 的第 3–7 步（在打包应用里建工程 → 导入素材 → 开面板 → 看画布 → 回放成片）逐条标 `not-run-here`。

Iteration 2 的理由是「GUI 人工操作没有诚实执行的手段」。本轮不接受这个结论为终局，理由是回读打包链后发现**手段是存在的、且零新增依赖**：

- `desktop/main/index.js:18,31` 只识别 `--dev` 与 `--user-data-dir=`，**不过滤任何 Chromium 开关**，因此 `Ecliptrix.exe --remote-debugging-port=<port>` 会被 Chromium 原生消费；
- `desktop/scripts/smoke-test.js:62-72,113-128` 已有 `readPorts(userDataDir)`，能拿到打包端前端/后端真实端口，且已经把「启动 → 健康 → 关闭 → 无残留进程」这 11 步跑通，可以直接作为 walkthrough 的宿主骨架；
- 驱动侧只需 `fetch http://127.0.0.1:<port>/json` + WebSocket 说 CDP。`results/env.json` 记录本机 Node 为 **v22.18.0**，Node ≥22.4 自带全局 `WebSocket`，**不需要引入 playwright / puppeteer / ws 任何一个新依赖**（仓库根 `package.json` 与 `desktop/package.json` 的 devDependencies 均无浏览器自动化库，新增依赖会触碰仓库评审清单第 6 条）。

所以本轮把 DoD#8 定为 MUST，并且**必须先用一条 5 行的探针证明前提成立**（见 E0），再动手写台架。

---

## 二、实验计划

### 2.1 目标与假设

**目标**：在不改变任何运镜功能语义、不改变视频侧任何一个字节的前提下，使

1. 静图运镜盒在**任意**归一化位置上，预览与导出**按构造**落在同一个输出像素格上；
2. 图片图层的放置基准显式为画布（而非「碰巧等于画布」的视频 fit-rect）；
3. 打包端（真实 Electron 窗口 + 打包 Python 后端 + 打包 FFmpeg）上，运镜从「加特效 → 预览 → 导出 → 回放」全链路被**自动化实测**一次。

**假设**（每条都必须被一个指标证伪或证实，不允许只在文字里成立）：

- **H1（可构造相等）**：导出侧的盒量化规则（截断原点、截断后向上取偶、FFmpeg contain 取整、整除居中）是**可被前端精确复现的纯函数**。若前端在归一化空间内按同一规则先量化再渲染，则两侧盒在输出像素空间内的四角偏差为 **0.000px**（不是「小于阈值」，是恒等）。
- **H2（量化不伤观感且不伤运镜）**：预览采纳导出栅格后，静图在预览中的位移 ≤1 输出像素（≈0.44 预览像素 @853px 画布），肉眼不可辨；带运镜时，盒→运镜的四角映射偏差仍 ≤0.5px（沿用 Iter 1/2 的 N1 阈值），且盒内 SSIM 不低于 Iteration 2 的实测水位。
- **H3（隐雷可拆且零回归）**：把图片图层基准显式改为画布矩形后，视频侧一个字节不动、静图侧在 `viewport` 非空时逐像素不变（因为今天两者恒等），而 `viewport` 为空的路径从「缩进 letterbox」变为「按画布」——由一条**在 B0 上必然失败**的守卫测试固定。
- **H4（打包端 GUI 可被诚实自动化）**：`--remote-debugging-port` + CDP 能在打包应用里完成建工程/导素材/开面板/调参/看画布/导出/回放，并把渲染出的画布帧与成片帧做像素比对。若该前提不成立（探针失败），本轮**不许**用任何替代物冒充闭合，只能按 §7.2 降级并如实记账。

### 2.2 指标与阈值

> 命名沿用前两轮风格但换前缀，避免与 M*/N* 混淆：**Q**（Quantisation/Parity 主线）、**W**（Walkthrough）。
> **所有指标都必须自带灵敏度自证**（Iteration 1/2 各抓出过一次「漂亮的假绿」）：任一指标若无法给出「注入已知偏差后读数显著变化」的对照，视为未测。

| ID | 度量对象 | 方法 | 阈值 / 判据 |
|---|---|---|---|
| **Q0** | 前置探针（不是指标，是开工许可） | 见 §2.6 E0 | 三项探针全部给出确定结论并落档 |
| **Q1** | 盒几何同源（主指标） | 用**生产代码路径**算出的预览归一化盒 × 输出分辨率，对比**真正发给 FFmpeg 的那条命令里**读回的 `scale=`/`overlay=` 整数；两侧都不许由台架重新推导 | **四角偏差恒等 0.000px**，D1 全矩阵（≥24 个 off-grid 位置 × 5 个比例，含 ≥4 个**越界盒**）**例外数必须为 0**（P1-3 修复：v1 的「容许的唯一例外须逐例登记并解释」是逃生门，已删除 —— 登记只用于诊断，任何非零读数一律判 Q1 FAIL）；**灵敏度**：把量化函数的 `floor` 改成 `round` 重跑一次，读数必须出现非零 |
| **Q2** | 成像级同源 | 预览按输出分辨率离屏渲染的帧 vs 真实 FFmpeg 成片抽帧，定位静图（洋红边框夹具）包围盒 | 每边偏差 ≤1px（B0 实测 4px）；**灵敏度**：把导出盒人为平移 2px，读数必须 ≥2px |
| **Q3** | 运镜几何同源（off-grid 回归） | Iter 2 的 N1 方法（对发射器产出的 `perspective=x0='…'` **求值后**逐角点比 TS 黄金向量），但夹具换成 **off-grid 盒矩阵** | 最大偏差 ≤0.5px；`comparisons ≥ 1200`；**灵敏度**：黄金向量注入 1px 偏置后必须超阈 |
| **Q4** | 视觉同源（带运镜） | 真实 Chromium 抓预览帧 vs 真实 FFmpeg 成片抽帧，盒内 SSIM，含 2D/3D/强缩放三档 | 2D ≥0.97、3D ≥0.93、强缩放 ≥0.90，硬地板 0.85；**方向哨兵**（反向运镜）必须显著更低（差 ≥0.02）；**帧偏移三点扫描** 0 档必须胜出 |
| **Q5** | 兜底默认值同源 | 构造一个**不带 `position`** 的合成请求，读回后端算出的盒；与前端 `DEFAULT_POSITION` × 输出分辨率比 | 完全相等；且带 `position` 的常规请求 filter_complex 与 B0 **逐字符相同** |
| **Q6** | 非回归（视频侧 + 图片侧 + 全量） | 在 B0 的 detached worktree 里**真跑一遍**取基线，再与本轮对比 | 16 个预设的视频侧 `filter_complex` 逐字符相同；**（P2-6 补）图片侧 `_image_overlay_filter_parts` 在 on-grid 夹具上产出的 `scale=/pad=/overlay=` 串亦须与 B0 逐字符相同**（量化是重构不是行为变更，后端输出理应一字不动；若有变化即说明重构改了规则，判 FAIL）；前端 vitest / 后端 pytest 失败**文件集合**与 B0 相同，新增失败 = 0 |
| **Q7** | 预算与规范 | 每图层运镜增量耗时、变更文件行数/函数长度/形参数、i18n 键对齐、`tsc --noEmit` | 增量 ≤1.0ms/图层、单帧均值 ≤12ms；**（P0-2 修复）新增文件 ≤800 行**；**存量已超阈文件**（B0 实测：`video_composition_service.py` 3024 行、`useVideoExport.ts` 817 行）**不得因本轮而增长**（净行数增量 ≤0，实测记录进 JSON）；`VideoPlayerPanel.tsx`（B0 764 行）改动后**必须仍 <800**；**被触碰的函数**长度 ≤50 行、形参 ≤5；en/zh 键数相等且无硬编码文案；tsc exit 0 |
| **W1** | 打包端能力与同一性 | 打包产物内运镜源码文件哈希 vs 工作树；打包端 FFmpeg 能力探测四项 + **E0-b 规则在 8.1.1 上的复测** | 源码哈希一致（L11）；能力探测与开发端逐项一致；**contain 取整规则在两个 FFmpeg 大版本上必须给出同一张表**，不一致按 §7.1 风险 1 处置并显式记录 |
| **W2** | 打包端 GUI walkthrough | CDP 驱动 §8 的 7 步 | 7 步全绿；每步落一张截图 + 一行结构化日志 |
| **W3** | 打包端预览↔成片一致 | walkthrough 内：从打包应用的画布抓帧，再回放它自己导出的成片抽帧，盒内 SSIM | 与 Q4 同档阈值；**这条是 DoD#8 真正的判据**，不是「应用能启动」。**（P1-1 修复）抓帧一律走 CDP `Page.captureScreenshot` + `clip`（取画布 `getBoundingClientRect`），不许用 `canvas.toDataURL()`** —— 合成器的解码 `<video>` 未设 `crossOrigin`（对比 `CanvasCompositor.ts:710` 的图片有设），跨源视频源会污染画布使 `toDataURL` 抛 `SecurityError`；`toDataURL` 只可作旁证，抛错时记录为证据而非判 FAIL |

### 2.3 数据集与夹具（D）

- **D1 `offgrid-box-matrix`（新，本轮核心）**：≥24 个归一化位置，**刻意**不落在整像素上。构造规则须写进夹具文件：对每个输出分辨率 `W×H`，取 `x,y ∈ {0.28, 0.3337, 0.5001, 0.7143}`、`w,h ∈ {0.22, 0.3337, 0.44}` 的组合，并**断言** `x*W`、`w*W`、`y*H`、`h*H` 至少一项的小数部分 ∈ (0.15, 0.85) —— 否则该样本不算 off-grid，必须换掉。**这条断言本身要被测**（防止夹具退化成 on-grid 后指标假绿）。
  - **（P0-1 新增，强制）越界子集**：矩阵必须**显式包含 ≥4 个 `x+w > 1` 或 `y+h > 1` 的样本**（例如 `x=0.7143,w=0.44` → 1.1543；`y=0.7143,h=0.3337` → 1.048），并**单独成组判定**。这是 P0-1 的直接回归夹具：v1 的钳制差异只在越界盒上暴露，而 v1 的矩阵虽然碰巧会生成这类样本，却没有把它们标出来，一旦下游"顺手"把越界样本当无效数据剔掉，P0-1 就会带着 295px 的分歧被判绿。**剔除越界样本 = 本轮不合格**（L-Q3 的直接适用）。
  - 同时必须包含 ≥2 个**负坐标**样本（`x = -0.05`，图片被拖出左边缘）：钳制与不钳制在负方向同样分叉（预览 `clamp01 → 0`，导出 `int(-96) = -96`）。
- **D2 五个比例**：`16:9 1920×1080`、`9:16 1080×1920`、`4:3 1440×1080`、`1:1 1080×1080`、`21:9 2560×1080` —— 与 `video_scaling.py:22-28` 的 `_ASPECT_RATIO_MAP` 逐项对齐（该表是导出分辨率的唯一真相；节点 #1 已复核该表与 `video_models.py:306-312` 的 `AspectRatio` 五个枚举值、以及前端 `aspectRatios.ts:32-36` 的五个 `id` 三方一一对应，DD-3 的键可以直接用 `id` 字符串）。
- **D3 静图夹具**：沿用 Iter 2 的 `still_16x9.png`(1920×1080) 与 `still_4x3.png`(1440×1080)，**新增** `still_odd_1501x1000.png`(1501×1000，奇数宽；P2-4：原名 `still_3x2_odd` 有误导，1501/1000 = 1.501 并非 3:2) —— 奇数自然尺寸会把 FFmpeg contain 取整与向上取偶两条规则同时逼出来（评审实测已证：1501×1000 进 434×288 盒得 `432×288`、`pad_x=1`）。全部代码合成、SHA256 落 `results/env.json`。夹具须带**洋红 1px 外框 + 四角标记**，这是 Q2 包围盒定位的基础。
  - **（P2-5 新增）自然尺寸一致性断言**：台架须断言预览侧 `img.naturalWidth/naturalHeight` 与导出侧 FFmpeg 解码出的尺寸**逐值相等**。contain 规则再一致，喂进去的自然尺寸不同也会分叉；这条断言把该变量钉死在夹具层。
- **D4 底片**：一段 6s 纯色渐变视频，比例与工程画布**相同**（沿用 Iter 2 约束，把 §1.2 的 letterbox 变量挡在 Q1–Q4 之外）；**另加**一段比例**不同**的底片，专用于 §1.2 的守卫测试（Q1 的一个独立分组，不参与主阈值判定）。
- **D5 walkthrough 工程**：1 段视频 + 1 张图片 + 1 条字幕；视频挂 3D 预设（`orbit-left`），图片挂 2D（`ken-burns`）与 3D 各一份，时长 6s。

### 2.4 基线（B）

- **B0 = `d4df938`**：Iteration 2 终态。Q6 的「逐字符相同」必须在 **B0 的 detached worktree 里真跑一遍**取得，**不许**引用 Iter 2 的 JSON（这是 Iter 2 自己立的规矩，本轮继承）。
- **B1 = 无运镜对照**：同一夹具关掉运镜，给 Q2/Q4 提供「上限」参考值。
- **B2 = 反向运镜哨兵**：给 Q4 提供「若比对错了会怎样」的下限参考值。
- **B3 = 红灯证据**：本轮**每一条新增守卫测试**都必须在 B0 的 worktree 上跑一遍并**记录其失败输出**（`results/red-on-baseline.json`）。测试存在 ≠ 测试有效；Iteration 2 在产品测试里抓出过 `expect(f(x)).toBe(f(x))` 这种恒真断言，本轮用红灯证据把这类东西从源头堵死。

### 2.5 算力与运行环境

```
environment: local
```

| 项 | 值 |
|---|---|
| 主机 | 本机 Windows 11 (`10.0.26200`)，工作目录 `M:/takoAI/Ecliptrix` |
| 是否远程 | **否**。不使用任何远程主机 / SSH / 云资源；无私钥、无凭证进入本目录 |
| Python | 3.11.7（后端 venv）；`pytest` |
| Node | v22.18.0（CDP 台架依赖其全局 `WebSocket`，见 E0-a） |
| Electron | 33.4.11（打包端） |
| FFmpeg | 开发端 `2025-05-15-git-…-full_build`；打包端 `resources/ffmpeg` 8.1.1-essentials —— **两者是不同大版本，必须都测** |
| GPU | ANGLE (Intel Arc Graphics, D3D11)，WebGL 2.0 |
| 预算 | 台架总时长目标 ≤25 分钟（Iter 2 全量 571s，本轮新增打包 walkthrough 与出包，出包约 9.3 分钟）；**出包步骤必须走后台 + 异步等待协议**，不许裸 sleep |

### 2.6 台架与执行顺序

所有实验代码只落在 `docs/plans/camera-motion-box-parity-and-desktop-walkthrough/experiments/`，所有产物只落 `results/`。沿用 Iter 2 的 `run_all.py` 单入口模式（一条命令可全量复跑），阶段如下：

- **E0 前置探针（开工许可，先于任何代码改动）**
  - **E0-a**（已由节点 #1 预先证实，降为确认性复跑）：`node -e "console.log(process.version, typeof WebSocket)"`。**评审实测结果：`v22.18.0 function`** —— §8 的零依赖前提成立。
  - **E0-b**（已由节点 #1 在开发端实测通过，改为「固化规则 + 双版本确认」）：规则**不再需要猜**，评审已用真实 FFmpeg 16/16 验证下述纯函数（详见 `## 评审记录` R5）：

    ```
    tmp_w = round_half_away(box_h * nat_w / nat_h)   # av_rescale：四舍五入，平局远离零
    tmp_h = round_half_away(box_w * nat_h / nat_w)
    w = min(box_w, tmp_w);   h = min(box_h, tmp_h)
    pad_x = floor((box_w - w) / 2);   pad_y = floor((box_h - h) / 2)
    ```

    节点 #2/#3 仍须做两件事：①把这套向量**原样**作为 `overlay-box-golden.json` 的一部分；②在**打包端 FFmpeg 8.1.1** 上复跑同一批组合（W1），确认跨大版本同表。测法沿用评审用过的一次成形写法：`color=white:s=<nat>` → `scale=<box>:force_original_aspect_ratio=decrease` → `pad=<box>:(ow-iw)/2:(oh-ih)/2` → `bbox`，一次读回缩放尺寸与居中偏移（探针用不透明 `black` 便于 `bbox` 读数，与生产的 `black@0` 几何等价）。
  - **E0-c**（**P0-3 修复：判据加强为端到端**）。v1 只要求 `GET /json/version` 返回 200 且含 `webSocketDebuggerUrl` —— 这只证明 HTTP 端点活着，**不证明 WebSocket 升级会被接受**（Chromium 会拒绝 `Origin` 不在 `--remote-allow-origins` 白名单内的 DevTools 连接），也拿不到**页面级** target。绿灯 E0-c 配死掉的 E9 是最坏结局：它授权本轮开工，然后把 DoD#8 第三次悬空。新判据是**一条完整链路必须全通**：
    1. `Ecliptrix.exe --remote-debugging-port=<port> --user-data-dir=<隔离目录>` 起得来；
    2. `GET /json/version` → 200；
    3. `GET /json/list` → 至少一个 `type=page` 且带 `webSocketDebuggerUrl` 的 target；
    4. 用 Node 内置 `WebSocket` 连上该 **page** target（握手成功，非 403）；
    5. 发一次 `Runtime.enable` + `Runtime.evaluate {expression:"1+1"}`，**收到 `result.value === 2`**；
    6. 再发一次 `Page.captureScreenshot`，**拿到非空 base64**（这一步同时预验 W3 的抓帧手段，见 P1-1）。

    以上 6 步的原始请求/响应逐条落档。若第 4 步握手被拒，**先加 `--remote-allow-origins=*` 重试一次并记录是否需要它**（这是已知的 Chromium 行为，不是失败）；仅当加了仍不通，才判 E0-c 失败并走 §7.2。
  - **三项探针的结论必须逐条落 `results/e0-probes.json`，含原始命令与原始输出**。E0-b 若在打包端与开发端结论不一致 → 按 §7.1 风险 1 处置；E0-c 失败 → 走 §7.2，且 DoD#9 直接判**未达成**（见 §六）。
- **E1 Q0/Q1 盒几何**（改动后立即跑，最短反馈环）
- **E2 Q2 成像级**（Electron 离屏渲染 + 真实 FFmpeg 成片）
- **E3 Q3 运镜几何 off-grid**
- **E4 Q4 视觉 SSIM + 哨兵 + 帧偏移扫描**
- **E5 Q5 兜底默认值**
- **E6 Q6 非回归**（detached worktree 真跑 B0）
- **E7 Q7 预算与规范审计**
- **E8 出包**（`desktop/build.ps1 -Dir` 或 `npm run build:dir`，后台执行 + `wait_async` 注册，**严禁**裸 `sleep`）
- **E9 W1/W2/W3 打包端 walkthrough**（依赖 E8）
- **E10 红灯证据**（B3：所有新增测试在 B0 worktree 上跑一遍，记录失败输出）

---

## 三、设计决策（D-Decision，供节点 #1 评审、节点 #2 实现）

| ID | 决策 | 理由 / 备选与否决原因 |
|---|---|---|
| **DD-1** | **导出侧是量化真相，预览侧向它对齐** | 导出必须落在整数像素上（FFmpeg 参数是整数、H.264 要求偶数维度），无法浮点化；而预览天然可以量化。反向对齐（让导出浮点）在物理上不可能 |
| **DD-2** | 量化发生在**归一化空间**，量化基准是**输出分辨率**（非预览画布） | 预览画布是显示尺寸（如 853×480），按它量化不可能复现 1920×1080 的栅格。量化输出 `{x: xq/W, y: yq/H, w: bw/W, h: bh/H}`，预览再按自身画布缩放 —— 于是两侧在**归一化空间恒等**，在输出像素空间恒等，预览画布上的残差纯粹是显示缩放，属不可消除项且 <1 显示像素 |
| **DD-3** | 输出分辨率表在前端建一张 `EXPORT_RESOLUTIONS` 常量，并用**一条跨语言一致性测试**钉住它与 `video_scaling.py:_ASPECT_RATIO_MAP` 相等 | 双份常量必然漂移（本仓库已有 `DEFAULT_POSITION` 漂移的先例，见 §1.3）。测试直接读 `.py` 源文件解析该表并比对，漂移当场变红。**不许**为此新增运行时接口调用（预览不能依赖后端在线） |
| **DD-4** | contain 规则做成**两侧共享的纯函数**（TS 与 Python 各一份 + 互测），规则本身由 E0-b **实测**确定而非查文档 | Iteration 2 的教训：`perspective` 的 `t` 变量按文档「应该」可用，实测 `Invalid argument`。凡是 FFmpeg 行为，一律实测 |
| **DD-5** | 图片图层放置基准改为**显式画布矩形**，`_baseFit` 仅继续服务视频图层 | 见 §1.2。改动面极小，但把一条隐式等式变成显式契约。**保留** `imageFit` 参数（未来若真要把叠加锚到视频区，是显式传参，不是隐式继承） |
| **DD-6** | 后端兜底默认值 `0.3/0.3` → `0.8/0.8`，与前端三处统一 | 见 §1.3。属变更既有导出默认值，因此必须：①单独一条测试固定；②在报告里显式声明这是行为变更；③确认无任何现存测试依赖 0.3（若有，是它错了，一并修正并说明） |
| **DD-7** | walkthrough 走 **CDP + Node 内置 WebSocket**，零新增依赖 | 新增 playwright/puppeteer 会引入数百 MB 与一条新的供应链，仓库评审清单第 6 条要求依赖必要性论证。CDP 路线用的都是已有能力 |
| **DD-8** | 本轮**不做** R4（新式 `-/filter_complex`）、**不做** `rotation`、**不做** L14 | 三者都在 STRETCH 且与本轮目标正交。收官轮的价值在于把已知账结清，不是开新战线 |
| **DD-9**（P0-1） | **量化路径的盒不做钳制**：`quantiseOverlayBoxNormalised` 的输出**不得**经过 `clamp01` / `Math.min(w, 1-x)`；越界部分交给画布自然裁剪，与导出侧 `overlay` 在帧边界的裁剪行为一致 | DD-1 已定「导出是量化真相」，钳制是**只有预览侧有**的行为。备选「反过来给后端也加钳制」被否决：那会改变既有导出成片的画面（把越界图片缩小重排），是一次面向所有历史工程的行为变更，风险远大于收益；而现方案只是让预览停止"自作主张地缩图"。**这是一次预览行为变更**：拖出边缘的图片从"被缩小塞回画面"变为"被裁掉一角"——而后者正是用户导出后一直会看到的结果，属对齐而非回归。必须①单独一条守卫测试固定（向量 `x=0.7143,w=0.44,W=1920` → 归一化宽必须恰为 `844/1920`）；②在报告里显式声明为行为变更；③`computeImageBounds` 的原钳制分支在**非量化**调用路径上保持不变，避免波及未传 `exportResolution` 的既有调用 |
| **DD-10**（P1-2） | **量化盒的 aspect 一律以输出分辨率为基准**：喂给 `motionStateAt` 的 `boxAspect`，在量化路径上必须等于 `bw/bh`（输出像素整数比），不得由预览画布比推导 | 现状 `MultiTrackPlaybackEngine._assemble`（`:374-390`）传的是 `canvas.width/canvas.height`（如 853/480 = 1.777083），与后端的 `even_w/even_h` 差约 3.9e-4。数值虽小，但它正是本轮要铲除的「靠碰巧相等」类等式；有了 `exportResolution` 后修它是零成本的 |
| **DD-11**（P1-1） | **打包端抓帧走 CDP `Page.captureScreenshot`**，不走 `canvas.toDataURL()` | 合成器的解码 `<video>` 未设 `crossOrigin`（图片在 `CanvasCompositor.ts:710` 设了），跨源视频源会污染画布。截图走浏览器合成器输出，与污染状态无关，是唯一不押注于 URL 同源性的取像手段 |
| **DD-12**（P1-5） | **`drawFrame` / `_drawOverlays` 老路径既不同步量化规则、也不删除**，而是显式标注为 test-only 并登记进移交清单 | 实测该路径**已无生产调用点**（`drawFrame` 仅被 `types.ts:339` 接口声明和 5 个测试文件引用），对它同步量化规则是纯浪费；但删除要动公开接口 + 5 个测试文件，超出收官轮的收口范围。折中：加一条注释写明"test-only，且**不在**量化契约内"，并加一条 grep 守卫（生产代码出现 `.drawFrame(` 即失败），把"以后有人误接回去"这条路堵死 |

---

## 四、代码改动计划

> **需要改代码**（本节即为节点 #2 的施工单）。下列行号基于 `d4df938` + 当前工作树，节点 #2 施工前须重新定位并在报告中记录实际行号。

### 4.1 新增文件

| 文件 | 职责 | 约束 |
|---|---|---|
| `src/components/video/playback/internal/overlayBoxQuantise.ts` | 唯一的 TS 量化实现：`quantiseOverlayBoxNormalised(pos, outW, outH)` → 归一化盒；`containRectInBox(natW, natH, boxW, boxH)` → 盒内 contain 矩形（复现 E0-b 实测规则） | 纯函数、无 DOM、≤120 行；每个导出函数写明「与 Python 孪生函数同源」并给出对方路径。**（P1-6）两个函数的求值空间必须在 docstring 里钉死**：`containRectInBox` 的 `boxW/boxH` 是**输出像素整数**，返回的也是**输出像素空间**的矩形；调用方负责按 `previewW/outW` 缩放到预览画布再绘制。**若传入预览像素尺寸，取整会落在错误栅格上，Q2 必然超阈** —— 这条歧义 v1 未规定，属 P1-6。**（DD-9）`quantiseOverlayBoxNormalised` 不得对输出做 `clamp01` 或 `Math.min(w, 1-x)`** |
| `src/components/video/playback/exportResolutions.ts` | `EXPORT_RESOLUTIONS` 表（DD-3）+ `resolveExportResolution(aspectRatioId)` | ≤40 行；文件头注明它是 `video_scaling.py:_ASPECT_RATIO_MAP` 的孪生。键用 `aspectRatios.ts:32-36` 的 `id` 字符串（`'16:9'…`），已复核与后端 `AspectRatio` 枚举值逐字相同 |
| `backend-services/basic-service/app/services/composition/overlay_box.py` | Python 孪生：`quantise_overlay_box(pos, out_w, out_h)`、`contain_rect_in_box(...)` | 纯函数、无 I/O；`_overlay_placement` 与 `_image_overlay_filter_parts` 改为调用它 |
| `src/components/video/playback/__tests__/overlayBoxQuantise.test.ts` | 量化规则单测 + **跨语言表一致性测试**（DD-3） | 必须包含至少一条「在 B0 上会红」的断言。**（P2-3）读 `.py` 源文件时路径必须从仓库根解析**（如经 `process.cwd()` 或向上回溯到含 `package.json` 的目录），不得写死相对 `__dirname` 的层级数，否则换 cwd/移动目录即脆。**（DD-9）必须含越界向量** `x=0.7143,w=0.44,W=1920 → 归一化宽 === 844/1920` |
| `backend-services/basic-service/tests/test_overlay_box.py` | Python 侧同一批向量（与 TS 用同一个 JSON 黄金文件） | 黄金文件放 `docs/plans/<feature>/fixtures/overlay-box-golden.json` |
| `src/components/video/components/CameraMotionModal/__tests__/MotionPreviewStage.test.tsx` | 补 Iteration 2 风险 5：面板 3D 预览组件零单测 | 只断言「委托给共享 `drawWithMotion` 缝 + `acquire/release` 配平 + 无 WebGL 时降级仍落笔」，**不许** mock 一个 GL 上下文来假装渲染成功 |
| `docs/plans/<feature>/experiments/**` | 台架（`run_all.py` + E0–E10 各阶段脚本 + CDP walkthrough 驱动） | 不进 `src/`、不进 `app/`；日志走 `results/logs/`（该目录已在 `.gitignore` 覆盖内，须复核） |

### 4.2 修改文件

| 文件 | 位置 | 改动 |
|---|---|---|
| `src/components/video/playback/ImageOverlayLayer.ts` | `:137-153` `computeImageBounds`、`:199-237` `buildImageLayersAt`、`:169-175` `boxAspectOf` | 新增可选 `exportResolution` 入参；有值时在返回 bounds 前套 `quantiseOverlayBoxNormalised`，且**该路径跳过 `clamp01` / `Math.min(w,1-x)` 钳制**（DD-9）；**运镜的 `boxAspectOf` 必须用量化后的盒，且基准比取 `outW/outH` 而非预览画布比**（DD-10；否则运镜与盒又分叉一次） |
| `src/components/video/playback/internal/assembleLayers.ts` | `:63-73` 入参（v1 写 `:60-70`，实测漂移）、`:201-206` 调用 | 透传 `exportResolution`；文档注明它与 `canvasAspect` 的分工（`canvasAspect` 继续服务视频侧覆盖保证，`exportResolution` 只服务图片侧量化） |
| `src/components/video/playback/MultiTrackPlaybackEngine.ts` | `:374-390` `_assemble`（v1 写 `:379-390`，实测漂移） | 从 host 拿 `exportResolution` 并透传 |
| `src/components/video/hooks/useCompositionPlayback.ts` | `:239-245` 入参、`:400-415` host 组装 | 新增 `exportResolution` 选项并写进 host |
| `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` | `:151-154` 附近、`:174-190` | 由 `selectedAspectRatio.id` 解析 `EXPORT_RESOLUTIONS` 并下传（该 id 已在 `:351` 传给导出 hook，两条路径自此同源）。**（P0-2）解析逻辑必须落在 `aspectRatios.ts` 或 `exportResolutions.ts`，面板只做一次调用** —— 该文件 B0 已 764 行，离 800 阈值只剩 36 行 |
| `src/components/video/playback/CanvasCompositor.ts` | `:363-406` `_drawImageLayer`、`:416-445` `_containRect`、`:239-269` `renderFrame`、`:570-590` `_drawOverlays` | ①图片图层基准改为显式画布矩形（DD-5）；②`_containRect` 改为调用共享 `containRectInBox`，**并在输出像素空间求值后按 `previewW/outW` 缩放**（P1-6）；③**（P1-5 已定案，取代 v1 的「同步或标注」二选一）`_drawOverlays` / `drawFrame` 不同步、不删除**：加注释标明 test-only 且不在量化契约内，并加 grep 守卫禁止生产代码出现 `.drawFrame(`（DD-12） |
| `backend-services/.../video_composition_service.py` | `:2607-2631` `_overlay_placement`、`:2633-2664` `_image_overlay_filter_parts` | 改为调用 `overlay_box.py`；兜底默认值 `0.3→0.8`（DD-6）。**`_image_overlay_filter_parts` 输出的字符串格式不得变化**（Q6 的逐字符不变靠它）。**（P0-2）该文件 B0 已 3024 行，本轮净行数增量必须 ≤0** —— 量化逻辑外迁到 `overlay_box.py` 后，`_overlay_placement` 应当变短而非变长。**（DD-6 前置已复核）** 后端测试目录内与 overlay/placement 相关的 `0.3` 命中数为 0，`_overlay_placement` 无测试引用，改默认值无既有测试阻力 |
| `src/components/video/components/VideoPlayerPanel/ImageOverlay.tsx` | 渲染 style 处 | **SHOULD**：DOM 手柄也落同一栅格，使「蓝框 = 画布像素 = 成片像素」三者同源。若与既有拖拽测试冲突，可降级为不做，但必须在报告里量化残差 |
| `docs/plans/timeline-camera-motion/experiments/README.md` | —— | **SHOULD**：补一行说明 Iter 1 台架的 `build-kernel.mjs` 模块清单已过期（缺 `internal/drawWithMotion`、`internal/boxTextureCache`、本轮的 `overlayBoxQuantise`），只读归档 |
| `CLAUDE.md` | Preview compositor 段 | 若最终改动影响该段描述（图片盒基准 / 量化契约），**必须**同步一句话，否则文档与代码分叉 |

### 4.3 明确不改

- 视频片段运镜的任何一行（`CameraMotionLayer.ts`、`camera_motion.py`、`camera_motion_overlay.py` 的几何与发射逻辑）——Q6 用逐字符比对钉死。
- 运镜 UI 的功能面（预设、面板、右键入口、i18n 文案）——除非 §4.2 的 SHOULD 项触发。
- 与本轮无关的在途改动：当前分支 `feat/remove-user-system` 工作树有约 330 个无关文件的改动，**任何节点都不得 `git add -A` / `git add .`**，提交必须逐路径添加（Iteration 1/2 均遵此规，且已有一次误提交 36MB 日志的历史教训）。

---

## 五、落地护栏（L）

沿用前两轮编号习惯，**新增**以 `L-Q` 前缀。

- **L-Q1（唯一实现）**：量化规则在每种语言里**只有一处实现**。若评审在 `src/` 或 `app/` 里 grep 到第二处 `int(pos.x * ...)` 或等价的取整逻辑，判本轮不合格。
- **L-Q2（红灯证据）**：每条新增守卫测试必须附 B0 上的失败输出（`results/red-on-baseline.json`）。无红灯证据的测试视为未测。
- **L-Q3（禁止夹具挑选）**：Q1–Q4 的夹具必须包含 off-grid 样本，且夹具文件里的 off-grid 断言本身要被测。任何「换个位置就绿了」的收敛都必须在报告里显式声明。**（P0-1 强化）越界盒（`x+w>1` / `y+h>1`）与负坐标盒是 D1 的必选子集，剔除它们等同于挑夹具，判本轮不合格。**
- **L-Q11（P1-3：主指标不得带逃生门）**：Q1 在 D1 全矩阵上的例外数必须为 **0**。「逐例登记并解释」只是诊断动作，**不构成通过条件**。任何以「已登记」为由把非零读数判绿的做法，与 Iteration 2 抓到的 `expect(f(x)).toBe(f(x))` 同类，判不合格。
- **L-Q12（P1-4：降级不得算达成）**：DoD#9 只有在 W2 与 W3 双绿时才判达成。走 §7.2 任何一条降级路线，DoD#9 一律判**未达成**（这与 §7.2 第 3 条本来就一致，v1 的 §六 措辞与之矛盾，已改）。
- **L-Q13（P0-2：阈值不得为了通过而重定义）**：Q7 的行数口径已按 B0 实测重写（新增文件 ≤800；存量超标文件不得增长）。下游**不得**再次自行调整该口径；若确有必要调整，必须按仓库规范写进 `.claude-index/config.md` 并在报告中说明理由。
- **L-Q4（实测优先于文档）**：FFmpeg 相关规则一律以 E0-b 实测为准。
- **L-Q5（打包端同一性）**：walkthrough 前必须核对打包产物内的运镜源码哈希与工作树一致（继承 Iter 1 的 L11）。
- **L-Q6（诚实降级）**：任何未执行的步骤一律标 `not-run-here` 并写明缺口，**不许**用包外等价证据顶替，也不许在摘要里写成「已闭合」。
- **L-Q7（摘要与原始数据一致）**：`summary.md` 的每个数字必须能在对应 JSON 里找到。Iteration 2 在这一条上翻过车（N7 四个数字与 JSON 全部对不上）。
- **L-Q8（既有失败集合归因）**：后端合成套件的 17 项既有失败必须按提交归因确认「集合相同、零新增」，不许笼统写「与基线一致」。
- **L-Q9（着色器/绘制缝改动 → 必须重跑视觉指标）**：继承 Iter 2 的 L13。本轮 `_containRect` 与 `_drawImageLayer` 都在这条缝上。
- **L-Q10（长任务协议）**：出包（约 9.3 分钟）与 walkthrough 必须走后台执行 + `wait_async` 注册；任何 >30s 的等待都不许裸 sleep。

---

## 六、Definition of Done

1. **Q1 = 0.000px**：≥24 个 off-grid 位置 × 5 个比例（**含 ≥4 个越界盒 + ≥2 个负坐标盒**），预览盒与导出盒在输出像素空间四角恒等。**（P1-3）例外数必须为 0**；登记只用于诊断，不构成通过条件。
2. **Q2 ≤1px**、且 2px 注入探针读数 ≥2px（灵敏度自证）。
3. **Q3 ≤0.5px**，`comparisons ≥1200`，注入 1px 偏置后必须超阈；**（DD-10）盒 aspect 取输出像素比**。
4. **Q4** 三档 SSIM 达标 + 方向哨兵差 ≥0.02 + 帧偏移 0 档胜出。
5. **Q5** 无 `position` 请求两侧相等；常规请求 filter_complex 与 B0 逐字符相同。
6. **Q6** 视频侧 16/16 逐字符相同（在 B0 worktree 真跑取基线）；**图片侧 on-grid 夹具的 `scale=/pad=/overlay=` 串亦逐字符相同**；前后端新增失败 = 0。
7. **Q7**（**P0-2 重写口径**）性能预算达标；**新增文件 ≤800 行**；**存量超阈文件（`video_composition_service.py` 3024 行、`useVideoExport.ts` 817 行）净行数增量 ≤0**；`VideoPlayerPanel.tsx` 改动后仍 <800 行；被触碰函数 ≤50 行 / 形参 ≤5；i18n 键对齐；`tsc --noEmit` exit 0。
8. **W1** 打包产物含本轮源码（哈希一致）；打包端 FFmpeg 能力探测落档，**且 E0-b 的 contain 规则在 8.1.1 上复测同表**。
9. **W2 + W3：DoD#8 真正闭合** —— §8 的 7 步在打包应用里自动跑通，并且打包端预览帧（**经 CDP `Page.captureScreenshot` 取得**，DD-11）与其自身导出成片的盒内 SSIM 达标。**（P1-4 修复）本条仅在 W2 与 W3 双绿时判达成**；一旦走 §7.2 任一降级路线，本条一律判**未达成**，并在报告标题行与 `summary.md` 首段显式写明「DoD#8 仍未闭合」。三轮之后仍不闭合是可接受的结论，把降级写成闭合不可以。
10. **B3 红灯证据**齐全：每条新增守卫测试在 B0 上的失败输出可复核。
11. 无僵尸代码 / 无孤儿 TODO；`results/report.md` ≥3000 字，含背景/参数/关键日志/结果/风险五节，并**汇总三轮的残留账**（本轮之后无下一轮，必须给出完整的移交清单）。
12. 提交按路径逐个 `git add`，不含 `.log`、`__pycache__`、`.next/`、`tsconfig.tsbuildinfo`，不裹挟 330 个无关在途文件。

---

## 七、风险与回退

### 7.1 主线风险

| # | 风险 | 缓解 |
|---|---|---|
| 1 | **E0-b 测不出稳定的 FFmpeg contain 规则**（不同版本行为不同） | **风险已显著下降**：评审已在开发端 16/16 实测通过（R5），规则确定为纯函数。残留风险只剩「打包端 8.1.1 与开发端不同表」；若真不同，`containRectInBox` 改为「按版本分支 + 阈值放宽到 ≤1px」，并在报告显式记录这是版本相关行为 |
| 2 | **量化改动引起既有测试大面积变红** | 预期会有：现存断言按浮点盒写。逐条判定「是断言过时还是改错了」，每条修改都要在报告里给理由；**不许**为了变绿而放宽断言 |
| 6 | **（P0-1 引入）取消钳制后，越界图片在预览里从"被缩小"变为"被裁切"，可能有既有测试/用户预期依赖旧行为** | 这是**对齐导出**的行为变更而非回归（用户导出后一直看到的就是裁切）。缓解：①只在传了 `exportResolution` 的量化路径上取消钳制，未传的旧调用路径行为不变（DD-9③）；②逐条复核依赖钳制的既有断言并在报告说明；③报告里把它列为**显式行为变更**，而非静默修复 |
| 7 | **（P0-2 引入）`VideoPlayerPanel.tsx` 只剩 36 行余量** | 解析逻辑外迁到 `aspectRatios.ts` / `exportResolutions.ts`（§4.2 已强制）；Q7 把该文件 <800 列为硬判据，越线当场变红而不是事后发现 |
| 8 | **（P0-3 引入）CDP 握手被 Chromium 的 Origin 白名单拒绝** | E0-c 第 4 步失败时先加 `--remote-debugging-port` 之外的 `--remote-allow-origins=*` 重试并记录；这是已知行为不是失败。仅当加了仍不通才走 §7.2 |
| 3 | **CDP 驱动 UI 选择器脆弱** | 优先用 `data-testid` / `aria-label`（面板已有 `role=status`/`role=alert`），必要时**新增少量 `data-testid`**（属可接受的可测试性改动）；每步失败必须抓截图 + DOM 快照落 `results/` |
| 4 | **出包 9.3 分钟 + walkthrough 使总时长超预算** | E8/E9 后台执行 + 异步等待；E1–E7 可先行完成并单独判定 |
| 5 | **改动触及 `CanvasCompositor` 这条全局绘制缝** | 视频侧路径不进量化分支（视频盒 = 整帧，量化恒等），并由 Q6 逐字符 + 全量 vitest 兜底；L-Q9 强制重跑视觉指标 |

### 7.2 DoD#8 的降级路线（唯一被允许的降级）

若 E0-c 证明 `--remote-debugging-port` 在打包应用上不可用：

1. **降级 A**：用 `readPorts()` 拿到打包端前端端口，在**同一台机器上另起一个 Electron 窗口**加载 `http://127.0.0.1:<frontendPort>/`，驱动同一份打包前端 + 打包后端 + 打包 FFmpeg 完成 7 步。**必须明确记账**：窗口 chrome 与主进程 IPC 未覆盖。
2. **降级 B**：若降级 A 也不可行，产出一个**一条命令可跑的人工 walkthrough 脚本**（自动建好工程与素材，人只需点 7 下并回答 7 个 y/n），把人工成本降到分钟级，并在 JSON 里逐步标 `not-run-here`。
3. **无论哪种降级，DoD#8 一律记为未闭合**，报告标题行与 `summary.md` 首段都要写明。三轮之后仍不闭合是可以接受的结论；把它写成闭合不可以。

---

## 八、打包端 walkthrough 步骤规程（W2 的判据清单）

在**打包应用**（`desktop/release/win-unpacked/Ecliptrix.exe`，隔离 userData）内按序执行，每步落一张截图与一行结构化日志：

1. **启动与就绪**：应用起来、后端/前端健康、主窗口 `did-finish-load`（复用 `smoke-test.js` 的判据）。
2. **建工程 + 导素材**：新建视频工程，导入 D5 的 1 视频 + 1 图片 + 1 字幕，落到时间轴。
3. **开运镜面板**：在视频片段上打开运镜入口（右键菜单 → 面板弹出），断言面板可见、16 个预设可见、3D 预览区有真透视（非仿射影子）。
4. **给视频加 3D 运镜**：选 `orbit-left`，改一个强度参数，Apply；断言片段徽标点亮、面板关闭、时间轴状态已更新。
5. **给图片加 2D 与 3D 运镜**：`ken-burns`（2D）与一个 3D 预设各一次；断言**画布上静图确实在动**（连续两帧画布像素差异显著，且方向与预设一致）——这条直接对应 Iteration 2 修掉的 G1（面板骗人）。
6. **看画布**：抓取运镜过程中的画布帧（≥3 个时间点），落盘。**（P1-1 / DD-11）取像一律用 CDP `Page.captureScreenshot` + `clip`（`clip` 取画布元素的 `getBoundingClientRect` 与 `devicePixelRatio`），不用 `canvas.toDataURL()`** —— 后者在解码 `<video>` 跨源时会抛 `SecurityError`。若额外跑一次 `toDataURL` 作旁证并抛错，把错误原文记进 JSON 作为「画布被污染」的证据，不判 FAIL。
7. **导出并回放**：触发导出，等待成片文件出现（异步等待，不裸 sleep），抽同名时间点的帧，与第 6 步的画布帧做盒内 SSIM（**W3**），并断言成片能被解码播放（时长/帧数/分辨率符合预期）。

> **选择器与稳定性**：每一步的定位优先用 `data-testid` / `aria-label` / 既有 `role=status`/`role=alert`；失败必须同时落**截图 + DOM 快照**（`DOM.getDocument` + `DOM.getOuterHTML`），否则失败无法离线复盘（§7.1 风险 3）。

---

## 九、节点交接说明（本 DAG 的 #1–#4）

- **节点 #1（评审）——已完成（v1 → v2）**：三项重点复核结论：①§1 源码断言**逐条属实**，无虚构 API、无错行（见 `## 评审记录` R1）；②DD-2/DD-3/DD-4 **可实现**，其中最关键的 FFmpeg contain 规则已用真实 FFmpeg **16/16 实测钉死为纯函数**（R5），H1 由假设升格为已知；③DoD **确实存在两条无法被证伪的条目**（Q1 的「容许例外」逃生门、DoD#9 的「降级也算达成」），已删除。另新查出 3 个 P0（P0-1 钳制分歧使 Q1 按构造不可达、P0-2 行数阈值按构造不可满足、P0-3 E0-c 判据不足以守住 DoD#8）与 7 个 P1，全部就地修复。
- **节点 #2（实现）**：按 §4 施工，先跑 E0 探针再动代码（E0-a/E0-b 已有评审实测结论，仍须复跑落档；**E0-c 必须按加强后的 6 步判据跑，不得只测 `/json/version`**）。**不许**扩大改动面到 §4.3 的禁区。提交前自查仓库 Clean Code 阈值，注意 Q7 口径已按 B0 实测重写。
- **节点 #3（实验）**：按 §2.6 顺序执行 E1–E10，全部产物落 `results/`。发现的真实缺陷就地修并如实记录；**禁止**为了指标好看而更换夹具。
- **节点 #4（终审 + 提交）**：不接受任何一方的断言为真，逐条复核后写 `results/report.md`（§六 DoD#11），按路径逐个 `git add` 后提交。**本轮是最后一轮**，报告末尾必须给出三轮合并后的完整残留清单与移交建议。

---

## 评审结论

**判定：有条件通过（可以进入节点 #2 施工）。**

v1 是一份**方向正确、证据扎实**的计划：它没有借收官轮之名开新战线，选的三件事（G4 盒基准同源、图层放置基准显式化、DoD#8 真闭合）都是前两轮**已登记、未闭合**的实账；§1 的每一条源码断言经逐行回读**全部属实**，这在连续三轮的计划书里是最好的一次。

但它有三处会让本轮**在开工后才发现做不成**的硬伤，全部已就地修复：

1. **P0-1**：主指标 Q1 的「0.000px 恒等」在它自己规定的 D1 夹具矩阵上**按构造不可能达成** —— 预览侧 `computeImageBounds` 对越界盒做钳制、后端完全不钳制，实算分歧 295.5px，比本轮要修的 1.166px 大两个数量级。v1 只盘点了三处量化分歧，漏了这一处**量级最大**的。修复后它反而成了本轮最有价值的产出：一个「拖到边缘的图片所见非所得」的真实用户可见缺陷。
2. **P0-2**：Q7 的「改动文件 ≤800 行」对 §4.2 **强制要改**的文件按构造不可满足（`video_composition_service.py` B0 已 3024 行）。照原文判定，下游只能判失败或偷偷放宽指标 —— 后者正是 L-Q7 要防的事。
3. **P0-3**：E0-c 的判据（`/json/version` 返回 200）**不足以证明 H4**，而它是 DoD#8 闭不闭合的唯一开关。绿灯 E0-c 配死掉的 E9，会让 DoD#8 第三次悬空。

另有 7 个 P1（含两条**使 DoD 不可证伪**的逃生门：Q1 的「容许例外」与 DoD#9 的「降级也算达成」）与 8 个 P2，均已修复或登记。

评审同时**向前多做了一步**：把 v1 押注最重的 E0-b（「FFmpeg contain 取整能否被纯函数复现」）用真实 FFmpeg **实测 16/16 通过**，H1 由假设升格为已知，并给出了可直接进 `overlay-box-golden.json` 的规则与向量。这也顺带证伪了一个会让人少写量化的直觉：**盒比例等于图片比例时 contain 并不恰好填满**（1920×1080 进 634×356 盒实得 633×356，且 `pad_x=floor(1/2)=0` 使画面左偏）。

### 落地条件（节点 #2 / #3 必须满足，缺一即判本轮不合格）

1. **先跑 E0，再动代码**。E0-c 必须按加强后的 6 步端到端判据执行（含真跑一次 `Runtime.evaluate` 与一次 `Page.captureScreenshot`）；握手被拒时先加 `--remote-allow-origins=*` 重试并记录。
2. **D1 必须含 ≥4 个越界盒 + ≥2 个负坐标盒，且不得剔除**（L-Q3 强化）。剔除越界样本等同挑夹具。
3. **DD-9 的取消钳制是一次显式的预览行为变更**，必须有专门守卫测试（向量 `x=0.7143,w=0.44,W=1920 → 844/1920`）+ 报告显式声明，不得作为静默修复混入。
4. **`containRectInBox` 一律在输出像素空间求值**，再按 `previewW/outW` 缩放绘制；契约写进 docstring。
5. **Q7 按重写后的口径判定**，不得再次自行调整（L-Q13）。存量超阈文件净行数增量 ≤0。
6. **W3 抓帧走 `Page.captureScreenshot`**，不得依赖 `canvas.toDataURL()`。
7. **DoD#9 只在 W2+W3 双绿时判达成**；走 §7.2 任一降级 ⇒ 判未达成并写进报告标题行（L-Q12）。
8. **B3 红灯证据对本轮全部新增守卫测试生效**，尤其是 DD-9 的越界向量测试 —— 它在 B0 上必须是红的，否则说明测试没测到东西。

### 未在本轮解决、明确留给移交清单的事项

- `drawFrame` / `_drawOverlays` 这条已无生产调用点的老路径（DD-12 只做标注 + grep 守卫，删除超出收口范围）。
- `computeImageBounds` 在**非量化**调用路径上仍保留钳制，两套语义并存（DD-9③ 的代价，换取改动面可控）。
- §4.2 的两条 SHOULD（`ImageOverlay.tsx` DOM 手柄同栅格、Iter 1 台架 README 过期说明）若未触发，须在报告里量化残差而非略过。

---

## 十、元信息

- 版本：**v2**（节点 #0 产出 v1 → 节点 #1 评审就地修订为 v2）
- v2 变更摘要：新增 `## 评审记录`（P0×3 / P1×7 / P2×8，含一次真实 FFmpeg 实测证据 R5）与 `## 评审结论`；新增 DD-9 ~ DD-12、L-Q11 ~ L-Q13、§7.1 风险 6~8；就地改写 §1.1（三处分歧 → 四处）、§1.2（精确数字）、§2.2（Q1/Q6/Q7/W1/W3）、§2.3（D1/D2/D3）、§2.6（E0-a/b/c）、§4.1、§4.2、§六 DoD 1/3/6/7/8/9、§8 第 6 步、§九 节点 #1/#2。
- 本文件是本 feature 的唯一契约入口。**（R0 修复）feature 定位规则**：下游节点一律以**上游节点输出的 `feature=` 声明**为准（本轮为 `camera-motion-box-parity-and-desktop-walkthrough`）；`ls docs/plans/*/experiment-plan.md` 只作交叉校验，**不可**作为唯一定位手段 —— 该命令当前匹配 3 个目录（三轮各留档一份），机械套用「>1 即 fail」会让收官轮在第一步空转失败。
- 节点 #0 与节点 #1 均未写任何实现代码、未执行 `git add` / `git commit`、未修改任何项目源码；节点 #1 的 FFmpeg 探针只在系统临时目录内运行，未在仓库落任何文件。
