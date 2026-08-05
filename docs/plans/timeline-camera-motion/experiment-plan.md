# Timeline Camera Motion（2D / 3D 运镜特效）实验与实现计划

> feature = `timeline-camera-motion`
> **版本：v2（2026-08-04 评审修订）** ｜ v1 = 节点 #0 初稿，v2 = 节点 #1 评审后就地修复版。
> 本文件是 5 节点串行 DAG 的唯一交接契约。下游节点 #2–#4 通过「`docs/plans/*` 下含 `experiment-plan.md` 的子目录」定位本特性，**不要**靠「最新目录」查找。
> 作者角色：Anthropic research engineer / solution architect。产出定位：Anthropic 级顶级产品品质 —— 美观、优雅、稳健、可靠、符合人机交互最佳实践。
> **下游节点 #2 阅读顺序**：先读 `## 评审记录`（知道哪些结论被推翻），再读 `## 评审结论`（知道必须先做什么），最后按 §3→§4→§7 落代码。v1 中被 v2 推翻的段落已就地改写，正文内以 `✅[R-xx]` 标注修复点。

---

## 评审记录

> 评审维度：可行性 / 完整性 / 一致性 / 规模。评审方法：**不接受 v1 的任何断言为真** —— 逐条回读被引用的源码，并对 FFmpeg 侧做了 4 项**实证探测**（见 §2.5「探测结论」）。
> 严重度定义：**P0** = 按 v1 写法实现出来必然出错或根本无法实现；**P1** = 可实现但指标不可测 / 会让下游改错文件 / 内部自相矛盾；**P2** = 记录性偏差，不阻塞。
> P0 / P1 **全部已就地修复**；P2 仅登记不改（改动收益低于引入的噪音）。

### P0（5 项，全部已修复）

| ID | 问题 | 证据（已回读源码） | 修复 | 状态 |
|----|------|------|------|------|
| **R-P0-1** | §7.1 要求在 `assembleLayers` 里调 `projectQuad()` —— **不可实现**。`projectQuad` 需要画布尺寸与视频固有尺寸，而 `assembleLayers` 拿到的 `ActiveVideoEntry.source` 是 `DrawableVideoSource`，**只暴露 `readyState` 一个字段**，且该模块被显式约束为「零 DOM、零 canvas」；fit-rect 是在 `CanvasCompositor._drawVideoLayer` 内用 `source.videoWidth/videoHeight` + `canvas.width/height` 现算的。 | `internal/assembleLayers.ts:33-47`（`DrawableVideoSource` 只有 `readyState`）、`:8-18` 的 PURE 约束；`CanvasCompositor.ts:296-308` | 几何拆成两段：**时间段**`motionStateAt()`（纯量、无像素，留在 `assembleLayers`，与 `TransitionLayer.alphaFor` 同范式）+ **像素段**`projectQuad(state, fitRect, canvasSize)`（在 `_drawVideoLayer` 内调用，仍是纯函数、可单测）。见 §3.1 / §4.1 / §7.1 | **已修复** |
| **R-P0-2** | 四角顺序与 FFmpeg 不一致。v1 §3.1 定义 `DestQuad = [左上,右上,右下,左下]`（顺时针），若按下标直接写进 `perspective` 的 `x0..x3` 会得到**蝴蝶结形反转**。 | 实测 `ffmpeg -h filter=perspective`：`x0/y0=top left`、`x1/y1=top **right**`、`x2/y2=bottom **left**`、`x3/y3=bottom right` —— 是**光栅序**不是顺时针序 | 冻结全局唯一角序 `Q = [TL, TR, BR, BL]`（TS/Python/黄金向量共用）；Python 发射器**必须**做 `x2←Q[3], x3←Q[2]` 的换位，并由专用单测钉死。见 §3.1 / §4.3 / §7.5 | **已修复** |
| **R-P0-3** | §3.2「3D 露底用黑底 pad」**会遮挡下层轨道**：导出侧 `_overlay_tracks` 是整幅 `overlay=0:0`，上层轨道的黑色露底区会盖住下层；而预览侧上层视频只画自己的四边形，下层是透出的。→ 双轨 + 3D 运镜时预览与成片必然不同。 | `filtergraph_builder.py:319-334`；`CanvasCompositor.renderFrame:232-238`（逐层叠画） | 改为**透明 backdrop**：`format=yuva420p → pad(color=#00000000) → perspective → crop`。已实测：`perspective` **保留 alpha**、越界采样复制的是**透明**边缘像素，下层正确透出（§2.5 探测 3/4）。底层轨道的透明区 RGB=0 → 落地即黑，与预览 letterbox 黑底等价。见 §3.2 / §4.3 | **已修复** |
| **R-P0-4** | 比 L1 更危险的**第二处静默吞特效**：filtergraph 命令一旦返回非 0，调用方**直接 `return False` 回退 concat**，只写一行 `logger.error`，前端完全无感 —— 即「运镜表达式写错 → 用户拿到一条没有特效但『导出成功』的片子」。v1 §4.3 承诺的「兜底=导出失败并报错」被这条既有回退路径架空。 | `video_composition_service.py:225-232`（`falling back to concat`） | 新增硬约束：`request.video_items` 中**任一 clip 带 `camera_motion` 时，filtergraph 失败禁止回退 concat** —— 先按 §4.3 降级阶梯重试一次 2D 影子链并回传 warning，再失败则整单 `failed` + 结构化错误。新增回归测试。见 §4.3 / §7.4 / §9 L11 | **已修复** |
| **R-P0-5** | **M1 两侧比的不是同一个东西**。预览侧变换的是「视频内容 fit-rect」；导出侧 `perspective` 变换的是**已经 scale+pad 成画布尺寸、黑边烤进去的整幅帧**（归一化阶段完成）。竖屏素材放到横屏画布时，两侧的「四角」在语义上不同构，M1 的逐点比较无意义，且导出画面会错。 | `video_composition_service.py:697-700` + `composition/video_scaling.py:135-148`（scale+pad+setsar）；`_compose_videos_filtergraph` 以 `pre_trimmed=True` 调用 builder | 共享真相改为**画布空间的 3×3 单应矩阵 `H`**：黄金向量比较的是 `H` 作用在**画布矩形**四角上的结果（与素材比例无关）；预览侧再用同一个 `H` 作用到 fit-rect 上。见 §3.1 / §2.2 M1 | **已修复** |

### P1（12 项，全部已修复）

| ID | 问题 | 证据 | 修复 | 状态 |
|----|------|------|------|------|
| **R-P1-1** | §4.3「插在 `scale/pad` 之后」在生产路径**不存在该锚点**：`pre_trimmed=True` 时 `_build_clip_chain` 根本不发射 `scale/pad/setsar`。 | `filtergraph_builder.py:163-170`；调用点 `pre_trimmed=True` | 锚点改为「`setpts=PTS-STARTPTS` 之后、`fade` 之前」，并说明 `pre_trimmed=False`（单测形态）下等价于 scale/pad 之后。见 §4.3 | **已修复** |
| **R-P1-2** | `build_filtergraph` 再加 `fps` + `caps` 会变成 **6 个形参**，违反本计划 §7 自己引用的仓库阈值（≤5）。 | 现签名 4 参；CLAUDE.md「函数形参不超过 5 个」 | 引入 `FiltergraphOptions` dataclass（`pre_trimmed / fps / caps / letterbox_color`），签名保持 4 参。见 §7.4 | **已修复** |
| **R-P1-3** | 文件定位错误会让下游**改错文件**：`TimelineItemData` 不在 `domain/ports.ts:40`，而在 `domain/types.ts:40`；L3 说的「双份声明」实为**同文件的两个 interface**：`TimelineItemData`(opacity :64 / transitionIn :80) 与 `CreateItemProps`(opacity :193 / transitionIn :196)。 | `domain/types.ts:40/64/80/168/193/196`；`ports.ts` 内无该 interface | §1.3 表与 §7.2、§9 L3 全部改正。见 §1.3 / §7.2 | **已修复** |
| **R-P1-4** | **M2 不可测**：没写「怎么抓预览帧、用什么算 SSIM、阈值凭什么是 0.97」；且导出侧是先归一化到画布分辨率再放大，预览侧是从原始解码分辨率采样 —— 放大类预设的**锐度天然有差**，0.97 对 zoom-in 不现实。夹具 D2 含 9:16 / 1:1 素材，而上层轨道的黑边在导出侧是**不透明**的（既有行为），会让 M2 因与运镜无关的原因失败。 | `_normalize_video` 先 scale 到 target；`video_scaling.build_video_filter` 用 `pad=...:black` | 给出可执行口径（Playwright/Electron 抓 `captureFrame()` PNG → `ffmpeg -lavfi ssim`）、统一降采样到 640×360 再比、按预设类别分级阈值、并约束「叠加轨夹具必须与画布同比例」。见 §2.2 M2 / §2.3 D2·D3 | **已修复** |
| **R-P1-5** | **M3 的 `droppedFrameRate` 语义错配**：合成器的 `droppedFrames` 统计的是「本帧一个图层都没画出来」，不是掉帧；即使掉到 20fps 它也可能恒为 0，指标形同虚设。 | `CanvasCompositor.renderFrame:240-245` + `_maybeEmitDroppedRate:403-427` | M3 改为三元组：`lastDrawMs` 滚动均值 ≤ 12ms（= `ADAPTIVE_DEGRADE_DRAW_MS`，已核验常量值）**且** `getStats().targetFps` 全程保持 60 **且** rAF 间隔 p95 ≤ 20ms。见 §2.2 M3 | **已修复** |
| **R-P1-6** | **M5「逐字节一致」不可达**：mp4 复用器会写入时间戳/编码器元数据，同输入两次导出也不会字节相同。 | 通用 FFmpeg 行为；`_get_encoding_params` 未加 `-bitexact` | 改为可判定的三条：①无运镜时 `build_filtergraph` 产出的 `filter_complex` 字符串与 `can_use_concat` 与改动前**完全相同**（单测断言）②抽帧 SSIM = 1.000 ③既有 playback/composition 测试全绿。见 §2.2 M5 | **已修复** |
| **R-P1-7** | **intensity 语义与测试自相矛盾**：`state(p)=from+(to-from)·p·intensity` 在 `intensity=0` 时停在 `from`，而 Zoom Out 这类预设的 `from.scale=1.4` 并非恒等 —— §7.5 却写着「intensity=0 恒等」。 | v1 §3.3 与 §7.5 互斥 | 改为**相对中性态**缩放：`state(p) = N + ((from + (to−from)·p) − N)·intensity`，`N` = 中性态（scale 1、其余 0/1）。`intensity=0` → 真恒等；`ensureCoverage` 必须在 intensity 之后算。见 §3.3 | **已修复** |
| **R-P1-8** | **降级 warning 回传链路不存在**：合成是异步任务（`start_video_composition` 立即返回 id，前端轮询 `/compose/{id}/status`），往 `VideoCompositionResponse` 加字段前端**永远收不到**。 | `video_composition_service.py:753/1554`；`video_router.py:195`；`lib/api/videoComposition.ts:226-256` | 链路写全：`self.compositions[id]['warnings']` → `get_composition_status` → `GET /compose/{id}/status` → TS `CompositionStatusResponse.warnings?` → `useVideoExport` 完成分支 `showWarning`。见 §4.3 / §7.4 / §7.3 | **已修复** |
| **R-P1-9** | 「jest/vitest（沿用既有配置）」**落不了地**：本仓库只有 **vitest**，且 `include` 只收 `src/**/*.test.ts(x)`、环境 jsdom。jsdom **没有 WebGL、`drawImage`/`toDataURL` 也是桩** —— `PerspectiveQuadRenderer` 的真渲染断言在单测里做不到。 | `package.json` scripts / devDeps（无 jest、无 playwright）；`vitest.config.ts` include + jsdom | §2.5 写死命令；§7.5 标注每个测试文件的**可测边界**（GL 只测「不可用时降级不抛错」），真渲染验证下沉到桌面 walkthrough。见 §2.5 / §7.5 | **已修复** |
| **R-P1-10** | **D1 黄金向量没有生成器**：谁生成、如何冻结、浮点如何跨语言比较全未定义，§7 的文件清单里也没有这个脚本 —— 下游会各写各的。 | v1 §2.3 D1 与 §7.5 不闭合 | 补 `scripts/gen-camera-motion-golden.mjs`（唯一生成者）+ 固定 6 位小数字符串序列化 + schema + 「TS 侧是回归锁、Python 侧才是跨实现校验」的定位说明。见 §2.3 D1 / §7.5 | **已修复** |
| **R-P1-11** | **同轨像素格式不一致会炸 concat/xfade**：轨内只有部分 clip 转成 `yuva420p`，`concat` / `xfade` 要求各输入参数一致。 | `_compose_track:279-316` | 规则：**轨内任一 clip 带运镜 → 该轨所有 clip 统一 `format=yuva420p`**，并加断言测试。见 §4.3 / §7.5 | **已修复** |
| **R-P1-12** | 「表达式超 4KB 就折线近似」**阈值无依据、且没有真正的兜底**：真正的硬约束是 Windows `CreateProcess` 的 ~32767 字符命令行总长，而本仓库是 `subprocess.run(list)` 直传（不过 shell）。 | `_compose_videos_filtergraph` 用 list 形式 `subprocess.run` | 三级：①单 clip 表达式 ≤ 2KB ②整图 `filter_complex` ≤ 8KB 时内联 ③超过则写临时文件并用 `-/filter_complex <file>`（新版）或 `-filter_complex_script <file>`（旧版，本机实测仍被接受但已标 deprecated），由能力探测二选一。见 §4.3 | **已修复** |

