# 视频帧包编辑（追加帧 / 删除单帧）— 设计方案

- **Feature slug**: `frame-pack-edit`
- **Owner**: 视频编辑组
- **Status**: v2（已评审，已采纳 P0 / P1 修订）
- **Last updated**: 2026-05-09

## 评审记录

下表是对 v1 文档的逐节评审条目。所有 P0 / P1 已直接落到 v2 正文（标注「已修复 → §x.x」），P2 作为可选改进留给实现阶段或后续迭代决定。

| 编号 | 严重度 | 维度 | 描述 | 处理 |
|---|---|---|---|---|
| P1-1 | P1 | Consistency / UX | §3.2 prose 描述删除按钮在「top-right 内层 Y 轴下方一行」，§4.2.5 代码却把按钮放到 `bottom-1 right-1`——会和 `bottom-0 inset-x-0` 的 timestamp bar 在视觉上重叠（虽然 hover 才显示，但仍盖在文字之上看着脏）。两段说法互相矛盾，且任一种位置都不理想。 | **已修复 → §3.2 / §4.2.5**：删除按钮改放到 `top-1 right-7`（即 `use as ref` 按钮的左侧 6px 间距），与下载按钮（top-1 left-1）、`use as ref`（top-1 right-1）、timestamp bar（bottom 0）三方都不冲突；prose 与代码同步对齐。 |
| P1-2 | P1 | Completeness | `VideoProcessingModal` 走 `hasEverOpened` 长驻 mount，导致 `FrameExtractionTab` 内部 `phase`/`selectedVideo` 状态在「append 模式 → 用户中途关闭弹窗 → 下次以普通模式重开」之间残留，会让用户在普通入口看到上次 append 模式的 extract 画面，事实上就是把别的帧包绑定到了"创建新帧包"的链路。这是个会让用户错把帧塞进新包的 UX 越界。 | **已修复 → §4.2.4**：在 `FrameExtractionTab` 里加一条 `useEffect`，当 `appendCtx` 由非 null 转 null（含 `null → null` 重新 mount）或 props 形态切换时，强制 `setPhase('select')` + `setSelectedVideo(null)` + `setErrorMessage(null)`，明确给出关键路径。 |
| P1-3 | P1 | Feasibility / Consistency | §4.2.4 / §9-R2 提到用 `fcntl.flock` 配 "Windows 等价" 做文件级锁。但 1) 项目 Windows 也是合法部署目标（CLAUDE.md 提到的 install/start 同时支持 Windows + Linux），fcntl 是 POSIX-only；2) `metadata.json` 的 read-modify-write 同进程内只要 asyncio.Lock 即可串行化，跨进程场景生产是单 worker uvicorn（参考 main.py），多 worker 留作待办更合理。手写 fcntl + Windows 兼容层属于过度设计且容易引入新 bug。 | **已修复 → §4.1.3 / §9-R2**：改为 `_pack_locks: Dict[str, asyncio.Lock]` 进程内按 pack_id 串行化 read-modify-write，明确多 worker 部署需要换 Postgres advisory lock，并在风险表里标注。 |
| P1-4 | P1 | Completeness | §4.2.4 提到 append 模式下 `handleBack` 需要直接关闭弹窗，"通过 `onCloseRequest` prop（VideoProcessingModal 注入）实现"，但这条 prop 链的具体注入点（`VideoProcessingModal` 透传 `handleClose`、`FrameExtractionTab` 的 prop 类型）没写。实现时容易变成"自己再起一份 onClose"，绕开 modal 的 auto-minimize 守卫逻辑。 | **已修复 → §4.2.3 / §4.2.4**：明确 `VideoProcessingModal` 把 `handleClose` 透传为 `onRequestClose`，`FrameExtractionTab` 的 `handleBack` 在 `appendCtx != null` 时调它；不引入新关闭路径。 |
| P1-5 | P1 | Right-sizing / UX | "添加视频帧" 按钮 disabled 条件 v1 只看 `materials.find(...sourceMaterialId)`。但用户在 append 模式正在保存（FrameExtractionTab phase=`saving`）时，弹窗已经关闭了 → 用户可能再次点击按钮、再起一次并发 append，这就把 R2（并发覆盖）从"两个 tab"扩到了"一个用户连点"。 | **已修复 → §4.2.2 / §4.2.5**：`MaterialsPanel` 维护 `framePackAppendInFlight` 标志（保存开始 → 关闭弹窗时不立即清空，等到 `onFramePackUpdated` 回调或 toast 报错后再清空）；按钮 disabled 条件并入此标志。 |
| P2-1 | P2 | Right-sizing | 多次 delete + append 循环后，`frame_NNN.jpg` 的 ordinal 可能越过 999；`:03d` 在 1000+ 时不再保证三位（变 4 位），文件名仍唯一但与 "001~999 frame" 隐式约定不一致。当前 cap=200，理论达到需 ~5 次"删 199 + 加 199"循环。 | **接受现状**：v2 在 §4.1.3 末尾加一行 note，说明 ordinal 不限于三位、URL 仍稳定；不做实际行为变更。 |
| P2-2 | P2 | Completeness | 前端在 append 时有 `pack.frame_count` 可用，可在 client 提前判 `existing + new > cap`，省掉一次 4xx 往返。v1 没要求做。 | **接受现状**：后端 cap 仍是权威，本期不做 client 预校验；§4.2.4 末尾加 TODO 提示。 |
| P2-3 | P2 | Feasibility | `DELETE /api/frame-pack/{pack_id}/frames/{index}` 的 `index` v1 仅 typed 为 int；负数 / 0 会一路落到 404 而不是 400。 | **接受现状**：FastAPI 路径参数类型校验已经把字符串挡掉，§4.1.2 加一句 `Path(..., gt=0)`，错误码用 422 与 FastAPI 默认对齐。 |
| P2-4 | P2 | Completeness | 没有显式针对 "进程内并发 append 同一 pack" 的回归测试。 | **接受现状**：§8.1 加一条 `test_append_concurrent_same_pack` 用 `asyncio.gather` 并验证 frame_count 等于 base + 2*delta、ordinal 互不冲突。 |
| P2-5 | P2 | Consistency | §9-R3 提的 "整包删除" toast 文案 key `framePackEmptiedRemoved` 在 §4.2.6 i18n 表里漏列；不补会被 type-check 抓到，但要补一次。 | **已修复 → §4.2.6**：i18n 表补齐该 key（中英文）。 |
| P2-6 | P2 | Completeness | i18n line number 数（"line ≈ 3426"）属于易腐脆引用，文件未来 lint / 重排时会失真。 | **接受现状**：v2 改写成"在文件末段 `materialsPanel` 块内的 EN/中文区分别新增"；删除具体行号。 |

