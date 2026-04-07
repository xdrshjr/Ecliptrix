# Spec 05: 前端清理、菜单调整与 i18n

## 1. 概述

删除独立的 `CodingPlanPanel` 组件和侧边栏菜单项，清理已废弃的 i18n 翻译 key，以及新增模型设置相关的 i18n 翻译 key。

> **注意**：经确认，不存在专属的 Coding Plan Next.js API 代理路由（coding 功能复用 `/api/model-settings/*` 路由），无需清理 API 路由。

## 2. 变更范围

### 2.1 删除组件文件

- 删除 `src/components/AdminSettings/CodingPlanPanel.tsx`

### 2.2 侧边栏菜单调整 (`src/components/AdminSettings/SettingsSidebar.tsx`)

**移除 `codingPlan` 菜单项：**
```pseudo
// SettingsMenuItem 类型移除 'codingPlan'
type SettingsMenuItem =
  | 'userManagement'
  | 'modelSettings'
  // | 'codingPlan'          ← 删除
  | 'ttsSettings'
  | 'youtubeSettings'
  | 'uploadSettings'
  | 'watermarkSettings'
  | 'videoAnalysisSettings'
  | 'systemSettings';

// menuItems 数组中移除 codingPlan 对象
```

### 2.3 管理页面调整 (`src/components/AdminSettings/AdminSettingsPage.tsx`)

**移除 CodingPlanPanel 的 import 和 switch case：**
```pseudo
// 删除 import CodingPlanPanel
// 删除 case 'codingPlan': return <CodingPlanPanel />;
```

### 2.4 i18n 废弃 key 清理 (`src/lib/i18n.ts`)

以下 key 仅被 `CodingPlanPanel.tsx` 和 `SettingsSidebar.tsx` 的 `codingPlan` 菜单项使用，随组件删除后成为死代码，应从类型定义（`adminSettings` 接口）、英文翻译对象和中文翻译对象中移除：

| Key | 说明 |
|-----|------|
| `codingPlan` | 侧边栏菜单标签 |
| `codingPlanDesc` | 侧边栏菜单描述 |
| `codingPlanProviders` | CodingPlanPanel 内标题 |
| `codingPlanProvidersDesc` | CodingPlanPanel 内描述 |
| `codingPlanAssignment` | CodingPlanPanel 内标题 |
| `codingPlanAssignmentDesc` | CodingPlanPanel 内描述 |

### 2.5 i18n 翻译新增 (`src/lib/i18n.ts`)

在 `adminSettings` 命名空间下新增以下翻译 key（注意 `modelCoding` 已存在，无需新增）：

| Key | 中文 | 英文 | 备注 |
|-----|------|------|------|
| `tabProviders` | 提供商管理 | Provider Management | 新增 |
| `tabAssignments` | 模型分配 | Model Assignment | 新增 |
| `tabAdvanced` | 高级设置 | Advanced Settings | 新增 |
| `apiFormat` | API 格式 | API Format | 新增 |
| `apiFormatAuto` | 自动检测 | Auto Detect | 新增 |
| `apiFormatOpenai` | OpenAI 格式 | OpenAI Format | 新增 |
| `apiFormatAnthropic` | Anthropic 格式 | Anthropic Format | 新增 |
| `defaultModels` | 预置模型 | Default Models | 新增 |
| `effectiveConfig` | 当前生效配置 | Effective Configuration | 新增 |
| `configSource` | 配置来源 | Config Source | 新增 |
| `configFromDb` | 数据库 | Database | 新增 |
| `configFromEnv` | 环境变量 | Environment | 新增 |
| `envFallbackDesc` | 未配置数据库分配时，系统使用环境变量作为回退 | When no database assignment is configured, the system falls back to environment variables | 新增 |
| `testConnectionFormat` | 测试连接格式 | Test Connection Format | 新增 |
| `modelInfo` | 模型信息 | Model Info | 新增 |
| `formatUsed` | 使用的格式 | Format Used | 新增 |
| `providerCard` | 提供商卡片 | Provider Card | 新增 |

### 2.6 清理检查

确保以下引用不存在残留：
- 搜索 `CodingPlanPanel` 在全项目中的引用 → 全部移除（当前引用点：`AdminSettingsPage.tsx` import 和 switch case）
- 搜索 `codingPlan` 在 `SettingsMenuItem` 类型和相关逻辑中的引用 → 全部移除（当前引用点：`SettingsSidebar.tsx` 类型定义和 `menuItems` 数组）
- 搜索 `CODING_PROVIDER_TYPES` 常量 → 已在 CodingPlanPanel 中定义，随文件删除即可
- 搜索 `codingPlanDesc`、`codingPlanProviders`、`codingPlanProvidersDesc`、`codingPlanAssignment`、`codingPlanAssignmentDesc` → 从 `i18n.ts` 中移除（类型接口 + 英文 + 中文三处）
- 确认无其他文件直接 import CodingPlanPanel
- 确认 `.claude-index/index.md` 中的 CodingPlanPanel 引用在索引重建时自然消失（无需手动清理）

## 3. 接口契约与执行顺序

**依赖 Spec 03/04：** Tab 布局和 coding 功能类型已在 ModelSettingsPanel 中实现
**建议在 Spec 03/04 完成后执行本 Spec**，以避免合并冲突（master plan 第 6 节）
**无新增 API 端点**
**无新增后端变更**

## 4. 测试要点

- 侧边栏不再显示 CodingPlan 菜单项
- 点击"模型设置"后，coding 类型在模型分配 Tab 中可见
- 所有新增翻译 key 在中英文下正常显示
- 已废弃的 `codingPlan*` 翻译 key 在 `i18n.ts` 中不存在
- 全局搜索 `CodingPlanPanel` 和 `CODING_PROVIDER_TYPES` 无残留引用
- 无残留 import 或引用导致编译错误
- `npm run type-check` 和 `npm run build` 无报错
