# 诊断报告：导出视频包含已删除的片段素材 / 未使用轨道上的最新素材

- **Bug slug**: `video-export-uses-deleted-clip-material`
- **报告人**: 资深调试工程师（Subtask #0 问题定位与分析）
- **日期**: 2026-06-04
- **相关轮次**: 第 2 轮（针对第 1 轮提交 `f00f61e` 引入的"导出复用已下载素材"功能的回归）
- **本节点约束**: 仅做定位与分析，不写修复代码、不提交。

---

## 一、问题描述（Problem description）

用户反馈（原文）：

> 加入到下方剪辑面板上的视频，后续又删除掉了（轨道上），但导出的视频，还有那些删除之后的视频**片段**素材在其中，没有使用轨道上的最新的视频素材。

拆解为两个可验证的现象：

1. **导出结果包含已从轨道删除的视频片段内容**（"删除之后的视频片段素材还在其中"）。
2. **导出结果没有使用当前轨道上真正引用的素材文件**（"没有使用轨道上的最新的视频素材"）。

关键词 **"视频片段素材"（片段 = clip/segment）** 指向 `VideoCutModal` 视频切分功能产出的"切片素材"，而非普通整段搜索素材。下文复现与根因均围绕"切片素材"展开。

第 1 轮（`f00f61e` "reuse already-downloaded materials on video export"）把导出从"按 URL 精确查缓存"改成了"**按 `(source, source_id)` 复合键 + `cache_url` 磁盘提示**复用缓存文件"。本轮问题即由该改动触发。

---

## 二、复现步骤（Reproduction steps）

> 前置：使用一个**带 `metadata.source` + `metadata.sourceId`** 的源视频（如 Pexels / Unsplash / Freesound 搜索得到的视频；只要素材 metadata 里带 `source` 和 `sourceId` 即可触发）。本地上传且无 source 元数据的视频**不会**触发（见 §三.4 边界）。

1. 在视频编辑器中，对一个 Pexels 源视频 X 使用"视频切分 / 剪辑"功能（`VideoCutModal`），切出 ≥2 个片段：`clip1`、`clip2`、`clip3`。它们会作为独立切片素材加入下方素材/剪辑面板，每个片段是**独立的物理文件、独立的 URL**。
2. 把 `clip1`、`clip2`、`clip3` 都拖到视频轨道。
3. 删除其中一个（例如 `clip2`，键盘 `Delete` 或工具栏删除均可）。
4. 点击"导出视频"。
5. **观察**：导出的视频里，多个片段位看到的是**同一个片段**的画面（往往是最后被处理/缓存的那个片段，可能正是已删除的 `clip2`），而不是轨道上当前的 `clip1` / `clip3`。

更容易稳定复现的等价路径（让缓存行先存在）：

- 1'. 先把源视频 X 本身加到轨道（X 是远程素材，会被后台预取并写入 `cached_materials` 一行：`(pexels, X.sourceId) → 整段 X 文件`）。
- 2'. 再对 X 切分出 `clip1/clip2/...` 加入轨道、删除若干、导出。
- 结果：每个切片导出时都命中 `(pexels, X.sourceId)` 那一行，全部解析到**同一个文件**（整段 X 或某个切片），当前切片自己的 URL 被忽略。

**为什么常常要"导出一次后再导出"才明显**：首轮导出若缓存里尚无该 `(source, source_id)` 行，复合键查询 miss，回退到按各自 URL 下载，结果正确；但首轮的**写回**会把所有切片塞进同一行（见 §三.3），于是**第二次导出**（即用户"先删再导"的真实操作序列里常见的多次导出）开始稳定复现。

---

## 三、根因分析（Root cause analysis，含证据）

### 结论

第 1 轮把"切片素材"的导出缓存键设成了它们**共同的父级 `(source, source_id)`**。由于 `cached_materials` 对 `(source, source_id)` 有唯一约束，**同一源视频切出的所有片段在缓存里坍缩成同一行、同一个文件**；后端导出又**优先用复合键/`cache_url` 解析文件、把片段真正的 URL 放在最后**。于是删除部分片段后，剩余片段在导出时仍解析到那一个被复用/覆盖过的文件——即"删除片段的内容还在、当前轨道素材没被用上"。

