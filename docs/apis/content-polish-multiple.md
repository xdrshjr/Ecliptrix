# 多目标内容润色API

## 概述

多目标内容润色API(`/api/content-polish-multiple`)用于同时应用多个润色目标对原始内容进行润色优化，生成5种不同强度的候选答案。与单目标润色API不同，此API确保每个生成的结果都同时满足用户选择的所有润色目标。

## 接口信息

- **路径**: `/api/content-polish-multiple`
- **方法**: `POST`
- **内容类型**: `application/json`
- **响应类型**: `text/event-stream` (SSE流式响应)

## 功能特点

1. **多目标协同**: 同时满足多个润色目标的要求
2. **强度分级**: 生成5种不同强度的润色版本（轻度、中度、强度、深度、极度）
3. **流式响应**: 使用SSE技术实时返回生成内容
4. **详细日志**: 完整的请求和响应日志记录
5. **错误处理**: 完善的参数验证和错误处理机制

## 请求参数

### 请求体 (JSON)

```json
{
  "originalContent": "string",     // 必需，原始内容
  "polishStyles": ["string"],      // 必需，润色目标ID数组
  "taskId": "string",             // 必需，任务ID
  "intensity": number             // 可选，强度级别(1-5)，默认为2
}
```

### 参数详细说明

| 参数名 | 类型 | 必需 | 默认值 | 说明 |
|--------|------|------|--------|------|
| `originalContent` | string | 是 | - | 需要润色的原始内容，不能为空 |
| `polishStyles` | string[] | 是 | - | 润色目标ID数组，至少包含一个有效的目标ID |
| `taskId` | string | 是 | - | 任务唯一标识符，用于日志跟踪 |
| `intensity` | number | 否 | 2 | 润色强度级别，范围1-5 |

### 润色强度说明

| 强度 | 标签 | 描述 |
|------|------|------|
| 1 | 轻度润色 | 保持原文的基本结构和表达方式，仅做必要的优化和调整 |
| 2 | 中度润色 | 在保持原意的基础上，适度改进表达方式和语言风格 |
| 3 | 强度润色 | 在保持核心观点的前提下，大幅优化表达方式，让内容更加出色 |
| 4 | 深度润色 | 深度重构内容结构和表达方式，同时保持核心思想不变 |
| 5 | 极度润色 | 全面升级内容的表达方式、结构布局和感染力，实现质的飞跃 |

## 可用的润色目标

### 平台类别 (platform)
- `short_video`: 短视频文案
- `three_second_hook`: 三秒钩子

### 互动类别 (engagement)
- `engage_comments`: 激发用户评论
- `curiosity_gap`: 好奇心缺口
- `fan_sb`: 犯SB策略

### 情感类别 (emotional)
- `reader_resonance`: 激发读者共鸣
- `empathy`: 激发共情
- `emotional_trigger`: 情绪触发

### 转化类别 (conversion)
- `call_to_action`: 行动号召

### 叙述类别 (narrative)
- `storytelling`: 故事化表达

### 定位类别 (targeting)
- `pain_point`: 痛点切入

### 传播类别 (viral)
- `viral_potential`: 传播性强

### 争议类别 (controversial)
- `provoke_debate`: 故意引战

### 独特性类别 (uniqueness)
- `differentiation`: 差异化

### 结构类别 (structure)
- `echo_ending`: 收尾呼应

### 强调类别 (emphasis)
- `contrast_strong`: 强烈对比

### 记忆类别 (memorable)
- `golden_sentence`: 金句输出

### 可信度类别 (credibility)
- `data_support`: 数据支撑
- `authority_quote`: 权威引用

### 沉浸式类别 (immersive)
- `scenario_immersion`: 场景代入

### 创新类别 (innovative)
- `reverse_thinking`: 反向思维

### 心理类别 (psychological)
- `anxiety_marketing`: 焦虑营销
- `scarcity_urgency`: 稀缺紧迫
- `social_proof`: 社会认同

### 动机类别 (motivation)
- `benefit_driven`: 利益驱动

### 实用类别 (practical)
- `practical_tips`: 实用干货

## 响应格式

