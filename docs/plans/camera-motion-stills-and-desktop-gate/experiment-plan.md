# Camera Motion — 静图运镜补全与桌面门禁闭合（实验与实现计划）

> feature = `camera-motion-stills-and-desktop-gate`
> **版本：v2（2026-08-05 节点 #1 评审就地修订）** ｜ 前身：v1（2026-08-05 节点 #0 初稿） ｜ 迭代轮次：**Iteration 2 / 3**
> 作者角色：Anthropic research engineer / solution architect。产出定位：Anthropic 级顶级产品品质 —— 美观、优雅、稳健、可靠、符合人机交互最佳实践。
> 评审状态：**有条件通过**（见文末 `## 评审结论`）。P0×4 / P1×6 全部已就地修复，P2×5 记录在案。

---

## 评审记录（节点 #1，2026-08-05）

> 评审方法：**不接受 v1 的任何断言为真**。文中每一处符号引用都回读了源码；每一条 FFmpeg 行为都在本机真实 ffmpeg 上跑过（`D:\dev-tools\ffmpeg-2025-05-15-git-12b853530a-full_build`，与 §2.5 同一支二进制）。凡本节点实证过的结论，都附了可复现的命令与观测值。
>
> **定位消歧结论**：`ls docs/plans/*/experiment-plan.md` 命中 **2** 个目录。按节点 #0 完成输出 `feature=camera-motion-stills-and-desktop-gate` 与本文件 §「交接消歧」的判据，**本文件是 Iteration 2 的唯一有效契约**；`docs/plans/timeline-camera-motion/`（抬头 `feature = timeline-camera-motion`、版本 v2、已随 `6d0fa57` / `8c702ec` 提交）是 Iteration 1 的只读归档。歧义可判、无需中止（见 P2-15）。

### 总览

| 编号 | 维度 | 严重度 | 一句话 | 状态 |
|------|------|--------|--------|------|
| P0-1 | 一致性 | **P0** | 导出侧核心落点 `_merge_overlays_single_pass` **在仓库中不存在**；真实拓扑是「三入口 + 一条静默回退梯」 | **已修复** |
| P0-2 | 可行性 | **P0** | v1 自封的 P0 spike（`perspective` 是否支持 `t`）未决，且被设为节点 #2 的开工前置 | **已修复（本节点实证结案）** |
| P0-3 | 完备性 | **P0** | `ensureCoverage` 对静图的语义**从未定义**，v1 却直接复用 `motionStateAt`；且 N1/N2 对该缺陷**结构性失明** | **已修复** |
| P0-4 | 完备性 | **P0** | L-I2 的真正落点（编排块 + 回退梯）不在 §7.4 清单里；今天图片叠加失败就是「记一行日志 → 成片照样 completed」 | **已修复** |
| P1-5 | 一致性 | P1 | §1.3 证据 2 对 `extractVideoSequences` 的断言与源码**相反** → L14 是幻影地雷 | **已修复** |
| P1-6 | 一致性 | P1 | `PerspectiveQuadRenderer` 没有 `dispose()`，实为 `release()`；N5-③ 计数口径不可测 | **已修复** |
| P1-7 | 可行性 | P1 | 预览盒基准（letterbox fit-rect）与导出盒基准（整帧百分比）**本就不同源** → 会污染 N1/N2 | **已修复（新增 N0 前置基线）** |
| P1-8 | 右尺寸 | P1 | 方案 A 下 `pad(margin)+crop` 经实证为 **no-op**，只留下坐标系偏移陷阱 | **已修复** |
| P1-9 | 完备性 | P1 | G3 定级过低：`GUARD_CANVAS` 还经 `isMotionRenderable → ensureCoverage` 影响 Apply 门禁 | **已修复（P2 → P1）** |
| P1-10 | 可行性 | P1 | 叠加通道的 `fps` 无处可取：两个真实函数的签名里**都没有 fps**，§7.4 未提签名改造 | **已修复** |
| P2-11 | 可行性 | P2 | R4 缺实证数据 | 已补实证，仍留 STRETCH |
| P2-12 | 一致性 | P2 | §3.1 的 `scale=W:H` 记号与 §3.3 的 `bw:bh` 打架 | 已统一 |
| P2-13 | 完备性 | P2 | `ImagePosition.rotation` 两侧均忽略，未登记为不变量 | 已登记 |
| P2-14 | 完备性 | P2 | `results/env.json` 的 schema 未定义 | 已定义最小字段集 |
| P2-15 | 可行性 | P2 | 下游若按「唯一目录」硬判定位会直接 fail | 已给判据 |

---

### P0-1 ｜ 导出侧核心落点是一个不存在的符号（虚构 API）

**证据**：`grep -rn "_merge_overlays_single_pass" app/ tests/` → **0 命中**；`grep -rn "single_pass" app/` → **0 命中**。

v1 在 **5 处**把 `_merge_overlays_single_pass` 当作既有函数引用（§2.3 D4、§3.1 理由 3、§3.3、§7.4-19、§9 L1），并据此推出「D4 夹具必须带字幕」「两条路必须同源」「27 号测试断言两路逐字符相同」以及 DoD #2。**这个函数不存在**，因此上述推论全部建立在一张错误的地图上。

`app/services/video_composition_service.py` 的真实拓扑（本节点实读）：

| 真实符号 | 触发条件 | 作用 |
|----------|----------|------|
| `_process_overlays_and_subtitles_combined(image_items, subtitle_items, …)`（:2523） | `has_images and has_subtitles` | 图片叠加 + 字幕合成**单趟**编码 |
| `_process_image_overlays(image_items, …)`（:2662） | `has_images and not has_subtitles` | 仅图片叠加 |
| `_process_overlays_sequential(all_image_items, request, …)`（:2500） | **上面第一条失败或抛异常时的回退**（:1589 / :1595） | 内部**再次调用** `_process_image_overlays`，然后单独跑字幕 |

**比 v1 设想的更危险**：这不是「两条平行路径」，而是「三入口 + 一条会把 combined 静默降级到 sequential 的回退梯」。也就是说，即使两个发射点都接了运镜，`combined` 失败时仍会**悄悄换一条路重跑**，而 :1583–:1595 的处理是 `logger.warning` + 继续 —— 用户拿到的是一个「成功」的成片。这正是 L-I2 要防的失败模式，v1 却因为地图错误没有把这条梯子算进来。

**修复**：§2.3 D4、§3.1、§3.3、§7.4-19、§9 L1 全部改用真实符号，并把回退梯写进 L1 与 L-I2 的防守面（见 P0-4）。

---

### P0-2 ｜ P0 spike 已实证结案：`perspective` 不支持 `t`，`on` 可用

v1 §3.3 把这条 spike 定为「节点 #1 必须在评审阶段实证，节点 #2 开工前必须有结论」。**本节点已执行，结论如下**（`ffmpeg -hide_banner`，`testsrc2=size=320x180:rate=25:duration=1`，`eval=frame:sense=destination`）：

| 探针 | 表达式 | 退出码 | 结论 |
|------|--------|--------|------|
| S1 | `x0='0+on'` | **0** | `on` **可用** |
| S2 | `x0='0+t'` | **-22（Invalid argument）** | `t` **不可用** —— v1 的猜测被证实 |
| S5 | `x0='0+on*8'`，抽第 0 / 第 9 帧 | 0 | 两帧字节**不同** → `eval=frame` 确实逐帧重算，不是只算一次 |

`ffmpeg -h filter=perspective` 的 AVOptions 也确认：`x0..y3` 均为 `<string>` 且带 `F`（可按帧求值）标志，`eval` 有 `init` / `frame` 两档，`sense` 有 `source` / `destination` 两档 —— 与 Iteration 1 的用法一致。

**结论：`on/fps` 方案成立，节点 #2 的开工前置已解除。** 同时确认了 v1 的自律选择是对的：即使 `t` 将来可用也不改用，少一个变量少一处分叉。

---

### P0-3 ｜ `ensureCoverage` 对静图语义未定义，且现有指标看不见这个缺陷

**证据**（`CameraMotionLayer.ts` 实读）：

```
motionStateAt(motion, clip, t, canvasAspect = 16/9)   // :268
  → const coverage = ensureCoverage(motion, canvasAspect)   // :276
  → return coverage > 1 ? { ...state, scale: state.scale * coverage } : state
ensureCoverage(motion, canvasAspect)                  // :230
  → if (motion.space !== '2d') return 1               // 只影响 2D
isMotionRenderable(motion, canvas)                    // :491 → :493 也调 ensureCoverage
```

`ensureCoverage` 是为**视频**立的规矩：2D 平移/缩放不得把画布边缘露出黑边，所以把 `scale` 抬到刚好覆盖。v1 §3.2 让静图直接复用 `motionStateAt`，于是这条规矩被**无声地继承**到静图上 —— 但静图是**叠加层**，它的盒周围本来就是透明 pad，"露出下层"恰恰是特性而不是缺陷。

具体后果：一个 `offsetX = 0.1` 的纯平移预设，在 `scale = 1` 时 `ensureCoverage` 会算出 `k = 2×|0.5+0.1| / 1 = 1.2`，把静图**放大 20%**。用户选的是「横移」，得到的是「边放大边横移」。**而 Ken Burns（2D）正是本轮的旗舰场景**，也就是说旗舰场景恰好落在这条未定义语义上。

**为什么两条指标都抓不到**：
- **N1** 比的是 TS ↔ Python 四角。两侧都会调各自的 `ensureCoverage`，**一起错**，偏差仍是 0 → 全绿。
- **N2** 比的是预览 ↔ 成片 SSIM。两侧几何同源，**一起错**，SSIM 仍然很高 → 全绿。

一个所有既定指标都结构性失明的缺陷，是本轮最需要评审拦下的东西。

**修复**：把它升级为一个**必须显式决策的契约**，拆成两个子问题分别定死，并新增一条**能看见它**的断言（N1-c）：

- **(a) 是否启用**：静图默认 **不启用**画布级 coverage（`enforceCoverage = false`），因为叠加层的透明 pad 与「露出下层」是既定语义（§3.4 与 N3 都建立在这上面）。
- **(b) 若启用，aspect 取谁**：**必须取盒长宽比 `box.width / box.height`，不是画布长宽比**。这是更隐蔽的一半 —— 即便决定启用，传错 aspect 也会让 TS / Python 一起算出同一个错误倍率，N1 依旧全绿。

实现约束：`motionStateAt` 增加**可选**第 5 参 `enforceCoverage: boolean = true`，Python `state_at` 镜像同名同默认的关键字参数。默认值保持 `true` ⇒ **视频侧调用点一个字不用改，H1 的「逐位相同」由构造保持**（N4-① 仍然成立）。`isMotionRenderable` 同样要跟随该策略，否则面板门禁与真实渲染判的不是同一件事（与 P1-9 合流）。

---

### P0-4 ｜ L-I2 的真正落点不在改动清单里；今天的失败路径就是静默的

**证据**（`video_composition_service.py` :1596–:1613 实读）：

```python
elif has_images:
    success = self._process_image_overlays(...)
    if success and os.path.exists(video_with_images_path):
        os.replace(...)
    else:
        logger.warning("Image overlay processing did not produce output file")   # ← 然后什么都不做
except Exception as e:
    logger.error(...)                                                            # ← 然后什么都不做
# → 继续走到 :1638 composition_update = {"status": "completed", ...}
```

也就是说：**图片叠加整体失败 → 一行日志 → 合成标记 `completed` → 用户下载到一个没有任何图片的"成功"成片**。加上 P0-1 揭示的 combined→sequential 回退梯，静默面比 v1 设想的更大。

v1 §7.4-19 只写了「两个发射函数均调用 17 号发射器；实现 L-I1 / L-I2 护栏」，**但真正要改的是编排块本身**（:1564–:1613）与 `_process_overlays_sequential`。发射器改对了、编排块不改，L-I2 依然是空文。