### P2（7 项，登记不改）

| ID | 观察 | 处置 |
|----|------|------|
| **R-P2-1** | 符号/行号漂移：v1 写的 `_compose_with_filtergraph (:196)` 实为 `_compose_videos_filtergraph (:179)`；`TimelineItem.tsx:273` 实为 `:272`。其余引用（`CanvasCompositor.ts:288`、`types.ts:93`、`TimelinePanel.tsx:731`、`useVideoExport.ts:326-345`、`TimelineToolbar.tsx:203-215`）**全部核对属实**。 | 正文已顺手改正符号名；行号不再逐个追平（会随改动漂移），下游以**符号名**为准 |
| **R-P2-2** | i18n 新增文案实际要改**三处**：`src/lib/i18n.ts` 的 TS interface 声明（`effects: string` 在 :432 一带）+ en 对象（:2962 一带）+ zh 对象（:5295 一带）。该文件已 6997 行，远超仓库 800 行阈值。 | §7.3 已补「三处」；文件拆分是既有技术债，**不在本特性范围**，PR 说明里注明即可 |
| **R-P2-3** | 上层轨道的**黑色 letterbox 边在导出侧是不透明的**（归一化 `pad=...:black` 烤进帧里），与预览「只画 fit-rect、下层透出」本就不一致 —— 这是**既有缺陷**，非本特性引入。 | 不在本特性修（会牵动归一化管线）。但 M2 夹具必须绕开它（见 R-P1-4），并在 §9 L13 登记 |
| **R-P2-4** | `captureFrame()` 依赖画布未被跨域污染；若素材是跨域 URL，`toDataURL` 抛异常并返回 `null`。 | D2 夹具强制同源本地素材，已在 §2.3 注明 |
| **R-P2-5** | 桌面打包端的 FFmpeg 未必与本机同版本（本机实测版本见 §2.5）。 | 能力探测本就是运行时执行；walkthrough 时额外记录一次 `ffmpeg -version` 到 results |
| **R-P2-6** | **风险核销**：曾担心「clip 变速会让 `on/fps` 与 clip 本地时间脱钩」。已核验：`playbackRate` 只存在于 `UseVideoPlaybackReturn`（全局播放器控件），**不是 per-clip 属性**，时间轴 item 上没有变速字段。 | 无需防守，记录以免下游重复排查 |
| **R-P2-7** | 规模偏大：29 个源文件 + 8 个测试文件集中在单个「代码开发」节点（#2）。 | 已在 §8 与 `## 评审结论` 给出 **must / stretch 切分**，保证节点 #2 时间不足时仍有可验收的最小闭环 |

---

## 0. 一句话目标

在 Ecliptrix 视频剪辑器里，为时间轴上的**视频片段**增加一套「2D 运镜 / 3D 运镜」特效：有明确的入口按钮 → 打开设计精良的运镜面板 → 选择预设并可视化调参 → **画布预览实时正确呈现** → **导出成片逐帧一致地还原同一运镜**。

---

## 1. 现状勘察（已读代码，事实性结论）

### 1.1 预览链路（唯一路径，已无 v1 / 无 playback-v2 flag）

```
useCompositionPlayback → MultiTrackPlaybackEngine._renderAt(comp, isPlaying)
  ├─ VideoSourcePool.sync(groups, comp)          # 每条视频轨解出当前 <video> 解码元素
  ├─ _buildVideoEntries → activeClipAt()         # 配对「元素 ↔ 当前 clip」
  ├─ assembleLayers()  (internal/assembleLayers.ts, 纯函数)
  │     └─ buildVideoLayers(): opacity = item.opacity × TransitionLayer.alphaFor(clip, t)
  └─ CanvasCompositor.renderFrame(CompositorLayer[])
        └─ _drawVideoLayer(): fitContain(intrinsic → canvas) + ctx.globalAlpha + ctx.drawImage
```

关键事实：

- `CanvasCompositor._drawVideoLayer` 当前是**无变换绘制** —— 只有 `fitContain` 得到的矩形 + `globalAlpha`，没有任何 `setTransform`。这就是 2D 运镜要插入的唯一位置。
- `assembleLayers` 是纯函数、jsdom 可测，是「把时间 `t` 折算成视觉参数」的既有范式（`TransitionLayer.alphaFor` 就住在这里）。运镜的**时间插值**必须沿用同一范式，落在同一层。
- ✅[R-P0-1] **但几何投影不能落在这里**：`assembleLayers` 消费的 `ActiveVideoEntry.source` 类型是 `DrawableVideoSource`，**只有 `readyState` 一个字段**，且模块头部显式约束「PURE：no DOM beyond reading VideoElementLike fields, no canvas」。fit-rect 与画布尺寸只在 `CanvasCompositor._drawVideoLayer` 内可见。因此几何必须**两段式**拆分（§3.1）。
- `CompositorLayer` 的 `video` 变体目前只有 `{ id, source, opacity, z }`（`playback/types.ts:93`）。需要扩展一个运镜字段。
- 画布是 2D context（`getContext('2d')`），**天生无法做真透视**。3D 运镜必须另想办法（见 §4.2）。
- ✅[R-P1-5] `CompositorStats = { drawnFrames, droppedFrames, lastDrawMs, targetFps }`；其中 `droppedFrames` 在 `renderFrame` 里的含义是「本帧没有任何图层画出」，**不是掉帧计数**。自适应降级阈值 `ADAPTIVE_DEGRADE_DRAW_MS = 12`（已核验）。
- `captureFrame(): string | null` 已存在（`canvas.toDataURL('image/png')`），是 M2 抓预览帧的现成钩子；画布被跨域素材污染时返回 `null`。

### 1.2 导出链路（后端 FFmpeg）

```
useVideoExport.ts  →  videoCompositionAPI.composeVideo({ video_items, ... })
  → VideoCompositionRequest / VideoCompositionItem (app/models/video_models.py)
  → video_composition_service._compose_videos_filtergraph (:179)     ✅[R-P2-1] 符号名改正
       └─ build_filtergraph(clips, W, H, pre_trimmed=True)   # composition/filtergraph_builder.py
            └─ _build_clip_chain(): [setpts] → (scale → pad → setsar 仅 pre_trimmed=False) → fade → colorchannelmixer(opacity)
            └─ _compose_track(): xfade / concat
            └─ _overlay_tracks(): overlay 0:0
```

关键事实：

