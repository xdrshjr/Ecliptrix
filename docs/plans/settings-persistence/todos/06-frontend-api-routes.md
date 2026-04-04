# TODO 06 - 前端 API Proxy 路由

**对应规格:** `specs/06-frontend-api-routes.md`

## Dependencies

- `depends_on: [03]` — 需要后端 API 端点已实现
- `blocks: [05]` — 前端面板调用这些 proxy 路由
- `parallel_group: C` — 可与 04 并行

**Why:** 前端面板通过 Next.js proxy 路由访问后端 API，路由必须先就绪。

## Tasks

### Proxy 路由
- [x] 创建 `src/app/api/system-settings/categories/route.ts` — GET 代理
- [x] 创建 `src/app/api/system-settings/[category]/route.ts` — GET + PUT 代理
- [x] 创建 `src/app/api/system-settings/[category]/[key]/route.ts` — PUT 代理
- [x] 创建 `src/app/api/system-settings/[category]/reset/route.ts` — POST 代理
- [x] 创建 `src/app/api/system-settings/reset-all/route.ts` — POST 代理
- [x] 创建 `src/app/api/system-settings/audit-log/route.ts` — GET 代理
- [x] 所有路由正确传递 Authorization header

### API Client
- [x] 创建 `src/lib/api/systemSettings.ts`
- [x] 实现 `getCategories()`, `getCategorySettings()`, `updateSetting()`, `updateCategorySettings()`, `resetCategory()`, `resetAll()`, `getAuditLog()`
- [x] 所有方法附带 session token

### TypeScript 类型
- [x] 定义 `SystemSettingItem`, `SettingsCategory`, `AuditLogEntry` 等类型
- [x] 添加到 `src/types/index.ts` 或单独类型文件

### 现有路由适配
- [x] 更新 `ModelSettingsPanel.tsx` 中 provider_id 类型从 number 改为 string
- [x] 更新 `CodingPlanPanel.tsx` 中 provider_id 类型（如适用）
- [x] 验证现有 model-settings proxy 路由在 UUID 参数下正常工作
