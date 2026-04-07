# Spec 03: 前端 Tab 布局重构与提供商管理

## 1. 概述

将 `ModelSettingsPanel.tsx` 从当前的单页混合布局重构为三 Tab 分页布局（提供商管理 / 模型分配 / 高级设置），并重写提供商管理 Tab 的交互体验。

## 2. 涉及文件

| 文件 | 变更类型 |
|------|----------|
| `src/components/AdminSettings/ModelSettingsPanel.tsx` | 修改：重构为 Tab 布局，扩展接口定义，重写提供商管理区域 |

注意：模型分配 Tab（Tab 2）和高级设置 Tab（Tab 3）的内容实现见 Spec 04。删除 `CodingPlanPanel.tsx` 和侧边栏菜单清理见 Spec 05。

## 3. Tab 结构设计

```
┌──────────────────────────────────────────────────────────┐
│  [提供商管理]    [模型分配]    [高级设置]                    │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  (Tab 内容区域)                                           │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

- Tab 切换使用受控状态 `activeTab: 'providers' | 'assignments' | 'advanced'`
- Tab 样式使用自定义 Tab 组件（项目 `src/components/ui/` 中没有 shadcn Tabs，需手写简单 Tab 切换，与项目现有样式一致）
- 默认激活第一个 Tab（提供商管理）

## 4. 提供商管理 Tab（Tab 1）

### 4.1 布局结构

```
┌──────────────────────────────────────────────────────────┐
│  提供商管理                                    [+ 添加提供商] │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌─────────────────┐  ┌─────────────────┐                │
│  │ DeepSeek         │  │ Kimi Coding Plan│                │
│  │ api.deepseek.com │  │ api.kimi.com    │                │
│  │ Key: sk-****xxx  │  │ Key: 未设置      │                │
│  │ 格式: OpenAI     │  │ 格式: Anthropic  │                │
│  │ [编辑] [测试] [删]│  │ [编辑] [测试] [删]│                │
│  └─────────────────┘  └─────────────────┘                │
│                                                          │
│  (如果正在编辑/新增)                                       │
│  ┌──────────────────────────────────────────────────────┐│
│  │  提供商类型: [下拉选择 ▼]                               ││
│  │  显示名称:   [____________]                            ││
│  │  API URL:    [____________]  (选择类型后自动填充默认值)   ││
│  │  API Key:    [____________]                            ││
│  │  API 格式:   [自动 ▼] / [OpenAI] / [Anthropic]         ││
│  │  可用模型:   [获取模型列表]  glm-5.1, glm-5-turbo       ││
│  │             [测试连接]  ✓ 连接成功 (320ms)              ││
│  │                                                      ││
│  │            [保存]  [取消]                               ││
│  └──────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────┘
```

### 4.2 提供商表单行为

**类型选择自动填充：**
- 用户选择 `provider_type` 时，从 `knownProviders` 查找匹配项
- 自动填充 `api_url` 为 `default_api_url`
- 自动填充 `api_format` 为该类型的默认格式
- 如果用户之前未手动修改过这些字段，则覆盖；已修改的字段保持不变

**API 格式选择器：**
- 下拉选项：`自动` / `OpenAI` / `Anthropic`
- 默认值：`自动`（跟随 provider_type 推断）
- 用户可手动覆盖

**模型列表获取：**
- 对于有 `default_models` 的提供商（coding 类），直接显示预置模型列表
- 对于通用提供商，调用 `/api/model-settings/fetch-models` 获取
- 模型列表以 tag/chip 样式展示

**连接测试：**
- 点击"测试连接"时，使用表单中的 `api_format` 值发送到后端
- 显示结果：成功（绿色 + 延迟）/ 失败（红色 + 错误信息）
- 测试时使用模型列表中的第一个模型（或 `default_models[0]`）

### 4.3 提供商卡片

已保存的提供商以卡片列表展示：
- 卡片信息：名称、类型标签、API URL（截断显示）、Key 状态、API 格式
- 操作按钮：编辑、测试连接、删除（带确认）
- 类型标签用颜色区分：coding 类型（蓝色）/ 通用类型（灰色）

### 4.4 TypeScript 接口扩展

以下现有接口需扩展以匹配 Spec 01/02 的后端变更：

**`KnownProvider` 扩展（对应后端 `ProviderInfo`）：**
```pseudo
interface KnownProvider {
    id: string;
    name: string;
    default_api_url: string;
    region: string;
    api_format: string;          // 新增: "auto" | "openai" | "anthropic"
    default_models: string[];    // 新增: 预置模型列表
}
```

**`SavedProvider` 扩展（对应后端 `ModelProviderResponse`）：**
```pseudo
interface SavedProvider {
    ...existing fields...
    api_format: string;          // 新增: 从数据库读取
}
```

**`TestResult` 扩展（对应后端 `TestConnectionResponse`）：**
```pseudo
interface TestResult {
    success: boolean;
    message: string;
    latency_ms?: number;
    model_info?: {               // 新增: Spec 02 返回的模型信息
        model: string;
        format_used: string;
    };
}
```

### 4.5 ProviderFormState 扩展

```pseudo
interface ProviderFormState {
    id: string | null;
    name: string;
    provider_type: string;
    api_url: string;
    api_key: string;
    api_key_changed: boolean;
    api_format: string;            // 新增: "auto" | "openai" | "anthropic"
    urlManuallyEdited: boolean;    // 新增: 跟踪用户是否手动修改了 URL
    formatManuallyEdited: boolean; // 新增: 跟踪用户是否手动修改了格式
}
```

## 5. 数据获取

数据获取逻辑保持不变，在组件挂载时并行获取：
- `GET /api/model-settings/providers` → 已知提供商类型（静态）
- `GET /api/model-settings/providers/saved` → 已保存的提供商
- `GET /api/model-settings/assignments` → 已有的模型分配

三个 Tab 共享同一份数据状态，切换 Tab 不重新请求。

## 6. 接口契约

**依赖后端变更（Spec 01）：**
- `GET /api/model-settings/providers` 返回的 `ProviderInfo` 包含 `api_format` 和 `default_models`
- `POST/PUT /api/model-settings/providers` 接受 `api_format` 字段
- `GET /api/model-settings/providers/saved` 返回的 `SavedProvider` 包含 `api_format`

**依赖后端变更（Spec 02）：**
- `POST /api/model-settings/test-connection` 接受 `api_format` 字段
- 返回 `model_info` 字段

## 7. 测试要点

- Tab 切换正常，状态不丢失
- 选择 provider_type 时自动填充 URL 和格式
- 手动修改 URL 后，切换 provider_type 不覆盖已修改的 URL
- 提供商 CRUD 操作正常（创建、编辑、删除）
- `api_format` 字段正确保存和回显
- 连接测试传递正确的 `api_format` 参数
- coding 类提供商直接展示预置模型列表
- `KnownProvider` 接口正确接收 `api_format` 和 `default_models` 字段
- `SavedProvider` 接口正确接收 `api_format` 字段
- 连接测试结果正确显示 `model_info`（模型名和格式）

## 8. 依赖与前置条件

- **依赖 Spec 01：** 后端 `ProviderInfo` 返回 `api_format` 和 `default_models`；`ModelProviderResponse` 返回 `api_format`
- **依赖 Spec 02：** 后端 `TestConnectionRequest` 接受 `api_format`；`TestConnectionResponse` 返回 `model_info`
- **后续 Spec 04 依赖本 spec：** Tab 布局框架和共享数据状态
- **后续 Spec 05 依赖本 spec：** 本 spec 不删除 `CodingPlanPanel.tsx`，由 Spec 05 负责清理