- 导出侧已经是「预览语义的镜像实现」，`filtergraph_builder.py` 的 docstring 明确写着要与 `assembleLayers` + `TransitionLayer.alphaFor` 保持一致。运镜必须遵守同一约定。
- ✅[R-P1-1] **`pre_trimmed=True`（唯一的生产调用形态）下 `_build_clip_chain` 不发射 `scale/pad/setsar`** —— 输入已由 `_normalize_video` 归一化为「画布尺寸 + 黑边烤入 + 固定 fps」。因此运镜滤镜的锚点是「`setpts=PTS-STARTPTS` 之后、`fade` 之前」（几何在画布空间生效，alpha 后置，与预览的「先变换后 alpha」一致）。
- ✅[R-P0-5] 归一化用 `scale + pad=...:black + setsar=1:1`（`composition/video_scaling.py:135-148`）把每个 clip 变成**画布尺寸、黑边已烤入的整幅帧**。这意味着导出侧 `perspective` 变换的对象是**整幅画布帧**，而预览侧变换的是**视频内容 fit-rect** —— 两者必须由同一个**画布空间单应矩阵**导出，而不是各自算一组「四角」。
- `build_filtergraph` 有一条 `can_use_concat=True` 的退化捷径（单轨 + 无转场 + opacity=1）。**若某 clip 带运镜却走了 concat，运镜会被静默丢弃** —— 见 §9 L1。
- ✅[R-P0-4] **还有第二处静默吞特效**：`_compose_videos_filtergraph` 在 FFmpeg 返回非 0 时只写一行 `logger.error` 就 `return False`，调用方转而走 `_concat_videos`。用户会拿到一条「导出成功但没有特效」的片子。见 §9 L11。
- ✅[R-P1-8] 合成是**异步任务**：`start_video_composition` 立刻返回 `composition_id`，前端轮询 `GET /api/video-compose/{id}/status`（BFF）→ 后端 `GET /api/video/compose/{id}/status` → `get_composition_status` 直接返回 `self.compositions[id]` 字典。任何要给用户看的 warning 必须写进这个字典。
- `VideoCompositionItem` 已有 `track_z / transition_in / transition_out / opacity / audio_detached` 这批「预览→导出」透传字段，运镜字段照此模式新增即可，且必须 Optional 以保持向后兼容。
- `VideoCompositionRequest.output_fps: int = 30 (15..60)` 已存在 —— 导出侧把帧序号折算成时间所需的 `fps` **无需新增契约**，直接取该字段。
- ✅[R-P1-9] 导出只有**这一条**管线：所谓「本地导出」（`docs/plans/local-video-editing-refactor/specs/05-local-export-parity.md`）指的是「URL 选同源本地路径 + 后端内置 FFmpeg 直读本地文件」，**不是**另一套渲染器。下游不必寻找第二条导出实现。

### 1.3 数据模型与持久化链路（一个 per-clip 属性要穿过的 9 个接缝）

| # | 位置 | 作用 |
|---|------|------|
| 1 | ✅[R-P1-3] `timeline/domain/types.ts:40` `TimelineItemData` | 领域 DTO（**不在 `ports.ts`**） |
| 2 | `timeline/domain/entities/TimelineItem.ts` | 实体 |
| 3 | ✅[R-P1-3] `timeline/domain/types.ts:168` `CreateItemProps` | **同文件第二个** interface（opacity :193 / transitionIn :196），漏改即类型漂移 |
| 4 | `timeline/store/actions/*` + `historySlice` | 变更动作 + undo/redo |
| 5 | `timeline/infrastructure/TimelineRepository.ts` | 工程存档 save/load |
| 6 | `timeline/infrastructure/CompositionAdapter.ts:~181 / ~335` | 时间轴 → 预览序列 **与** 时间轴 → 导出 payload |
| 7 | `video/types/videoEditingTypes.ts:12` `VideoSequenceItem` | 预览序列项 |
| 8 | `hooks/useVideoExport.ts:~330` | **第二个**导出 payload 构造点（与 #6 并存） |
| 9 | `app/models/video_models.py` `VideoCompositionItem` | 后端契约 |

> ⚠️ 第 6 与第 8 是两处独立构造导出 `video_items` 的代码（已回读确认：`CompositionAdapter` 写 `transition_in: seq.transitionIn`，`useVideoExport` 另写一遍 `transition_in: item.transitionIn`）。运镜字段必须两处都补，否则「预览有、导出无」。

### 1.4 UI 入口（好消息：占位已经存在）

- `TimelineToolbar.tsx` 已有 `id: 'effects'` 按钮，图标齐全，`label = t.timeline.toolbar.effects`（en `Effects` / zh `特效`），快捷键 `E` 已在 i18n 里声明（`effectsShortcut: 'E'`），但当前 `comingSoon: true, disabled: true`。
- `TimelinePanel.tsx:731 handleAddEffect` 目前只弹一句「功能即将上线」。
- `TimelinePanel.tsx:499` 已把 `handleAddEffectRef.current()` 绑到快捷键分发上（`!ctrl && !shift && !alt && 非输入态 && key==='e'`；`Ctrl+E` 已被导出 JSON 占用，不冲突）。
- `TimelineItem.tsx:272 handleContextMenu` 目前被「分离音频」独占（右键即直接执行，无菜单 UI）。

结论：入口链路 **已经贯通，只差实现**。不需要新造按钮位，只需把占位点亮 —— 这正是「优雅、不新增孤岛」的做法。

---

## 2. 实验目标 / 假设 / 指标

### 2.1 假设（Hypothesis）

> **H1（核心）**：2D 运镜与 3D 运镜可以被同一个几何抽象统一 —— ✅[R-P0-5] 「**画布矩形在画布空间里被一个 3×3 单应矩阵 `H` 映射到哪四个点**」。2D 仿射运镜是 `H` 退化为仿射（末行 `[0,0,1]`）的特例。
>
> **H2**：只要预览端与导出端消费**同一个纯几何函数**（TS / Python 双实现 + 共享黄金向量约束），就能在不引入客户端渲染导出的前提下，取得逐帧可测的 WYSIWYG 一致性。
>
> **H3**：3D 透视预览用「按需惰性分配的 WebGL 贴图四边形渲染器 + 结果回贴到既有 2D 合成画布」实现，可以在不重写现有合成器（z 序 / 透明度 / 字幕 / 图片叠加全部保留）的前提下达到 60fps。

H1 是本计划的设计支点：它把「两套特效」压成「一套几何 + 三个渲染后端」，从而让**预览、导出、单测**共用一份真相。

### 2.2 评估指标（Metrics）

| ID | 指标 | 定义（v2 已可执行） | 通过阈值 |
|----|------|------|----------|
| **M1** | 几何一致性 | ✅[R-P0-5] TS `cameraHomography()` 与 Python `camera_homography()` 在 16 预设 × 21 采样时刻上，各自把**画布矩形**四角 `[TL,TR,BR,BL]` 映射后的 8 个坐标，与冻结的黄金向量 D1 逐点比对（画布固定 1920×1080） | 最大偏差 ≤ 0.5 画布像素，且 336 组用例 100% 通过 |
| **M2** | 视觉一致性 | ✅[R-P1-4] 口径：①用 Playwright（或 Electron devtools protocol）在预览暂停到指定 composition time 后取 `compositor.captureFrame()` 的 PNG；②对同一工程导出成片，用 `ffmpeg -ss <t> -i out.mp4 -frames:v 1 ref.png` 抽帧；③**两张图统一 `scale=640:360:flags=bicubic` 后**用 `ffmpeg -i a.png -i b.png -lavfi ssim -f null -` 取 All 值。降采样是为了剥离「导出侧先归一化到画布分辨率再放大」造成的锐度差（该差异与几何正确性无关）。样本 = 6 预设 × 5 时刻 | 分级：2D 非放大类（pan/tilt/roll）≥ 0.97；2D 放大类（zoom-in/Ken Burns）≥ 0.93；3D 类 ≥ 0.90。**任何一格 < 0.85 视为几何错误而非画质差，直接判负** |
| **M3** | 预览性能 | ✅[R-P1-5] 「1 个 3D 运镜 + 2 个 2D 运镜 clip 同屏」连续播放 30s，采集三项：`getStats().lastDrawMs` 的滚动均值、`getStats().targetFps`、rAF 回调间隔分布 | 均值 ≤ 12ms（= `ADAPTIVE_DEGRADE_DRAW_MS`，即不触发 60→30 降级）**且** `targetFps` 全程 = 60 **且** rAF 间隔 p95 ≤ 20ms |
| **M4** | 导出鲁棒性 | 16 个预设各导出一次的成功率；以及 FFmpeg 能力探测缺失时降级路径是否正确告警 | 16/16 成功；降级时**必须**在前端出现可见 warning（经 §4.3 的 status.warnings 链路），禁止静默丢特效；✅[R-P0-4] 且**禁止**在带运镜时回退 concat |
| **M5** | 回归安全 | ✅[R-P1-6] ①无运镜工程下 `build_filtergraph` 产出的 `filter_complex` 字符串与 `can_use_concat` 与改动前**逐字符相同**（单测冻结）②同一无运镜工程改动前/后各导出一次，抽 5 帧 SSIM = 1.000 ③既有 playback / composition 测试全绿 | 三条全部满足（**不再要求逐字节一致** —— mp4 复用器写入时间戳/元数据，字节级不可复现） |
| **M6** | 交互质量 | 面板可全键盘操作、Esc 关闭、焦点陷阱、`prefers-reduced-motion` 生效、en/zh 双语无硬编码字符串、axe 无 critical 违规 | 全部满足 |

### 2.3 数据集（Dataset）

不涉及外部学术数据集。构造一个受控的本地素材夹具集，落在 `docs/plans/timeline-camera-motion/fixtures/`：

- **D1 几何黄金向量**：`camera-motion-golden.json` —— 16 预设 × 21 采样点的期望四角坐标（画布固定 1920×1080，角序 `[TL,TR,BR,BL]`）。
  ✅[R-P1-10] **唯一生成者** = `scripts/gen-camera-motion-golden.mjs`（读 TS 参考实现，`node --experimental-strip-types` 或先 `tsc` 到临时目录），产物人工抽检后冻结、纳入版本控制。序列化约定：所有浮点用 `toFixed(6)` 的**字符串**存储，两侧读入后 `parseFloat` 比较，避免 JS/Python 的 repr 差异伪造出「不一致」。定位说明：**TS 侧断言是回归锁**（自己生成自己校验，只防回归）；**Python 侧才是真正的跨实现校验**（M1 的实质）。
