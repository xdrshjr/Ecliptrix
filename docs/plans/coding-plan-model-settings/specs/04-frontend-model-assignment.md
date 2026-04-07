# Spec 04: 模型分配 Tab 与 Coding 类型集成

## 1. 概述

重构模型分配区域为独立 Tab 页，将 `coding` 功能类型加入统一的 5 个功能类型卡片（chat / fast / video_cut / vision / coding），并实现智能表单默认值填充。同时实现高级设置 Tab（Tab 3），展示环境变量回退说明和当前生效配置概览。

## 2. 变更范围

### 2.1 FunctionType 扩展

```pseudo
// 当前
type FunctionType = 'chat' | 'fast' | 'video_cut' | 'vision';
const FUNCTION_TYPES = ['chat', 'fast', 'video_cut', 'vision'];

// 变更后
type FunctionType = 'chat' | 'fast' | 'video_cut' | 'vision' | 'coding';
const FUNCTION_TYPES = ['chat', 'fast', 'video_cut', 'vision', 'coding'];
```

### 2.2 状态初始化扩展

```pseudo
// assignments 初始状态
const [assignments] = useState({
    chat: null, fast: null, video_cut: null, vision: null, coding: null
});

// assignmentForms 初始状态
const [assignmentForms] = useState({
    chat:      { provider_id: null, model_name: '', temperature: 0.7, modelInputMode: 'select' },
    fast:      { provider_id: null, model_name: '', temperature: 0.7, modelInputMode: 'select' },
    video_cut: { provider_id: null, model_name: '', temperature: 0.7, modelInputMode: 'select' },
    vision:    { provider_id: null, model_name: '', temperature: 0.7, modelInputMode: 'select' },
    coding:    { provider_id: null, model_name: '', temperature: 1.0, modelInputMode: 'select' },
});
```

注意：`coding` 的默认 temperature 为 `1.0`（与 Kimi/GLM 推荐参数一致，不同于其他类型的 `0.7`）。

### 2.3 模型分配 Tab 布局

```
┌──────────────────────────────────────────────────────────┐
│  模型分配                                                 │
│  为每个功能类型选择对应的模型提供商和模型                       │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────────────────────────────────────────────┐│
│  │  💬 聊天模型 (chat)                      ● 使用数据库  ││
│  │  提供商: [DeepSeek ▼]  模型: [deepseek-chat ▼] [手动]  ││
│  │  温度: [====●======] 0.7                              ││
│  │                               [保存] [重置为环境变量]    ││
│  └──────────────────────────────────────────────────────┘│
│                                                          │
│  ┌──────────────────────────────────────────────────────┐│
│  │  ⚡ 快速模型 (fast)                     ○ 使用环境变量  ││
│  │  提供商: [选择提供商 ▼]  模型: [________]              ││
│  │  温度: [====●======] 0.7                              ││
│  │                               [保存] [重置为环境变量]    ││
│  └──────────────────────────────────────────────────────┘│
│                                                          │
│  ... (video_cut, vision 同上)                             │
│                                                          │
│  ┌──────────────────────────────────────────────────────┐│
│  │  🔧 代码模型 (coding)                   ○ 使用环境变量  ││
│  │  提供商: [Kimi Coding Plan ▼]  模型: [kimi-k2.5 ▼]    ││
│  │  温度: [==========●] 1.0                              ││
│  │                               [保存] [重置为环境变量]    ││
│  └──────────────────────────────────────────────────────┘│
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 2.4 提供商筛选逻辑

在模型分配 Tab 中，`coding` 功能类型的提供商下拉列表应包含**所有已保存的提供商**（不做筛选）。用户理论上可以将任意提供商分配给 coding 功能，就像 chat 可以使用任意提供商一样。

注意：这与当前 `CodingPlanPanel` 的行为不同（当前面板只筛选 coding 类型的提供商），统一面板后不再区分。

### 2.5 模型选择交互

选择提供商后，获取该提供商的模型列表（按优先级）：
1. 如果提供商对应的 `ProviderInfo` 有非空 `default_models`（coding 类型提供商）→ 使用预置列表
2. 如果提供商有已缓存的模型列表（之前在提供商 Tab 获取过）→ 直接使用
3. 否则 → 调用 `fetch-models` API 获取

模型选择支持两种输入模式：
- `select`：下拉选择已获取的模型
- `manual`：手动输入模型名（点击切换按钮）

### 2.6 分配保存

保存分配调用 `PUT /api/model-settings/assignments`，请求体不变：
```pseudo
{
    "function_type": "coding",
    "provider_id": "uuid-xxx",
    "model_name": "kimi-k2.5",
    "temperature": 1.0,
    "max_tokens": 128000
}
```

注意：`max_tokens` 不在 `assignmentForms` 状态中跟踪，保存时使用后端 `ModelAssignmentRequest` 的默认值 `128000`。如果后续需要前端可配置 `max_tokens`，需扩展 `AssignmentFormState`。

### 2.7 Tab 标签与 i18n

```pseudo
const tabLabels = {
    chat: t.adminSettings.modelChat,
    fast: t.adminSettings.modelFast,
    video_cut: t.adminSettings.modelVideoCut,
    vision: t.adminSettings.modelVision,
    coding: t.adminSettings.modelCoding,    // 新增
};
```

## 3. 接口契约

**依赖 Spec 01：** 后端 `ModelFunctionType.CODING` 已存在，分配 API 已支持
**依赖 Spec 03：** Tab 布局框架和提供商数据状态共享
**对外提供：** `coding` 分配通过 `GET /api/model-settings/resolve/coding` 被其他服务消费

## 4. 高级设置 Tab（Tab 3）

### 4.1 环境变量回退说明

展示一个静态的环境变量映射表，帮助用户理解：当未配置数据库分配时，系统会使用哪些环境变量作为回退。

```pseudo
功能类型    环境变量前缀           说明
chat       LLM_*                主聊天模型
fast       FAST_LLM_*           快速操作模型
video_cut  VIDEO_CUT_LLM_*      视频剪辑模型
vision     VL_LLM_*             视觉语言模型
coding     CODING_LLM_*         代码模型
```

### 4.2 当前生效配置概览

调用 `/api/model-settings/resolve/{function_type}` 获取每个功能类型的实际生效配置，以只读方式展示：

```pseudo
┌─────────────────────────────────────────────────────┐
│  当前生效配置                                         │
├─────────────────────────────────────────────────────┤
│  chat:      DeepSeek / deepseek-chat      [数据库]   │
│  fast:      (环境变量) / gpt-4o-mini       [环境变量] │
│  video_cut: (环境变量) / deepseek-chat     [环境变量] │
│  vision:    (环境变量) / glm-4v-plus       [环境变量] │
│  coding:    Kimi Coding / kimi-k2.5       [数据库]   │
└─────────────────────────────────────────────────────┘
```

每行显示：提供商名/API URL、模型名、配置来源（数据库/环境变量）。

## 5. 测试要点

- `coding` 功能类型在分配 Tab 中正常展示
- coding 默认 temperature 为 1.0
- 提供商下拉列表显示所有已保存的提供商（不做 coding 筛选）
- 保存 coding 分配后，`resolve/coding` 返回正确配置
- 重置分配后回退到环境变量
- 高级设置 Tab 正确展示生效配置
- 模型选择的 select/manual 模式切换正常
