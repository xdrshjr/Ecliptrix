# Spec 07 — Frontend Persistence & BFF

> 父：`master-plan.md` §7.1, §5.2
> 范围：Next.js BFF 路由（GET/PUT/POST）、API client、`useCoverPersistence` hook、debounce 保存、并发控制

## 1. Goals

- G7.1 BFF 三个路由：GET/PUT 配置、POST PNG 缓存
- G7.2 API client `videoCover.ts` 封装 fetch，统一错误处理与超时
- G7.3 `useCoverPersistence` hook 提供 `load / save / uploadPng`，自动 debounce 保存（600 ms）
- G7.4 同一时刻只有一个 save 在飞行；新 save 排队、覆盖待发的旧 save
- G7.5 网络错误时显示 toast 但不阻塞 UI；下次自动重试

## 2. 文件改动列表

### 2.1 新增

```
src/app/api/video-cover/[projectId]/
├── route.ts                       # GET / PUT
└── png-cache/
    └── route.ts                   # POST

src/lib/api/
└── videoCover.ts

src/components/video/components/VideoCoverModal/hooks/
├── useCoverPersistence.ts
└── __tests__/
    └── useCoverPersistence.test.tsx
```

## 3. BFF 路由

### 3.1 `/api/video-cover/[projectId]/route.ts`

> **代理工具更正**：项目实际的代理 helper 名为 `createPassthroughRoute` / `backendProxy`，位于 `src/lib/api/server/backend-proxy.ts`（非 `proxyToBackend`）。已确认其特性：自动转发 `Authorization` 与 `x-session-token`、原样转发 multipart、超时与错误统一为 `BACKEND_TIMEOUT` / `BACKEND_UNREACHABLE` / `BACKEND_ERROR` envelope、支持动态参数 builder 形态。

```ts
import { createPassthroughRoute } from '@/lib/api/server/backend-proxy';

// 动态路由：使用 builder 形态读取 params.projectId
export const { GET, PUT, DELETE } = createPassthroughRoute(
  (p) => `/api/video-cover/${p.projectId}`,
);
```

> 一行代码即可覆盖 GET / PUT / DELETE；helper 已自动处理 JSON / multipart 转发与 Authorization 透传，本路由不需要额外手写。

### 3.2 `/api/video-cover/[projectId]/png-cache/route.ts`

> **更正**：`backend-proxy.ts` 已经原生支持 multipart（行 219-225：当 `Content-Type` 以 `multipart/form-data` 起头时，helper 会 `await req.formData()` 然后用 `FormData` 作为 body，让 `fetch` 自动写新 boundary，**不**需要手撕 `duplex: 'half'`）。可对比 `src/app/api/storage/upload-file/route.ts`，它就是一行 `createPassthroughRoute('/api/storage/upload-file', { timeoutMs: 60_000 })`。

```ts
import { createPassthroughRoute } from '@/lib/api/server/backend-proxy';

// multipart 上传：helper 会 re-encode FormData 并加新 boundary，
// 同时透传 Authorization / x-session-token。
export const { POST } = createPassthroughRoute(
  (p) => `/api/video-cover/${p.projectId}/png-cache`,
  { timeoutMs: 60_000 },          // PNG 上传放宽到 60s
);
```

> 取消之前手写的 `duplex: 'half'` 流式转发：现版本 helper 把 multipart 在 BFF 完整接收后再转发到后端，行为与 `/api/storage/upload-file` 等已上线路由一致；trade-off 是 BFF 需要 buffer 整个 PNG（≤5MB），与现状对齐，不另开特例。

## 4. API Client `src/lib/api/videoCover.ts`

```ts
import type { CoverState } from '@/components/video/components/VideoCoverModal/types';

const TIMEOUT_MS = 10000;

async function fetchWithTimeout(input: RequestInfo, init?: RequestInit, ms = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface CoverApiError extends Error {
  status?: number;
}

function makeError(status: number, message: string): CoverApiError {
  const e = new Error(message) as CoverApiError;
  e.status = status;
  return e;
}

export async function getCover(projectId: string): Promise<CoverState | null> {
  const res = await fetchWithTimeout(`/api/video-cover/${projectId}`);
  if (res.status === 404) return null;
  if (!res.ok) throw makeError(res.status, await res.text());
  const json = await res.json();
  return json.data ?? null;
}

export async function putCover(projectId: string, state: CoverState): Promise<CoverState> {
  const res = await fetchWithTimeout(`/api/video-cover/${projectId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  });
  if (!res.ok) throw makeError(res.status, await res.text());
  const json = await res.json();
  return json.data;
}