### 证据链（按数据流顺序）

**(1) 切片素材继承了父素材的 `source` / `sourceId`，但内容/URL 各不相同**

`src/components/video/VideoEditingInterface.tsx:1191`（创建临时切片素材时展开父 metadata）：

```ts
metadata: {
  ...originalMaterial.metadata,   // ← 把父视频的 source / sourceId 一并继承
  isClip: true,
  originalMaterialId: originalMaterial.id,
  ...
}
```

切分完成后回填，每个片段拿到**各自独立的 URL**，metadata 仍保留父级 source/sourceId —— `src/components/video/VideoEditingInterface.tsx:1244`：

```ts
const updatedMaterial: MaterialItem = {
  ...tempClipMaterials[index],
  url: cutClip.video_url,          // ← 每个片段不同的物理文件
  serverUrl: cutClip.video_url,
  ...
  metadata: { ...tempClipMaterials[index].metadata, cutClipResult: cutClip }, // source/sourceId 仍在
};
```

**(2) 复合键完全由 `(metadata.source, metadata.sourceId)` 决定 → 同源切片键相同**

`src/components/video/lib/materialKey.ts:57`：

```ts
export function materialCompositeKey(material: MaterialKeyInput): MaterialCompositeKey {
  const meta = (material.metadata ?? {}) as Record<string, unknown>;
  const metaSource = typeof meta.source === 'string' ? (meta.source as string) : '';
  const metaSourceId =
    asIdString(meta.sourceId) || asIdString(meta.id) || asIdString(meta.video_id);
  const source = metaSource && metaSource !== 'ark-ai-video' ? metaSource : '';
  if (source && metaSourceId) {
    return { source, source_id: metaSourceId };   // ← 所有同源切片在此返回相同键
  }
  return { source: 'url', source_id: hashUrl(url) };
}
```

注意：键里**没有任何内容判别量**（不含 clip 范围、不含各片段自身 URL）。`isClip` 也未被纳入判断。

导出请求按此键逐项下发 —— `src/components/video/hooks/useVideoExport.ts:299`：

```ts
const { source: cacheSource, source_id: cacheSourceId } = materialCompositeKey(material);
videoItems.push({
  ...
  url: videoUrl,            // 片段真实 URL
  source: cacheSource,      // ← 同源切片相同
  source_id: cacheSourceId, // ← 同源切片相同
  cache_url: material.cacheUrl || undefined,
});
```

**(3) 缓存表对 `(source, source_id)` 唯一 → 同源切片坍缩为一行一文件，且会被互相覆盖**

唯一约束 —— `backend-services/basic-service/app/models/db_models.py:157`：

```python
__table_args__ = (
    UniqueConstraint("source", "source_id", name="uq_cached_materials_source_id"),
)
```

磁盘文件名也只由 `(source, source_id)` 决定 —— `backend-services/basic-service/app/services/material_download_service.py:619`：

```python
def _target_path(self, source: str, source_id: str, url: str) -> str:
    ...
    safe_id = "".join(c for c in source_id if c.isalnum() or c in ("-", "_"))[:64] or "asset"
    return str(sub_dir / f"{safe_id}{ext}")   # ← <source>/<source_id>.<ext>，同源切片同名 → 互相覆盖
```

写回（write-through）按 `(source, source_id)` upsert 同一行，把 `local_path` 翻转到"最后处理的那个片段" —— `material_download_service.py:493` 与 `:524`：

```python
cached_path = self._target_path(source, source_id or self._fallback_id(url), url)
...
# upsert 命中已存在的 (source, source_id) 行时：
row.source_url = url
row.local_path = cached_path   # ← 被最后一个片段覆盖
row.status = "ready"
```

**(4) 复合键查询忽略 URL，"先 source_id 后 url"**

`material_download_service.py:282`（`_lookup_impl`）：

