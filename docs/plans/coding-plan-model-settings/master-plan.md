# Master Plan: Coding Plan 模型设置适配与设置界面优化

## 1. 概述

本项目的目标是将 Coding Plan 模型设置合并到现有的模型设置主面板中，同时全面优化模型设置界面的布局、流程和体验。核心工作包括：新增 `coding` 功能类型到统一面板、修正 GLM Coding Plan 的 API 端点配置、增强连接测试支持用户手动选择 API 格式、以及将整个模型设置界面重构为 Tab 分页布局。

## 2. 目标

1. **合并 Coding Plan 到模型设置主面板**：删除独立的 `CodingPlanPanel` 和侧边栏菜单项，将 `coding` 作为第 5 个功能类型统一管理
2. **修正 Coding Plan 提供商配置**：更新 GLM Coding Plan 的 API 端点和模型列表（基于 `docs/coding-plan` 测试结果）
3. **新增 API 格式字段**：在提供商层面增加 `api_format` 字段（`openai` / `anthropic`），支持自动推断和用户手动覆盖
4. **Tab 分页布局重构**：将模型设置面板重构为三个 Tab — 提供商管理 / 模型分配 / 高级设置
5. **增强连接测试**：根据提供商类型和 API 格式自动选择测试方式，显示延迟和模型信息
6. **智能表单默认值**：新增/编辑提供商时自动填充默认 URL 和模型名，用户可自定义修改
7. **确保端到端可用**：Kimi K2.5 和 GLM 5.1 的 Coding Plan 必须实际调通

## 3. 范围

### 范围内（In Scope）

- 后端：`ModelFunctionType` 已有 `CODING`，无需新增枚举值
- 后端：`ProviderInfo` 增加 `api_format` 和 `default_models` 字段（静态参考数据）
- 后端：`ModelProviderCreate`/`ModelProviderUpdate`/`ModelProviderResponse` 增加 `api_format` 字段（用户 CRUD）
- 后端：数据库 `model_providers` 表增加 `api_format` 列（可选，默认 `auto`）
- 后端：修正 GLM Coding Plan 端点为 `https://open.bigmodel.cn/api/coding/paas/v4`（OpenAI 格式）
- 后端：更新 GLM Coding Plan 模型列表为 `["glm-5.1", "glm-5-turbo"]`
- 后端：修正 Kimi Coding 的 `region` 从 `international` 为 `domestic`
- 后端：Kimi Coding 请求需附加 `User-Agent: claude-code/1.0` 请求头
- 后端：连接测试支持用户指定 API 格式覆盖自动检测
- 后端：`TestConnectionResponse` 增加 `model_info` 字段
- 前端：删除 `CodingPlanPanel.tsx` 组件
- 前端：删除 `SettingsSidebar` 中的 `codingPlan` 菜单项
- 前端：`ModelSettingsPanel` 重构为 Tab 布局（提供商 / 模型分配 / 高级）
- 前端：`FUNCTION_TYPES` 扩展到 5 个，增加 `coding`
- 前端：提供商表单增加 `api_format` 选择（自动 / OpenAI / Anthropic）
- 前端：提供商表单选择类型时自动填充默认 URL
- 前端：连接测试 UI 增强，支持格式选择
- i18n：新增 coding 相关的翻译 key

### 范围外（Out of Scope）

- 用户级个人配置（保持系统级全局）
- 新增其他非 coding 类的提供商
- Workflow 或 Agent 系统的 coding 集成
- 前端深色/浅色主题重新设计

## 4. 架构设计

### 4.1 数据模型变更

```
model_providers 表:
  + api_format VARCHAR(20) DEFAULT 'auto'   -- 'auto' | 'openai' | 'anthropic'
```

`api_format` 的解析逻辑（取代现有 `ANTHROPIC_FORMAT_TYPES` 常量）：
- `auto`（默认）：根据 `provider_type` 自动推断（`kimi_coding`, `claude_coding`, `anthropic` → Anthropic 格式，其余 → OpenAI 格式）
- `openai`：强制使用 OpenAI Chat Completions 格式
- `anthropic`：强制使用 Anthropic Messages 格式

### 4.2 后端提供商配置更新

`ProviderInfo` 新增 `api_format` 和 `default_models` 两个可选字段。现有 `CODING_PROVIDER_MODELS` 字典将合并到各 `ProviderInfo` 的 `default_models` 字段中，统一管理。非 coding 类的通用提供商（deepseek, openai 等）可不设 `default_models`，继续使用 `/models` 端点动态获取。