**修复**：§7.4-19 展开为 4 个具体落点（combined / image-only / sequential 回退 / 编排块的成败判定），并在 §5 写清 L-I2 的判定位置必须是**编排块**（唯一能把 `composition_id` 标成 `failed` 的地方）。

**顺带核实（结论是好消息）**：v1 说 warning 回传链路「Iteration 1 已打通，本轮只是复用」—— 属实，且**终点是用户可见的**，不是只写日志：

```
compositions[id]["warnings"]                       (video_composition_service.py:1465-1466)
  → video_router.py:247-248  safe_info["warnings"]
  → videoComposition.ts:216  warnings?: string[]
  → useVideoExport.ts:701-703  logger.warn(...) + showWarning(t.timeline.cameraMotion.exportDegraded, 8000)
```

（v1 把承载体写成 `CompositionStatusResponse.warnings`，实际是 `video_router` 组装的 `safe_info` dict + 前端 `videoComposition.ts` 的类型；已在 §5 就地更正为真实符号。）

---

### P1-5 ｜ §1.3 证据 2 对 `extractVideoSequences` 的断言与源码相反

v1 原文：「该函数只过滤 `item.type !== 'video' || !item.materialId`，**不排除图片素材**」，并据此推出「运镜挂在一个永远画不出来的图层上」，再据此立了 L14。

**源码**（`CompositionAdapter.ts:117` 起）：

```ts
if (item.type !== 'video' || !item.materialId) continue;
const material = materials.find((m) => m.id === item.materialId) as ... ;
if (!material || material.type !== 'video') continue;      // ← 图片素材在这里就被排除了
```

**图片不会进 `videoSequences`。** 因此「同一图层被画两次」的冗余不存在，L14 是一条幻影地雷 —— 它会让节点 #2 为一个不存在的现象写测试、并在代码里登记一条不实注释。

**这不动摇 G1 的结论**：证据 2 的前半段（`ImageOverlayInput` 无 `cameraMotion` 字段、`buildImageOverlayInputs` 不透传）已由本节点独立复核为真，单凭它就足以证明「预览侧丢弃」。已就地删掉错误的后半段并重写 L14。

---

### P1-6 ｜ `PerspectiveQuadRenderer` 没有 `dispose()`

**证据**：`PerspectiveQuadRenderer.ts` 的公开方法只有 `isUnavailable()`（:97）、`acquire()`（:106）、`render()`（:129）、`release()`（:158）；`grep -n "dispose"` → **0 命中**。

v1 §4 写「面板关闭 / 卸载即 `dispose()`」，N5-③ 写「`acquire`/`dispose` 计数配平」。按 v1 写，节点 #2 会调一个不存在的方法（tsc 立刻报错），节点 #3 会去测一个不存在的计数口径。已就地改为 `release()`，并把 N5-③ 的口径改写成可测形式（`acquire()` 返回值 + `release()` 调用次数 + `isUnavailable()`）。

---

### P1-7 ｜ 预览盒与导出盒的**基准不同源**（新缺口 G4）

这是 v1 完全没有提到、但会直接把 N1/N2 打穿的一条。

| | 盒原点/尺寸的基准 | 证据 |
|---|---|---|
| **预览** | 画布的 **letterbox fit-rect**（最底层就绪视频按 `fitContain` 算出的内嵌矩形），无就绪视频时才回落整画布 | `CanvasCompositor._baseFit`（:265-281）→ `_drawImageLayer(ctx, fit, layer)`（:295）→ `boxX = fit.x + layer.bounds.x * fit.width`（:401-404） |
| **导出** | **整帧**百分比 | `_process_image_overlays`：`x = int(pos.x * video_width)`、`w = int(pos.width * video_width)` |

当视频的固有比例与工程画布比例一致时（常见路径），`fitContain` 给出整画布，两者重合 —— 这也是它至今没被发现的原因。**一旦出现 letterbox/pillarbox（视频比例 ≠ 工程比例），预览的图片盒是内缩的，导出的不是**，两侧在**没有任何运镜**时就已经分叉。

对本轮的杀伤：N1/N2 比的正是「同一个盒上的运镜几何」。若盒本身先偏了，N2 会以一个与运镜无关的原因变红，团队会去查运镜 —— 查错方向。

**修复**：新增 **N0（前置基线）** —— 在跑任何运镜指标之前，先测「无运镜时预览盒与导出盒的四角一致性」，不达标就先冻结夹具口径（D2/D3/D4 一律使用**固有比例 == 工程画布比例**的视频），并把该偏差作为**已知既有缺陷**登记（L15），**不在本轮扩大战线去修**。这样 N1/N2 测的才是运镜本身。

---

### P1-8 ｜ 方案 A 下的 `pad(margin) + crop` 经实证是 no-op

v1 §3.3 的滤镜串在 `perspective` 前后包了一对 `pad(+2ml, +2mt, #00000000)` / `crop(bw:bh:ml:mt)`，§3.4 方案 A 又说「crop 回盒尺寸，overlay 坐标一个字都不用改」。这两件事叠在一起 ⇒ **先撑开边距，再把边距原样裁掉**。

**本节点用真实 ffmpeg 跑了三个变体**（红底 320×180，绿图 100×60 → 盒 160×90 叠在 (80,45)，`on/fps` 驱动的 3D 四角，抽第 20 帧后取像素）：

| 变体 | 退出码 | 盒内"露底"采样点 (81,46) | 盒中心 (160,90) |
|------|--------|--------------------------|-----------------|
| `pad(margin)` + `format=yuva420p` + `perspective` + `crop` | 0 | **(253,0,0) 红 = 露出底层** | (0,127,0) 绿 |
| 同上但**去掉** `format=yuva420p` | 0 | **(253,0,0) 红** | (0,127,0) 绿 |
| **去掉 `pad(margin)` 与 `crop`**，四角直接在盒空间发射 | 0 | **(253,0,0) 红** | (0,127,0) 绿 |

三者对露底的结论**完全相同**。原因：`perspective` 对四角覆盖不到的目标像素保留源的透明度，`overlay` 再按 alpha 合成 —— 露底靠的是 **alpha**，不是 margin。margin 只有在**不 crop、允许画到盒外**（方案 B）时才有意义。

**修复**：方案 A 的滤镜串删掉 `pad(margin)` 与 `crop`，四角直接在盒空间发射。收益不只是少两个滤镜：**它消灭了一整类坐标系错误** —— 保留 pad 就意味着四角必须写在「padded 帧」坐标系里（全体 +ml/+mt），发射器一旦忘了这个偏移，整张图平移 16px，而这种偏移在 SSIM 上表现为"有点糊"，极难归因。`backdropMargin()` 仅在方案 B 被启用时才需要。

**附带实证（两条都是好消息，已就地更正 v1 的保守假设）**：
1. **`format=yuva420p` 不是必需的**。上表变体 2 证明：只要下游是 `overlay`，格式协商本来就会选到带 alpha 的格式。v1 §3.3 把它标成「3D 需要 alpha」，实测是「加了无害、不加也对」。保留它作为**显式意图声明**可以，但 §5「像素格式一致性」那一条的风险等级应下调，且 L9 的「无运镜时不引入 `format`」依然要守（那是为 N4-② 的逐字符冻结，不是为 alpha）。
2. **现有 `pad=…:black@0` 对无 alpha 源（jpeg / yuvj420p）也是真透明的**。实测：绿色 jpeg 经 `scale=160:90:force_original_aspect_ratio=decrease,pad=160:90:(ow-iw)/2:(oh-ih)/2:black@0` 后叠到红底，pad 条带采样 = **(253,0,0) 红**。评审开始时曾怀疑这里会退化成不透明黑边（那会直接打穿 N3），**实测证伪，无需处理**。

---

### P1-9 ｜ G3 从 P2 提级到 P1

v1 把 `GUARD_CANVAS = {1920,1080}` 归为「判据用错画布」的 P2。实际影响链比 v1 描述的长一环：

```
CameraMotionModal.tsx:45 GUARD_CANVAS
  → :139 isMotionRenderable(draft, GUARD_CANVAS)
      → CameraMotionLayer.ts:493 ensureCoverage(motion, aspect)   ← 倍率随 aspect 变
      → 决定 Apply 按钮是否可用
```

所以它不只是「可渲染性结论不同构」，而是**竖屏（9:16）工程下面板算出的 coverage 倍率与真实渲染不是同一个数**，Apply 门禁可能放行一个真实画布上翻面的参数、或拦下一个本来合法的参数。它与 P0-3(b) 是同一个根（aspect 取谁），因此必须同批修、同批测。

---

### P1-10 ｜ 叠加通道的 `fps` 无处可取，且不该信任请求值

v1 §3.3 要求进度用 `on/fps`，L3 要求 `fps` 取 `output_fps`。但两个真实函数的签名里**都没有 fps**：

```python
_process_image_overlays(self, image_items, video_path, output_path, temp_dir, output_resolution)
_process_overlays_and_subtitles_combined(self, image_items, subtitle_items, video_path, output_path, temp_dir, output_resolution)
```

`output_fps` 在 `VideoCompositionRequest`（`video_models.py:354`，默认 30，范围 15–60）上，但没有被传进来。v1 §7.4-19 完全没提签名改造 —— 节点 #2 到这一步会卡住或就地瞎取一个值。

**更进一步**：`on` 数的是**叠加通道自己输出的帧号**，所以真正正确的分母是**叠加通道输入文件的实际帧率**，而不是请求里声称的 `output_fps`。两者在正常路径相等，但合成阶段一旦发生任何帧率协商，信任请求值就会让整段运镜**匀速偏快/偏慢** —— 而这种错误在单帧 SSIM 上几乎看不出来，只在时间轴上体现。

**修复**：签名增加 `output_fps`；发射器的 fps **以 `ffprobe` 实测输入文件帧率为准，`output_fps` 为兜底**，两者不一致时记 warning；25fps 用例断言实测值被采用（已写进 §3.3 / §7.4 / L3）。

---

### P2（记录在案，不阻塞）

- **P2-11 R4 实证**：本机 ffmpeg 上 `-/filter_complex <file>` 与 `-filter_complex_script <file>` **都可用（rc=0）**，但后者会打印 `-filter_complex_script is deprecated, use -/filter_complex ... instead`。R4 留在 STRETCH 是合理的右尺寸判断；若本轮不做，需知道该 deprecation 警告会持续出现在日志里（不影响功能）。**若要做，必须遵守 L10：探测位同 PR 内要有真实消费点 + 回归用例**（Iteration 1 终审问题 1 的复发防线）。
- **P2-12 记号统一**：§3.1 理由 3 用 `scale=W:H` 描述的其实是**盒尺寸**（源码是 `scale={even_w}:{even_h}`，`even_w = pos.width * video_width`），与 §3.3 的 `bw:bh` 是同一件事。`W:H` 极易被读成画布尺寸 —— 已统一为 `bw:bh`。
- **P2-13 `rotation` 不变量**：`ImagePosition` 有 `rotation` 字段（`video_models.py:100`），但**预览 `_drawImageLayer` 与导出 `_process_image_overlays` 都完全忽略它**。本轮不引入它，但要登记为不变量：节点 #2 不得"顺手"在任一侧实现旋转，否则立刻制造新的预览/导出分叉（已入 L16）。
- **P2-14 `results/env.json` schema**：v1 要求把 D2 的 SHA256 记进去但没定义结构。已在 §2.3 给出最小字段集。
- **P2-15 下游定位**：`ls docs/plans/*/experiment-plan.md` 会命中 2 个目录，按「唯一目录」硬判会直接失败。判据见文首「交接消歧」：以节点 #0 输出的 `feature=` 为准。本节点据此判定并继续，未中止。

---

## ⚠️ 交接消歧（下游节点 #1–#4 必读，最高优先级）

`docs/plans/` 下现在有**两个**含 `experiment-plan.md` 的目录，请勿混淆：