```python
if source and source_id:
    stmt = select(CachedMaterial).where(
        CachedMaterial.source == source,
        CachedMaterial.source_id == str(source_id),
    )
    row = result.scalar_one_or_none()   # ← 命中即返回该行，完全不比对 url
if row is None and url:
    ...                                  # url 只是兜底
```

**(5) 导出时后端优先用复合键 / `cache_url` 解析文件，真实 URL 放最后**

`backend-services/basic-service/app/services/video_composition_service.py:944`（位于 `:936` 起的 `for url in unique_urls:` 复用循环内）：

```python
cached_path = material_svc.resolve_cached_path(
    url=url, source=src, source_id=sid, cache_url=cache_url
)   # F2 cache_url 磁盘提示 → F1 (source,source_id) → F4 等待；三者都命中同一行
if not (cached_path and os.path.exists(cached_path)):
    cached_path = material_svc.lookup_by_url(url)   # 仅在前面 miss 才回退到真实 URL
```

把 (1)~(5) 串起来：同源切片 `clip1/clip2/clip3` 在缓存层是**同一行、同一文件**，导出对每个切片都优先用这一行解析出的文件，且这文件已被写回逻辑覆盖成某一个切片（可能是已删除的那个）。剩余切片于是全部播放成那一个文件的内容——**"删除的片段还在 / 当前素材没被用上"**。

### 这是 `f00f61e` 的回归（对照证据）

`f00f61e` 之前，导出查缓存只有"精确 URL"一条路径（`lookup_by_url`）。切片各自 URL 不同 → 命中不同文件/各自下载 → 结果正确。`f00f61e` 新增的"复合键/`cache_url` 优先"复用路径把内容**非唯一**的 `(source, source_id)` 当成了内容身份，才产生坍缩。提交信息自述该键"resilient to CDN URL rotation"——对"同一逻辑视频换 CDN URL"成立，但对"同一 source 切出的不同片段"**不成立**，正是被忽略的失效场景。

### 关联/放大向量（非主因，但加重现象）

- **预取去重**：`useRemoteMaterialPrefetch` 以 `${source}::${source_id}` 去重（`hooks/useRemoteMaterialPrefetch.ts:334`），同源切片只会预取一次，并把同一个 `cacheUrl`（`r.local_url`）回填给所有切片。若切片 URL 是**远程**（如开启 OSS 时 `cutClip.video_url` 为远程地址），则连**预览**也会被带歪；默认本地存储（同源 `/api/storage/...`）时预取被跳过，预览正常、仅导出出错——与用户"预览看着对、导出错"的体感一致。
- **`cache_url` 盲信（F2）**：`_resolve_cache_url_to_disk` 只做路径越界校验、不校验内容是否与 `url` 对应（`material_download_service.py` F2 实现），一旦 `cacheUrl` 因上面去重被写成别的片段文件，导出直接复用错误文件。
- **`ark` vs `ark-ai-video` 命名不一致**：前端 `materialCompositeKey` 仅排除 `'ark-ai-video'`，而后端写回 ARK/Storyboard 用 `source='ark'`（见 `CLAUDE.md`）。若某素材 metadata.source 恰为 `'ark'` 且复用了 sourceId，亦可能命中同类坍缩。属同一类"键非内容唯一"问题，建议一并核查。

---

## 四、影响面（Impact surface）

- **受影响功能**：视频导出（`useVideoExport` 合成导出路径）。
- **受影响素材**：任何 **`metadata` 携带 `source` + `sourceId` 的素材所切出的多个片段**（典型为 Pexels/Unsplash/Freesound 等搜索来源视频经 `VideoCutModal` 切分后的切片）；以及更一般地，任何**两个内容不同却共享 `(source, source_id)` 的素材**。
- **不受影响**：
  - 普通"整段"搜索素材（不同视频 `sourceId` 不同，键天然唯一）。
  - 纯本地上传、无 `metadata.source` 的素材切片（落入 `('url', hash(url))`，各片段 URL 不同 → 键唯一，不坍缩）。
  - 预览播放（本地存储场景下切片为同源 URL、跳过预取，按各自 `serverUrl` 播放，正常）。