- **D2 视觉夹具**：3 段本地素材（16:9 横屏、9:16 竖屏、1:1 方图各一），每段 6 秒，来自 `static/uploads` 的已缓存素材（**不新增二进制入库**，只记录相对路径与 SHA256）。
  ✅[R-P2-4] 必须是**同源本地**素材：跨域素材会污染画布，`captureFrame()` 返回 `null`，M2 无法采集。
- **D3 工程夹具**：3 份时间轴工程 JSON —— ①单轨单 clip ②双轨叠加 + 运镜 ③运镜 + 转场 + 字幕 + 图片叠加共存。用于 M2 / M4 / M5。
  ✅[R-P1-4] **约束**：②③里参与叠加的**上层轨道素材必须与画布同比例**（用 16:9 素材配 16:9 画布）。原因见 R-P2-3：上层轨道的黑色 letterbox 边在导出侧是不透明的（既有缺陷），用竖屏素材做叠加会让 M2 因与运镜无关的原因失败。9:16 / 1:1 素材只用于**单轨**场景。

### 2.4 基线（Baselines）

- **B0 现状基线**：当前分支构建（无运镜）。用于 M3 性能回归与 M5 导出回归对照。
- **B1 朴素导出基线**：用 FFmpeg `zoompan` 直接实现缩放推拉。已知缺陷：`zoompan` 按输入帧计数推进、对变帧率源易抖动、无法表达 3D 透视。以它作为 M2 的对照，用来证明「统一单应矩阵」方案的必要性而非过度设计。
- **B2 朴素预览基线**：canvas 2D 水平条带切片近似透视。用于证明 §4.2 选择 WebGL 的合理性（条带法在强俯仰角下有可见接缝）。

### 2.5 运行环境

```
environment: local
```

- 全部工作在本地开发机完成：Windows 11（`win32`, 10.0.26200），主工作目录 `M:/takoAI/Ecliptrix`。
- ✅[R-P1-9] **前端测试 = vitest，没有 jest**：
  - `npm test` → `vitest run`（`vitest.config.ts`：环境 jsdom、`setupFiles: ./src/test/setup.ts`、`include: ['src/**/*.test.ts','src/**/*.test.tsx']`）。
  - 因此**所有新增前端测试必须落在 `src/` 下、以 `*.test.ts` 结尾**才会被收集。
  - **jsdom 没有 WebGL，`drawImage`/`toDataURL` 也是桩**：`PerspectiveQuadRenderer` 在单测里只能验证「context 获取失败时降级、不抛错、不返回空帧」；真渲染正确性由桌面 walkthrough + M2 承担。
  - 类型检查 `npm run type-check`；开发服务器 `npm run dev`（:3000）。
- 后端 `backend-services/basic-service/`，venv 激活后 `uvicorn app.main:app --reload --port 8000`；测试 `pytest tests/ -v`。
- 系统依赖：**FFmpeg 必需**（运镜导出的核心）。能力探测在首次导出时执行并进程内缓存。

#### ✅ 探测结论（P0 spike 已在评审阶段完成，节点 #2 不必再阻塞）

本机 `ffmpeg version 2025-05-15-git-12b853530a-full_build-www.gyan.dev`（gyan.dev full build）。四项实测：

| # | 探测项 | 命令 / 方法 | 结论 |
|---|--------|------|------|
| 1 | `perspective` 滤镜与选项 | `ffmpeg -h filter=perspective` | **可用**。含 `sense={source,destination}`、`eval={init,frame}`、`interpolation={linear,cubic}`。**角序为光栅序**：`x0/y0`=左上、`x1/y1`=**右上**、`x2/y2`=**左下**、`x3/y3`=右下 → 见 R-P0-2 |
| 2 | `eval=frame` 是否真的逐帧重算、`on` 变量是否可用 | 以静态图案源 + `x0='on*8'` 连出 3 帧原始像素比对 | **成立**。白条边界每帧精确右移 8px，与 `on*8` 一致 |
| 3 | 是否保留 alpha | `color=black,format=rgba,colorchannelmixer=aa=0.5 → perspective → overlay` 到白底，取首像素 | **保留**。结果 RGB=(127,127,127)，即 50% 混合 —— alpha 未被 perspective 丢弃（`yuva420p` 同样通过，结果 253 的 1LSB 偏差来自色度下采样） |
| 4 | 越界采样行为 | 把源四角映射到画面中央 1/4，取画面角点 | **边缘复制**（非黑、非透明）：角点 = 源边缘色。→ 用**透明 pad** 包裹后，复制到的就是透明像素；实测「透明 pad → perspective → crop → overlay 到红底」时，四边区域正确显示为红底（下层透出），中间为源内容 |

> 因此 §4.3 的降级阶梯**第 1 档在本机成立**，节点 #2 应按第 1 档主路径实现，把第 2/3 档作为运行时探测失败后的分支实现（不必再做前置 spike）。
> ✅[R-P2-5] 打包桌面端的内置 FFmpeg 版本可能不同 —— 能力探测本就是运行时行为；walkthrough 时额外记录一次 `ffmpeg -version` 到 `results/`。

- 最终验收必须包含一次 **Electron 桌面端 walkthrough**（本仓库既有强制门禁：desktop 打包端与 dev 端行为常年不一致，例如 starlette Range、打包 env 覆盖）。
- **不涉及远程主机、不涉及 SSH、不涉及任何私钥**。

---

## 3. 核心设计：一套几何，三个渲染后端

### 3.1 统一抽象 —— 画布空间单应矩阵 `H`　✅[R-P0-1] ✅[R-P0-2] ✅[R-P0-5]

v1 的 `projectQuad(state, sourceFitRect, canvasSize) -> DestQuad` 被**拆成三个纯函数**，原因见 R-P0-1（`assembleLayers` 拿不到画布/固有尺寸）与 R-P0-5（两端变换对象不同构）：

```ts
// ① 时间段：纯量运算，无任何像素概念。住在 assembleLayers（与 alphaFor 同层）。
motionStateAt(motion: CameraMotion, clip: {startTime, duration}, t: number): CameraMotionState

// ② 几何段：画布空间的 3×3 单应矩阵。TS / Python 双实现，M1 的唯一比较对象。
cameraHomography(state: CameraMotionState, canvas: {width, height}): Mat3

// ③ 像素段：把 H 作用到一个矩形上，得到目标四边形。住在 CanvasCompositor / Python 发射器。
applyHomographyToRect(H: Mat3, rect: Rect): DestQuad   // 角序 [TL, TR, BR, BL]
```

**唯一角序约定（全局冻结）**：`DestQuad = [x_TL,y_TL, x_TR,y_TR, x_BR,y_BR, x_BL,y_BL]` —— 顺时针。TS、Python、D1 黄金向量、所有测试**一律**用这个顺序。

- **2D 运镜**（`space: '2d'`）：只用 `scale / offsetX / offsetY / roll` → `H` 的末行恒为 `[0,0,1]`（仿射）→ 可无损降解为 2×3 仿射矩阵。
- **3D 运镜**（`space: '3d'`）：额外用 `yaw / pitch / dolly` → 先在 3D 空间对平面做旋转与推拉，再用固定 FOV 的针孔相机投影 → `H` 末行非零（真透视）。
- **可渲染性守卫**：`isRenderable(H, canvas)` —— 任一角点的齐次分量 `w ≤ ε`（点跑到相机背后）、或四边形自交/非凸时返回 false，此时把 `yaw/pitch` 按二分法钳回最后一个可渲染值。预设表的取值范围必须保证全程可渲染；守卫只防用户在「高级参数」里手动填出病态值。

三个消费者：

| 后端 | 消费方式 |
|------|----------|
| 预览 2D | `A = affineFrom(H)`，`ctx.transform(a,b,c,d,e,f)` 后照旧 `drawImage(source, fit.x, fit.y, fit.w, fit.h)` |
| 预览 3D | `quad = applyHomographyToRect(H, fitRect)` 交给 WebGL 贴图四边形渲染器（真投影插值），结果画布 `drawImage` 回贴到 2D 合成画布 |
| 导出 | `quad = applyHomographyToRect(H, canvasRect)`（**画布矩形**，因为导出侧的输入帧就是整幅画布），再按 FFmpeg 的**光栅角序**发射：`x0←Q.TL, x1←Q.TR, x2←Q.BL, x3←Q.BR` |

> 两端消费的是**同一个 `H`**，只是作用在不同矩形上 —— 这正是 H2 成立的机制，也是 M1 能逐点比较的前提。

### 3.2 覆盖保证（Coverage Guarantee）—— 消除黑边分歧的关键设计　✅[R-P0-3]

运镜若把画面拉小/转开，画布边缘会露底。预览露出的是下层轨道（无下层时是 letterbox 黑）；FFmpeg `perspective` 对越界采样是**边缘复制**（实测确认，§2.5 探测 4）→ 若不处理，二者不一致。

设计决策：

1. **纯 2D 预设强制满覆盖**：几何函数内置 `ensureCoverage()`，对纯 2D 运镜自动预放大基准 scale，使运动窗口内任意时刻四边形都完全覆盖画布（工业界 Ken Burns 的标准做法，CapCut / Premiere 同理）。这样两端都不会露底，天然一致。
   ✅[R-P1-7] `ensureCoverage()` 必须在 **intensity 应用之后**计算（intensity 会放大位移/缩放量，先算会算漏）。
2. **3D 预设允许露底，且用「透明 backdrop」而非黑底**：俯仰/环绕本来就该露出背景。导出侧走
   `format=yuva420p → pad(margin, color=#00000000) → perspective → crop(回画布)`。
   因为 pad 出来的边框是**透明**像素，边缘复制复制到的也是透明 → 与预览「上层视频只画自己的四边形、下层透出」**逐像素等价**。
   - 已实测验证（§2.5 探测 3/4）：透明 pad 方案下，四边区域正确显示下层内容。
   - **底层轨道**同样安全：`#00000000` 的 RGB 分量为 0，编码丢弃 alpha 后即黑，与预览 `letterboxColor` 默认 `#000` 一致。若 `ICanvasViewport.letterboxColor` 被设为非黑，pad 颜色必须取同一颜色的 0 alpha 版本（`FiltergraphOptions.letterbox_color`）。
   - v1 的「黑底 pad」被**否决**：`_overlay_tracks` 是整幅 `overlay=0:0`，不透明黑会盖住下层轨道（R-P0-3）。
