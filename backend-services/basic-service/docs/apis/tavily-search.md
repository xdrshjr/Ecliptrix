# Tavily Search 集成说明

## 概述

Tavily 网络搜索由 `app/services/web_research/web_search_service.py` 提供，
属于剪辑 Agent 的网络研究服务域（spec：
`docs/plans/agent-general-capabilities/spec.md`）。旧工作流时代的
`tavily_search_service.py` 与 `/api/workflow/tavily-search` 端点已删除，
本文档仅描述现行集成，避免悬挂引用。

## 入口

- REST：`POST /api/web-research/search`（Bearer 形式的错误契约见
  `app/models/web_research_models.py::STATUS`）
- Agent 工具：`web_search`（`src/lib/video-editing-agent/tools/webTools.ts`，
  经 Next.js BFF `src/app/api/web-research/[...path]/route.ts` 白名单代理）

## Key 管理

- 显式凭证：设置中心「AI → 网络与研究」→ 搜索凭证
  （`PUT /api/web-research/credentials`，≤5 把，仅该专用入口可写；
  响应永不回显，只返回 `configured/key_count`）
- 未显式保存时回落读取 env `TAVILY_API_KEYS`（逗号分隔多把）
- 401/403 自动换下一把；429 按 Retry-After 最多等 2s 再换，
  最多尝试 min(key_count, 3) 次；零 key 返回 HTTP 503
  `provider_not_configured`（failure_class=configuration）

## 请求参数

| 字段 | 约束 |
|---|---|
| query | 1..512 字符 |
| max_results | 1..8（默认 5） |
| search_depth | basic / advanced |
| include_images | bool（图片仅作候选，不自动下载） |

上游固定 `POST https://api.tavily.com/search`，
`include_raw_content=false`；搜索结果带服务端分配的来源 ID 与
artifact 引用（分页读取走 `read_research_artifact` 工具）。