```python
# 目标状态：PROVIDERS 列表中 Coding Plan 提供商（含端点修正 + 新增字段）
ProviderInfo(id="kimi_coding", name="Kimi Coding Plan",
             default_api_url="https://api.kimi.com/coding",
             region="domestic",
             api_format="anthropic",
             default_models=["kimi-k2.5"])
# 注意：Kimi 请求需要 User-Agent: claude-code/1.0 头，否则连接被拒绝

ProviderInfo(id="glm_coding", name="GLM Coding Plan",
             default_api_url="https://open.bigmodel.cn/api/coding/paas/v4",
             region="domestic",
             api_format="openai",
             default_models=["glm-5.1", "glm-5-turbo"])

ProviderInfo(id="codex", name="Codex (OpenAI)",
             default_api_url="https://api.openai.com/v1",
             region="international",
             api_format="openai",
             default_models=["codex-mini-latest"])

ProviderInfo(id="claude_coding", name="Claude (Anthropic)",
             default_api_url="https://api.anthropic.com",
             region="international",
             api_format="anthropic",
             default_models=["claude-sonnet-4-20250514", "claude-opus-4-20250514"])
```

### 4.3 前端 Tab 布局

```
┌─────────────────────────────────────────────────────┐
│  [提供商管理]  [模型分配]  [高级设置]                   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Tab 1: 提供商管理                                   │
│  - 已保存提供商列表（卡片式）                           │
│  - 新增/编辑提供商表单                                 │
│  - 测试连接按钮（带格式选择）                           │
│  - 获取模型列表                                       │
│                                                     │
│  Tab 2: 模型分配                                     │
│  - 5 个功能类型卡片（chat/fast/video_cut/vision/coding）│
│  - 每个卡片：提供商选择 → 模型选择 → 温度设置           │
│  - 状态指示：使用数据库配置 / 使用环境变量默认           │
│                                                     │
│  Tab 3: 高级设置                                     │
│  - 环境变量回退配置说明                                │
│  - 当前生效配置概览（所有功能类型的实际解析结果）         │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 4.4 连接测试增强

```
TestConnectionRequest:
  + api_format: Optional[str]  -- 用户可手动指定 'openai' | 'anthropic'

TestConnectionResponse:
  + model_info: Optional[dict]  -- 测试成功时返回模型信息摘要
```

测试格式解析优先级：
1. 用户手动指定的 `api_format`（请求参数）
2. 提供商保存的 `api_format`（数据库）
3. 根据 `provider_type` 自动推断

特殊处理：
- `kimi_coding` 类型的请求需附加 `User-Agent: claude-code/1.0` 头（现有 `_test_anthropic_connection` 已处理此逻辑）
- `model_info` 返回字段包含模型 ID、所有者等测试成功后的摘要信息

## 5. 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| Coding 集成方式 | 合并到主面板 | 避免组件/逻辑重复，统一管理入口 |
| 面板布局 | Tab 分页 | 清晰分离关注点，避免信息过载 |
| API 格式 | 提供商级别字段 | GLM 同时支持两种格式，需要用户能选择 |
| 默认值策略 | 智能表单 | 选择 provider_type 时自动填充 URL/模型，降低配置门槛 |
| 菜单项 | 删除独立 CodingPlan | 避免入口混乱，统一到模型设置 |
| DB 迁移 | 新增 api_format 列 | 最小化变更，向后兼容（默认 auto） |

## 6. 依赖关系

- 后端 DB 迁移必须先于前端变更
- `ProviderInfo` 模型扩展必须先于前端提供商表单改造
- 连接测试增强必须先于前端测试 UI 改造
- 提供商管理 Tab 必须先于模型分配 Tab（分配依赖已保存的提供商）
- 前端清理和 i18n（spec 05）可与 Tab 重构（specs 03-04）并行，但建议最后执行以避免合并冲突

## 7. 风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| GLM Coding Plan 端点变更 | API 调不通 | 基于 docs/coding-plan 测试脚本验证端点 |
| Kimi User-Agent 校验 | 连接失败 | 后端 `_test_anthropic_connection` 已处理 |
| DB 迁移兼容性 | 现有数据丢失 | `api_format` 使用默认值 `auto`，不影响现有记录 |
| 前端大量重构 | 引入 UI bug | 分 Tab 逐步迁移，保持数据获取逻辑不变 |
| 已有 coding assignment 数据 | 迁移后不兼容 | coding function_type 不变，已有分配继续生效 |

## 8. Spec 文件目录

| Spec | 内容 |
|------|------|
| `specs/01-backend-model-changes.md` | 后端模型、数据库迁移、提供商配置更新 |
| `specs/02-backend-test-connection.md` | 连接测试增强、API 格式支持 |
| `specs/03-frontend-tab-layout.md` | 前端 Tab 布局重构、提供商管理 Tab |
| `specs/04-frontend-model-assignment.md` | 模型分配 Tab、coding 类型集成 |
| `specs/05-frontend-cleanup-i18n.md` | 删除 CodingPlanPanel、菜单清理、i18n |