- **触发时机**：源视频曾被预取、或对同源切片做过 ≥1 次导出后，`(source, source_id)` 行已存在，之后的导出稳定复现。
- **严重度**：高。导出是核心交付物，且**静默出错**（无报错、内容错配），用户难以察觉直至检查成片。
- **引入版本**：`f00f61e`（2026-06-04），第 1 轮"导出复用已下载素材"。

---

## 五、候选修复方案（Candidate fixes 对比）

| 方案 | 改动位置 | 思路 | 侵入性 | 风险 | 工作量 |
|---|---|---|---|---|---|
| **A. 切片/派生素材改用内容唯一的 URL 键** | `src/components/video/lib/materialKey.ts`（单文件） | 在 `materialCompositeKey` 中检测派生素材（`metadata.isClip === true` 或 `metadata.originalMaterialId`），强制走 `('url', hashUrl(url))`，使每个片段键唯一 | 低 | 低 | 低 |
| **B. 创建切片时不继承 `source`/`sourceId`** | `VideoEditingInterface.tsx#handleExportClips`（单文件） | 复制父 metadata 时剔除 `source`/`sourceId`（或给每个切片写入唯一 `sourceId`，如 clip id） | 低 | 中（改变切片 metadata 形态，可能影响其它读 metadata 的逻辑） | 低 |
| **C. 后端复合键复用增加 URL 一致性校验** | `material_download_service.py#_lookup_impl` / `resolve_cached_path` | F1 命中 `(source, source_id)` 行后，仅当 `row.source_url == 请求 url` 才复用，否则视为 miss → 回退下载 | 中 | 中（削弱 `f00f61e` 主打的"CDN URL 轮换仍复用"能力） | 中 |
| **D. A + C 组合（前端键唯一 + 后端兜底校验）** | 上述两处 | 前端从源头让键内容唯一；后端再加一道"键非唯一也不会喂错文件"的防线 | 中 | 低 | 中 |

补充说明：

- 方案 **A** 是"单一事实源"修复：`materialKey.ts` 文档自述是 ingest 与 export 共用的键派生唯一入口，在此加守卫可同时修正**导出键**与**预取去重键**，最小且自洽。
- 方案 **C** 单独使用即可止血，但会让"同一视频 CDN URL 变了仍复用"的特性退化为"URL 不同就重下"，与 `f00f61e` 的设计目标冲突；更适合作为**防御纵深**而非唯一修复。
- 方案 **B** 触及更广（凡是读 `metadata.source` 的地方都会变），需评估对预览代理启发式（`useRemoteMaterialPrefetch` 中的 `PREVIEW_PROXY_SOURCES`）等的连带影响。

---

## 六、推荐方案（Recommended fix）

**推荐 D = A（主修，必做）+ C（后端防御纵深，建议同做）。** 若只能改一处，则取 **A**。

**理由：**

1. **A 命中根因且最小**：根因是"切片复合键内容不唯一"。在 `materialCompositeKey`（ingest/export 共用的唯一键入口，见 `materialKey.ts:1` 文档）对派生素材回退到 URL 键，使每个片段键唯一，从源头消除坍缩；改动一处、风险低、与现有架构一致，且**不影响**普通整段素材的 `(source, source_id)` 复用与 CDN 轮换收益。
2. **C 提供不可绕过的正确性兜底**：即便将来又出现别的"键非内容唯一"场景（如 §三 的 `ark`/`ark-ai-video` 不一致），后端在按复合键复用前比对 `source_url`，可保证"宁可重下、绝不喂错文件"，把**静默错配**降级为"最多慢一点"。这恰好契合 `f00f61e` 自述的设计契约——"miss 永远回退原下载路径、正确性不变"。
3. **可验证**：按 §二 复现步骤，修复后每个剩余切片应解析到各自 URL/各自文件，导出成片中不再出现已删除片段的内容、且使用轨道当前素材。

**落地要点（交付给修复节点 Subtask #2 的提示，不在本节点实现）：**