| 目录 | 状态 | 对本轮的意义 |
|------|------|--------------|
| `docs/plans/timeline-camera-motion/` | **Iteration 1 已完成并已提交**（`6d0fa57` 实现 + `8c702ec` 加固与实验记录），是**只读归档** | 背景与既有契约的真相来源；**不要**再改它，不要把它当本轮契约 |
| `docs/plans/camera-motion-stills-and-desktop-gate/`（本目录） | **Iteration 2 的唯一有效契约** | 节点 #1 评审本文件、节点 #2 按本文件落代码、节点 #3 按本文件跑指标、节点 #4 终审并提交 |

判据一句话：**本轮的 feature 目录名由节点 #0 的完成输出 `feature=camera-motion-stills-and-desktop-gate` 给定**；若下游用「含 `experiment-plan.md` 的子目录」自动定位并命中两个，取本目录（另一个的抬头写着 `feature = timeline-camera-motion` 且版本为 v2）。

---

## 0. 一句话目标

Iteration 1 已经把 2D / 3D 运镜做进了**视频片段**的预览与导出，并在真实 FFmpeg 与真实 Chromium 上量到了像素级一致。本轮把这套能力补齐到「用户真的会用它的地方」：**时间轴上的静态图片片段（Ken Burns 是 2D 运镜最经典的用法）现在可以打开运镜面板、可以保存、徽标也会亮，但预览与导出都会静默忽略它** —— 这正是 Iteration 1 自己定义为最不可接受的失败模式（把「没有特效的成片」当成功交付）。同时闭合 Iteration 1 唯一没关上的门禁 DoD #8（Electron 打包端 walkthrough），并修掉面板里「3D 预设永远只能看到 2D 仿射影子」这一 WYSIWYG 缺口。

---

## 1. 起点勘察（本轮新读代码，事实性结论）

以下每一条都在本轮重新读过源码，**符号名为准**（行号会漂移，只在本轮实读处标注）。

### 1.1 Iteration 1 已经闭环的部分（本轮不重做）

- 几何内核一式两份并由黄金向量钉死：TS `src/components/video/playback/CameraMotionLayer.ts`（584 行，导出 `motionStateAt` / `cameraHomography` / `projectRect` / `applyHomographyToRect` / `affineFrom` / `isMotionRenderable` / `ensureCoverage` / `backdropMargin`），Python `app/services/composition/camera_motion.py`（524 行）+ `camera_motion_filters.py`（480 行）。
- 预览：`CanvasCompositor._drawVideoLayer` 对**视频图层**做像素段（2D 走 `ctx.transform`，3D 走 `PerspectiveQuadRenderer`，WebGL 不可用降级为仿射影子）。
- 导出：`filtergraph_builder` + `video_composition_service._compose_videos_filtergraph` 的 `perspective`（`eval=frame`）路径，含降级阶梯、能力探测 `ffmpeg_caps.probe()`、以及两条「静默吞特效」护栏（L1：有运镜禁 concat；L11：有运镜且 filtergraph 失败禁回退 concat）。
- UI：`CameraMotionModal` + `PresetGallery` + `MotionInspector` + `MotionPreviewThumb`，16 个预设，工具栏与右键菜单双入口，`E` 快捷键，en / zh 双语，`isMotionRenderable` 守卫接进 `Apply`。
- 指标 M1–M6 已在本机实测：几何最大偏差 6.84e-7px、80 格 SSIM 最低 0.9911、`lastDrawMs` 均值 0.88ms、16/16 导出成功、零回归、i18n 齐平。证据在 `docs/plans/timeline-camera-motion/results/`。

### 1.2 Iteration 1 明确挂账、本轮要处理的项

| 编号 | 来源 | 内容 |
|------|------|------|
| **R1** | 终审报告 §5 | **DoD #8 未闭合**：Electron 打包端「加运镜 → 预览 → 导出 → 播放成片」walkthrough 从未走过；打包端自带 FFmpeg（`desktop/main/backendService.js` 把 `resources/ffmpeg` 前置进 PATH），版本未必与本机相同，而能力探测是运行时行为 |
| **R2** | 终审报告 §5 | 双轨叠加下的 3D 露底只验到滤镜串层面，没有逐像素比对 |
| **R4** | 终审报告 §5 | `-filter_complex_script` 已被上游标记 deprecated，新式 `-/filter_complex <file>` 未探测 |
| **R-P2-5** | 计划 v2 | 打包端 FFmpeg 版本需在 walkthrough 时记录一次 |

（R3「后端 17 项既有 composition 失败」与 R5「jsdom 测不了真渲染」是结构性问题，本轮只沿用既有对策，不立项，见 §9 L12 / L13。）

### 1.3 本轮新查出的缺口（附证据，均已回读源码）

> 节点 #0 查出 G1–G3；节点 #1 评审时新增 **G4**（预览/导出盒基准不同源），并把 **G3 从 P2 提级到 P1**。

**G1（P0，静默无效）｜静态图片片段的运镜是一个彻底的空操作，而 UI 让用户以为它生效了。**

证据链（三处独立读取）：

1. **入口是开着的**：`src/components/video/timeline/TimelineItem.tsx:279` 写的是
   `const canEditCameraMotion = item.type === 'video' && !isTrackLocked;`
   而本仓库的 `TrackType` 只有 `'video' | 'audio' | 'subtitle'`（`timeline/domain/types.ts:29`）—— **放在视频轨上的图片素材，其 `item.type` 就是 `'video'`**。所以右键菜单的「运镜」对图片片段可用，面板能打开，`setCameraMotionAction` 能落库，`TimelineItem.tsx:668` 的 `2D/3D` 徽标也会亮。
2. **预览侧丢弃**：图片在预览里走的是**另一条通道**。`useCompositionPlayback.ts:161 buildImageOverlayInputs` 以 `if (item.originalMaterialType !== 'image') continue;` 挑出图片项，构造 `ImageOverlayInput`；该接口（`playback/ImageOverlayLayer.ts:43`）**没有 `cameraMotion` 字段**，`buildImageLayersAt` 也不调用 `motionStateAt`。运镜只在 `internal/assembleLayers.ts:124` 的 `entry.clip.cameraMotion` 上读取，那是视频轨分组的路径 —— 图片项根本走不到那里。于是用户看到的是 `_drawImageLayer` 画的那张**不动的**图。

   > **【节点 #1 更正，P1-5】** v1 在此处还断言「图片同时也会被 `CompositionAdapter.extractVideoSequences` 收进 `videoSequences`，运镜挂在一个永远画不出来的图层上」。**该断言与源码相反**：`CompositionAdapter.ts:117` 起除了 `item.type !== 'video' || !item.materialId` 之外，还有一道 `if (!material || material.type !== 'video') continue;` —— **图片素材在这里就被排除了，不会进 `videoSequences`**。因此不存在"同一图层被画两次"的冗余（原 L14 据此作废，见 §9）。本条结论（预览侧丢弃运镜）由上面已复核的 `ImageOverlayInput` 缺字段单独成立，不受影响。
3. **导出侧丢弃**：`useVideoExport.ts` 在 `item.type === 'video'` 分支里先判 `material.type === 'image' || item.originalMaterialType === 'image'`，命中就 `imageItems.push({ id, name, url, start_time, duration, track_id, position, opacity, fade_in_duration, fade_out_duration })` 然后 `return`（本轮实读 :262–:281）—— **没有 `camera_motion` 字段，也不会走到下面那段给视频项挂 `camera_motion` 的代码**。后端 `ImageCompositionItem`（`video_models.py:280`）同样没有该字段。

结论：用户对一张图片应用「缓慢推近」，面板显示正确、徽标显示 `2D`、撤销栈正确，**预览一动不动，导出也一动不动**，并且没有任何警告。这与 Iteration 1 亲手立下的 L1 / L11 两条护栏所防的是同一类失败，只是发生在另一条管线上。

**G2（P1，WYSIWYG 缺口）｜面板里的 3D 预设，从头到尾只能看到 2D 仿射影子。**

`MotionPreviewThumb.tsx` 的文件注释写着「3D moves render through the affine shadow (`affineFrom`)… **the large preview and the real canvas do the true perspective**」，但 `CameraMotionModal.tsx:203` 的大预览用的是**同一个** `MotionPreviewThumb` 组件（只是把 `width/height` 换成 `LARGE_PREVIEW_WIDTH=320` / `LARGE_PREVIEW_HEIGHT=180`）。即：面板里**没有任何一处**呈现真透视，注释所承诺的「大预览」并不存在。用户选择 `orbit-left` 这类 3D 预设时，看到的是一个被裁掉了透视收敛的近似，只有点了 `Apply` 之后才在时间轴画布上看到真相 —— 对一个「所见即所得」为核心卖点的特性，这是选择环节的信息缺失。

**G3（~~P2~~ → **P1**，节点 #1 提级，见评审记录 P1-9）｜`GUARD_CANVAS` 硬编码 16:9。**

`CameraMotionModal.tsx:45` 用 `const GUARD_CANVAS = { width: 1920, height: 1080 }` 作为 `isMotionRenderable` 的判据画布（消费点在 :139），注释也承认「the panel does not receive the project canvas」。但 `cameraHomography` 的焦距取 `PERSPECTIVE_FOCAL_RATIO * max(width, height)`，**判据随长宽比变化**；竖屏（9:16）工程下，面板给出的可渲染性结论与真实画布不同构，极端参数下会出现「面板放行、真实画布上翻面」或反之。

**提级理由**：影响链比 v1 描述的多一环 —— `isMotionRenderable`（`CameraMotionLayer.ts:491`）内部 :493 还会调 `ensureCoverage(motion, aspect)`，**倍率随 aspect 变**。所以 `GUARD_CANVAS` 不只让"能不能渲染"的判据失准，还让面板算出的 coverage 与真实渲染**不是同一个数**，直接影响 Apply 门禁的正确性。它与 G4/P0-3(b) 同根（aspect 取谁），必须同批修、同批测。

**G4（P1，节点 #1 新增，见评审记录 P1-7）｜预览盒与导出盒的基准不同源。**

预览的图片盒挂在**画布的 letterbox fit-rect** 上（`CanvasCompositor._baseFit`:265-281 → `_drawImageLayer`:401-404 的 `boxX = fit.x + layer.bounds.x * fit.width`），导出的图片盒挂在**整帧**上（`_process_image_overlays` 的 `x = int(pos.x * video_width)`）。视频固有比例 == 工程画布比例时两者重合（所以至今未被发现）；一旦 letterbox/pillarbox 出现，**在没有任何运镜时两侧就已分叉**。这是既有缺陷，不在本轮修复范围，但必须先用 N0 把它挡在 N1/N2 的测量之外，否则会把与运镜无关的偏差归因到运镜上（防守见 §9 L15）。

---

## 2. 实验目标 / 假设 / 指标 / 数据集 / 基线 / 环境

### 2.1 假设（Hypothesis）

- **H1 —— 运动矩形抽象可以把静图纳入同一套几何，且对视频侧输出零影响。**
  把 Iteration 1 的「H 作用在某个矩形上」推广为：**每个 clip 的运镜作用在它自己的渲染盒（motion box）上**。视频 clip 的盒就是画布矩形（`{x:0,y:0,w:W,h:H}`），静图 clip 的盒就是它的摆放盒（归一化 `position` 换算出的像素矩形）。定义
  `H_box(state, box) = T(box.x, box.y) · cameraHomography(state, {width: box.width, height: box.height})`
  当 `box` 恰为画布矩形时 `T` 为单位阵且第二项与今天逐位相同 —— 因此**视频侧的滤镜串与预览四角逐字符 / 逐浮点不变**，这一点可由构造证明并由单测钉死（N4-a）。