3. **margin 由几何函数给出，不再固定 2×**：`backdropMargin(H, canvas) -> {mx, my}`，取四边形超出画布的最大外扩量并向上取偶（yuv420p 色度对齐要求），并夹在 `[0, W/2] × [0, H/2]`。`mx == my == 0` 时**完全跳过 pad/crop**，避免对不需要的 clip 付 4× 像素代价。

这条设计把「两个渲染器的边界行为」从「靠人肉对齐」变成「由几何函数判定并声明」，是本方案稳健性的核心之一。

### 3.3 时间与缓动

- 运镜进度 `p = ease(clamp01((t - clipStart - startRatio·D) / ((endRatio - startRatio)·D)))`，`D` 为 clip 时长。
- 支持 `linear / ease-in / ease-out / ease-in-out`（三次贝塞尔闭式，TS 与 Python 双实现且被 M1 黄金向量约束）。
- ✅[R-P1-7] **状态插值（v2 修正）**：设中性态 `N = { scale:1, offsetX:0, offsetY:0, roll:0, yaw:0, pitch:0, dolly:1 }`，
  ```
  raw(p)   = from + (to − from)·p
  state(p) = N + (raw(p) − N) · intensity          // intensity ∈ [0,2]，默认 1
  ```
  这样 `intensity = 0` → `state ≡ N` → **真恒等**（v1 的 `from + (to−from)·p·intensity` 在 intensity=0 时会停在 `from`，而 Zoom Out 的 `from.scale = 1.4` 并不恒等 —— 与 §7.5 的「intensity=0 恒等」用例直接矛盾）。`intensity = 2` 是对中性态偏移的双倍夸张，语义与 UI 上的「强度」滑杆直觉一致。
- 窗口外：`p<0` 钳到 `state(0)`，`p>1` 钳到 `state(1)`（**保持终态而非跳回**，符合剪辑直觉）。
- 时间基准统一使用 clip 局部时间，与 `TransitionLayer` 的 `TIME_EPSILON = 0.001` 对齐。
- ✅[R-P2-6] 导出侧 clip 局部时间 = `on / output_fps`。已核验时间轴 item **没有 per-clip 变速字段**（`playbackRate` 只在全局播放器控件 `UseVideoPlaybackReturn` 上），因此帧序号与 clip 本地时间严格一一对应，无需额外补偿。

---

## 4. 渲染方案细节

### 4.1 预览 —— 2D　✅[R-P0-1]

`assembleLayers.buildVideoLayers()` 只挂**时间段**结果（无像素）：

```ts
layers.push({ kind:'video', id, source, opacity, z,
              motion: clip.cameraMotion ? { space, state: motionStateAt(clip.cameraMotion, clip, t) } : undefined });
```

`CanvasCompositor._drawVideoLayer` 里做**像素段**（此处才有 `canvas` 与 `fit`）：

```ts
const fit = fitContain({ sourceWidth: intrinsicW, sourceHeight: intrinsicH,
                         destWidth: canvas.width, destHeight: canvas.height });   // 与现状完全一致，不传 targetAspectRatio
ctx.save();
ctx.globalAlpha = clamp01(layer.opacity);
if (layer.motion?.space === '2d') {
  const H = cameraHomography(layer.motion.state, { width: canvas.width, height: canvas.height });
  const a = affineFrom(H);
  ctx.transform(a[0], a[1], a[2], a[3], a[4], a[5]);   // ← 必须是 transform（左乘叠加），不是 setTransform
}
ctx.drawImage(source, fit.x, fit.y, fit.width, fit.height);
ctx.restore();
```

✅[R-P1-x/一致性] v1 写的是 `ctx.setTransform(...)` 并注释「叠加在既有 DPR/画布变换之上」—— **`setTransform` 是替换语义，不是叠加**。当前 `CanvasCompositor` 恰好没有画布级 DPR 变换，所以 v1 写法暂时不会出错；但 `MotionPreviewThumb`（迷你预览）会在 DPR 缩放过的画布上复用同一段几何，用 `setTransform` 就会静默丢掉 DPR。统一用 `ctx.transform` 是唯一正确写法。

`fitContain` 的调用参数必须与现状**逐字一致**（不传 `targetAspectRatio`）—— 这是 `_drawVideoLayer` 与 `_baseFit` 的既有差异，改动它会引入与本特性无关的画面变化。

成本近似为零；无运镜时矩阵为单位阵、分支不进入，`M5` 回归因此天然成立。

### 4.2 预览 —— 3D（WebGL 贴图四边形）

新增 `PerspectiveQuadRenderer.ts`：

- 惰性分配：**只有当前时间轴存在至少一个 `space:'3d'` 运镜时**才创建离屏 canvas + WebGL context；全部移除后释放。
- 每帧：`texImage2D(video)` 上传当前帧 → 以 `applyHomographyToRect(H, fitRect)` 得到的四角为顶点，配合正确的透视校正插值（顶点携带 `w` 分量，片元用 `q` 做透视除法）绘制 → 主合成器 `ctx.drawImage(glCanvas, 0, 0)`。
- **不接管合成器**：z 序、透明度、字幕层、图片叠加层、转场 alpha 全部仍由 `CanvasCompositor` 掌管。GL 只负责「把这一层视频画成一个透视四边形」，输出一张带 alpha 的位图。这保证了新代码是**加法**而非重写，符合仓库既有分层。
- 降级：`getContext('webgl2'||'webgl')` 失败 → 退回 2D 仿射「影子」（保留 scale/平移/roll 包络，丢弃透视前缩），并 `console.warn` 一次 + 在预览调试面板打点。**永不黑屏** —— 这是本仓库反复踩过的坑（见 `docs/diagnoses/preview-seek-blackscreen-*`），必须显式承诺。
- ✅[R-P1-9] **可测边界**：jsdom 无 WebGL，单测只能覆盖「context 获取失败 → 返回 null → `_drawVideoLayer` 走 2D 影子分支 → 仍返回 true（画出了东西）」。真渲染由 M2 + 桌面 walkthrough 承担，测试文件里必须写明这一点，不要用 mock 伪造「GL 渲染正确」的假绿。

被否决的备选 B2（canvas 2D 条带切片）：强俯仰角下条带接缝可见、且 CPU 成本随条带数线性上升，与「顶级」不符。

### 4.3 导出 —— FFmpeg　✅[R-P1-1] ✅[R-P0-3] ✅[R-P1-11] ✅[R-P1-12] ✅[R-P0-4]

每个带运镜的 clip，在 `_build_clip_chain` 的 **`setpts=PTS-STARTPTS` 之后、`fade` 之前**插入（`pre_trimmed=True` 下没有 `scale/pad` 可言；`pre_trimmed=False` 的单测形态里，该位置正好等价于 scale/pad 之后）：

```
format=yuva420p                                                   # 轨内统一，见下
[可选] pad=W+2*mx:H+2*my:mx:my:color=#00000000                     # 仅 mx/my > 0（3D 露底）
       perspective=x0=<TL.x>:y0=<TL.y>:x1=<TR.x>:y1=<TR.y>
                  :x2=<BL.x>:y2=<BL.y>:x3=<BR.x>:y3=<BR.y>
                  :sense=destination:eval=frame:interpolation=cubic
[可选] crop=W:H:mx:my
```

- ✅[R-P0-2] **角点映射必须换位**：几何给的是顺时针 `Q=[TL,TR,BR,BL]`，FFmpeg 要的是光栅序 —— `x2/y2` 接 `Q[3]`(BL)、`x3/y3` 接 `Q[2]`(BR)。按下标直传会得到蝴蝶结形反转。专用单测钉死。
- **坐标系**：套了 pad 时，8 个角点坐标必须在 **padded 空间**里表达（各自 `+mx` / `+my`），`crop` 再取回中心。
- 8 个角点均为**以帧序号 `on` 表达的时间函数**（导出已归一化为固定 `output_fps`，`t = on/fps`）。表达式由 Python 侧 `camera_motion.py` 生成，其数学与 TS `cameraHomography` 一一对应。
- ✅[R-P1-11] **轨内像素格式统一**：`concat` / `xfade` 要求各输入参数一致。规则 —— **某轨内任一 clip 带运镜，则该轨所有 clip 都插入 `format=yuva420p`**（无运镜的 clip 只加这一个滤镜，不加 pad/perspective/crop）。
- ✅[R-P1-12] **表达式长度三级控制**（v1 的「4KB」无依据）：
  1. 单 clip 的 8 个表达式合计 ≤ **2KB**：直接内联。
  2. 超过 → 对运动窗口均匀取 N 点做**分段线性近似**（用嵌套 `if(lt(on,·),·,·)` 或 `lerp` 展开），并记 info 日志。
  3. 整图 `filter_complex` > **8KB** → 写临时文件，用 `-/filter_complex <file>`（新版）或 `-filter_complex_script <file>`（旧版；本机实测仍被接受，已标 deprecated），由能力探测二选一。
     真正的硬约束是 Windows `CreateProcess` 的 ~32767 字符命令行总长；本仓库用 `subprocess.run(list)` 直传（不过 shell），所以 8KB 阈值留了充足余量。

**降级阶梯（M4 的被测对象）**：

1. **首选**：`perspective` 且支持 `eval=frame` → 2D/3D 全支持，逐帧精确。✅ **本机实测成立**（§2.5），节点 #2 直接按此实现主路径。
2. **次选**（探测到 `perspective` 无 `eval=frame`）：2D 运镜改走 `scale`（超采样）+ `crop`（`t` 表达式）+ `rotate`（`t` 表达式）；3D 运镜降级为其 2D 仿射影子，**并回传一条结构化 warning**。
3. **兜底**（`perspective` 完全不可用且 2D 链也失败）：**整单导出失败并给出可执行的错误信息**（缺哪个滤镜、建议的 FFmpeg 版本），绝不静默产出「看起来没加特效」的成片。

✅[R-P0-4] **禁止静默回退 concat（新增硬约束）**：`_compose_videos_filtergraph` 现有的「FFmpeg 非 0 → `return False` → 调用方走 `_concat_videos`」路径，在**任一 clip 带 `camera_motion`** 时必须被切断：

