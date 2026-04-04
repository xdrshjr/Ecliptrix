# 06 - 前端 API Proxy 路由

## 概述

在 Next.js API 层新增 proxy 路由，将前端请求转发到后端的 `/api/system-settings/*` 端点。同时更新现有 model-settings proxy 适配 UUID。

## 新增路由

### 目录结构

```
src/app/api/system-settings/
  categories/
    route.ts                          # GET -> /api/system-settings/categories
  [category]/
    route.ts                          # GET, PUT -> /api/system-settings/{category}
    [key]/
      route.ts                        # PUT -> /api/system-settings/{category}/{key}
    reset/
      route.ts                        # POST -> /api/system-settings/{category}/reset
  reset-all/
    route.ts                          # POST -> /api/system-settings/reset-all
  audit-log/
    route.ts                          # GET -> /api/system-settings/audit-log
```

### 路由实现模式

所有路由遵循现有 proxy 模式（与 `src/app/api/model-settings/` 一致）：

```
// src/app/api/system-settings/[category]/route.ts

import { NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000'

export async function GET(
  request: Request,
  { params }: { params: { category: string } }
) {
  const { category } = await params
  const res = await fetch(`${BACKEND_URL}/api/system-settings/${category}`, {
    headers: { 'Content-Type': 'application/json' },
  })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}

export async function PUT(
  request: Request,
  { params }: { params: { category: string } }
) {
  const { category } = await params
  const body = await request.json()

  // 从请求中传递认证 header
  const sessionToken = request.headers.get('authorization') || ''

  const res = await fetch(`${BACKEND_URL}/api/system-settings/${category}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': sessionToken,
    },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
```

### 认证传递

所有 system-settings 路由需要将 session token 从前端请求转发到后端：

```
从 request.headers.get('authorization') 获取 token
传递到后端请求的 Authorization header
```

前端调用时需要携带 session token（从 localStorage `ecliptrix-session-token` 获取）。

## 前端 API Client

### 新增: `src/lib/api/systemSettings.ts`

```
接口定义:

getCategories(): Promise<CategoriesResponse>
getCategorySettings(category: string): Promise<CategorySettingsResponse>
updateSetting(category: string, key: string, value: any): Promise<SettingResponse>
updateCategorySettings(category: string, settings: Record<string, any>): Promise<CategorySettingsResponse>
resetCategory(category: string): Promise<CategorySettingsResponse>
resetAll(): Promise<BaseResponse>
getAuditLog(params?: { category?: string, limit?: number, offset?: number }): Promise<AuditLogResponse>
```

**实现模式（与现有 `src/lib/api/config.ts` 一致）：**

```
const API_BASE = '/api/system-settings'

export async function getCategorySettings(category: string) {
  const token = localStorage.getItem('ecliptrix-session-token')
  const res = await fetch(`${API_BASE}/${category}`, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  })
  return res.json()
}
```

## 现有路由变更

### `src/app/api/model-settings/`

**变更点：** `provider_id` 参数从数字改为 UUID 字符串。

受影响的路由文件：
- `providers/[providerId]/route.ts` — providerId 变为 UUID string（实际不影响 proxy 逻辑，因为只是 URL 参数传递）
- `providers/[providerId]/fetch-models/route.ts` — 同上

**无需代码修改** — Next.js 动态路由 `[providerId]` 本身就是 string 类型，proxy 只是传递参数，UUID 和 integer 在 URL 中都是字符串。

### `src/components/AdminSettings/ModelSettingsPanel.tsx`

**变更点：**
- 所有 `provider.id` 从 `number` 改为 `string`
- `ModelAssignmentRequest.provider_id` 从 `number` 改为 `string`
- 相关 state 类型更新

## TypeScript 类型定义

### 新增到 `src/types/index.ts` 或单独文件

```
interface SystemSettingItem {
  key: string
  value: any
  default_value: any
  value_type: string
  description?: string
  updated_at?: string
  updated_by?: string
}

interface SettingsCategory {
  name: string
  label: string
  description: string
}

interface AuditLogEntry {
  id: string
  setting_type: string
  category?: string
  key?: string
  action: string
  changed_by?: string
  changed_at: string
}
```