- **H2 —— 叠加通道用「全局帧号」驱动进度，可达到与视频侧同级的预览/导出一致性。**
  图片叠加是在**已合成的视频**上再跑一遍 FFmpeg（`_process_overlays_and_subtitles_combined` / `_process_image_overlays` —— 节点 #1 按真实符号更正，见 P0-1），其时间原点就是成片的 0 秒，因此 clip 进度 = `clip((on/fps - start_time) / duration, 0, 1)` 再经 `startRatio/endRatio/easing` 映射。视频侧用的是 `on/fps`（clip 本地时间，因为 clip 已 `setpts` 重置），静图侧用的是同一个变量减去一个绝对偏移 —— 内核不变，只有时间基准的仿射不同。
- **H3 —— 面板里给 3D 预设一个真透视预览，成本可控。**
  只给**大预览**一个 WebGL 上下文（卡片保持仿射影子），复用 `PerspectiveQuadRenderer`，关闭面板即 `dispose`。浏览器 WebGL 上下文上限（通常 16）不会被 16 张卡片挤爆。
- **H4 —— 打包端与开发端在运镜链路上等价，但必须实测而非假定。**
  本仓库有 dev / 打包行为不一致的历史（starlette Range、打包 env 覆盖）。打包端自带 FFmpeg，能力探测落档可能不同；walkthrough 的价值就是把这个假设变成一条记录。

### 2.2 评估指标（Metrics）

> 口径原则沿用 Iteration 1：**不可测就写明不可测**；每个指标都要落成 `results/*.json` 里的一个可回读的数字，而不是一句「已验证」。

| ID | 指标 | 口径与阈值 |
|----|------|-----------|
| **N0** | **前置基线：无运镜时盒一致性**（节点 #1 新增，闭合 G4/P1-7 的测量污染） | **在 N1/N2 之前跑，不达标就停下**。对 D2 的两张图 × 3 种摆放盒，在**完全不加运镜**的情况下比较预览 `_drawImageLayer` 实际落笔的盒矩形与导出 `_process_image_overlays` 算出的 `x/y/even_w/even_h`。**阈值：四角偏差 ≤ 1px**。达标 ⇒ 后续 N1/N2 的偏差可以归因给运镜；不达标 ⇒ 说明夹具触发了 letterbox 分叉，**先把夹具收敛到「视频固有比例 == 工程画布比例」再继续**，并把实测偏差原样记进 `results/n0-box-baseline.json`（作为 G4 的既有缺陷证据，本轮不修）。 |
| **N1** | **静图几何一致性（TS ↔ Python）** | 用**线上预设表**经生产 `toCameraMotionWire` 产出的 wire 载荷喂 Python 发射器，与 TS `H_box` 的四角逐点比较。覆盖 16 预设 × 5 种盒配置（① 与画布同比例的盒 ② 4:3 盒在 16:9 画布 ③ 角落小盒（0.2×0.2）④ 满画布盒（回归视频侧等价性）⑤ 9:16 画布下的盒）× 5 个进度点（0 / 0.25 / 0.5 / 0.75 / 1）= 2000 个角点。**阈值：最大偏差 ≤ 0.5px**。<br>**N1-c（节点 #1 新增，闭合 P0-3 的指标盲区）**：N1 本身**看不见** coverage 语义错误（TS 与 Python 会一起错，偏差仍是 0）。因此另加一条**绝对值断言**，不比两侧之差而比与期望值之差：<br>① 静图 + 2D 纯平移预设（`offsetX = 0.1`、`scale = 1`）在 `enforceCoverage = false` 下，`motionStateAt` 返回的 `scale` **必须严格等于 1**（若被 coverage 抬到 1.2 即失败）；<br>② 同一预设在 `enforceCoverage = true` 下，倍率**必须用盒长宽比**算出，与用画布长宽比算出的值在「盒比例 ≠ 画布比例」时**必须不同**（这条专门钉死 P0-3(b)：两侧一起取错 aspect 时 N1 依然全绿）；<br>③ 视频侧默认路径（`enforceCoverage` 缺省）返回值与 `8c702ec` 逐位相同。 |
| **N2** | **静图预览 / 导出视觉一致性** | Electron 真 Chromium 抓 `CanvasCompositor` 预览帧 vs 真实 FFmpeg 成片抽帧，统一降采样到 640×360 后 `ffmpeg -lavfi ssim`。覆盖 ≥ 8 预设（4×2D + 4×3D）× 3 个进度点 = 24 格。**分级阈值**：2D ≥ 0.97、3D ≥ 0.93、强缩放类 ≥ 0.90，**硬地板 0.85**。每格附**方向哨兵**（同时与上下镜像成片比一次，要求正立分数至少高 0.02）—— 这是 Iteration 1 抓出「3D 预览上下颠倒」的那把锁，必须沿用。 |
| **N3** | **双轨 3D 露底逐像素**（闭合 R2） | 夹具：下层视频轨（纯色可辨图案）+ 上层图片轨带 3D 运镜。除 SSIM ≥ 0.93 外，另加一条**显式断言**：取上层 3D 收敛后**露出的**若干采样点，要求预览与成片在该点**都**呈现下层的颜色（而不是黑色）—— 透明 backdrop 的正确性只有这条能证明。 |
| **N4** | **零回归** | ①**视频侧冻结**：16 个预设的 `filter_complex` 字符串与 `8c702ec` 逐字符相同（复用 Iteration 1 的冻结断言）；②**无运镜工程冻结**：无运镜时图片叠加命令与 `8c702ec` 逐字符相同；③前端全量 vitest 的失败集合 ⊆ 父提交失败集合（按提交归因，不靠推断）；④运镜定向后端套件全绿。 |
| **N5** | **面板真透视** | ①结构化断言：大预览把交给渲染器的四角与内核 `projectRect` 的期望值逐点比较（容差 1e-6）；②WebGL 不可用时降级为仿射影子且**不黑屏**、有可见提示；③**无泄漏**（口径经节点 #1 按真实 API 重写，见 P1-6）：连续开关面板 20 次后，`release()` 的调用次数 **==** `acquire()` 返回 `true` 的次数，且面板卸载后 `PerspectiveQuadRenderer` 持有的 `_canvas` / `_bundle` 均为 `null`、活跃 WebGL 上下文 ≤ 1。**该类没有 `dispose()`** —— teardown 方法名是 `release()`。 |
| **N6** | **桌面 walkthrough**（闭合 DoD #8） | 打包端 8 项清单（见 §8.4）全绿，且落一份 `results/desktop-walkthrough.json`：打包端 `ffmpeg -version` 原文、`ffmpeg_caps.probe()` 的落档、每一步的截图/成片路径与 SHA256、以及一条「成片能在打包端播放器里放出运镜」的人工确认。 |
| **N7** | **性能与规范** | ①静图运镜开启后 `CanvasCompositor.lastDrawMs` 滚动均值的**增量 ≤ 1.0ms/图层**，总均值仍 ≤ 12ms（`ADAPTIVE_DEGRADE_DRAW_MS`），`targetFps` 全程 60；②i18n en / zh 三处齐平、0 硬编码文案；③所有改动后的文件 ≤ 800 行、函数 ≤ 50 行、形参 ≤ 5；④`npm run type-check` 静默通过。 |

### 2.3 数据集（Dataset）

- **D1 —— 静图黄金向量**：`fixtures/camera-motion-stills-golden.json`。**唯一生成者**是扩展后的 `scripts/gen-camera-motion-golden.mjs`（沿用 Iteration 1 的 R-P1-10 规矩：一个生成器、6 位小数字符串序列化、带 schema）。TS 侧是回归锁，Python 侧才是跨实现校验。
- **D2 —— 静图夹具**：代码合成，**不进仓库二进制**。两张 PNG：`still_4x3.png`（1440×1080）与 `still_16x9.png`（1920×1080），四角形状与颜色互不相同（角序错误要肉眼可见，而不是躲在一个略低的 SSIM 里），中心带非对称图案（否则平移与轨道运动不可见）。SHA256 记进 `results/env.json`。选 4:3 是刻意的：它让「盒比例 ≠ 图片比例」这条最容易分叉的路径进入每一次测量。
  **`results/env.json` 最小字段集（节点 #1 补，P2-14）**：`{ ffmpeg_version, ffmpeg_path, ffmpeg_caps, gpu_renderer, webgl_version, electron_version, node_version, os_release, git_head, fixtures: { <name>: { path, width, height, sha256 } } }`。
  **夹具比例约束（节点 #1 新增，配合 N0 / G4）**：本轮所有含视频的夹具，其**视频固有比例必须等于工程画布比例**，以免 letterbox 把 G4 的既有盒偏差混进 N1/N2 的读数。要专门测 letterbox 场景时，单独立用例并明确标注它测的是 G4 而不是运镜。
- **D3 —— 双轨夹具**：下层用 Iteration 1 的合成视频夹具（`experiments/fixture_media.py`，直接复用，不复制），上层用 D2 的 4:3 图片放在 0.55×0.55 的盒里带 `orbit-left`。
- **D4 —— walkthrough 工程**：一条 6s 视频 + 一张图片 + 一条字幕。**必须带字幕**的理由（节点 #1 按真实符号更正，原 v1 引用的 `_merge_overlays_single_pass` 不存在，见 P0-1）：带字幕时图片叠加走 `_process_overlays_and_subtitles_combined`，不带字幕时走 `_process_image_overlays`，**两个不同的滤镜串组装点都必须过一次**；此外 combined 失败时还会回退到 `_process_overlays_sequential`（内部再调 `_process_image_overlays`），这条回退梯同样要被覆盖，见 L1。

### 2.4 基线（Baselines）

- **B0 = `8c702ec`**（Iteration 1 终态）：N4 的所有「逐字符相同」都以它为参照，用 detached worktree **取出来实际执行**，不用作者自己冻结的字面量（沿用 Iteration 1 的 e5 方法）。
- **B1 = 静图无运镜**：当前行为（`scale + pad(black@0) + overlay`），是 N4-② 的冻结对象。
- **B2 = 视频侧运镜**：一致性口径的参照系 —— 静图侧的 N1 / N2 阈值与视频侧的 M1 / M2 完全同档，不允许因为「图片是叠加层」而放宽。

### 2.5 运行环境

```
environment: local
```

- 全部在本机跑：Windows 11（`win32`, 10.0.26200），工作目录 `M:/takoAI/Ecliptrix`。**不涉及远程主机、不涉及 SSH、不涉及任何私钥**，本文件也不包含任何凭据。
- FFmpeg：本机 `gyan.dev full build`（Iteration 1 实测落在降级阶梯第 1 档）；**打包端 FFmpeg 另计**，由 `desktop/main/backendService.js` 从 `resources/ffmpeg` 前置进 PATH，其版本与能力落档由 N6 实测记录。
- 预览侧 GPU：`ANGLE (Intel Arc Graphics, Direct3D11)`，WebGL 2.0。
- Electron：复用 `desktop/node_modules/electron`，**不新增依赖**。注意 `ELECTRON_RUN_AS_NODE=1` 会让 `electron.exe` 退化成纯 Node —— Iteration 1 的 `experiments/_common.py:child_env()` 已经处理，本轮**导入复用**它而不是复制。
- 打包：现有 `desktop/release/win-unpacked/` **早于 `6d0fa57`**，N6 之前必须重新 `desktop/build.ps1` 打包一次，否则 walkthrough 验的是旧代码（本仓库有过「桌面端仍现象 = 过期打包」的先例）。
- 测试命令：前端 `npx vitest run`、`npm run type-check`；后端 `pytest tests/ -k "composition or filtergraph or camera or overlay"`（venv 内）。

---

## 3. 核心设计

### 3.1 统一抽象升级：从「画布矩形」到「运动矩形（motion box）」

Iteration 1 的支点是「一套 H，三个渲染后端」。本轮只加一层，不动内核：

```
运动矩形 box = 这个 clip 在画布上真正占据的像素盒
  · 视频 clip：box = 画布矩形 {0, 0, W, H}          ← 与今天完全一致
  · 静图 clip：box = position 换算出的摆放盒         ← 本轮新增

H_box(state, box) = T(box.x, box.y) · cameraHomography(state, {width: box.width, height: box.height})
四角          = applyHomographyToRect(H_box, {x:0, y:0, width: box.width, height: box.height})
```