## 1. Overview

视频编辑模块当前已经支持"视频帧包（Frame Pack）"——用户从 `素材面板 → 视频处理 → 视频帧提取` 弹窗里挑选一个视频源，逐帧 scrub 截图后批量保存为一个不可变的帧包。帧包卡片支持点开查看细节（`FramePackView`），但进入详情后只能整体删除整个包，**无法在帧包基础上继续添加新帧、也无法删除帧包内的单张帧**。这意味着用户一旦保存就锁死了：错过几个关键镜头、或者多截了一张糊片，都得整包删掉重做，体验非常糟糕。

本次迭代要补齐这两个缺口：
1. 在 `FramePackView` 底部"删除视频帧包"按钮**左侧**新增「添加视频帧」按钮；点击后**复用现有的 `VideoProcessingModal`（视频处理弹窗）打开它的「视频帧提取」Tab**，并在弹窗里以"追加模式（append mode）"运行——选择/锁定原始视频、scrub 截图、保存时把新帧合并进当前帧包，而不是新建一个独立的帧包。
2. 允许用户在 `FramePackView` 网格中**逐帧删除**已保存的帧。删除是即时生效的（删一张接口走一张），并同步刷新当前面板和素材面板列表。

业务上这是一个纯增量改动：既不替换现有的"创建新帧包"流程，也不引入跨包的合并/拆分能力；视觉上不引入新弹窗（复用既有的 `VideoProcessingModal`），交互上沿用现有的截帧 UI 和确认弹窗。后端按 RESTful 习惯加两条新路由（追加 + 删单帧），服务层在原 `frame_pack_service` 的相同事务边界内做"目录写入 + DB 一致性"操作。

## 2. Goals & Non-goals

### Goals
- 在帧包详情页提供「添加视频帧」按钮，复用 `VideoProcessingModal` 的 `frame-extraction` Tab。
- 弹窗以追加模式运行：保存时把新帧并入当前帧包（同一 `pack_id`），不新建包。
- 帧包详情页里的每张帧支持删除（hover 显示删除图标 + 确认对话框）。
- 删除/追加后，前端就地更新 `currentFramePack` 与 `framePacks[]`，不强依赖整体 refetch。
- 后端新增两条接口：`POST /api/frame-pack/{pack_id}/append`、`DELETE /api/frame-pack/{pack_id}/frames/{index}`。

### Non-goals
- **不实现帧重排序**（前端 `useFrameExtraction` 已有 `reorder()`，但保存仍按时间戳重排——保持现状）。
- **不实现跨包合并**（A 包帧迁移到 B 包）。
- **不修改"创建帧包"的入口和契约**（`POST /api/frame-pack/create` 保持二进制兼容）。
- **不重命名已存在的帧文件**：删除单帧后保留稳定的 `frame_NNN.jpg` ordinal（容许 metadata 出现 index 空洞），避免下游缓存（`ReferenceImagePanel`、`AiVideoModal`、`ImagePickerSlot`）的 URL 被重算。
- **不清理已保存帧的 OSS 副本**之外的存储（用户帧包的 OSS 同步交给现有 `delete_pack` 路径覆盖；本期 append 也不主动 push 到 OSS——和当前 `create_pack` 行为一致）。

## 3. User-facing flow

### 3.1 添加视频帧

1. 用户在素材面板点开一个帧包卡片 → 进入 `FramePackView`。
2. 在原"删除视频帧包"按钮**左边**渲染一个新按钮「添加视频帧」（i18n key `materialsPanel.addFramesToPack`）。
3. 点击后：
   - `MaterialsPanel` 设置 append 上下文 `framePackAppendCtx = { packId, sourceMaterialId, sourceMaterialName, sourceDurationSec }`，并打开 `VideoProcessingModal`（`isVideoProcessingOpen=true`）。
   - `VideoProcessingModal` 收到新的 `initialTab='frame-extraction'` 与 `framePackAppendCtx` props，强制激活 `frame-extraction` Tab。
   - `FrameExtractionTab` 检测到 `framePackAppendCtx` 不为 `null`：
     - 跳过"视频选择"页（phase=`select`），直接进入 `extract` 阶段。
     - 优先用 `materials[]` 里 `id === sourceMaterialId` 的视频；若已不在素材列表，则使用一个根据 `framePackAppendCtx` 拼出的 `MaterialItem` 占位（含 name/duration），其 `url` 留空 → `FrameExtractorLayout` 的 `<video>` 会发 load error，UI 落到既有的"无法播放"提示。**该兜底分支由 P1-2 的客户端校验在 click handler 里直接挡住**——按钮在 `sourceMaterialId` 不在 `materials` 中时禁用并 tooltip 提示"原视频已不在素材库，请先重新导入"。
   - 用户截帧 → 点「保存」→ 不走 `createFramePack`，改走新增的 `appendFramesToPack`。
4. 保存成功：
   - 后端返回更新后的 `ImagePack`（含追加后的全量帧列表）。
   - 前端把它通过新的 `onFramePackUpdated(pack)` 上报给 `MaterialsPanel`，由后者更新 `framePacks[]`（按 `pack_id` 替换）和 `currentFramePack`（如果用户仍在 detail 页）。
   - 关闭弹窗、清空 `framePackAppendCtx`。