export async function uploadCoverPng(projectId: string, blob: Blob): Promise<{ url: string }> {
  const fd = new FormData();
  fd.append('file', blob, 'cover.png');
  const res = await fetchWithTimeout(`/api/video-cover/${projectId}/png-cache`, {
    method: 'POST',
    body: fd,
  }, 30000);            // 上传超时放宽到 30s
  if (!res.ok) throw makeError(res.status, await res.text());
  const json = await res.json();
  return json.data;
}

export async function deleteCover(projectId: string): Promise<void> {
  const res = await fetchWithTimeout(`/api/video-cover/${projectId}`, { method: 'DELETE' });
  if (!res.ok) throw makeError(res.status, await res.text());
}
```

## 5. `useCoverPersistence` Hook

### 5.1 API

```ts
export interface UseCoverPersistenceOpts {
  projectId: string;
  enabled: boolean;             // 弹窗未打开时不启动
}

export function useCoverPersistence(opts: UseCoverPersistenceOpts): {
  initialState: CoverState | null;     // 首次 GET 的结果，加载完再可读
  isLoading: boolean;
  loadError: Error | null;
  save: (state: CoverState) => void;   // debounced
  flush: () => Promise<void>;          // 立即清空 debounce 队列
  uploadPng: (blob: Blob) => Promise<string>;
};
```

### 5.2 实现要点

```ts
export function useCoverPersistence({ projectId, enabled }) {
  const [initialState, setInitialState] = useState<CoverState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const pendingRef = useRef<CoverState | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // 首次加载
  useEffect(() => {
    if (!enabled || !projectId) return;
    setIsLoading(true);
    setLoadError(null);
    getCover(projectId)
      .then(state => setInitialState(state))
      .catch(err => setLoadError(err))
      .finally(() => setIsLoading(false));
  }, [enabled, projectId]);

  // debounce save
  const flush = useCallback(async () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (!pendingRef.current) return;
    if (inFlightRef.current) {
      await inFlightRef.current;        // 等前一个完成再发新的
      // pendingRef 可能在等待期间被新 save 覆盖，这里取最新
    }
    if (!pendingRef.current) return;
    const payload = pendingRef.current;
    pendingRef.current = null;
    inFlightRef.current = putCover(projectId, payload)
      .then(() => { /* ok */ })
      .catch(err => {
        toast.error(t.videoCoverModal.errors.saveFailed);
        // 失败时回填，下次 save 会再发
        if (!pendingRef.current) pendingRef.current = payload;
      })
      .finally(() => { inFlightRef.current = null; });
    return inFlightRef.current;
  }, [projectId]);

  const save = useCallback((state: CoverState) => {
    pendingRef.current = state;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { void flush(); }, 600);
  }, [flush]);

  const uploadPng = useCallback(async (blob: Blob) => {
    const { url } = await uploadCoverPng(projectId, blob);
    return url;
  }, [projectId]);

  // 卸载前 flush
  useEffect(() => {
    return () => { void flush(); };
  }, [flush]);

  return { initialState, isLoading, loadError, save, flush, uploadPng };
}
```

### 5.3 错误处理

| 错误 | 行为 |
|----|------|
| 加载 GET 失败（非 404） | toast 警告；UI 仍渲染默认状态（不阻塞使用） |
| 加载 GET 404 | 返回 null，applyDefault |
| save PUT 失败 | toast 警告；下次 save 自动重发；不报错弹框 |
| uploadPng 失败 | toast 警告；本地下载已完成不影响 |

## 6. `VideoCoverModal` 顶层状态接线

### 6.1 状态结构

```ts
const [coverState, setCoverState] = useState<CoverState>(makeDefaultState(aspectRatio));
const [selectedLayerKey, setSelectedLayerKey] = useState<string | null>(null);
const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
const [isCapturing, setIsCapturing] = useState(false);

const persistence = useCoverPersistence({ projectId, enabled: isOpen });