三条必须写进代码注释的理由：

1. **为什么不能直接把画布空间的 H 作用到小盒上。** `cameraHomography` 是绕**画布中心** `(W/2, H/2)` 构造的，平移量是 `offsetX * 画布宽`，焦距取 `1.6 × 画布长边`（本轮实读 `CameraMotionLayer.ts:343-371`）。把它直接作用到一个位于左上角的 0.3×0.3 小盒上，「推近」会变成「绕着画布中心甩出去」，而且平移幅度是盒宽的三倍多。**运镜必须相对 clip 自己就地发生**，所以 H 必须在盒自己的坐标系里构造。
2. **为什么这对视频侧是恒等改动。** 视频的盒就是画布矩形：`T` 是单位阵，`{width: box.width, height: box.height}` 就是画布尺寸。因此 `H_box ≡ cameraHomography(state, canvas)`，**逐位相同**。这不是「应该不会变」，而是构造上不可能变，并由 N4-① 的逐字符断言与一条专门的等价性单测钉死。
3. **为什么导出侧天然对齐。** 导出侧的图片在被 overlay 之前，已经被 `scale=bw:bh:force_original_aspect_ratio=decrease, pad=bw:bh:(ow-iw)/2:(oh-ih)/2:black@0` 做成了一张**盒尺寸的、居中 contain、四周透明**的图（本轮实读 `_process_image_overlays`:2740 与 `_process_overlays_and_subtitles_combined`:2523；`bw/bh` 即源码里的 `even_w/even_h = _ensure_even_dimensions(pos.width * video_width, pos.height * video_height)`）。`perspective` 作用在这张盒图上，坐标系原点就是盒的左上角 —— 与上式的 `{x:0, y:0, width: box.width, height: box.height}` 逐字对应。**两侧比较的是同一个东西**，这正是 Iteration 1 R-P0-5 的教训。
   > 记号统一（节点 #1，P2-12）：v1 此处写作 `scale=W:H`，与 §3.3 的 `bw:bh` 是同一件事，但 `W:H` 极易被误读成**画布**尺寸。全文统一用 `bw:bh` 表示**盒**尺寸。
   > 透明性已实证（节点 #1，P1-8 附带）：即使源图不带 alpha（jpeg / yuvj420p），这段既有 `pad=…:black@0` 出来的边条**也是真透明**的（实测叠到红底上采样得 (253,0,0)）。无需为此额外加 `format`。

**冻结项**：角序仍是 `[TL, TR, BR, BL]`（顺时针），Python 发射器仍做 `x2←Q[3], x3←Q[2]` 的光栅序换位。静图不引入第二套角序。

### 3.1.1 覆盖保证（coverage）对静图的语义 —— 必须显式决策（节点 #1 新增，P0-3）

`motionStateAt`（`CameraMotionLayer.ts:268`）内部无条件折入 `ensureCoverage`（:276）。这是给**视频**立的规矩：2D 移动不得让画布露出黑边。静图是**叠加层**，盒外本来就是透明 pad，"露出下层"是 §3.4 / N3 明确要的特性 —— 直接复用 `motionStateAt` 会把视频的规矩无声地施加到静图上。

具体后果：`offsetX = 0.1`、`scale = 1` 的纯平移预设，`ensureCoverage` 算出 `k = 2×|0.5+0.1| / 1 = 1.2`，**把静图放大 20%**。用户选「横移」，得到「边放大边横移」。而 Ken Burns（2D）正是本轮旗舰场景。

**本轮契约（两个子问题分别定死）**：

| 子问题 | 决策 | 理由 |
|--------|------|------|
| (a) 静图是否启用画布级 coverage | **不启用**（`enforceCoverage = false`） | 叠加层的透明 pad 与"露出下层"是既定语义；强行覆盖会篡改用户选定的取景 |
| (b) 若启用，aspect 取谁 | **取盒长宽比 `box.width / box.height`**，绝不取画布长宽比 | `ensureCoverage` 的推导里只有 aspect 幸存；盒比例 ≠ 画布比例时取错会算出错误倍率 |

**实现约束（保证 H1 的构造性不变）**：`motionStateAt` 增加**可选第 5 参** `enforceCoverage: boolean = true`，Python `state_at` 镜像同名同默认的关键字参数。**默认 `true` ⇒ 视频侧所有调用点一个字不用改，返回值逐位相同**，N4-① 的逐字符冻结由构造保持。`isMotionRenderable`（:491，内部 :493 同样调 `ensureCoverage`）必须跟随同一策略与同一 aspect，否则面板门禁与真实渲染判的不是同一件事（与 G3/P1-9 合流）。

**为什么必须额外加断言**：N1 比的是 TS↔Python 之差、N2 比的是预览↔成片 SSIM —— 这两侧在 coverage 上会**一起错**，偏差与 SSIM 都不会变红。**能看见这个缺陷的只有 N1-c 的绝对值断言**，它不可省。

### 3.2 预览侧：`_drawImageLayer` 的像素段

时间段与像素段**必须继续分开**（Iteration 1 R-P0-1 的墙还在）：

- **时间段**（纯量、无像素）：`ImageOverlayLayer.buildImageLayersAt` 里调 `motionStateAt(motion, {clipStart, clipDuration}, t, boxAspect, /* enforceCoverage */ false)`，把 `{space, state}` 挂到 image 图层上。与视频侧 `assembleLayers.ts:124` 的写法同范式，**差别只有末两参**（§3.1.1 的 coverage 契约：aspect 取盒比例、静图不启用 coverage）。
- **像素段**（需要盒尺寸）：`CanvasCompositor` 内计算 `box`（`fit` + 归一化 `bounds`）→ `H_box` → 2D 用 `ctx.transform(affineFrom(H))`，3D 用 `PerspectiveQuadRenderer`。

**关键实现约束（顺序不能反）**：导出侧是「先 contain 进盒 + 透明 pad → 再变换整只盒」。预览侧今天的 `_drawImageLayer` 是「算 contain rect → `drawImage`」。要一致，预览必须**变换盒**、然后在被变换的坐标系里画那个 contain rect —— 等价于变换「盒图」。顺序写反（先算 contain rect 再对 contain rect 施加 H）在 `盒比例 ≠ 图片比例` 时会与导出分叉，且分叉量随平移量线性增长。D2 夹具里那张 4:3 图就是专门用来让这条路径每次测量都被踩到的。

**3D 的额外一步**：`PerspectiveQuadRenderer` 需要一张**纹理**，其 UV 空间必须等于盒空间。当 `|盒比例 − 图片比例| < ε` 时，contain 恰好填满盒，可以直接把 `HTMLImageElement` 当纹理（快路径）；否则必须先把图片 contain 进一张**盒尺寸的透明离屏画布**再上传。离屏画布要按 `(src, 盒宽, 盒高)` 缓存复用 —— 每帧新建会把 N7 的 1.0ms 预算和 GC 一起吃掉。

**降级**：WebGL 不可用 → `affineFrom(H)` 仿射影子（与视频侧同策略，绝不黑屏，L6）。

### 3.3 导出侧：叠加通道的 `perspective` 发射

在 `[imgN]` 与 `overlay` 之间插入运镜段。**节点 #1 已按实证简化（P1-8），最终形态如下**：

```
[i:v] scale=bw:bh:force_original_aspect_ratio=decrease,
      pad=bw:bh:(ow-iw)/2:(oh-ih)/2:black@0,      ← 既有，不动（实测已产出真透明边条）
      perspective=x0..y3:eval=frame:sense=destination,   ← 四角直接写在【盒空间】，原点 (0,0) = 盒左上角
      [imgN]
```

**v1 原稿在 `perspective` 前后还包了一对 `pad(bw+2ml, bh+2mt, #00000000)` / `crop(bw:bh:ml:mt)`。节点 #1 用真实 ffmpeg 实测证明该组合在方案 A 下是 no-op，已删除**（三个变体的盒内露底采样点全部得到底层的红色 (253,0,0)，中心全部得到图像的绿色 (0,127,0)，结论完全相同）。原因：露底靠的是 **alpha** —— `perspective` 对四角覆盖不到的目标像素保留源的透明度，`overlay` 再按 alpha 合成 —— 与 margin 无关。删掉它不只是省两个滤镜，更**消灭了一整类坐标系错误**：保留 pad 就意味着四角必须整体 `+ml/+mt` 写在 padded 帧坐标系里，发射器一旦漏掉这个偏移，整张图平移 16px，而这种偏移在 SSIM 上只表现为"有点糊"，极难归因。`backdropMargin()` 仅在启用方案 B 时才需要（见 §3.4）。

`format=yuva420p` 同样**不是必需**的（实测：去掉它，格式协商依然选到带 alpha 的格式，露底结论不变）。允许保留作为显式意图声明，但不得在**无运镜**时发射（L9 / N4-② 的逐字符冻结）。

- **进度表达式（H2）**：`p_raw = clip((on/fps - start_time) / duration, 0, 1)`，再套 `startRatio/endRatio` 窗口与 easing —— 与视频侧共用同一套发射器代码，只是把「clip 本地时间」换成「全局时间减 start_time」。
- **✅ P0 spike 已结案（节点 #1 实证，见评审记录 P0-2）**：`perspective` 的坐标表达式**不支持 `t`**（`x0='0+t'` → 退出码 -22 Invalid argument），**支持 `on`**（`x0='0+on'` → 退出码 0）；`eval=frame` 确实逐帧重算（第 0 帧与第 9 帧字节不同）。`ffmpeg -h filter=perspective` 亦确认 `x0..y3` 为 `<string>` 且带按帧求值标志。**结论：`on/fps` 方案成立，节点 #2 的开工前置条件已解除。** 即使将来 `t` 可用也不改用 —— 少一个变量少一处分叉。
- **`fps` 从哪来（节点 #1 更正，P1-10）**：两个真实函数的签名里**都没有 fps**（见 §7.4-19），必须先改签名把 `output_fps` 传进来。但**分母的真相不是请求值**：`on` 数的是叠加通道自己输出的帧号，所以正确的 fps 是**叠加通道输入文件的实测帧率**。发射器一律以 `ffprobe` 实测值为准、`output_fps`（`video_models.py:354`，默认 30，范围 15–60）为兜底，两者不一致时记一条 warning。取错会让整段运镜匀速偏快/偏慢，而这种错误在单帧 SSIM 上几乎看不出来 —— 必须有一条 25fps 用例断言实测值被采用。
- **两个组装点 + 一条回退梯必须同源（L1，节点 #1 按真实符号重写，见 P0-1）**：`_process_overlays_and_subtitles_combined`（:2523，有字幕时）与 `_process_image_overlays`（:2662，无字幕时）是**两份**几乎相同的 overlay 组装代码；此外 combined 失败时会回退到 `_process_overlays_sequential`（:2500），它内部**再次调用** `_process_image_overlays`。运镜段必须由**同一个发射函数**产出并被两处组装点调用；测试要断言「两个组装点对同一输入产出逐字符相同的运镜段」。否则会出现「有字幕时有运镜、没字幕时没运镜」这种最难排查的分叉。
  ⚠️ v1 在此处引用的 `_merge_overlays_single_pass` **在仓库中不存在**（`grep` 0 命中），全部已更正为上述真实符号。
- **`enable` 窗口不变**：`overlay=...:enable='between(t,start,end)'` 保持原样。`perspective` 在窗口外仍会计算，但窗口外的结果被 `enable` 丢弃 —— 成本是常数级，换来的是不动既有时序逻辑。若 N7 测出可观开销，再考虑 `trim`（记为 stretch）。

### 3.4 3D 露底与 overlay 坐标

**先说结论（节点 #1 实证修订，P1-8）：露底靠 alpha，不靠 margin。** 因此方案 A 根本不需要 margin —— 盒内被 3D 变换让出来的区域会保留源的透明度，`overlay` 按 alpha 合成时自然透出下层。三变体实测（有 pad+crop / 有 pad+crop 但无 `format` / 完全无 pad 无 crop）在盒内露底采样点上得到**同一个**结果：底层的红色 (253,0,0)。