```
if any(item.camera_motion for item in request.video_items):
    # 先按第 2 档重建一次 2D 影子链重试；仍失败 → raise，不得 return False
```

并把降级/失败原因写进合成状态字典（下条）。

✅[R-P1-8] **warning 回传链路（逐跳写全，缺一跳前端就看不见）**：

```
build_filtergraph → FiltergraphResult.warnings: list[str]
  → _compose_videos_filtergraph 收集
  → self.compositions[composition_id]['warnings'] = [...]
  → get_composition_status() 原样返回该字典
  → GET /api/video/compose/{id}/status（前端经 BFF /api/video-compose/{id}/status）
  → TS CompositionStatusResponse.warnings?: string[]
  → useVideoExport 的完成分支 showWarning(t.timeline.cameraMotion.exportDegraded3d)
```

能力探测放在新文件 `composition/ffmpeg_caps.py`，进程内缓存，单次 `ffmpeg -filters` + `ffmpeg -h filter=perspective` 解析（探测 `eval` / `sense` 两个选项名是否出现在帮助文本里）。

---

## 5. 数据模型（新增契约）

```ts
export type CameraMotionSpace = '2d' | '3d';
export type CameraMotionEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

/**
 * 运镜的一个端点状态。2D 预设只使用前 4 个字段。
 * 中性态 N = { scale:1, offsetX:0, offsetY:0, roll:0, yaw:0, pitch:0, dolly:1 }，
 * intensity 缩放的是「相对 N 的偏移量」（见 §3.3）。
 */
export interface CameraMotionState {
  scale: number;    // 1 = 恰好 fit
  offsetX: number;  // 归一化 [-1,1]，相对画布宽
  offsetY: number;  // 归一化 [-1,1]，相对画布高
  roll: number;     // 度，画面内旋转
  yaw: number;      // 度，绕 Y 轴（3D）
  pitch: number;    // 度，绕 X 轴（3D）
  dolly: number;    // 相机距离倍率，1 = 中性（3D）
}

export interface CameraMotion {
  presetId: string;              // 'zoom-in' | 'orbit-left' | ... | 'custom'
  space: CameraMotionSpace;
  from: CameraMotionState;
  to: CameraMotionState;
  easing: CameraMotionEasing;
  startRatio: number;            // [0,1)，运动在 clip 内的起点
  endRatio: number;              // (startRatio,1]，终点
  intensity: number;             // [0,2]，对「相对中性态偏移」的整体缩放
}

/** 3×3 行主序单应矩阵；2D 时末行恒为 [0,0,1]。 */
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

/** 目标四边形，角序固定为 [TL, TR, BR, BL]（顺时针）。 */
export type DestQuad = readonly [number, number, number, number, number, number, number, number];
```

✅[R-P0-5] `offsetX/offsetY` 的归一化基准从 v1 的「fit 宽/高」改为「**画布宽/高**」—— 几何统一在画布空间，基准必须也是画布，否则同一预设在横屏/竖屏素材上位移量不同，导出侧无从复现。

后端镜像（`video_models.py`）：`CameraMotionState` / `CameraMotionSpec`（snake_case 字段），全部 Optional，缺省即「无运镜」。字段校验：`0 <= start_ratio < end_ratio <= 1`、`0 <= intensity <= 2`、`space in {'2d','3d'}`、`scale > 0`、`dolly > 0`。

**版本与兼容**：所有新字段 Optional；老工程 JSON 读入后 `cameraMotion === undefined`；老前端读新工程时忽略该字段仍可播放（只是没有运镜）。不引入 schema 版本号。

---

## 6. UI / UX 设计（人机交互最佳实践）

### 6.1 入口

1. **工具栏「特效」按钮**（`TimelineToolbar.tsx` 现有占位）：移除 `comingSoon/disabled`；改为「未选中视频片段时 disabled + tooltip 提示先选片段」，选中后可用，快捷键 `E`（已声明，且与 `Ctrl+E` 导出 JSON 不冲突）。
2. **片段右键菜单**：`TimelineItem.tsx:272` 现在被「分离音频」独占且无菜单 UI。改为渲染一个真正的轻量上下文菜单（`分离音频 / 添加运镜… / 移除运镜`），保留原行为为菜单项之一。这修掉一个既有的交互怪味（右键=直接执行破坏性操作，无确认、无发现性）。
3. **片段徽标**：已应用运镜的 clip 在时间轴上显示一枚小徽标（复用 `MaterialCacheBadge` / `TimelineItemDownloadOverlay` 的既有徽标语汇），hover 显示预设名。可发现性 + 状态可见性。

### 6.2 运镜面板 `CameraMotionModal`

布局（对齐既有 modal 设计语言：shadcn/ui new-york、CSS 变量、class 暗色模式；参考同目录已有的 `MediaPreviewModal/PreviewModalShell`、`VideoCoverModal` 的壳层写法，不另造轮子）：

```
┌──────────────────────────────────────────────────────────┐
│  运镜  Camera Motion              [片段名 · 时长]     ✕  │
├───────────────────────────┬──────────────────────────────┤
│  ⟨ 2D 运镜 ⟩ ⟨ 3D 运镜 ⟩   │   实时预览（循环播放当前设置）│
│  ┌────┐┌────┐┌────┐┌────┐ │   ──────────────────────────  │
│  │推近││拉远││左摇││右摇│ │   强度  ●────────  1.00      │
│  └────┘└────┘└────┘└────┘ │   缓动  [缓入缓出 ▾]         │
│  ┌────┐┌────┐┌────┐┌────┐ │   区间  ├───●──────●──┤      │
│  │上移││下移││旋进││KB  │ │   方向  [ 反转 ]             │
│  └────┘└────┘└────┘└────┘ │   ▸ 高级参数（数值微调）      │
├───────────────────────────┴──────────────────────────────┤
│  [ 移除运镜 ]                        [ 取消 ]  [ 应用 ]   │
└──────────────────────────────────────────────────────────┘
```

**预设清单（16 个，各 8 个）**

- 2D：推近 Zoom In、拉远 Zoom Out、左摇 Pan Left、右摇 Pan Right、上移 Tilt Up、下移 Tilt Down、旋转推进 Rotate In、Ken Burns（缓推 + 斜向平移）
- 3D：环绕左 Orbit Left、环绕右 Orbit Right、俯冲 Dive、拉升 Crane Up、翻页 Swing In、透视推轨 Dolly In 3D、摇臂 Boom、螺旋 Spiral

✅[R-P2-7] **规模裁剪**：若节点 #2 时间不足，**必须**交付的是每组前 4 个（2D：推近/拉远/左摇/右摇；3D：环绕左/环绕右/俯冲/拉升），其余 8 个是**纯数据表扩展**（`cameraMotionPresets.ts` 加常量即可，不碰任何逻辑），可留给节点 #4。M1/M4 的样本量按实际交付的预设数等比缩减，并在结果报告里注明。

**交互原则**

- **即时反馈**：每个预设卡片是一个 60×34 的迷你 canvas，用该 clip 自己的缩略帧循环演示运镜本身（而非通用示意图）。选中后右侧大预览同步。
- **非破坏性**：调参过程实时驱动主预览画布，但**只有点「应用」才写入 store**（一次 history 记录，`Ctrl+Z` 可整体撤销）。取消/Esc 完整回滚。
- **可发现性**：常用参数（强度/缓动/区间/反转）直出；scale/offset/yaw/pitch/roll/dolly 数值收在「高级」折叠区，避免新手被淹没。
- **无障碍**：焦点陷阱 + Esc 关闭 + 预设网格方向键导航 + `role="radiogroup"`/`aria-checked` + 每个滑杆有 `aria-valuetext`（中文可读值）。
- **尊重系统偏好**：`prefers-reduced-motion: reduce` 时停掉卡片自动循环，改为 hover/focus 才播放。
- **国际化**：所有文案走 `src/lib/i18n.ts`，en + zh 双语齐备，零硬编码。
- **性能守护**：面板打开时最多同时运行 8 个迷你预览（视口内懒启动），避免 16 个 canvas 同时跑掉主线程。

---

## 7. 代码改动计划（Code-change plan）

> 本特性**需要改代码**。下面是精确到文件的计划；下游节点 #2 按此执行。
> 所有新文件遵守仓库 Clean Code 阈值：单文件 ≤ 800 行、单函数 ≤ 50 行、参数 ≤ 5、嵌套 ≤ 4、圈复杂度 ≤ 10。公开 API 必须有 docstring（TS: TSDoc；Python: Google style）。

### 7.1 前端 —— 几何与渲染（纯逻辑，最先落地、最先可测）

| 文件 | 动作 | 内容 |
|------|------|------|
| `src/components/video/playback/CameraMotionLayer.ts` | **新增** | ✅[R-P0-1] 纯函数模块：`progressAt()`、`motionStateAt()`、`cameraHomography()`、`applyHomographyToRect()`、`affineFrom()`、`ensureCoverage()`、`backdropMargin()`、`isRenderable()`。零 DOM、零 canvas。~320 行。 |
| `src/components/video/playback/cameraMotionPresets.ts` | **新增** | 预设的 `from/to` 常量表 + `presetById()`。纯数据。~150 行（按 §6.2 裁剪规则，首版可只含 8 个）。 |
| `src/components/video/playback/PerspectiveQuadRenderer.ts` | **新增** | WebGL 贴图四边形渲染器：`acquire()/release()/render(source, quad, canvasSize): HTMLCanvasElement\|null`。含 context-lost 恢复与不可用降级。~240 行。 |
| `src/components/video/playback/types.ts` | 修改 | `CompositorLayer.video` 增加 `motion?: { space: CameraMotionSpace; state: CameraMotionState }`（**不是** transform/quad —— 像素段不在这一层，见 R-P0-1）；导出 `Mat3` / `DestQuad` / `CameraMotion*` 类型。 |
| `src/components/video/playback/internal/assembleLayers.ts` | 修改 | ✅[R-P0-1] `buildVideoLayers()` 内**只**调 `motionStateAt()`（纯量、无像素），把 `motion` 挂到 video layer 上。保持纯函数、保持 `DrawableVideoSource` 不变宽。 |
| `src/components/video/playback/CanvasCompositor.ts` | 修改 | ✅[R-P0-1] `_drawVideoLayer()` 分三支：无运镜（现状）/ 2D（`cameraHomography` → `affineFrom` → **`ctx.transform`**）/ 3D（委托 `PerspectiveQuadRenderer` 后 `drawImage` 回贴）。新增惰性持有 renderer + `detach()` 里释放。 |
| `src/components/video/playback/index.ts` | 修改 | 导出新模块。 |