// 加载完成后接入持久状态
useEffect(() => {
  if (!persistence.isLoading && persistence.initialState) {
    setCoverState(persistence.initialState);
  } else if (!persistence.isLoading && !persistence.initialState) {
    setCoverState(makeDefaultState(aspectRatio));   // 模板 1 + frameTime 0
  }
}, [persistence.isLoading, persistence.initialState, aspectRatio]);

// 状态变化时 debounced save
useEffect(() => {
  if (!persistence.isLoading) {
    persistence.save(coverState);
  }
}, [coverState]);

// 关闭弹窗前 flush
useEffect(() => {
  if (!isOpen) {
    persistence.flush().catch(() => {});
  }
}, [isOpen]);
```

### 6.2 默认状态构造

```ts
function makeDefaultState(aspectRatio: CoverAspectRatio): CoverState {
  return {
    templateId: 'title',
    config: structuredClone(COVER_TEMPLATES.title.defaultConfig),
    imageSource: 'frame',
    frameVirtualTimeMs: 0,
    uploadedImageUrl: null,
    aspectRatio,
  };
}
```

> 当 `aspectRatio` 在弹窗外变化（用户先关弹窗、改宽高比、再开），保存的状态里 `aspectRatio` 字段会被同步覆盖；旧坐标保持归一化。

## 7. i18n keys 增量

```ts
videoCoverModal: {
  errors: {
    loadFailed: '加载封面配置失败' | 'Failed to load cover config',
    saveFailed: '保存失败，将自动重试' | 'Save failed, will retry',
    uploadFailed: '云端缓存失败（不影响本地下载）' | 'Cloud cache failed (local download unaffected)',
  },
}
```

## 8. 测试计划

### 8.1 `useCoverPersistence.test.tsx`

- 首次加载触发 GET 一次
- 多次 save 在 600ms 内只 PUT 一次（拿到最新值）
- save 期间触发新 save → 等待前一个完成后再发，PUT 内容是最新值
- PUT 失败 → 自动重发（mock 第二次成功）
- flush 立即清队列
- 卸载时 flush

### 8.2 `videoCover.test.ts` (API client)

- 404 → null
- 500 → throw with status
- timeout abort → throw AbortError
- uploadCoverPng 上传 multipart Content-Type 含 boundary

### 8.3 BFF 路由（集成）

- GET / PUT proxy 透传 status code 与 body
- 未设置 BACKEND_URL → 500 + 友好消息
- multipart POST 流式转发不损坏数据（hash 比对）

## 9. 边界与风险

| 风险 | 缓解 |
|----|------|
| `BACKEND_URL` 未配置 | BFF 返回 500 与诊断消息（参考 memory：post-refactor 单一来源） |
| Next.js multipart 流式转发：`duplex: 'half'` 在某些 Node 版本需要 polyfill | **已不适用**：本 spec 已切换为 `createPassthroughRoute` + 原生 FormData 重编码（参见 §3.2），不再使用流式转发 |
| toast 误轰炸 | save 失败仅在用户明显感知（连续 3 次失败）后才 toast；前两次静默 |
| 本地编辑后没保存就关闭 | 卸载时 flush；用户即便立刻关也不丢配置（除非网络极差） |
| 防抖期间用户切换项目 | `useCoverPersistence` 在 projectId 变化时 abort 旧 inflight；初始化新 GET |
| 项目尚未持久化（id 为临时）| 调用方需保证 projectId 已是后端 ID；否则不显示按钮（spec 01 G1.6） |
| BFF 路由用文件名 `[projectId]` 触发 Next.js 动态段匹配 | 与项目其他 `[id]` 路由风格一致 |
| `proxyToBackend` 不存在或不支持 multipart | **已确认**：项目实际 helper 名为 `createPassthroughRoute` / `backendProxy`（`src/lib/api/server/backend-proxy.ts`），原生支持 multipart（FormData 重编码）；本 spec §3.1/3.2 已统一使用 |

## 10. Dependencies

- 上游：spec 06（后端路由提供契约）
- 下游：spec 05（uploadPng 在下载流程中调用）；VideoCoverModal 主流程消费 `useCoverPersistence`
- 第三方：无新增

## 11. 完成条件

- [ ] BFF 三条路由通过手动 curl 测试可调通后端
- [ ] API client 单元测试全绿
- [ ] `useCoverPersistence` 单元测试覆盖防抖、并发、重试
- [ ] 关闭弹窗时确保 flush 已发出
- [ ] 端到端：在弹窗内修改 → 关闭 → 重开 → 状态恢复