盒外 margin 由内核的 `backdropMargin(H, box)` 给出（**取偶**，`BACKDROP_MIN_PAD = 16`）。两种落地方式：

- **方案 A（默认）**：**不 pad、不 crop**，四角直接写在盒空间，`overlay` 坐标一个字都不用改。代价：3D 把内容推到**盒外**的部分会被盒边界截断（直边裁切），无法画到盒外。
- **方案 B（stretch）**：pad 出 margin → perspective → 不 crop，`overlay=x-ml:y-mt`。允许内容溢出盒外，露底更完整，但要处理负坐标与 z 序。**只有方案 B 才需要 `backdropMargin()`**。

**默认取 A**：`overlay` 坐标不变意味着 N4-② 的「无运镜逐字符冻结」和既有的图片位置/拖拽 WYSIWYG（`image-overlay-fit-and-transform` 的 D2/D6 契约）都不受牵动；B 留作 stretch，并且只有当 N2 的 3D 格出现系统性偏低、或人工确认"图被盒边切得难看"时才启用。**预览侧必须与所选方案一致**：选 A，预览也要把绘制裁进盒（`ctx.clip` 到盒矩形），这样两侧被截断的位置一致。这条不对齐会直接把 N2 打穿。

### 3.5 时间与 `duration` 可变

图片 clip 的 `duration` 是用户可以拖拽改的。进度必须按**当前** `duration` 归一（`startRatio/endRatio` 是比例而非秒）——拖长一张图，运镜整体变慢而不是提前结束。这与视频侧语义一致，且撤销/重做后无需重算运镜数据。

---

## 4. 面板：真透视预览与真实画布比例（G2 / G3）

- **新增 `MotionPreviewStage`**（大预览专用组件，与 `MotionPreviewThumb` 分开）：2D 走 canvas 2D，3D 走 `PerspectiveQuadRenderer`；`acquire()` 返回 `false`（或 `isUnavailable()` 为真）→ 回落 `MotionPreviewThumb` 的仿射影子并显示一行本地化说明（`role="status"`，不抢焦点）。面板关闭 / 卸载即 **`release()`**。
  > **节点 #1 更正（P1-6）**：`PerspectiveQuadRenderer` **没有 `dispose()` 方法**。其公开 API 只有 `isUnavailable()`（:97）、`acquire()`（:106）、`render()`（:129）、`release()`（:158）。v1 两处写的 `dispose()` 会直接编译失败，已全部改为 `release()`。
- **顺手修正注释**：`MotionPreviewThumb` 里那句「the large preview … do the true perspective」在改造完成前是**不实描述**，必须同步改写为它当下的真相。僵尸/失真注释按仓库规范等同技术债。
- **画布尺寸下传（G3）**：`CameraMotionModal` 新增 `canvasSize: { width, height }` prop，由 `TimelinePanel` 从工程画布（`aspectRatio` / 输出分辨率）算出；`GUARD_CANVAS` 常量删除。静图片段还要额外下传它的**盒比例**，让预览与真实呈现同构。
- **不做的事**：不给 16 张卡片各配一个 WebGL 上下文（H3）；不引入关键帧编辑器（不在本轮范围）。

---

## 5. 导出鲁棒性

- **R4：新增 `-/filter_complex` 探测位。** `ffmpeg_caps.FfmpegCaps` 增补 `supports_filter_complex_file`，优先新式、回落旧式 `-filter_complex_script`、两者都无则内联并 `logger.warning`。**教训沿用**：Iteration 1 终审的问题 1 正是「探测了但没人消费」—— 新增的能力位必须在同一个 PR 里有真实消费点和一条回归用例，否则不许加。
- **L-I1 / L-I2 两条护栏（对齐 L1 / L11）**：
  - **L-I1**：任一图片项带 `camera_motion` 时，图片叠加通道**必须**执行（不得因任何优化判定被跳过）。
  - **L-I2**：任一图片项带 `camera_motion` 且叠加通道失败时，**禁止**静默产出「没有运镜的成片」—— 先按降级阶梯重试一次（3D → 2D 影子 → 静态取景），仍失败则整单 `failed` + 结构化错误，并经既有链路回传。
  - 这两条测试**先于功能代码写**（沿用 Iteration 1 落地条件 #3）。

- **⚠️ L-I2 的判定必须落在编排块，不是发射器（节点 #1 新增，P0-4）**。今天的实际行为是**静默的**：

  ```python
  # video_composition_service.py :1596-1613
  elif has_images:
      success = self._process_image_overlays(...)
      if success and os.path.exists(video_with_images_path):
          os.replace(...)
      else:
          logger.warning("Image overlay processing did not produce output file")   # ← 然后什么都不做
  except Exception as e:
      logger.error(...)                                                            # ← 然后什么都不做
  # → 继续走到 :1638 composition_update = {"status": "completed", ...}
  ```

  即：**图片叠加整体失败 → 一行日志 → 合成标记 `completed` → 用户下载到一个没有任何图片的"成功"成片**。再叠加 :1583–:1595 的 combined→sequential 回退梯，静默面比 v1 设想的更大。发射器改对了但编排块不改，L-I2 仍是空文 —— 因为**只有编排块能把 `composition_id` 标成 `failed`**。落点见 §7.4-19 的四个子项。

- **warning 回传链路（节点 #1 已核实为真，并更正符号名）**：v1 称「Iteration 1 已打通、本轮只是复用」属实，且终点是**用户可见**的，不只是日志：

  ```
  compositions[id]["warnings"]                    (video_composition_service.py:1465-1466)
    → video_router.py:247-248   safe_info["warnings"]
    → videoComposition.ts:216   warnings?: string[]
    → useVideoExport.ts:701-703 logger.warn(...) + showWarning(t.timeline.cameraMotion.exportDegraded, 8000)
  ```

  （v1 把承载体写成 `CompositionStatusResponse.warnings`；实际是 `video_router` 组装的 `safe_info` dict + 前端 `videoComposition.ts` 的类型 —— 后端没有名为 `CompositionStatusResponse` 的模型。）

- **像素格式一致性（风险等级经实证下调，节点 #1，P1-8）**：`format=yuva420p` 实测**并非必需** —— 只要下游是 `overlay`，格式协商本就会选到带 alpha 的格式（去掉它，露底结论不变）。因此这里不存在 v1 担心的"引入 yuva420p 影响下游"的强风险。仍然要守的是：**无运镜时不引入 `format` 滤镜**，保证 N4-② 逐字符冻结（这是为冻结，不是为 alpha）。

---

## 6. 数据模型（新增契约）

| 层 | 位置 | 改动 |
|----|------|------|
| TS 领域 | `timeline/domain/types.ts` | `TimelineItemData.cameraMotion` **已存在**，静图复用，无新字段 |
| TS 预览 | `playback/ImageOverlayLayer.ts` | `ImageOverlayInput` 新增 `cameraMotion?: CameraMotion | null` |
| TS 预览 | `playback/types.ts` | `CompositorLayer` 的 `image` 变体新增 `motion?: { space, state }`（与 video 变体同形） |
| TS wire | `lib/api/videoComposition.ts` | 图片项接口新增 `camera_motion?: CameraMotionWire`，**复用既有 `toCameraMotionWire`**（不写第二个映射器） |
| Python | `models/video_models.py` | `ImageCompositionItem` 新增 `camera_motion: Optional[CameraMotionSpec]`，**复用既有 `CameraMotionSpec`**（含其 `end_ratio > start_ratio` 校验） |

**兼容性**：全部为可选字段；旧工程 / 旧请求不带该字段时行为与 B1 完全一致（N4-② 冻结）。持久化走既有 `TimelineRepository` 快照，无迁移。

---

## 7. 代码改动计划（Code-change plan）

**本轮需要改代码。** 文件清单如下（新增 6 个、修改 14 个、测试 **9** 个 —— 节点 #1 补入 29 号生命周期测试）。节点 #2 请按 7.1 → 7.4 顺序落地：纯逻辑最先、可单测最先，UI 最后。

### 7.1 前端 —— 几何（纯逻辑）

1. `src/components/video/playback/CameraMotionLayer.ts`（**改**，584 → ≤ 660 行）
   新增 `cameraBoxHomography(state, box)` 与 `motionBoxQuad(state, box)`：**必须内部调用既有 `cameraHomography` / `applyHomographyToRect`**，不得重写任何几何。若行数逼近 800，拆到 `CameraMotionBox.ts` 而不是压缩注释。
   **另加（节点 #1，P0-3）**：`motionStateAt` 增加可选第 5 参 `enforceCoverage: boolean = true`；`isMotionRenderable` 跟随同一策略。默认值不变 ⇒ 视频侧调用点零改动、返回值逐位相同（H1 / N4-① 由构造保持）。**形参数量到 5 即到仓库阈值上限，不得再加第 6 个** —— 若还需更多参数，改为 options 对象并同步 Python 侧。
2. `src/components/video/playback/index.ts`（**改**）导出新符号。

### 7.2 前端 —— 预览渲染

3. `src/components/video/playback/ImageOverlayLayer.ts`（**改**，200 → ≤ 260 行）`ImageOverlayInput` 加字段；`buildImageLayersAt` 折入时间段。
4. `src/components/video/playback/types.ts`（**改**）image 图层变体加 `motion`。
5. `src/components/video/playback/internal/drawWithMotion.ts`（**新增**，≤ 200 行）
   把「给定盒 + 图层状态，2D 走 `ctx.transform` / 3D 走 `PerspectiveQuadRenderer` / 降级走仿射」这段**从 `_drawVideoLayer` 抽出来的**共享逻辑独立成模块，视频与静图共用。**理由是硬的**：`CanvasCompositor.ts` 已 736 行，就地扩写必然越过仓库 800 行阈值（Iteration 1 终审的问题 4 就是这条被漏审的规矩）；而且两处渲染逻辑一旦复制，就是下一个预览/导出分叉的种子。
6. `src/components/video/playback/internal/boxTextureCache.ts`（**新增**，≤ 120 行）盒尺寸透明离屏画布的 LRU 缓存（键 = `src|bw|bh`，容量 ≤ 8，面板/引擎卸载时清空）。
7. `src/components/video/playback/CanvasCompositor.ts`（**改**，736 → **不增反减**）`_drawVideoLayer` / `_drawImageLayer` 改为调用 5 号模块。

### 7.3 前端 —— 数据流与 UI

8. `src/components/video/hooks/useCompositionPlayback.ts`（**改**）`buildImageOverlayInputs` 透传 `item.cameraMotion`。
9. `src/components/video/hooks/useVideoExport.ts`（**改**）`imageItems.push({...})` 增补 `camera_motion: toCameraMotionWire(item.cameraMotion)`。
10. `src/lib/api/videoComposition.ts`（**改**）图片项 wire 类型加字段。
11. `src/components/video/components/CameraMotionModal/MotionPreviewStage.tsx`（**新增**，≤ 260 行）真透视大预览。
12. `src/components/video/components/CameraMotionModal/CameraMotionModal.tsx`（**改**）接 `canvasSize` / `motionBox` prop，删 `GUARD_CANVAS`，大预览换成 11 号组件。
13. `src/components/video/components/CameraMotionModal/MotionPreviewThumb.tsx`（**改**）修正失真注释。
14. `src/components/video/timeline/TimelinePanel.tsx`（**改**）下传画布尺寸与（静图的）摆放盒。
15. `src/lib/i18n.ts`（**改**）新增文案（真透视不可用提示、静图运镜的面板副标题）——**三处同改**：TS interface 声明 + en + zh。

### 7.4 后端

