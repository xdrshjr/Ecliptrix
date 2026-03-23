# TODO 03: API 路由对应关系检查与清理

**对应 Spec:** `specs/03-api-route-cleanup.md`

## Dependencies
- `depends_on: [01, 02]` — 需要先完成前后端死代码清理，避免在已废弃的代码中找到虚假引用
- `blocks: []` — 无后续阻塞
- `parallel_group: B`

## 任务清单

### 前端 API 路由被调用检查
- [x] 列出 `src/app/api/` 下所有路由路径 (87 routes)
- [x] 对每个路由路径 grep 前端代码中的调用
- [x] 同时检查 `src/lib/api/` 中对应的 API 客户端函数
- [x] 标记无任何调用的废弃路由

### 前后端路由代理对应检查
- [x] 读取每个前端 API 路由文件，提取代理的后端路径
- [x] 验证后端路由端点存在性
- [x] 标记代理目标不存在的废弃路由 (`/api/files/upload` proxied to non-existent backend endpoint)

### 后端孤立端点检查
- [x] 列出 `app/routers/` 中所有端点
- [x] 对比前端 API 路由的代理目标
- [x] 标记没有前端代理且不被直接调用的端点 (see report below)

### 孤立 API 客户端函数
- [x] 扫描 `src/lib/api/` 导出函数
- [x] 删除未被任何组件/hook 调用的函数

### 执行清理
- [x] 删除废弃的前端 API 路由文件
- [ ] 删除废弃的后端路由端点 (deferred — backend endpoints left intact for safety)
- [x] 删除废弃的 API 客户端函数
- [x] 运行 `npm run type-check` + `npm run build` 验证

## 执行结果

### 已删除的前端 API 路由目录 (9)
1. `src/app/api/chat/workflow/` — zero callers; used ServerWorkflowExecutor (also deleted)
2. `src/app/api/files/upload/` — zero callers; proxied to non-existent backend endpoint
3. `src/app/api/prompt-optimization/` — zero callers; superseded by `/api/prompt-polish/`
4. `src/app/api/tts/health/` — zero callers; health check with no frontend consumer
5. `src/app/api/video-composition/` — zero callers; superseded by `/api/video-compose/`
6. `src/app/api/video-editing/` — zero callers; superseded by `/api/video-editing-chat/`
7. `src/app/api/youtube/info/` — zero callers
8. `src/app/api/admin/users/delete/[userId]/` — old URL format duplicate; new format `[userId]/delete` is used
9. `src/app/api/model-settings/route.ts` — root backward-compatibility shim; sub-routes used directly

### 已删除的支持文件 (1)
1. `src/lib/workflow/ServerWorkflowExecutor.ts` — only used by deleted `chat/workflow` route

### 已删除的 API 客户端文件 (1)
1. `src/lib/api/storage.ts` — all 3 exports (`uploadVideo`, `uploadFile`, `downloadFile`) had zero external callers

### 后端孤立端点（未删除，仅报告）
- `POST /api/youtube/info` — backend endpoint exists but frontend proxy was deleted; no other backend callers found

### 验证结果
- `npm run type-check`: PASS (only pre-existing test runner type errors in `trimming.test.ts`)
- `npm run build`: PASS (clean build, deleted routes no longer in output)