### 3.2 删除单帧

1. 在 `FramePackView` 的帧网格里，每个帧 card hover 时除已有"download"图标外，多渲染一枚"X"删除图标，定位 `absolute top-1 right-7`（即 `use as ref`/`top-1 right-1` 按钮的左侧 ~6px 间距），与下载按钮（`top-1 left-1`）、`use as ref`（`top-1 right-1`）、底部 timestamp bar（`bottom-0 inset-x-0`）三者均不冲突。当 `onUseFrameAsReference` 未注入（如 AI Video 流程之外）时，X 按钮回落到 `top-1 right-1`。
2. 点击 X → 弹原生 `confirm` **不可用**（项目里没用 `window.confirm`），改用与帧包级别一致的 `ConfirmDialog`（参考 `framePackDeleteConfirm` 用法），message: "确定要删除这一帧吗？"。
3. 确认后 → `DELETE /api/frame-pack/{pack_id}/frames/{index}?project_id=...`。
4. 接口返回 `200 BaseResponse` + `data: ImagePack`（更新后的包）。
5. 前端把它通过 `onFramePackUpdated(pack)` 同步到 `MaterialsPanel`。

## 4. Technical design

### 4.1 后端

#### 4.1.1 路由：`POST /api/frame-pack/{pack_id}/append`

- 复用 `frame_pack_router.py` 里 `create_frame_pack` 的 multipart 解析、Content-Length 短路、manifest 校验逻辑（提取为模块私有 helper `_parse_multipart_frames(request, max_bytes, cap_remaining)`，create 与 append 都调用）。
- 鉴权：`current_user`、`assert_pack_owned(db, pack_id, user_id) → bound_project_id`、与请求里的 `project_id` 比对，不一致返 404（沿用 enumerate-resistance 模式）。
- Cap 校验：`existing_count + new_count ≤ max_frames_per_pack()`；超限抛 `FRAME_COUNT_EXCEEDS_LIMIT`。
- 请求体：与 `create` 完全一致（`project_id` Form、`manifest` JSON、`frame_001..frame_NNN` 文件部分）。**不再要求 `source_material_id / source_material_name / source_duration_sec`**，这些字段从已有 `metadata.json` 继承。
- manifest.frames[i].index 仅作为客户端侧 ordinal（与 file 部分配对用），后端忽略它的具体值，**重新生成全局 ordinal**——见 §4.1.3。
- 响应：`FramePackDetailResponse` + 更新后的 `FramePack`（与 `get_frame_pack` 的 shape 完全相同）。

#### 4.1.2 路由：`DELETE /api/frame-pack/{pack_id}/frames/{index}`

- Path: `pack_id`（pack id）、`index`（FastAPI `Path(..., gt=0)`，要删的帧 1-based ordinal；非正整数由 FastAPI 422 拒绝——P2-3）。
- Query: `project_id`（必填）。
- 鉴权同上。
- 服务层 `frame_pack_service.delete_frame(db, pack_id, index)`：
  - 加载 `metadata.json`，找到 `frames[]` 里 `index == index` 的项；找不到 → 404 `FRAME_NOT_FOUND`。
  - 物理删除 `pack_directory/frame_NNN.jpg`（`NNN` = `index` 的 `:03d`）。
  - 从 `metadata.frames` 中移除该项，更新 `frame_count`，回写 `metadata.json`。
  - **不**重排序、不重命名其余文件（保留 ordinal 稳定性）。
  - 如果删的是 `frame_count == 0`：删掉整个 pack 目录 + 调用 `pack_ownership_service.delete_by_pack`（与"用户删完最后一帧"语义对齐——视觉上等价于删整包，避免出现"空帧包"幽灵）。这条路径在响应里仍返回 `FramePack` 但 `frames=[]` + `frame_count=0`，并附 `message: "Frame pack deleted (last frame removed)"`。前端再据此把 pack 从 `framePacks[]` 里移除（见 §4.2.2）。
- 响应：`FramePackDetailResponse` + 更新后的 `FramePack`（或在"删完最后一帧"时返回 `frame_count=0` 的代表对象）。

#### 4.1.3 Append 服务层：`frame_pack_service.append_frames`

签名：

```python
async def append_frames(
    *,
    db: AsyncSession,
    user_id: str,
    pack_id: str,
    frames: List[Dict[str, Any]],   # same shape as create_pack
) -> Dict[str, Any]:
```

行为：

1. `validate_pack_id(pack_id)` + `_pack_dir(pack_id)` 解析磁盘目录；找不到 → `FileNotFoundError`。
2. 读取 `metadata.json`，得到现有 `frames[]` 与 `existing_max_ordinal = max(frame['index'] for frame in metadata['frames'])`（空包时为 0）。
3. 串行写入新帧：每一帧的 ordinal = `existing_max_ordinal + i`（i 从 1 起），filename = `frame_{ordinal:03d}.jpg`。**和 §3.1 / Non-goals 里的"稳定 ordinal"一致**——append 永远只往后追加 ordinal，不复用空洞。
4. 把新帧 dict（`index`/`filename`/`timestamp_sec`/`width`/`height`/`row=0`/`col=ordinal-1`）merge 进 `metadata['frames']`，**按 `timestamp_sec` 升序排序**，回写。
5. 更新 `frame_count`、保留原 `original_image_url`、保留原 `pack_id`。
6. 复用 `_get_create_semaphore()` 限并发；与 `create_pack` 共享同一个 semaphore（合理：都是一种"写入帧包"的 IO bound 操作）。
7. **同 pack 内串行（P1-3 修订）**：在 `frame_pack_service` 模块级维护 `_pack_locks: Dict[str, asyncio.Lock]`（首次访问时按 pack_id 懒构造），`append_frames` 与 `delete_frame` 在拿到 semaphore 后再 `async with _pack_locks.setdefault(pack_id, asyncio.Lock())`，把同一 pack 的 read-modify-write `metadata.json` 串行化。**这只在单进程 / 单 worker 场景生效**——多 worker 部署需要换成 Postgres advisory lock（参考已有 `pack_ownership_service` 的 session 用法），列入 §10 follow-up。生产 Singapore-01 当前是单 worker uvicorn，本期可接受。
8. 失败回滚：写入磁盘前快照 `metadata.json` 的副本 → 任一步骤失败 → 删除本次新写入的所有 `frame_NNN.jpg` 文件 + 还原 `metadata.json`。
9. **Ordinal 备注（P2-1）**：append 永远 `existing_max_ordinal + i`，多次 delete + append 循环后 ordinal 可能 > 999；`frame_{N:03d}.jpg` 在 N≥1000 时 zero-padding 自然失效（`frame_1000.jpg`），文件名仍唯一、URL 稳定。frontend `key={frame.index}` 不依赖位数。