16. `app/models/video_models.py`（**改**）`ImageCompositionItem.camera_motion: Optional[CameraMotionSpec]`（复用既有 `CameraMotionSpec`，:138，含其 `end_ratio > start_ratio` 校验）。
17. `app/services/composition/camera_motion_overlay.py`（**新增**，≤ 300 行）叠加通道运镜段发射器：输入 `(spec, box, timing, fps, caps)`（**≤ 5 个形参 —— box 与 timing 用聚合结构体，不要摊成 `box_w, box_h, start_time, duration` 四个位置参数**），输出滤镜片段字符串。**只依赖 `camera_motion.py` 内核**，不重算几何；`state_at` 以 `enforce_coverage=False` 调用（§3.1.1）。方案 A 下**不产出 margin**（P1-8）。
18. `app/services/composition/ffmpeg_caps.py`（**改，STRETCH**）`supports_filter_complex_file` 探测位 + 消费点。注意既有 `FfmpegCaps` 已有 `supports_filter_complex_script`（:36）—— 按 L10，新增探测位必须同 PR 内有真实消费点与回归用例，否则不许加。
19. `app/services/video_composition_service.py`（**改**）—— **节点 #1 按真实符号重写（P0-1 / P0-4 / P1-10）**，四个落点缺一不可：
    - **19a** `_process_overlays_and_subtitles_combined`（:2523，有字幕路径）调用 17 号发射器；
    - **19b** `_process_image_overlays`（:2662，无字幕路径）调用**同一个**发射器（两处产出必须逐字符相同，见 L1 / 测试 27）；
    - **19c** `_process_overlays_sequential`（:2500，combined 失败时的回退梯）—— 它内部再调 19b，必须确认运镜不在这条回退路上丢失；
    - **19d** **编排块 :1564–:1613**：实现 L-I1 / L-I2 的**判定**。这是唯一能把 `composition_id` 标成 `failed` 的地方（§5）；今天这里失败只 `logger.warning` 然后继续标 `completed`。
    - **签名改造（P1-10）**：19a / 19b 的签名目前**都没有 fps**，必须把 `output_fps` 传进来；发射器的 fps 以 `ffprobe` 实测输入文件帧率为准、`output_fps` 兜底，不一致时记 warning。
20. `app/services/composition/filtergraph_builder.py`（**可能不改**）—— 视频侧路径按 H1 应保持逐字符不变；若发现必须改，说明 H1 被推翻，**停下来先报告**。

### 7.5 测试与夹具

21. `scripts/gen-camera-motion-golden.mjs`（**改**）追加静图黄金向量生成（唯一生成者）。
22. `docs/plans/camera-motion-stills-and-desktop-gate/fixtures/camera-motion-stills-golden.json`（**新增**）。
23. `src/components/video/playback/__tests__/cameraMotionBox.test.ts`（**新增**）—— 含「盒 = 画布时与 `cameraHomography` 逐位相同」的等价性证明用例（H1 的锁），以及 **N1-c 的三条 coverage 绝对值断言**（§3.1.1 / P0-3 —— 这是唯一能看见 coverage 缺陷的测试）。
24. `src/components/video/playback/__tests__/ImageOverlayLayer.motion.test.ts`（**新增**）时间段，含「静图以 `enforceCoverage=false` + 盒 aspect 调用 `motionStateAt`」的断言。
25. `src/components/video/playback/__tests__/CanvasCompositor.imageMotion.test.ts`（**新增**）2D transform 实参 / 3D 四角 / 降级不黑屏 / contain-then-transform 顺序 / 方案 A 的 `ctx.clip` 裁盒。
26. `src/components/video/hooks/__tests__/useVideoExport.stillsCameraMotion.test.ts`（**新增**）wire 透传。
27. `backend-services/basic-service/tests/test_camera_motion_overlay.py`（**新增**）发射器 vs 内核逐点（1e-6）、光栅序换位、`on/fps` 进度、25fps 用例（断言用的是 **ffprobe 实测帧率**而非请求值）、**两个组装点（19a / 19b）产出逐字符相同**、**方案 A 下不发射 `pad(margin)` / `crop`**。
28. `backend-services/basic-service/tests/test_image_overlay_no_silent_drop.py`（**新增**）L-I1 / L-I2 护栏（**先于功能代码写**）。必须覆盖 **19d 编排块**的三条失败路径：combined 返回 False、combined 抛异常（→ sequential 回退梯）、image-only 返回 False —— 三者在有 `camera_motion` 时都**不得**让合成以 `completed` 收尾。
29. `src/components/video/playback/__tests__/PerspectiveQuadRenderer.lifecycle.test.ts`（**新增**，节点 #1 补，配合 N5-③）`acquire()` / `release()` 计数配平与 `isUnavailable()` 降级 —— **注意方法名是 `release()`，该类没有 `dispose()`**。

### 7.6 实验台架（节点 #3 用，落在本目录）

`experiments/` 下新增 **`e6_n0_box_baseline.py`**（节点 #1 新增，**必须最先跑**：无运镜时预览盒 vs 导出盒的四角一致性，见 N0 / G4）/ `e7_n1_stills_geometry.py` / `e8_n2_stills_visual.py` / `e9_n3_dual_track.py` / `e10_n4_regression.py` / `e11_n5_panel.py` / `e12_n6_desktop_walkthrough.md`（人工清单 + 证据收集脚本）+ `run_all.py`（**顺序执行，e6 不达标即中止并报告**）。**复用** `docs/plans/timeline-camera-motion/experiments/_common.py` 与 `fixture_media.py`（以路径导入，**不复制** —— 两份台架漂移比没有台架更糟；两文件均已确认存在）。二进制不进仓库，只留 JSON / 小尺寸对比图。

**已由节点 #1 预先跑通、节点 #3 可直接引用的实证**（无需重跑，但重跑成本极低）：`perspective` 的 `on` 可用 / `t` 不可用（-22）、`eval=frame` 逐帧生效、方案 A 下 `pad(margin)+crop` 为 no-op、`pad=…:black@0` 对无 alpha 源也真透明、`-/filter_complex` 与 `-filter_complex_script` 在本机均可用（后者打印 deprecation）。

---

## 8. 分阶段落地（映射到下游节点）

### 8.1 MUST（最小可交付闭环，节点 #2 时间不足时的收敛线）

- G1 全链路：§7.1 / 7.2 / 7.3 的 1、3–10 号 + §7.4 全部（19 号的 a/b/c/d 四个落点缺一不可）+ 护栏测试 27/28 号。
- **§3.1.1 的 coverage 契约 + N1-c 绝对值断言**（节点 #1 提入 MUST，P0-3）—— 它决定旗舰场景 Ken Burns 的取景是否被静默篡改，且是唯一能被看见的方式。
- **G3 画布比例下传（14 号）**（节点 #1 从 STRETCH 提入 MUST，P1-9）—— `GUARD_CANVAS` 经 `isMotionRenderable → ensureCoverage` 影响 Apply 门禁，与 coverage 契约同根；面板拿不到真实画布就无法按盒/画布比例正确判定，两者必须同批落地。
- 指标：**N0（前置）**、N1（含 N1-c）、N2（可裁到 4 预设 × 2 进度点）、N4、N6。
- **理由**：G1 是「用户以为生效、其实没有」的静默缺陷，与 Iteration 1 拼死防住的是同一类；N6 是 Iteration 1 唯一没关的门。这两条不闭合，本轮不算交付。

### 8.2 STRETCH（有余量再做）

- G2 真透视大预览（11–13 号）与 N5。
- R4 新式 `-/filter_complex` 探测（实证数据见 P2-11，做的话必须遵守 L10）；N3 双轨逐像素；§3.4 方案 B（**注意：方案 B 才需要 `backdropMargin()`**，方案 A 下不需要，见 P1-8）。

### 8.3 节点分工

| 节点 | 职责 | 交付物 |
|------|------|--------|
| #1 评审 ✅ **已完成** | 逐条回读本文件引用的符号；完成 §3.3 的 **P0 spike**（`perspective` 表达式变量表实证）；把 v1 就地修订为 v2 | 本文件 v2 + `## 评审记录`（P0×4 / P1×6 / P2×5）+ `## 评审结论` |
| #2 实现 | 按 §7 落代码，护栏测试先行 | 代码 + 全绿定向套件（**不 commit**，由 #4 统一提交） |
| #3 实验 | 跑 N1–N7，产出 `results/*.json` + `results/samples/*.jpg` | 指标与日志；**发现的真实缺陷就地修** |
| #4 终审 | 不接受任何一方的断言为真，回读原始 JSON 与源码复核，按路径逐个 `git add` 后提交 | `results/report.md` + 提交 |

### 8.4 桌面 walkthrough 清单（N6，逐项留证）

1. `desktop/build.ps1` 重新打包（HEAD 必须包含本轮改动）；记录打包产物路径与时间。
2. 启动打包端，记录 `resources/ffmpeg` 的 `ffmpeg -version` 原文 + 后端日志里 `ffmpeg_caps` 的落档行。
3. 新建工程，导入 D4 素材（视频 + 图片 + 字幕）。
4. 给**视频** clip 加一个 3D 预设 → 画布预览正确（截图）。
5. 给**图片** clip 加一个 2D 预设 → 画布预览正确（截图，Ken Burns 主场景）。
6. 再给图片加一个 3D 预设，确认**下层轨道透出**（截图，对应 N3 的人工确认）。
7. 导出成片，在打包端播放器里播放，逐一确认三处运镜都在（录屏或抽 3 帧）。
8. 去掉所有运镜再导一次，确认成片与 B1 无差异、无多余警告。

任何一项失败都必须落进 `results/desktop-walkthrough.json` 的 `failures[]` 并阻塞节点 #4 的通过判定。

---

## 9. 风险与地雷（必须逐条防守）