### 成功响应 (SSE流)

响应采用Server-Sent Events格式，每个数据包结构如下：

```
data: {"content": "内容片段"}

data: [DONE]
```

### 错误响应 (JSON)

```json
{
  "error": "错误类型",
  "message": "详细错误信息"
}
```

### HTTP状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 成功，返回SSE流 |
| 400 | 请求参数错误 |
| 500 | 服务器内部错误 |

## 使用示例

### 请求示例

```javascript
const response = await fetch('/api/content-polish-multiple', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    originalContent: "这是一段需要润色的原始内容...",
    polishStyles: ["short_video", "engage_comments", "storytelling"],
    taskId: "task_123456",
    intensity: 3
  }),
});

// 处理SSE流
const reader = response.body?.getReader();
let accumulatedContent = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const chunk = new TextDecoder().decode(value);
  const lines = chunk.split('\n').filter(line => line.trim());
  
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6);
      if (data === '[DONE]') {
        console.log('生成完成:', accumulatedContent);
        break;
      }
      
      try {
        const parsed = JSON.parse(data);
        if (parsed.content) {
          accumulatedContent += parsed.content;
          console.log('接收到内容:', parsed.content);
        }
      } catch (e) {
        console.warn('解析数据失败:', e);
      }
    }
  }
}
```

### 完整的多强度润色示例

```javascript
// 生成5种不同强度的润色版本
const generateMultipleVersions = async () => {
  const intensityLabels = ['轻度润色', '中度润色', '强度润色', '深度润色', '极度润色'];
  const results = [];

  for (let intensity = 1; intensity <= 5; intensity++) {
    try {
      const response = await fetch('/api/content-polish-multiple', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          originalContent: "原始内容...",
          polishStyles: ["short_video", "engage_comments"],
          taskId: "task_123456",
          intensity: intensity
        }),
      });

      const reader = response.body?.getReader();
      let content = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = new TextDecoder().decode(value);
        const lines = chunk.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') break;
            
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                content += parsed.content;
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      }

      results.push({
        intensity: intensity,
        label: intensityLabels[intensity - 1],
        content: content
      });

    } catch (error) {
      console.error(`强度${intensity}润色失败:`, error);
    }
  }

  return results;
};
```

## 错误处理

### 常见错误

1. **内容为空**
   ```json
   {
     "error": "Original content string is required",
     "message": "请提供有效的原始内容"
   }
   ```

2. **润色目标为空**
   ```json
   {
     "error": "Polish styles array is required and cannot be empty",
     "message": "请至少选择一个润色目标"
   }
   ```

3. **无效的润色目标**
   ```json
   {
     "error": "Unsupported polish styles: invalid_style",
     "message": "包含不支持的润色目标"
   }
   ```

4. **强度参数错误**
   ```json
   {
     "error": "Intensity must be between 1 and 5",
     "message": "强度参数必须在1-5之间"
   }
   ```

5. **LLM服务错误**
   ```json
   {
     "error": "LLM service error: 500 Internal Server Error",
     "message": "LLM服务暂时不可用"
   }
   ```

## 最佳实践

1. **目标选择**: 建议选择2-4个相关性强的润色目标，避免选择过多冲突的目标
2. **强度选择**: 根据内容类型选择合适的强度，重要文档建议使用2-3级强度
3. **错误处理**: 实现完善的错误处理和重试机制
4. **性能优化**: 可以并行调用多个强度级别的润色请求
5. **日志记录**: 使用taskId进行请求跟踪，便于问题排查

## 与单目标API的区别

| 特性 | 单目标API | 多目标API |
|------|-----------|-----------|
| 润色目标 | 单个目标 | 多个目标同时满足 |
| 生成结果 | 一个目标一个结果 | 5种强度的综合结果 |
| 提示词构建 | 单一目标提示词 | 多目标融合提示词 |
| 适用场景 | 特定目标优化 | 综合性内容优化 |
| 结果一致性 | 目标间可能冲突 | 目标间协调统一 |

## 更新历史

- **v1.0.0** (2024-01-01): 初始版本，支持多目标润色和5级强度控制 