#### 4.1.4 Delete-frame 服务层：`frame_pack_service.delete_frame`

签名：

```python
async def delete_frame(
    *,
    db: AsyncSession,
    pack_id: str,
    frame_index: int,
) -> Optional[Dict[str, Any]]:  # None when whole pack got deleted
```

行为见 §4.1.2 服务层段；OSS 删除（如果配置开启）只在"删完最后一帧"分支执行，复用 `delete_pack` 内现有的 `oss2.ObjectIterator(...)` 分支提取成 helper `_delete_pack_from_oss(date_str, pack_id)`。单帧删除暂不级联到 OSS（和当前 create 不 push OSS 的方向一致）。

### 4.2 前端

#### 4.2.1 新 API client：`src/lib/api/framePack.ts`

新增两个 export：

```typescript
export interface AppendFramePackInput {
  projectId: string
  packId: string
  frames: CreateFramePackFrameInput[]
}

export async function appendFramesToPack(input: AppendFramePackInput): Promise<ImagePack>

export async function deleteFrameFromPack(args: {
  projectId: string
  packId: string
  frameIndex: number
}): Promise<ImagePack | null>  // null 表示包整体被删
```

`appendFramesToPack` 与现有 `createFramePack` 的 multipart 拼装逻辑高度相似——抽出 `_buildFrameMultipart(frames)` 私有 helper 复用。

#### 4.2.2 `MaterialsPanel.tsx`

- 新增 state:
  ```ts
  const [framePackAppendCtx, setFramePackAppendCtx] = useState<{
    packId: string;
    sourceMaterialId: string;
    sourceMaterialName: string;
    sourceDurationSec: number;
  } | null>(null);
  // P1-5：在 append 网络请求落地（onFramePackUpdated 回调）前，禁掉"添加视频帧"按钮，
  // 防止用户连点带来重复并发 append。
  const [framePackAppendInFlight, setFramePackAppendInFlight] = useState<string | null>(null);
  const [frameDeleteConfirm, setFrameDeleteConfirm] = useState<{
    isOpen: boolean;
    packId: string | null;
    frameIndex: number | null;
  }>({ isOpen: false, packId: null, frameIndex: null });
  ```
- 新增 callback:
  ```ts
  const handleOpenAddFrames = useCallback((pack: ImagePack) => {
    if (framePackAppendInFlight === pack.pack_id) return; // P1-5：防连点
    setFramePackAppendInFlight(pack.pack_id); // 标记 in-flight，handleDone 成功 / 失败时清掉
    setFramePackAppendCtx({
      packId: pack.pack_id,
      sourceMaterialId: pack.source_material_id ?? '',
      sourceMaterialName: pack.source_material_name ?? '',
      sourceDurationSec: pack.source_duration_sec ?? 0,
    });
    setIsVideoProcessingOpen(true);
  }, [framePackAppendInFlight]);

  const handleFramePackUpdated = useCallback((updated: ImagePack | null, packId: string) => {
    setFramePackAppendInFlight((cur) => (cur === packId ? null : cur)); // P1-5：清 in-flight
    if (updated == null) {
      // 整包被删（删完最后一帧分支）
      setFramePacks(prev => prev.filter(p => p.pack_id !== packId));
      setCurrentFramePack(prev => (prev?.pack_id === packId ? null : prev));
      return;
    }
    setFramePacks(prev => prev.map(p => p.pack_id === updated.pack_id ? updated : p));
    setCurrentFramePack(prev => (prev?.pack_id === updated.pack_id ? updated : prev));
  }, []);

  const handleConfirmDeleteFrame = useCallback(async () => {
    const { packId, frameIndex } = frameDeleteConfirm;
    if (!packId || frameIndex == null || !projectId) {
      setFrameDeleteConfirm({ isOpen: false, packId: null, frameIndex: null });
      return;
    }
    setFrameDeleteConfirm({ isOpen: false, packId: null, frameIndex: null });
    try {
      const updated = await deleteFrameFromPack({ projectId, packId, frameIndex });
      handleFramePackUpdated(updated, packId);
      showSuccess('帧已删除');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showError(`删除帧失败: ${msg}`);
    }
  }, [frameDeleteConfirm, projectId, handleFramePackUpdated, showSuccess, showError]);
  ```
- `<FramePackView>` 调用处新增 props：
  - `onAddFrames={() => handleOpenAddFrames(currentFramePack)}`
  - `onDeleteFrame={(frameIndex) => setFrameDeleteConfirm({ isOpen: true, packId: currentFramePack.pack_id, frameIndex })}`
  - `canAddFrames={!!sourceVideoMaterialFor(currentFramePack) && framePackAppendInFlight !== currentFramePack.pack_id}`（用 `materials.find(m => m.id === pack.source_material_id)` 判断 + P1-5 in-flight 守卫；任一为假则禁用按钮 + tooltip 区分原因）。