### 7.2 前端 —— 数据模型与状态

| 文件 | 动作 | 内容 |
|------|------|------|
| `src/components/video/types/videoEditingTypes.ts` | 修改 | `VideoSequenceItem.cameraMotion?: CameraMotion` |
| ✅[R-P1-3] `src/components/video/timeline/domain/types.ts` | 修改 | **两处都要加**：`TimelineItemData`(:40) 与 `CreateItemProps`(:168) 各加 `cameraMotion?: CameraMotionData`。DTO 层不依赖 playback 模块，按 `SequenceTransitionData` 的既有做法重声明。（v1 误写为 `ports.ts:40`，该文件内无此 interface） |
| `src/components/video/timeline/domain/entities/TimelineItem.ts` | 修改 | 实体字段 + `withCameraMotion()` 不可变更新 |
| `src/components/video/timeline/store/actions/setCameraMotion.ts` | **新增** | `setCameraMotionAction(getState, itemId, motion \| null)`，走 `captureNextState()` 参与 undo/redo。~70 行。 |
| `src/components/video/timeline/store/actions/index.ts`（或 `store/index.ts`） | 修改 | 导出新 action |
| `src/components/video/timeline/infrastructure/TimelineRepository.ts` | 修改 | save 与 load 均透传 `cameraMotion` |
| `src/components/video/timeline/infrastructure/CompositionAdapter.ts` | 修改 | 预览路径（`opacity: item.opacity` 附近，~:181）透传 `cameraMotion`；导出路径（`transition_in: seq.transitionIn` 附近，~:335）映射为 `camera_motion` |

### 7.3 前端 —— UI

| 文件 | 动作 | 内容 |
|------|------|------|
| `src/components/video/components/CameraMotionModal/CameraMotionModal.tsx` | **新增** | 主面板容器：状态、焦点陷阱、Esc、应用/取消/移除。~320 行 |
| `.../CameraMotionModal/PresetGallery.tsx` | **新增** | 2D/3D 分组 + 键盘可达的 radiogroup 网格。~180 行 |
| `.../CameraMotionModal/MotionInspector.tsx` | **新增** | 强度/缓动/区间/反转 + 高级数值区。~220 行 |
| `.../CameraMotionModal/MotionPreviewThumb.tsx` | **新增** | 迷你 canvas 循环预览（复用 `CameraMotionLayer` 几何，视口懒启动、reduced-motion 感知）。**注意此画布带 DPR 缩放 → 必须用 `ctx.transform` 而非 `setTransform`**。~160 行 |
| `.../CameraMotionModal/index.ts` | **新增** | 桶导出 |
| `src/components/video/components/index.ts` | 修改 | 导出 |
| `src/components/video/timeline/TimelineToolbar.tsx` | 修改 | 点亮 `effects` 按钮：去掉 `comingSoon/disabled`，改为「无选中视频片段时禁用 + 提示」 |
| `src/components/video/timeline/TimelinePanel.tsx` | 修改 | `handleAddEffect`（:731）改为打开面板；承载 modal 状态；快捷键 `E` 复用既有 `handleAddEffectRef` 通路 |
| `src/components/video/timeline/TimelineItem.tsx` | 修改 | 右键菜单化（含「添加运镜…/移除运镜」）+ 已应用运镜徽标 |
| `src/components/video/hooks/useVideoExport.ts` | 修改 | ✅ `videoItems.push`（~:330）增加 `camera_motion` 映射（**与 CompositionAdapter 并列的第二处，务必同改**）；✅[R-P1-8] 合成完成分支读取 `status.warnings` 并 `showWarning` |
| `src/lib/api/videoComposition.ts` | 修改 | ✅[R-P1-8] `CompositionStatusResponse` 增加 `warnings?: string[]` |
| `src/lib/i18n.ts` | 修改 | ✅[R-P2-2] 新增 `timeline.cameraMotion.*`（面板全文案 + 预设名 + 降级警告文案）。**三处都要改**：TS interface 声明（:432 一带）、en 对象（:2962 一带）、zh 对象（:5295 一带） |

### 7.4 后端

| 文件 | 动作 | 内容 |
|------|------|------|
| `backend-services/basic-service/app/models/video_models.py` | 修改 | 新增 `CameraMotionState` / `CameraMotionSpec`；`VideoCompositionItem.camera_motion: Optional[CameraMotionSpec]`（校验见 §5） |
| `app/services/composition/camera_motion.py` | **新增** | Python 侧几何：`progress_expr()`、`state_at()`、`camera_homography()`、`apply_homography_to_rect()`、`backdrop_margin()`、`build_motion_filters(spec, canvas, fps) -> list[str]`。纯字符串/纯数学，无 I/O。**角点发射必须做光栅序换位（R-P0-2）**。~320 行 |
| `app/services/composition/ffmpeg_caps.py` | **新增** | `has_perspective_filter()` / `perspective_supports_eval_frame()` / `supports_filter_complex_file()`，进程内缓存。~100 行 |
| `app/services/composition/filtergraph_builder.py` | 修改 | ✅[R-P1-1] `_build_clip_chain()` 在 `setpts` 之后、`fade` 之前插入运镜滤镜；✅[R-P1-11] 轨内任一 clip 带运镜时该轨全员加 `format=yuva420p`；`_track_needs_filtergraph()` 增加「有 camera_motion」判据（**修掉 §9 L1**）；✅[R-P1-2] 新增 `FiltergraphOptions` dataclass（`pre_trimmed / fps / caps / letterbox_color`）取代继续加形参，`build_filtergraph(clips, w, h, options)` 保持 4 参；`FiltergraphResult` 增加 `warnings: List[str]` |
| `app/services/video_composition_service.py` | 修改 | 调用处构造 `FiltergraphOptions(fps=request.output_fps, ...)`；✅[R-P0-4] **带运镜时禁止静默回退 concat**（先重试 2D 影子链，再失败则 raise）；✅[R-P1-12] `filter_complex` > 8KB 时改用文件形式；✅[R-P1-8] 把 warnings 写进 `self.compositions[id]['warnings']` |
| `app/routers/video_router.py` | 修改 | ✅[R-P1-8] `GET /compose/{composition_id}/status` 的返回体带上 `warnings`（当前直接返回状态字典，确认字段不被裁剪即可） |

### 7.5 测试

| 文件（均在 vitest 的 `src/**/*.test.ts` 收集范围内） | 动作 | 覆盖 |
|------|------|------|
| `src/components/video/playback/__tests__/CameraMotionLayer.test.ts` | 新增 | 进度钳位、缓动闭式、✅[R-P1-7] **`intensity=0` → 恒等（对 Zoom Out 这类 `from≠N` 的预设也必须成立）**、覆盖保证（含 intensity 之后计算）、2D 时 `H` 末行 = `[0,0,1]`、`isRenderable` 病态输入、**读 D1 黄金向量断言 M1（TS 侧回归锁）** |
| `src/components/video/playback/__tests__/cameraMotionCompositor.test.ts` | 新增 | `assembleLayers` 只挂 `motion`（不含像素字段）；`_drawVideoLayer` 三分支（mock ctx 断言调用的是 **`transform` 而非 `setTransform`**）；✅[R-P1-9] WebGL 不可用时降级不抛错、`_drawVideoLayer` 仍返回 true（不空帧） |
| `src/components/video/timeline/store/actions/__tests__/setCameraMotion.test.ts` | 新增 | 设置/移除/undo/redo；锁定轨道拒绝写入 |
| `src/components/video/timeline/infrastructure/__tests__/CompositionAdapter.cameraMotion.test.ts` | 新增 | 预览与导出两条路径都带上运镜；无运镜时 payload 与改动前逐字段一致（M5） |
| `src/components/video/hooks/__tests__/useVideoExport.cameraMotion.test.ts` | 新增 | ✅[R-P1-8] 第二处 payload 构造点带上 `camera_motion`；`status.warnings` 非空时调用 `showWarning` |
| `.../infrastructure/__tests__/TimelineRepository.persistence.test.ts` | 修改 | 存档往返保留 `cameraMotion` |
| `backend .../tests/test_camera_motion_geometry.py` | 新增 | ✅ **读同一份 D1 黄金向量**断言 Python 几何与 TS 逐点一致（M1 的实质）；✅[R-P0-2] 单独一条：发射到 `perspective` 选项时 `x2/y2` 取 BL、`x3/y3` 取 BR |
| `backend .../tests/test_camera_motion_filters.py` | 新增 | 滤镜串结构与顺序（`setpts` 后、`fade` 前）；pad/crop 成对出现且 margin 为偶数；pad 颜色是 `#00000000`；表达式长度阈值触发折线近似 |
| `backend .../tests/test_filtergraph_camera_motion.py` | 新增 | ✅ **有运镜时 `can_use_concat` 必须为 False**（L1 护栏）；✅[R-P1-11] 轨内混合时全员 `format=yuva420p`；✅[R-P1-6] **无运镜时 `filter_complex` 字符串与基线逐字符相同**；降级阶梯三档各自的产物 |
| `backend .../tests/test_camera_motion_no_silent_concat.py` | 新增 | ✅[R-P0-4] 带运镜且 FFmpeg 返回非 0 时，**不得**调用 `_concat_videos`；必须抛出结构化错误或产出 warning |
| `scripts/gen-camera-motion-golden.mjs` | **新增** | ✅[R-P1-10] D1 的唯一生成者（6 位小数字符串序列化）；CI/本地手动执行，产物入库 |

**测试纪律（遵仓库规范）**：修 bug 先写可稳定复现的用例；公开行为覆盖正常路径 + 至少一条异常路径；不 mock 高风险路径（几何一致性必须用真实黄金向量，不允许双侧互相 mock；WebGL 真渲染不允许用 mock 伪造通过）。

---

## 8. 分阶段落地（映射到下游节点）

