# 润色目标国际化适配

## 概述

本文档描述了智能润色功能中"Select Polish Goals"（选择润色目标）选项的国际化实现。通过此次更新，所有26个润色目标的名称和描述都支持中英文双语显示。

## 更新内容

### 1. 国际化翻译添加

在 `src/lib/i18n.ts` 中为 `contentPolishModal` 添加了 `polishGoals` 对象，包含所有26个润色目标的中英文翻译。

#### 数据结构

```typescript
polishGoals: {
  [goalId: string]: {
    name: string;        // 润色目标名称
    description: string; // 润色目标描述
  };
}
```

### 2. 支持的润色目标清单

以下是所有支持国际化的润色目标：

| ID | 中文名称 | English Name | 分类 |
|----|---------|--------------|------|
| `short_video` | 短视频文案 | Short Video Copy | platform |
| `three_second_hook` | 三秒钩子 | 3-Second Hook | platform |
| `engage_comments` | 激发用户评论 | Engage Comments | engagement |
| `reader_resonance` | 激发读者共鸣 | Reader Resonance | emotional |
| `empathy` | 激发共情 | Evoke Empathy | emotional |
| `call_to_action` | 行动号召 | Call to Action | conversion |
| `storytelling` | 故事化表达 | Storytelling | narrative |
| `pain_point` | 痛点切入 | Pain Point Entry | targeting |
| `viral_potential` | 传播性强 | Viral Potential | viral |
| `curiosity_gap` | 好奇心缺口 | Curiosity Gap | engagement |
| `fan_sb` | 犯SB | Deliberate Errors | engagement |
| `provoke_debate` | 故意引战 | Provoke Debate | controversial |
| `differentiation` | 差异化 | Differentiation | uniqueness |
| `echo_ending` | 收尾呼应 | Echo Ending | structure |
| `contrast_strong` | 强烈对比 | Strong Contrast | emphasis |
| `golden_sentence` | 金句输出 | Golden Sentences | memorable |
| `data_support` | 数据支撑 | Data Support | credibility |
| `authority_quote` | 权威引用 | Authority Quote | credibility |
| `scenario_immersion` | 场景代入 | Scenario Immersion | immersive |
| `reverse_thinking` | 反向思维 | Reverse Thinking | innovative |
| `anxiety_marketing` | 焦虑营销 | Anxiety Marketing | psychological |
| `benefit_driven` | 利益驱动 | Benefit Driven | motivation |
| `scarcity_urgency` | 稀缺紧迫 | Scarcity & Urgency | psychological |
| `social_proof` | 社会认同 | Social Proof | psychological |
| `emotional_trigger` | 情绪触发 | Emotional Trigger | emotional |
| `practical_tips` | 实用干货 | Practical Tips | practical |

### 3. 组件更新

在 `src/components/video/components/ContentPolishModal/ContentPolishModal.tsx` 中更新了以下部分：

#### 3.1 润色目标显示

```typescript
// 显示润色目标名称（支持i18n）
{t.contentPolishModal.polishGoals[goal.id as keyof typeof t.contentPolishModal.polishGoals]?.name || goal.name}

// 显示润色目标描述（支持i18n）
{t.contentPolishModal.polishGoals[goal.id as keyof typeof t.contentPolishModal.polishGoals]?.description || goal.description}
```

#### 3.2 多目标描述

在润色结果中显示同时满足的多个目标时，使用翻译后的名称：

```typescript
selectedGoals.map(g => 
  t.contentPolishModal.polishGoals[g.id as keyof typeof t.contentPolishModal.polishGoals]?.name || g.name
).join('、')
```

#### 3.3 日志记录

所有日志记录中的润色目标名称也使用了国际化翻译，方便追踪和调试。

## 实现细节

### 降级策略

采用了安全的降级策略，确保在翻译缺失时仍能正常显示：

```typescript
// 优先使用i18n翻译，如果不存在则使用YAML配置中的原始值
t.contentPolishModal.polishGoals[goal.id]?.name || goal.name
```

### 数据流

1. **配置加载**: 从 `config/polish-config/polish-goals.yaml` 加载润色目标配置
2. **API返回**: `/api/polish-config` 返回包含 `id`, `name`, `description` 等字段
3. **前端渲染**: 组件根据当前语言设置，从 `i18n.ts` 获取翻译，如无翻译则使用API返回的原始值

### 语言切换

用户切换语言后，润色目标的名称和描述会自动更新为对应语言：

- **中文 (zh-CN)**: 显示中文名称和描述
- **英文 (en)**: 显示英文名称和描述

## 技术架构

### 文件修改清单

1. **src/lib/i18n.ts**
   - 添加 `polishGoals` 类型定义
   - 添加英文翻译（en）
   - 添加中文翻译（zh-CN）

2. **src/components/video/components/ContentPolishModal/ContentPolishModal.tsx**
   - 更新润色目标名称显示逻辑
   - 更新润色目标描述显示逻辑
   - 更新多目标描述生成逻辑
   - 更新日志记录逻辑

### 类型安全

使用 TypeScript 的类型系统确保类型安全：

```typescript
// 使用 keyof typeof 确保只能访问存在的润色目标
t.contentPolishModal.polishGoals[goal.id as keyof typeof t.contentPolishModal.polishGoals]
```

## 测试验证

### 功能测试点

1. ✅ 中文界面下所有润色目标显示中文名称和描述
2. ✅ 英文界面下所有润色目标显示英文名称和描述
3. ✅ 语言切换后润色目标立即更新
4. ✅ 选中多个目标后描述正确显示翻译后的目标名称
5. ✅ 日志中记录的目标名称使用正确的语言
6. ✅ 翻译缺失时降级到YAML原始值

### 兼容性

- ✅ 与现有 `polish-goals.yaml` 配置完全兼容
- ✅ 与 `/api/polish-config` API 完全兼容
- ✅ 与 `/api/content-polish-multiple` API 完全兼容
- ✅ 不影响后端润色逻辑

## 未来扩展

如需添加新的润色目标，需要在以下位置同步更新：

1. `config/polish-config/polish-goals.yaml` - 添加目标配置
2. `src/lib/i18n.ts` - 添加中英文翻译
   - `Translations.contentPolishModal.polishGoals` 类型定义
   - `en.contentPolishModal.polishGoals` 英文翻译
   - `zh-CN.contentPolishModal.polishGoals` 中文翻译

## 总结

通过本次国际化适配，智能润色功能的用户体验得到了显著提升：

- **多语言支持**: 完整支持中英文双语显示
- **类型安全**: 使用 TypeScript 确保类型安全
- **降级策略**: 翻译缺失时自动降级，保证系统稳定性
- **可维护性**: 结构清晰，易于扩展新语言或新目标
- **用户体验**: 用户可以用母语理解每个润色目标的含义

## 更新历史

- **v1.1.0** (2024-11-03): 实现润色目标的国际化适配，支持中英文双语