- A：在 `materialCompositeKey` 开头判断 `meta.isClip === true || meta.originalMaterialId` 时直接返回 `{ source: 'url', source_id: hashUrl(material.url || material.serverUrl || '') }`；补一条单测：两个共享 `source/sourceId`、URL 不同的切片，键必须不同（对应 `materialKey` 现有测试风格）。
- C：在 `_lookup_impl` 复合键分支命中后，若 `row.source_url` 与传入 `url` 均非空且不相等，则不返回该行（继续 url 兜底/下载）；保留"传入 url 为空时仍按复合键复用"的旧行为，避免误伤合法轮换场景。
- 数据残留：现网 `cached_materials` 里可能已有被切片污染的 `(source, source_id)` 行；A+C 之后这些行不再被切片查询，源视频本身仍正确命中，无需强制清理（如需彻底干净可单独清除 `local_path` 指向切片文件的行）。

---

## 七、关键证据索引（Evidence index）

| 编号 | 文件:行 | 作用 |
|---|---|---|
| E1 | `src/components/video/VideoEditingInterface.tsx:1191` | 切片继承父 `metadata`（含 source/sourceId） |
| E2 | `src/components/video/VideoEditingInterface.tsx:1244` | 切片回填各自 URL、metadata 仍含父级身份 |
| E3 | `src/components/video/lib/materialKey.ts:57` | 复合键仅由 source/sourceId 决定、无内容判别 |
| E4 | `src/components/video/hooks/useVideoExport.ts:299` | 导出按复合键 + cache_url 下发每个视频项 |
| E5 | `backend-services/basic-service/app/models/db_models.py:157` | `(source, source_id)` 唯一约束 → 同键单行 |
| E6 | `backend-services/basic-service/app/services/material_download_service.py:619` | 缓存文件名仅由 (source, source_id) 决定 → 同名覆盖 |
| E7 | `backend-services/basic-service/app/services/material_download_service.py:493` / `:524` | 写回 upsert 同一行、`local_path` 被最后片段覆盖 |
| E8 | `backend-services/basic-service/app/services/material_download_service.py:282` | `_lookup_impl` 先按复合键命中、忽略 URL |
| E9 | `backend-services/basic-service/app/services/video_composition_service.py:944` | 导出优先 `resolve_cached_path`，真实 URL 仅兜底 |
| E10 | `git show f00f61e` | 回归来源：新增"复合键/cache_url 优先"复用路径 |
| E11 | `src/components/video/hooks/useRemoteMaterialPrefetch.ts:242` | `keyFor` 委托 `materialCompositeKey` → 证明它是 ingest/prefetch/export 三处共用的唯一键入口（评审补） |
| E12 | `src/components/video/hooks/useRemoteMaterialPrefetch.ts:230` / `:259` | `defaultIsRemoteUrl` 对同源 URL 返回 false + `shouldPrefetch` 仅对 remote 触发 → 本地存储 clip 跳过预取（评审补） |
| E13 | `backend-services/basic-service/app/services/material_download_service.py:293` / `:354` | `_lookup_impl` 命中复合键即返回、不比对 url；`resolve_cached_path` F2→F1→F4 顺序 → 坍缩的"最反直觉一跳"（评审补） |
| E14 | `src/components/video/hooks/useVideoExport.ts:181` / `:203` | 导出按 `timelineState.tracks→track.items` 逐项构建 → 已删除片段不在请求内（排除"状态陈旧"假说，评审补） |

---

## 评审结论（Review Verdict）

- **评审人**: 资深评审工程师（Subtask #1 分析报告评审与修复）
- **日期**: 2026-06-04
- **评审范围**: 根因证据链审计 + 候选修复审计 + 敲定单一推荐方案
- **总判定**: 根因成立、证据链闭合（airtight）；**采纳方案 A 为唯一必做修复，明确不采纳方案 C（按现描述）**。

### 一、根因证据链：逐条复核，判定成立

E1–E10 引用均与当前代码逐字一致，已实际执行在失败路径上；本次评审补充 E11–E14 后链路完全闭合。四点复核结论：