| ID | 地雷 | 防守 |
|----|------|------|
| **L1** | 图片叠加有**两个组装点 + 一条静默回退梯**（有字幕 → `_process_overlays_and_subtitles_combined`:2523；无字幕 → `_process_image_overlays`:2662；combined 失败 → `_process_overlays_sequential`:2500 内部再调前者），改一处漏一处 → 「有字幕时有运镜」或「回退后运镜消失」<br>*（节点 #1 按真实符号重写：v1 引用的 `_merge_overlays_single_pass` 不存在，grep 0 命中）* | 单一发射器 + 27 号测试断言两个组装点逐字符相同；D4 夹具必须带字幕，walkthrough 第 8 步再跑一次无字幕；28 号测试覆盖回退梯 |
| **L2** | `perspective` 表达式里 `t` 未必存在 | ✅ **已实证结案（节点 #1）**：`t` 不可用（-22），`on` 可用，`eval=frame` 逐帧生效。一律用 `on/fps`；**开工前置已解除** |
| **L3** | 叠加通道的 `fps` 取错（源片 fps vs `output_fps` vs 实际输出帧率） | 两个组装点的签名里**目前都没有 fps**，先改签名；发射器以 **`ffprobe` 实测输入文件帧率**为准、`output_fps` 兜底，不一致记 warning；补一条 25fps 用例断言实测值被采用 |
| **L4** | 盒比例 ≠ 图片比例时「先 contain 再变换」与「先变换再 contain」分叉 | 冻结顺序为**变换盒**；D2 夹具用 4:3 图强制每次测量都走这条路 |
| **L5** | 离屏纹理每帧新建 → 掉帧与 GC 抖动 | `boxTextureCache` LRU + N7 的 1.0ms/图层 预算 |
| **L6** | WebGL 不可用时黑屏 | 仿射影子降级（沿用视频侧策略），并有单测 |
| **L7** | 多张图片各自 3D → WebGL 上下文/纹理暴涨 | 复用 `CanvasCompositor` 的**单个** `PerspectiveQuadRenderer`（逐图层顺序渲染），面板另有一个且随卸载 dispose；N5-③ 计数配平 |
| **L8** | 图片 `duration` 被拖拽后运镜时序错乱 | 进度按当前 `duration` 归一，`startRatio/endRatio` 存比例 |
| **L9** | 引入 `yuva420p` 影响既有 overlay / 编码 | 无运镜时不发射 `format`；N4-② 逐字符冻结 |
| **L10** | 新增能力位「探测了但没人消费」 | R4 的探测位必须同 PR 内有消费点 + 回归用例（Iteration 1 问题 1 的复发防线） |
| **L11** | walkthrough 验的是过期打包 | 打包前校验 `git rev-parse HEAD` 与打包产物时间戳，写进 `desktop-walkthrough.json` |
| **L12** | 后端 17 项既有 composition 失败遮蔽新回归（Iteration 1 的缺陷 B 就是被它遮住的） | N4-③/④ 按提交归因：在 `8c702ec` 的 detached worktree 里跑一遍取基线失败集合，只判**增量** |
| **L13** | jsdom 测不到真渲染（结构性盲区，R5） | 结构化断言（渲染器收到的四角）+ N2 方向哨兵 + walkthrough 三道；着色器或 `drawWithMotion` 一旦改动，**必须重跑 N2**，不许只看单测 |
| ~~**L14**~~ | ~~静图同时进了 `videoSequences` 与 `imageItems`~~ | **❌ 作废（节点 #1，P1-5）：该冗余不存在。** `CompositionAdapter.ts:117` 起有 `if (!material || material.type !== 'video') continue;`，图片素材不会进 `videoSequences`。按 v1 执行会为一个不存在的现象写测试、并在代码里留一条不实注释。**不要实现它。** 25 号测试保留「图片图层只被画一次」的断言是无害的，但它验证的是既有正确行为，不是修复 |
| **L15** | **（节点 #1 新增，G4/P1-7）** 预览盒挂 letterbox fit-rect、导出盒挂整帧 → 无运镜时就可能分叉，会把与运镜无关的偏差记到运镜头上 | N0 前置基线先测无运镜盒一致性；夹具收敛到「视频固有比例 == 工程画布比例」；实测偏差原样落 `results/n0-box-baseline.json` 作为既有缺陷证据。**本轮不扩大战线去修它** |
| **L16** | **（节点 #1 新增，P2-13）** `ImagePosition.rotation`（`video_models.py:100`）存在，但预览 `_drawImageLayer` 与导出 `_process_image_overlays` **都完全忽略它** | 登记为本轮**不变量**：节点 #2 不得"顺手"在任一侧实现旋转 —— 单侧实现会立刻制造一条新的预览/导出分叉，而它长得和运镜 bug 一模一样 |
| **L17** | **（节点 #1 新增，P0-3）** coverage 语义被 `motionStateAt` 无声继承到静图上，且 N1/N2 对此**结构性失明**（两侧一起错 → 偏差 0、SSIM 高） | §3.1.1 的显式契约（静图 `enforceCoverage=false`；若启用则 aspect 取盒比例）+ **N1-c 的绝对值断言**（唯一能看见它的测试）+ `isMotionRenderable` 跟随同策略 |

---

## 10. Definition of Done

0. **（节点 #1 新增，前置）** N0 通过：无运镜时预览盒与导出盒四角偏差 ≤ 1px，`results/n0-box-baseline.json` 已落档 —— 否则 N1/N2 的读数不可归因。
1. 时间轴上的**静态图片片段**可以打开运镜面板、选预设、调参、撤销 —— 且**预览实时正确呈现**。
2. 带运镜的图片片段**导出成片逐帧还原同一运镜**，两个 overlay 组装点（有/无字幕）**及 combined→sequential 回退梯**行为一致。
3. N1 ≤ 0.5px；**N1-c 的三条 coverage 绝对值断言为绿**（§3.1.1 —— 它们是唯一能看见 coverage 缺陷的测试）；N2 分级 SSIM 达标且方向哨兵全绿；N4 四条零回归全满足。
4. **L-I1 / L-I2 两条「静默吞特效」护栏测试为绿** —— 与 Iteration 1 的 L1 / L11 同等不可妥协。**判定必须落在编排块**（§7.4-19d）：带 `camera_motion` 时，combined 返回 False / combined 抛异常走回退梯 / image-only 返回 False 这三条路都**不得**以 `completed` 收尾。
5. **DoD #8 闭合**：§8.4 的 8 项 walkthrough 全绿，`results/desktop-walkthrough.json` 含打包端 FFmpeg 版本与能力落档。
6. 视频侧运镜**逐字符不变**（H1 的构造性保证被实测确认）。
7. N7：性能预算、i18n 三处齐平、文件行数/函数长度/形参数量全部在仓库阈值内、`tsc --noEmit` 通过。
8. **（MUST，节点 #1 从 STRETCH 提出，P1-9）** `GUARD_CANVAS` 已被真实画布尺寸取代，面板的 `isMotionRenderable` 判据与真实渲染同构（含 9:16 竖屏工程），且与 §3.1.1 的 coverage 策略一致。
9. （STRETCH 达成时）面板 3D 预设呈现**真透视**，WebGL 不可用时优雅降级且无上下文泄漏（`release()`/`acquire()` 计数配平，**该类没有 `dispose()`**）。
10. 无僵尸代码、无无主 TODO；`MotionPreviewThumb` 的失真注释已修正；**原 L14 与 rotation 均未被实现**（L14 描述的冗余不存在，rotation 是本轮不变量）。
11. 所有实验产物落在本目录 `results/`；二进制不进仓库；提交按路径逐个 `git add`（禁 `git add -A` / `.`）。

---

## 11. 交接说明

- **feature 目录名**：`camera-motion-stills-and-desktop-gate`
- 本目录内可新增 `specs/`、`todos/`、`fixtures/`、`experiments/`、`results/`；`experiment-plan.md` 保持唯一入口文件。
- 上一轮的 `docs/plans/timeline-camera-motion/` 是**只读归档**，可以读、可以引用、**不要修改**。
- 节点 #0 未写任何实现代码、未 `git add` / `git commit`、未改动任何项目源码。
- **节点 #1（评审）同样只改了本文件**：未写任何实现代码、未改动任何项目源码、未 `git add` / `git commit`。评审期间跑的 FFmpeg 探针全部在系统临时目录内进行，未在仓库留下任何产物。
- 本分支（`feat/remove-user-system`）工作树仍有大量在途改动；节点 #4 提交时务必按路径逐个 `git add`，并留意 `__pycache__` / `.next` / `tsconfig.tsbuildinfo` 不入库（`.gitignore` 覆盖不全，见 CLAUDE.md）。

---

## 评审结论

### 判定：**有条件通过（Conditionally Approved）** — 版本 v1 → **v2**

v1 是一份**高质量**的计划：问题定位（G1 静图运镜静默无效）是真的、严重性判断是对的、"不可测就写明不可测"的口径与"护栏测试先于功能代码"的纪律都继承得很好。**它被打回条件通过，不是因为方向错，而是因为三类具体缺陷**：

1. **一处虚构 API 污染了整个导出侧设计**（P0-1）。`_merge_overlays_single_pass` 不存在，而它是 5 个章节、1 条地雷、1 条 DoD、1 个测试的共同支点。真实拓扑（两个组装点 + 一条静默回退梯）比 v1 设想的更危险。
2. **一个所有既定指标都看不见的缺陷**（P0-3 / L17）。`ensureCoverage` 对静图的语义从未被决策，而 N1（比两侧之差）与 N2（比预览与成片）在这件事上会**一起错**，双双全绿。旗舰场景 Ken Burns 恰好落在这条语义上。评审的价值主要就体现在这一条 —— 它必须靠**绝对值断言**（N1-c）才能被看见。
3. **护栏写在了发射器上，而失败判定在编排块**（P0-4）。今天「图片叠加整体失败 → 一行日志 → 成片标记 completed」是既有行为，不改编排块，L-I2 就是一纸空文。

同时，评审也**用真实 FFmpeg 替 v1 结清了它自己挂起的 P0 spike**（P0-2），并把 v1 的两处保守假设证伪、换成了更简单的实现（P1-8：`pad(margin)+crop` 是 no-op，`format=yuva420p` 非必需，既有 `black@0` 对无 alpha 源也真透明）—— 净效果是**导出侧滤镜串更短、坐标系陷阱更少**。

### 落地条件（节点 #2 开工前必须确认已理解，逐条对应）

| # | 条件 | 对应 |
|---|------|------|
| 1 | 导出侧一律使用真实符号 `_process_overlays_and_subtitles_combined` / `_process_image_overlays` / `_process_overlays_sequential`；**不要去找 `_merge_overlays_single_pass`** | P0-1 |
| 2 | 运镜进度一律 `on/fps`，**不得使用 `t`**（已实证不可用）；fps 以 ffprobe 实测为准、`output_fps` 兜底，且两个组装点的签名必须先加 fps | P0-2 / P1-10 |
| 3 | `motionStateAt` 加**可选第 5 参** `enforceCoverage=true`（默认值保证视频侧逐位不变）；静图传 `false`，aspect 传**盒比例**；`isMotionRenderable` 跟随同策略；**N1-c 的绝对值断言必须写** | P0-3 / P1-9 |
| 4 | L-I1 / L-I2 的判定写在**编排块 :1564–:1613**，覆盖 combined 失败、combined 抛异常走回退梯、image-only 失败三条路；**护栏测试先于功能代码** | P0-4 |
| 5 | 方案 A **不发射** `pad(margin)` 与 `crop`，四角直接写在盒空间；`backdropMargin()` 仅方案 B 需要 | P1-8 |
| 6 | teardown 方法名是 **`release()`**，`PerspectiveQuadRenderer` 没有 `dispose()` | P1-6 |
| 7 | **N0 必须最先跑**且达标，否则 N1/N2 的偏差不可归因；夹具收敛到「视频固有比例 == 工程画布比例」 | P1-7 |
| 8 | **不要实现原 L14**（图片不会进 `videoSequences`，该冗余不存在）；**不要实现 rotation**（L16） | P1-5 / P2-13 |

### 未闭合项（不阻塞开工，节点 #3 / #4 需要知道）

- **DoD #8 桌面 walkthrough（N6）仍是本轮最大的未知**，且它是 Iteration 1 唯一没关上的门。打包端自带 FFmpeg，其 `perspective` 行为**未经本节点实证**（本节点的所有探针跑的是开发机的 `gyan.dev` build）。§8.4 第 2 步记录打包端 `ffmpeg -version` 与 `ffmpeg_caps` 落档因此不是形式主义 —— 它是把 H4 从假设变成记录的唯一手段。**L11（打包必须晚于本轮改动）务必先校验 `git rev-parse HEAD`**。
- **G4（预览/导出盒基准不同源）本轮只挡不修**。它是一个真实的既有缺陷，值得单开一轮；本轮用 N0 + 夹具约束把它隔离在测量之外，并留下 `n0-box-baseline.json` 作为下一轮的起点证据。
- **R2（双轨 3D 露底逐像素）/ R4（`-/filter_complex`）留在 STRETCH**。R4 的实证数据已补齐（新旧两式在本机均可用，旧式打印 deprecation），若本轮不做，日志里的 deprecation 警告会持续出现，不影响功能；若要做，**必须遵守 L10**（探测位同 PR 内要有真实消费点 + 回归用例）——这正是 Iteration 1 终审问题 1 的复发防线。

### 评审自身的边界（诚实声明）

- 本节点的 FFmpeg 探针在**开发机**上运行，结论对打包端**不自动成立**（这正是 N6 存在的理由）。
- 本节点**未运行**前端 vitest / 后端 pytest / `tsc`，未验证任何尚不存在的代码 —— 评审只核对了 v1 引用的**既有**符号与 FFmpeg 的**既有**行为。
- 本节点**只修改了本文件**，未改动任何项目源码，未 `git add` / `git commit`。

**结论：v2 可以交给节点 #2 开工。** 上表 8 条落地条件是通过的前提；其中第 3 条（coverage 契约 + N1-c 断言）与第 4 条（L-I2 落在编排块）是本轮**最容易被做成"看起来绿实际没做"**的两条，节点 #4 终审时应优先复核这两处的原始测试代码，而不是只看指标 JSON。