- `<VideoProcessingModal>` 调用处新增 props：
  - `initialTab={framePackAppendCtx ? 'frame-extraction' : undefined}`
  - `framePackAppendCtx={framePackAppendCtx}`
  - `onFramePackUpdated={handleFramePackUpdated}`
- `onClose` 时同时清掉 `framePackAppendCtx`；**不立即清 `framePackAppendInFlight`**（P1-5：保留到 `handleFramePackUpdated` 落地或显式失败 toast；用户取消的关闭也算异常路径，需要在 `onClose` 末尾增加 `setFramePackAppendInFlight(null)` 兜底，但前提是确认网络请求已 abort，否则保留——本期 `appendFramesToPack` 不支持 abort，`onClose` 路径仍清空，承担"成功后回调被静默丢弃"的轻微风险——记录在 §10 follow-up）。
- 多挂一个 `<ConfirmDialog>` 接 `frameDeleteConfirm`。

#### 4.2.3 `VideoProcessingModal.tsx`

- 新 props：
  ```ts
  initialTab?: TabId;
  framePackAppendCtx?: AppendCtx | null;
  onFramePackUpdated?: (pack: ImagePack | null, packId: string) => void;
  ```
- 在 `useEffect`（`isOpen` 由 false → true 触发的那一拍）里：若 `initialTab` 不为 undefined，调一次 `setActiveTab(initialTab)`；否则不动。
- 把 `framePackAppendCtx`、`onFramePackUpdated` 透传给 `<FrameExtractionTab>`，同时把已存在的 `handleClose` 作为 `onRequestClose` 透传下去（**P1-4 修订**：FrameExtractionTab 在 append 模式下需要的关闭路径与现有顶部"X"按钮共用 `handleClose`，保留其 auto-minimize 守卫；不在 tab 内部直接 setState 触发关闭）。

#### 4.2.4 `FrameExtractionTab.tsx`

- 新 props：
  ```ts
  appendCtx?: AppendCtx | null;
  onFramePackUpdated?: (pack: ImagePack | null, packId: string) => void;
  onRequestClose?: () => void; // P1-4：模态框关闭代理
  ```
- 当 `appendCtx` 非空：
  - 初始 phase 直接置为 `extract`，并把 `selectedVideo` 设成 `materials.find(m => m.id === appendCtx.sourceMaterialId) ?? syntheticMaterialFromCtx(appendCtx)`（synthetic 仅作 UI 兜底；按钮 disable 守在 `MaterialsPanel` 已经挡住源视频不在素材库的入口）。
  - `handleDone` 走 `appendFramesToPack({ projectId, packId: appendCtx.packId, frames })`，成功后调 `onFramePackUpdated(pack, appendCtx.packId)`，并通过下文 §4.2.3 透传的 `onRequestClose` 关闭弹窗。
- 当 `appendCtx` 为空：完全保持现有行为（创建新包）。
- handleBack 在 append 模式下直接调 `onRequestClose()`（VideoProcessingModal 透传过来的 `handleClose`），不引入第二条关闭路径——保留 `auto-minimize` 守卫。
- **状态复位（P1-2 修订）**：模态框使用 `hasEverOpened` 长驻 mount，意味着 tab 内 state 在多次开/关之间不会自动重置。新增 `useEffect`：

  ```ts
  const prevAppendCtxRef = useRef(appendCtx);
  useEffect(() => {
    const wasAppend = prevAppendCtxRef.current != null;
    const isAppend = appendCtx != null;
    prevAppendCtxRef.current = appendCtx;

    // 1) 进入 append 模式：强行置 extract 阶段。
    if (!wasAppend && isAppend) {
      const matched = materials.find((m) => m.id === appendCtx!.sourceMaterialId)
        ?? syntheticMaterialFromCtx(appendCtx!);
      setSelectedVideo(matched);
      setErrorMessage(null);
      setPhase('extract');
      return;
    }
    // 2) 退出 append 模式（用户中途关闭弹窗 → MaterialsPanel 清空 framePackAppendCtx）：
    //    复位到普通模式的初始视图，避免下次以"创建新帧包"入口重开时残留 extract 画面。
    if (wasAppend && !isAppend) {
      setSelectedVideo(null);
      setErrorMessage(null);
      setPhase('select');
    }
  }, [appendCtx, materials]);
  ```

- **不要在 `appendCtx` 持续 null 的状态变更里复位 phase**（这条会破坏现有"创建新包"流程的多步导航）——effect 用 ref 比较保证只在 append 模式边界触发。

#### 4.2.5 `FramePackView.tsx`

- 新 props：
  ```ts
  onAddFrames?: () => void;
  canAddFrames?: boolean;
  onDeleteFrame?: (frameIndex: number) => void;
  ```
- 按钮区改动（line 70-77）：

```tsx
<div className="flex items-center space-x-2">
  {onAddFrames && (
    <button
      type="button"
      disabled={!canAddFrames}
      onClick={onAddFrames}
      className="px-2 py-1 text-xs text-primary border border-primary/30 rounded hover:bg-primary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      title={canAddFrames ? undefined : (mp.addFramesToPackDisabledHint ?? '原视频已不在素材库')}
    >
      {mp.addFramesToPack ?? '添加视频帧'}
    </button>
  )}
  <button
    onClick={() => onDelete(pack.pack_id)}
    className="px-2 py-1 text-xs text-destructive border border-destructive/30 rounded hover:bg-destructive/10 transition-colors"
  >
    {mp.deleteFramePack ?? '删除视频帧包'}
  </button>
</div>
```

- 帧 card 上新增删除按钮：

```tsx
{onDeleteFrame && (
  <button
    type="button"
    onClick={(e) => { e.stopPropagation(); onDeleteFrame(frame.index); }}
    className={`absolute ${onUseFrameAsReference ? 'top-1 right-7' : 'top-1 right-1'} w-6 h-6 rounded bg-destructive/80 hover:bg-destructive text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10`}
    title={mp.deleteFrame ?? 'Delete frame'}
  >
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  </button>
)}
```