1. **链路闭合且每跳都被执行**：clip 继承父 `(source, sourceId)`（E1/E2）→ `materialCompositeKey` 对同源 clip 返回相同键（E3）→ 导出按该键下发每个视频项（E4）→ 后端 `resolve_cached_path` 先 F2/F1 命中那一行（E9 + `resolve_cached_path:354`）→ 唯一约束（E5）+ 同名文件（E6）+ 写回覆盖（E7）使同源 clip 在缓存层坍缩为"一行一文件"。

2. **最反直觉的一跳已确证（linchpin）**：后端去重是按 `item.url`（每个 clip 各不相同）做的（`video_composition_service.py:904-914`），"按 URL 去重"极易让人误判 clip 不会坍缩。但坍缩发生在**去重之后的 resolve 阶段**——`_lookup_impl` 一旦命中 `(source, source_id)` 复合键就直接 `return` 该行、**完全不比对 url**（`material_download_service.py:293-299`，E13）。因此即便三个 clip 的 url 互不相同，`resolve_cached_path` 仍把它们全部解析到同一行同一文件。这正是"每个 url 看似独立、最终却复用同一文件"的关键，证据确凿，非推测。

3. **症状判别排除了"前端状态陈旧"这一替代假说**：
   - 若为状态陈旧（导出请求仍夹带已删除 clip），症状应是"已删除 clip 作为**额外**片段出现，而 clip1/clip3 仍各自正确"；
   - 本 bug 的实际症状是"剩余每个片段都渲染成**同一个**文件、轨道当前素材整体没被用上"——这只可能由缓存层坍缩产生，不可能由状态陈旧产生。用户原文"没有使用轨道上的最新的视频素材"正对应坍缩特征。
   - 代码层面亦已锁死：导出按 `timelineState.tracks→track.items` 逐项构建（E14），已删除 clip 根本不在 `track.items` 内、不会作为独立项下发。叠加 Subtask #0 对前端删除链路的核验，"状态陈旧"假说被排除。

4. **回归归因正确**：`git show f00f61e`（E10）确认该提交新增了 F1 复合键 / F2 `cache_url` 优先复用路径；提交信息自述键"rotation-resilient"——对"同一逻辑视频换 CDN URL"成立，但把**内容非唯一**的 `(source, source_id)` 当作内容身份，对"同源切片"不成立，正是被忽略的失效场景。

### 二、候选修复审计（并发 / 错误路径 / 边界输入 / 回归四维）

**方案 A —— 在 `materialCompositeKey` 对派生素材回退 URL 键。命中根因、最小、无新回归。采纳为主修。**

- **派生素材判别**：clip 创建时同时写入 `isClip:true` 与 `originalMaterialId`（`VideoEditingInterface.tsx:1193-1194`），守卫 `meta.isClip === true || meta.originalMaterialId != null` 稳定命中，无漏判。
- **键唯一性 / 不互相覆盖**：clip 各自 url 不同 → `('url', hashUrl(url))` 互不相同；`_target_path` 落到 `url/<hash>.<ext>` 互不覆盖（E6 反向成立）。
- **不误伤正常素材**：整段父素材无 `isClip` → 仍走 `(source, sourceId)`，**CDN 轮换复用收益完全保留**，普通搜索素材的导出提速不受影响。
- **写回一致 + 并发安全**：导出请求会一并下发 `source='url'`、`source_id=hash(url)`（E4 路径），`store_external_download` 按同键 upsert → 每个 clip 独立行、独立文件；独立键 → 无 upsert 竞争、F4 等待按各自键独立进行。
- **单一事实源（三键统一）**：因 `keyFor` 委托 `materialCompositeKey`（E11），A **一处改动同时修正导出键、写回键与预取去重键**，无需在 `useVideoExport` / `useRemoteMaterialPrefetch` 各自打补丁。
- **残留风险极低**：远程 clip（OSS 开启）会从"一次预取"变为"每 clip 各自预取"——属正确性提升而非回归（本地存储默认场景 clip 同源、本就跳过预取，E12）。

**方案 C —— 后端 F1 命中后要求 `row.source_url == url` 才复用。不予采纳（按现描述会回归 f00f61e 主特性）。**