| 阶段 | 内容 | 完成判据 |
|------|------|----------|
| ~~**P0 能力探测 spike（阻塞门禁）**~~ | ✅ **已在评审阶段完成**，结论见 §2.5「探测结论」四项实测。节点 #2 **不再需要**做前置 spike，直接按降级阶梯第 1 档实现主路径 | 已完成（本机 `perspective` 支持 `sense=destination` + `eval=frame` + `on` + alpha + 边缘复制，均实测） |
| **P1 几何内核 + 单测**（must） | §7.1 前两个新文件 + `scripts/gen-camera-motion-golden.mjs` + D1 + TS 侧单测 | M1 的 TS 半边全绿 |
| **P2 预览接入**（must） | §7.1 其余 + §7.2 全部 | 时间轴手改 JSON 注入运镜即可在预览看到；M3 达标 |
| **P3 导出接入**（must） | §7.4 全部 + 后端测试 | M1 的 Python 半边全绿；M2/M4 达标；**R-P0-4 的护栏测试必须绿** |
| **P4 UI 与打磨**（must 最小集 + stretch） | §7.3 全部 + i18n + a11y | M6 达标；Electron 桌面端 walkthrough 通过 |

顺序不可交换：P1 必须先于 P2/P3（几何是双方唯一真相）。

✅[R-P2-7] **规模裁剪线（节点 #2 若时间不足，按此收敛，不要平均降质）**：

- **必须交付（最小可验收闭环）**：P1 + P2 + P3 全部；P4 只做「工具栏按钮点亮 + 面板可开可选可应用可撤销 + 8 个预设 + en/zh 文案」。
- **可延后到节点 #4**：另外 8 个预设（纯常量表）、迷你 canvas 预览卡片（可先用静态示意图占位）、axe 全量无障碍审计。
- **不可裁剪**：R-P0-1~5 的全部修复、L1 与 L11 的两条护栏测试、M1、M5。这几条一旦缺失，特性会以「静默产出错误成片」的方式失败 —— 这是最糟糕的失败模式。

---

## 9. 风险与地雷（必须逐条防守）

- **L1｜`can_use_concat` 静默吞特效**：单轨 + 无转场 + opacity=1 的工程会走 concat 捷径，运镜被丢弃且**没有任何报错**。必须在 `_track_needs_filtergraph()` 加入 camera_motion 判据，并写一条专门的回归测试。
- ✅[R-P0-4] **L11｜filtergraph 失败后静默回退 concat（新增，比 L1 更危险）**：`_compose_videos_filtergraph` 在 FFmpeg 非 0 时 `return False`，调用方转走 `_concat_videos` —— 表达式写错的直接后果是「导出成功但没有特效」。带运镜时必须切断这条回退路径。
- ✅[R-P0-2] **L12｜FFmpeg 角序是光栅序不是顺时针（新增）**：`x2/y2` 是**左下**、`x3/y3` 是右下。按下标直传顺时针数组会得到蝴蝶结形反转，且画面「看起来像某种特效」不易被肉眼判定为 bug。必须有专门单测。
- **L2｜两处导出 payload 构造**：`CompositionAdapter` 与 `useVideoExport` 并存。只改一处 → 「预览有、导出无」。改动清单已把两处并列，测试也各覆盖一次。
- ✅[R-P1-3] **L3｜`domain/types.ts` 的双 interface**：`TimelineItemData`(:40) 与 `CreateItemProps`(:168) 各有一套 opacity/transition 声明，只加一处会造成类型漂移。（v1 误记为「ports.ts + types.ts 两个文件」）
- ✅[R-P0-3] **L4｜`perspective` 越界采样是边缘复制（已实测确认）**。用 §3.2 的覆盖保证 + **透明** backdrop pad/crop 解决 —— 黑色 backdrop 会遮住下层轨道，不要用。
- ✅[R-P2-3] **L13｜上层轨道的 letterbox 黑边在导出侧是不透明的（既有缺陷，非本特性引入）**：归一化 `pad=...:black` 把黑边烤进帧里，`overlay` 时会盖住下层。本特性**不修**，但 M2 夹具必须绕开（叠加轨用与画布同比例的素材），否则会误判为运镜 bug。
- ✅[R-P1-11] **L14｜轨内像素格式不一致会炸 `concat`/`xfade`**：轨内任一 clip 带运镜时，该轨全员统一 `format=yuva420p`。
- **L5｜桌面打包端与 dev 端行为不一致**（本仓库反复踩：starlette Range 差异、打包 env 覆盖）。验收必须包含 Electron walkthrough，不能只跑 `npm run dev`；并记录打包端 `ffmpeg -version`。
- **L6｜预览黑屏回归**。本仓库有多份黑屏诊断报告（`VideoSourcePool` 的 compare-key、seek 守卫等）。运镜代码**绝不允许**在源未 ready 时改变现有 return-false 路径的行为；WebGL 失败必须降级而非抛错。
- ✅[R-P1-12] **L7｜表达式过长**。三级控制：2KB/clip → 折线近似；8KB/整图 → `-/filter_complex <file>`（或旧版 `-filter_complex_script`）。硬边界是 Windows `CreateProcess` 的 ~32767 字符。
- **L8｜性能**：16 个迷你预览 canvas 同时跑会掐死主线程。已设「视口内懒启动 + 最多 8 路」的硬上限。
- **L9｜.gitignore 极简**。本仓库 `.gitignore` 不含 `__pycache__/`、`*.pyc`、`.next/`、`tsconfig.tsbuildinfo`。下游提交节点务必用 `git commit --only <显式路径>`，禁止 `git add -A`。
- **L10｜夹具体积**：D2 视觉夹具**只记录相对路径 + SHA256**，不把视频二进制入库。

---

## 10. Definition of Done

1. 时间轴工具栏「特效」按钮可用（`E` 快捷键），右键菜单与片段徽标齐备。
2. 运镜面板可打开、预设可选、参数可调、实时预览正确、应用/取消/移除/撤销全部正确（预设数量按 §8 裁剪线，至少 8 个）。
3. 预览画布对 2D 与 3D 运镜均**逐帧正确渲染**，且 M3 三项全部达标。
4. 导出成片与预览视觉一致（M2 分级 SSIM 达标），已交付的预设 100% 导出成功（M4）。
5. TS 与 Python 几何在共享黄金向量上逐点一致（M1，比较对象为画布矩形四角）。
6. 无运镜工程零回归（M5 三条），既有 playback / composition 测试全绿。
7. en/zh 文案齐备（i18n 三处同改），无障碍与 reduced-motion 达标（M6）。
8. Electron 桌面端 walkthrough 走通「加运镜 → 预览 → 导出 → 播放成片」全链路。
9. 所有新代码满足仓库 Clean Code 阈值与注释规范；无僵尸代码、无无主 TODO。
10. ✅[R-P0-4] **L1 与 L11 两条「静默吞特效」护栏测试为绿** —— 这是本特性最不可妥协的一条。

---

## 11. 交接说明

- **feature 目录名**：`timeline-camera-motion`
- 下游节点 #2 起，若需要把本计划拆成多份 spec / todos，请在**本目录内**新增（例如 `specs/`、`todos/`、`fixtures/`、`results/`），保持 `experiment-plan.md` 为唯一入口文件。
- 节点 #0 未写任何实现代码；节点 #1（评审）**只改本文件**，未动任何源码、未 `git add` / `git commit`。

---

## 评审结论

**结论：有条件通过（v1 → v2）。**

v1 的架构判断是对的 —— 「一套几何 + 三个渲染后端」「入口占位已贯通」「`can_use_concat` 是最危险的地雷」这三条抓得很准，代码勘察也基本属实（引用的 8 处符号除 2 处外全部核对无误）。但 v1 有 **5 个 P0**：其中 R-P0-1（`assembleLayers` 根本拿不到画布尺寸）与 R-P0-2（FFmpeg 角序是光栅序）会让照着写的代码**直接跑不出正确结果**；R-P0-3（黑底遮挡下层轨）与 R-P0-5（两端变换对象不同构）会让**双轨/非 16:9 场景静默出错**；R-P0-4（filtergraph 失败静默回退 concat）会让**错误以「导出成功」的形式交付给用户** —— 这是本特性最糟糕的失败模式。这些都已在本文件就地修复。

另有 12 个 P1，集中在两类：**指标不可测**（M2 没有测量口径、M3 的 dropped 语义错配、M5 要求不可达的字节一致）与**下游会改错东西**（`ports.ts` 定位错误、`scale/pad` 锚点在生产路径不存在、测试框架写成 "jest/vitest"、warning 回传链路缺三跳）。也已全部就地修复。

评审同时**提前完成了 v1 列为阻塞门禁的 P0 spike**：对 FFmpeg `perspective` 做了 4 项实证探测（`eval=frame` 逐帧生效、`on` 变量可用、alpha 保留、越界为边缘复制），并实测验证了「透明 pad → perspective → crop」能让下层轨道正确透出。节点 #2 因此可以直接进入实现，不必再阻塞。

**落地条件（节点 #2 开工前必须接受）：**

1. **几何两段式不可合并**：`motionStateAt`（时间/纯量，住 `assembleLayers`）与 `cameraHomography`+`applyHomographyToRect`（像素，住 `CanvasCompositor` / Python 发射器）必须分开。任何「把 `projectQuad` 塞进 `assembleLayers`」的写法都会撞上 `DrawableVideoSource` 只有 `readyState` 这堵墙。
2. **角序 `[TL,TR,BR,BL]` 全局唯一**，Python 发射器换位到光栅序，且有专门单测。
3. **两条护栏测试先于功能代码写**：L1（有运镜 → `can_use_concat=False`）与 L11（有运镜 + FFmpeg 失败 → 不回退 concat）。这两条是「静默产出错误成片」的唯一防线，不可延后、不可裁剪。
4. **指标按 §2.2 v2 口径执行**，不要沿用 v1 的 0.97 单一阈值与「逐字节一致」。
5. **规模按 §8 裁剪线收敛**：宁可先交 8 个预设的完整闭环（几何→预览→导出→撤销→双语），也不要交 16 个预设但导出不一致。

满足以上 5 条即视为通过；不满足第 1/2/3 条的实现，节点 #4 评审时应判为不通过并打回。