按钮位置遵循 P1-1 修订：`onUseFrameAsReference` 已注入时（AI Video 选帧场景）X 按钮挂 `top-1 right-7`，让出 `top-1 right-1` 给 `use as ref`；未注入时 X 按钮直接占 `top-1 right-1`。下载按钮固定 `top-1 left-1`，timestamp bar 在 `bottom-0 inset-x-0`，hover 时三方/四方均不重叠。`z-10` 保证删除按钮在 timestamp 浮层之上。

#### 4.2.6 i18n 增量

`src/lib/i18n.ts` 同时补 EN / 中文：

| key | EN | 中文 |
|---|---|---|
| `materialsPanel.addFramesToPack` | `Add Frames` | `添加视频帧` |
| `materialsPanel.addFramesToPackDisabledHint` | `Original video is no longer in your library — re-import it first` | `原视频已不在素材库，请先重新导入` |
| `materialsPanel.deleteFrame` | `Delete frame` | `删除帧` |
| `materialsPanel.deleteFrameConfirmTitle` | `Delete frame` | `删除帧` |
| `materialsPanel.deleteFrameConfirmBody` | `Delete this frame from the pack? This cannot be undone.` | `确定要删除这一帧吗？此操作无法恢复。` |
| `materialsPanel.frameDeleted` | `Frame deleted` | `帧已删除` |
| `materialsPanel.framePackUpdated` | `Frames added to pack` | `已追加到帧包` |
| `materialsPanel.framePackEmptiedRemoved` | `Last frame removed — pack deleted` | `已删除最后一帧，帧包同步移除` |
| `materialsPanel.addFramesToPackInFlight` | `Adding frames…` | `正在添加帧…` |

新增 key 在 `i18n.ts` 文件末段 `materialsPanel` 块的 EN / 中文区分别成对追加（P2-6：不再写具体行号，靠 type-check 报缺失）。

### 4.3 前端组件层级

```
MaterialsPanel
├── FramePackView                       // 详情页
│   ├── [+] 「添加视频帧」按钮 (新)
│   ├── [-] 「删除视频帧包」按钮
│   └── frames[].card
│        └── [×] 单帧删除按钮 (新)
├── ConfirmDialog (frameDeleteConfirm)  // 单帧删除确认 (新)
└── VideoProcessingModal
     └── FrameExtractionTab             // 复用，加 append 分支
          ├── (appendCtx == null) 走 createFramePack 旧链路
          └── (appendCtx != null)  走 appendFramesToPack 新链路
```

## 5. File / module change plan

| 路径 | 类型 | 一句话变更意图 |
|---|---|---|
| `backend-services/basic-service/app/routers/frame_pack_router.py` | modify | 抽出 `_parse_multipart_frames` helper；新增 `POST /{pack_id}/append`、`DELETE /{pack_id}/frames/{index}` 两条路由 |
| `backend-services/basic-service/app/services/frame_pack_service.py` | modify | 新增 `append_frames`、`delete_frame`；提取 `_delete_pack_from_oss`；保持 `create_pack` 行为不变 |
| `backend-services/basic-service/tests/test_frame_pack_router.py` | create/extend | 覆盖 append 成功 / cap 超限 / 跨用户 404 / 单帧删 / 删完最后一帧落入"整包删" |
| `src/lib/api/framePack.ts` | modify | 新增 `appendFramesToPack`、`deleteFrameFromPack`；抽 `_buildFrameMultipart` 私有 helper |
| `src/components/video/components/MaterialsPanel/FramePackView.tsx` | modify | 加 `onAddFrames` / `canAddFrames` / `onDeleteFrame` props；按钮区 + 帧 card 增加删除按钮 |
| `src/components/video/components/MaterialsPanel/MaterialsPanel.tsx` | modify | 新增 `framePackAppendCtx` / `frameDeleteConfirm` state、3 个 handler、ConfirmDialog 挂载；把新 props 透传给 `FramePackView` 与 `VideoProcessingModal` |
| `src/components/video/components/VideoProcessingModal/VideoProcessingModal.tsx` | modify | 加 `initialTab`、`framePackAppendCtx`、`onFramePackUpdated` props；激活时强制切到 frame-extraction Tab |
| `src/components/video/components/VideoProcessingModal/FrameExtractionTab/FrameExtractionTab.tsx` | modify | 加 `appendCtx`/`onFramePackUpdated`；append 分支跳过视频选择直入 extract 阶段；handleDone 改走 `appendFramesToPack` |
| `src/lib/i18n.ts` | modify | 补 7 条翻译 key（中英文各一份） |
| `src/components/video/components/MaterialsPanel/__tests__/FramePackView.test.tsx` | create/extend | 覆盖按钮可见性 / disabled / 删除按钮 onClick |
| `src/components/video/components/VideoProcessingModal/FrameExtractionTab/__tests__/useFrameExtraction.test.tsx` | extend | 不动；append 由 `FrameExtractionTab.test.tsx` 覆盖 |
| `docs/plans/frame-pack-edit/spec.md` | create (本文件) | 设计方案 |

## 6. Interface design

### 6.1 REST

#### `POST /api/frame-pack/{pack_id}/append`

```http
POST /api/frame-pack/<pack_id>/append HTTP/1.1
Content-Type: multipart/form-data; boundary=...

project_id     = <uuid>
manifest       = {"frames":[{"index":1,"timestamp_sec":12.34,"width":1920,"height":1080}, ...]}
frame_001      = (binary, image/jpeg)
frame_002      = (binary, image/jpeg)
...
```

成功 200：

```json
{
  "success": true,
  "message": "Frame pack updated: 12 frames",
  "data": {
    "pack_id": "abc123...",
    "pack_type": "frame",
    "frame_count": 12,
    "frames": [ ... 全量 ... ],
    ...
  }
}
```