- **关键反对证据**：导出路径的每个 video item 都携带**非空** url（`useVideoExport.ts:305`）。f00f61e 复合键复用的**核心价值**正是"url 因 CDN 轮换而与入库 `source_url` 不同也仍能命中"。Fix C 的"两者均非空且不相等即视为 miss → 重下"，会在导出路径上对**任何轮换过的 url** 强制重新下载——等于把 f00f61e 的复合键复用退化回近似精确 URL 行为。
- **严重度修正**：§五/§六 把该副作用定性为"削弱 CDN 轮换复用能力"，但在**导出路径（本 bug 唯一相关路径，url 恒非空）**严重度被低估——实际近乎**令该招牌特性失效**；分析中"保留传入 url 为空时仍按复合键复用"的carve-out 对导出路径不起任何保护作用。
- **结论**：C 既做额外工作（多一道校验），又引入新回归（CDN 复用失效），不满足"最小且不引新回归"。若日后确需后端纵深防御，应采用**不被 query 轮换击穿的内容判别**（规范化 url path/basename 比对，或入库内容哈希），并与本 bug 修复**解耦**，**不应以严格 url 相等实现**。

**方案 B —— 创建 clip 时剔除 `source`/`sourceId`。不推荐。** 触及所有读 `metadata.source` 的逻辑（如 `PREVIEW_PROXY_SOURCES` 启发式，`useRemoteMaterialPrefetch.ts:52`/`:75`），副作用面显著大于 A，收益相同。

### 三、最终推荐方案（单一）

> **采纳方案 A 为唯一必做修复；不采纳方案 C（按现描述）。** 即把 §六 的推荐由"D = A + C"收敛为"仅 A"。

**理由**：A 在唯一键入口 `materialCompositeKey` 对派生素材回退到**内容唯一**的 URL 键，单文件改动即从源头消除"同源 clip 键坍缩"，端到端修复导出键、写回键、预取去重键（E11），且**不影响**整段素材的 `(source, sourceId)` 复用与 CDN 轮换提速收益，无新回归；而 C 在导出路径上会回归 f00f61e 招牌的 CDN 轮换复用，属"额外工作 + 新回归"，不纳入本次最小修复。

**交付 Subtask #2 的落地要点（本节点不实现）**：

1. **A 实现**：在 `materialCompositeKey` 中，于"`source && metaSourceId` 命中返回"之前加守卫：
   `const isDerived = meta.isClip === true || meta.originalMaterialId != null;`
   `if (isDerived) return { source: 'url', source_id: hashUrl(url) };`
   （`url` 已为 `material.url || material.serverUrl || ''`，无需另取。）
2. **单测**：当前仓库**无** `materialKey.test.ts`（f00f61e 的相关用例以**行为验证**形式落在 `useRemoteMaterialPrefetch.test.ts`，并未直接 `import materialCompositeKey`）。建议新增 `src/components/video/lib/__tests__/materialKey.test.ts`，至少覆盖：(a) 两个共享 `source`/`sourceId`、url 不同的 `isClip` 素材 → 键必须不同；(b) 普通整段素材（无 `isClip`）→ 仍返回 `(source, sourceId)`；(c) 无 `source` 的本地素材 → `('url', hashUrl)`。
3. **不采纳 C**：如确需后端纵深防御，另起任务并采用内容判别（非严格 url 相等）。
4. **数据残留**：现网 `cached_materials` 中 `(source, sourceId)` 行可能已被 clip 文件污染；A 之后 clip 不再查询该行，父素材本身仍正确命中，**无需强制清理**（如需彻底干净，可单独清除 `local_path` 指向 clip 文件的行）。
5. **关联但不阻塞**：§三 提到的 `ark` vs `ark-ai-video` 命名不一致属同类"键非内容唯一"问题，建议另行核查，**不纳入本次修复**。

### Definition of Done 自检

- [x] 根因证据链逐条复核与当前代码一致，补全 E11–E14，链路闭合（airtight）。
- [x] 候选修复按并发 / 错误路径 / 边界输入 / 回归四维审计完毕；指出 C 的新回归并降级。
- [x] 评审结论给出**单一**推荐方案（A）及明确不采纳项（C）与理由。
