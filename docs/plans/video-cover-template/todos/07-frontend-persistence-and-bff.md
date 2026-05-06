# TODO 07 — Frontend Persistence & BFF

> Spec: `specs/07-frontend-persistence-and-bff.md`

## Dependencies

```yaml
depends_on: [06]            # 后端契约就绪
blocks: [05]                # 渲染管线消费 uploadPng
parallel_group: B           # 与 02, 04 并行（前提：06 已完成）
```

## Tasks

### A. BFF 路由

- [ ] 新建 `src/app/api/video-cover/[projectId]/route.ts`：
  ```ts
  import { createPassthroughRoute } from '@/lib/api/server/backend-proxy';
  export const { GET, PUT, DELETE } = createPassthroughRoute(
    (p) => `/api/video-cover/${p.projectId}`,
  );
  ```
- [ ] 新建 `src/app/api/video-cover/[projectId]/png-cache/route.ts`：
  ```ts
  import { createPassthroughRoute } from '@/lib/api/server/backend-proxy';
  export const { POST } = createPassthroughRoute(
    (p) => `/api/video-cover/${p.projectId}/png-cache`,
    { timeoutMs: 60_000 },
  );
  ```
- [ ] 手动 curl 验证：GET / PUT / POST 都能透传到后端 + 401/403/404 状态码正确

### B. API Client

- [ ] 新建 `src/lib/api/videoCover.ts`：`getCover / putCover / uploadCoverPng / deleteCover`，带 `fetchWithTimeout`
- [ ] 单测 `__tests__/videoCover.test.ts`：404→null / 500→throw / timeout→AbortError / multipart Content-Type

### C. useCoverPersistence Hook

- [ ] 写 `VideoCoverModal/hooks/useCoverPersistence.ts`（spec 07 §5.2）
  - `enabled` 控制是否启动
  - GET 首次加载，setLoadError on fail
  - 600ms debounce save，PUT 串行（inflight 等待）
  - 失败回填 pendingRef，下次 save 自动重发
  - 卸载前 flush
- [ ] 单测 `__tests__/useCoverPersistence.test.tsx`：6+ 用例（首次加载 / debounce / 串行 / 失败重发 / flush / unmount）

### D. VideoCoverModal 顶层接线

- [ ] 在 `VideoCoverModal.tsx`：
  - `const persistence = useCoverPersistence({ projectId, enabled: isOpen })`
  - 加载完成后接入 initialState；如 null 用 `makeDefaultState(aspectRatio)`（在 todo 02 E 已落地，本 todo 仅消费）
  - 状态变化 useEffect → `persistence.save(coverState)`
  - 关闭弹窗时 `persistence.flush()`

### E. 错误提示（toast）

- [ ] 复用项目已有的 `Toast`（`src/components/ui/Toast.tsx`）
- [ ] save 失败仅在连续 3 次后 toast；前两次静默
- [ ] uploadPng 失败 toast 一次 + 不阻塞

### F. i18n keys

- [ ] `videoCoverModal.errors.loadFailed / saveFailed / uploadFailed`

### G. 端到端验收

- [ ] 弹窗内修改 → 关闭 → 重开 → 状态完整恢复
- [ ] 弱网下保存失败 → toast 提示 → 网络恢复后自动重发
- [ ] 切换项目时 inflight save 被 abort，新项目独立加载
- [ ] 多设备：A 设备改 → B 设备打开能看到（无实时同步要求，最后写赢）
- [ ] 全部单测 + 集成测试通过
