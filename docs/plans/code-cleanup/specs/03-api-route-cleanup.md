# Spec 03: 前后端 API 路由对应关系检查与清理

## 概述

交叉验证前端 Next.js API 路由（`src/app/api/`）与后端 FastAPI 路由（`app/routers/`），找出不再被使用的废弃路由。

## 检查维度

### 1. 前端 API 路由 → 前端组件调用

**方向：** 前端 API 路由是否被前端代码调用？
**检查方法：**
- 对 `src/app/api/` 下每个路由路径，grep 查找 `src/` 中的 fetch/axios 调用
- 同时检查 `src/lib/api/` 中的 API 客户端函数引用
- 如果一个 API 路由没有任何前端代码调用 → 标记为废弃

### 2. 前端 API 路由 → 后端路由代理

**方向：** 前端 API 路由代理的后端端点是否还存在？
**检查方法：**
- 读取每个前端 API 路由文件，提取 `BACKEND_URL` 后拼接的路径
- 验证对应的后端路由端点是否存在于 `app/routers/`

### 3. 后端路由 → 前端代理

**方向：** 后端路由端点是否有对应的前端 API 路由代理？
**检查方法：**
- 列出 `app/routers/` 中所有端点
- 对比前端 API 路由的代理目标
- 没有前端代理的后端端点 → 需要判断是否为直接调用（如 root mount 的路由）

### 4. 孤立的 API 客户端函数

**检查范围：** `src/lib/api/` 下的函数
**检查方法：**
- 导出的函数未被任何组件/hook 调用 → 废弃

## 特殊情况

- `ai_video_generate_router`、`video_export_router`、`intent_detection_router` 挂载在 root（不在 `/api` 前缀下）
- 直接 LLM 调用的路由（chat 路由）不代理后端，不参与后端对比
- 部分路由可能被 workflow executor 动态调用

## 产出

- 删除废弃的前端 API 路由文件（整个目录）
- 删除废弃的后端路由端点方法
- 删除废弃的 API 客户端函数