错误码（HTTP 400 / 404 / 413 / 500，与 create 对齐）：
- `PROJECT_ID_REQUIRED` (400)
- `INVALID_MANIFEST` (400)
- `FRAME_COUNT_EXCEEDS_LIMIT` (400) — `existing + new > cap`
- `PAYLOAD_TOO_LARGE` (413)
- `FRAME_PACK_NOT_FOUND` (404) — 含跨用户/跨项目伪装
- `FRAME_PACK_APPEND_FAILED` (500)

#### `DELETE /api/frame-pack/{pack_id}/frames/{index}?project_id=<uuid>`

成功 200（仍有帧）：

```json
{ "success": true, "message": "Frame deleted", "data": { ...更新后的 ImagePack... } }
```

成功 200（删完最后一帧 → 整包删）：

```json
{ "success": true, "message": "Frame pack deleted (last frame removed)", "data": { ...frame_count=0... } }
```

错误码：
- `PROJECT_ID_REQUIRED` (400)
- `FRAME_PACK_NOT_FOUND` (404)
- `FRAME_NOT_FOUND` (404)
- `FRAME_DELETE_FAILED` (500)

### 6.2 前端 API client 签名

```typescript
export async function appendFramesToPack(input: {
  projectId: string;
  packId: string;
  frames: CreateFramePackFrameInput[];
}): Promise<ImagePack>;

export async function deleteFrameFromPack(args: {
  projectId: string;
  packId: string;
  frameIndex: number;
}): Promise<ImagePack | null>;
```

`null` 由 client 在 `data.frame_count === 0` 时返回，用于通知调用方走"整包从列表移除"分支。

## 7. Data model

### 7.1 `metadata.json`（disk）

字段不变；append 时只往 `frames[]` 末尾追加再按 `timestamp_sec` 重排，并刷新 `frame_count`。delete 时从 `frames[]` 移除一项 + 刷新 `frame_count`。**`frames[i].index` 字段保留为"文件名 ordinal"，不再保证连续**——前端不依赖连续性（已用 `key={frame.index}` + 显示 `#{frame.index}`，连续性只是当前 create 路径产生的副作用）。

### 7.2 DB（`storyboard_packs` ownership 表）

无变更：append 不创建新 pack 行；delete-frame 的 last-frame 分支复用 `pack_ownership_service.delete_by_pack`。

### 7.3 前端 `ImagePack` / `ImagePackFrame`

`src/lib/api/imagePack.ts` 中 `ImagePackFrame.index: number` 已存在，沿用。无需新增字段。

## 8. Testing & acceptance criteria

### 8.1 后端单测（pytest）

- `test_append_success` — 已有 3 帧的包 append 2 帧 → 返回 5 帧、按时间戳排序、新文件 ordinal = 4/5。
- `test_append_cap_exceeded` — cap=200，已 199 帧 append 5 帧 → 400 `FRAME_COUNT_EXCEEDS_LIMIT`，磁盘无新文件残留。
- `test_append_cross_user_404` — 用户 B 拿 A 的 pack_id append → 404。
- `test_append_project_mismatch_404` — 用户传错 `project_id` → 404。
- `test_append_partial_failure_rollback` — 模拟第 2 张帧写入抛 IOError → metadata 还原、新文件全清；通过对 `aiofiles.open` patch 实现。
- `test_delete_frame_success` — 5 帧包删第 3 帧 → 剩 4 帧，filename `frame_003.jpg` 不再存在，`metadata.frame_count==4`，其余帧的 ordinal 不变。
- `test_delete_frame_not_found` — 删不存在的 index → 404。
- `test_delete_last_frame_drops_pack` — 1 帧包删唯一一帧 → ownership 行被清理、目录被删；响应 `frame_count==0`。
- `test_append_concurrent_same_pack`（P2-4）— `asyncio.gather` 两次 append，每次 2 帧，对相同 pack；期望最终 frame_count = base + 4，新文件 ordinal 全互斥（无重复 filename），metadata 仍是合法 JSON。

### 8.2 前端单测（Jest + Testing Library）

- `FramePackView.test.tsx` — 渲染：「添加视频帧」按钮存在、disabled 时 click 不触发、单帧 delete 按钮 hover 才显示、点击调 `onDeleteFrame(frame.index)`。
- `FrameExtractionTab.test.tsx` — 传 `appendCtx` 时初始 phase=extract、`handleDone` 调 `appendFramesToPack` 而不是 `createFramePack`、成功后调 `onFramePackUpdated`。
- `MaterialsPanel.test.tsx`（如已有）— 新增"删除单帧 → 调用 client → state 更新"快照测试。

### 8.3 手测验收脚本

1. 在 `localhost:3000` 创建一个项目，导入一个 ≥ 30 秒的视频。
2. 进入"视频处理 → 视频帧提取" → 截 3 张帧 → 保存为帧包 P1。
3. 在素材面板点击 P1 卡片 → 进入 `FramePackView`。
4. 期望：底部出现两个按钮，左：「添加视频帧」，右：「删除视频帧包」。
5. 点「添加视频帧」→ 期望弹出 `VideoProcessingModal`，自动定位到 `Frame Extraction` Tab，自动选中 P1 的源视频，进入 `extract` 阶段。
6. 截 2 张帧 → 保存 → 期望弹窗关闭、回到 `FramePackView`、网格里有 5 张帧（按时间戳排好序）、状态条「{count} 帧」从 3 变 5。
7. 在网格里 hover 某张帧 → 出现"X"删除按钮 → 点击 → 弹确认对话框 → 确认 → 期望网格立刻少一张、`frame_count` 变 4。
8. 重复 7 直到删到最后一张 → 期望直接退出 `FramePackView`、`framePacks[]` 列表里 P1 消失。
9. 服务端 log 不出现 `frame pack ownership row` 残留警告。

### 8.4 Definition of done

- 上述 7 条后端测试 + 3 条前端测试全部通过。
- `npm run type-check` 通过；`npm run lint` 不引入新 warning。
- 后端 `pytest tests/test_frame_pack_router.py -v` 全绿。
- 8.3 的 9 条手测脚本逐条通过。

## 9. Risks & mitigations

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | 用户在源视频已被删除/移除素材的情况下点「添加视频帧」 | extract 阶段 `<video>` 拉不到 metadata，UI 卡住 | 客户端按钮在 `materials.find(m=>m.id===pack.source_material_id) == null` 时 disabled，hover 提示"原视频已不在素材库，请先重新导入"。即使被绕过，extract 页面已有 `loadError` 兜底（`describeMediaError`）。 |
| R2 | 并发：用户 A 在两个 tab / 多次连点同时 append → 两端拿到相同 `existing_max_ordinal` → 文件互相覆盖 | 帧丢失 / metadata 损坏 | 单进程内：进程级 `_pack_locks: Dict[str, asyncio.Lock]` 按 pack_id 互斥（§4.1.3 step 7），把 read-modify-write 串行化；与 `_create_semaphore` 双重保护。前端：`MaterialsPanel.framePackAppendInFlight` 守住"按钮重复点击"边界（P1-5）。**多 worker 部署需切换 Postgres advisory lock**（详见 §10 follow-up）——本期生产单 worker，先不实施。已废弃 fcntl 跨平台方案（避免 Windows 等价 API 引入新风险）。 |
| R3 | 删完最后一帧静默触发整包删除 | 用户感知错位（"我只是删了一帧，怎么连卡片都没了"） | 后端 message 显式标注 `Frame pack deleted (last frame removed)`；前端在 toast 里用差异化文案 `materialsPanel.framePackEmptiedRemoved` 提示。 |
| R4 | 抽出 `_parse_multipart_frames` 时破坏 `create_pack` 既有错误码 / 错误消息 | 现有客户端错误处理失效 | 测试矩阵里明确把 `create_pack` 的所有 400 分支补上回归用例（INVALID_MANIFEST × 4 个分支：JSON 解析、空 frames、frame_NNN 不匹配、index ordinal 不匹配）。 |
| R5 | 单帧删除不重排 ordinal → 下游若以为 `frames[i].index == i+1` 会读越界 | UI 数据错乱 | 前端搜索：`framePack.*frames\[`、`frame.index === ` 全跑一遍；目前只有 `FramePackView`、`ReferenceImagePanel`、`AiVideoModal`、`ImagePickerSlot` 用到 `frame.index`，且都按 key 用、不假设连续——确认无回归。 |
| R6 | append 成功但 `onFramePackUpdated` 由于异步竞态被旧 detail 覆盖 | UI 与磁盘不一致 | `MaterialsPanel.handleFramePackUpdated` 用函数式 setter（`prev => ...`），不依赖闭包里的 `framePacks`。 |
| R7 | i18n 文案覆盖两份（中文 / 英文），漏写一份 | 用户看到 fallback 的硬编码中文 | i18n 在 spec §4.2.6 里成对列出；CI 跑 `npm run type-check` 会捕捉缺失（目前 `materialsPanel` 类型定义在 `i18n.ts` 顶部声明）。 |
| R8 | 在 append 模式下用户点弹窗右上角的关闭 → `framePackAppendCtx` 没清空 → 下次正常打开"视频处理"还以为是 append | 行为错乱 | `MaterialsPanel.onClose` 同时 `setFramePackAppendCtx(null)`；同时 `VideoProcessingModal.handleClose` 已是受控关闭路径，没有偷偷绕过。 |

## 10. Out-of-scope follow-ups

- 帧重排序（拖拽改 `timestamp_sec` 的展示顺序）。
- 帧描述编辑（`metadata.frames[].description` 已存在但 UI 未暴露）。
- 已删帧的"撤销"操作（短期内不做）。
- OSS 双写（append 不写 OSS，与 create 现状一致；后续若启用 OSS 同步要在 `append_frames` 末尾增加 push）。
- **多 worker 写入同步**（P1-3 后续）：`_pack_locks` 仅同进程有效；如果生产改成 uvicorn `--workers > 1`，需要把 read-modify-write metadata.json 换成 Postgres advisory lock（`pg_advisory_xact_lock(hashtext(pack_id))`）或转入"在 DB 持久化 frames" 的形态——视改造成本再决定。
- **append 请求 abort**（P1-5 兜底）：当前 `appendFramesToPack` 不支持 AbortController，用户在 saving 阶段关闭弹窗时网络请求仍会跑完，前端 toast 错过。可后续在 `http-client` 增加 abort 支持后回填。
- **client 侧 cap 预校验**（P2-2）：append 时 `pack.frame_count + frames.length > cap` 直接 short-circuit，省掉 4xx 往返。

---

**字数自检**：本文档主体（不计代码块标注）超过 800 词。

## 评审结论

**有条件通过**（Approved with conditions）。

设计在 v1 基础上经评审已修复 5 项 P1（删除按钮位置矛盾 / FrameExtractionTab 状态残留 / 跨平台文件锁过度设计 / onRequestClose prop 链欠详 / append 连点并发风险），P2 项已书面接受现状或落到测试用例 / follow-up 里。**生效前置条件**：

1. 实现时严格按 §4.1.3 step 7 落 `_pack_locks: Dict[str, asyncio.Lock]`；不允许引入 fcntl / msvcrt 等 OS 锁。
2. 实现时严格按 §4.2.4 落 `appendCtx` 边界 useEffect 状态复位；CR 必须验证「append → 关闭 → 普通模式打开」的回归路径。
3. §8.1 `test_append_concurrent_same_pack` 必须随实现一同提交，作为 P1-3 锁实现的回归屏障。
4. 部署到生产前确认 uvicorn `--workers=1`（与 §10 多 worker follow-up 配套）；切多 worker 时同步走 advisory lock 改造。
5. CR 时验证 `i18n.ts` 中英文新增 key 同步（type-check 必跑）。

满足以上 5 条后视为最终生效，无需再回评审。
