# Translate Search Query API

## 概述

翻译搜索查询API用于将非英语的视频搜索关键词翻译为英语，以提高视频搜索的准确性和覆盖范围。

## 接口信息

- **路径**: `/api/translate-search-query`
- **方法**: `POST`
- **内容类型**: `application/json`

## 功能特性

- 自动检测查询语言（英语/非英语）
- 智能翻译非英语查询为适合搜索的英语关键词
- 保持原始查询的核心含义和搜索意图
- 详细的日志记录和错误处理
- 如果查询已经是英语，直接返回原查询

## 请求参数

### 请求体 (JSON)

```json
{
  "query": "string",     // 必需，搜索查询字符串
  "taskId": "string"     // 必需，任务ID，用于日志追踪
}
```

### 参数说明

| 参数名 | 类型 | 必需 | 说明 |
|--------|------|------|------|
| query | string | 是 | 需要翻译的搜索查询，不能为空 |
| taskId | string | 是 | 任务标识符，用于日志记录和追踪 |

## 响应格式

### 成功响应

```json
{
  "success": true,
  "originalQuery": "string",      // 原始查询
  "translatedQuery": "string",    // 翻译后的查询
  "isEnglish": boolean,          // 原查询是否为英语
  "translationNeeded": boolean   // 是否需要翻译
}
```

### 错误响应

```json
{
  "error": "string"  // 错误描述
}
```

## 响应状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 请求成功 |
| 400 | 请求参数错误 |
| 500 | 服务器内部错误 |

## 使用示例

### 示例1：中文查询翻译

**请求**:
```bash
curl -X POST /api/translate-search-query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "可爱的小猫咪视频",
    "taskId": "task_123"
  }'
```

**响应**:
```json
{
  "success": true,
  "originalQuery": "可爱的小猫咪视频",
  "translatedQuery": "cute kitten videos",
  "isEnglish": false,
  "translationNeeded": true
}
```

### 示例2：英文查询（无需翻译）

**请求**:
```bash
curl -X POST /api/translate-search-query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "funny cat videos",
    "taskId": "task_124"
  }'
```

**响应**:
```json
{
  "success": true,
  "originalQuery": "funny cat videos",
  "translatedQuery": "funny cat videos",
  "isEnglish": true,
  "translationNeeded": false
}
```

## 语言检测逻辑

API使用以下规则检测查询语言：

1. **ASCII字符比例**: 检查ASCII字符占总字符的比例
2. **英语单词匹配**: 检测常见英语单词的存在
3. **综合判断**: 结合字符比例和单词匹配结果

### 检测规则
- ASCII比例 > 80% 且英语单词比例 > 30% → 判定为英语
- 查询长度 ≤ 2个单词且包含英语单词 → 判定为英语
- 其他情况 → 判定为非英语，需要翻译

## 翻译策略

对于非英语查询，API会：

1. 保持查询的核心含义和搜索意图
2. 转换为自然的、适合搜索的英语关键词
3. 优化关键词以提高视频搜索匹配度
4. 避免过度翻译或添加不必要的词汇

## 环境配置

API需要以下环境变量：

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| LLM_API_URL | LLM服务API地址 | https://api.openai.com/v1 |
| LLM_API_KEY | LLM服务API密钥 | 无 |
| LLM_MODEL | 使用的模型名称 | gpt-3.5-turbo |

## 日志记录

API提供详细的日志记录，包括：

- 请求接收和参数验证
- 语言检测结果
- 翻译过程和结果
- 错误信息和异常处理
- 响应时间和性能指标

## 错误处理

常见错误情况：

1. **缺少查询参数**: 返回400错误，提示需要提供查询字符串
2. **缺少任务ID**: 返回400错误，提示需要提供任务ID
3. **LLM服务错误**: 返回对应的HTTP状态码和错误信息
4. **内部服务错误**: 返回500错误，记录详细错误日志

## 性能考虑

- 英语查询直接返回，无需调用LLM服务
- 非英语查询使用较低的temperature(0.3)以确保翻译一致性
- 限制最大token数量(200)以控制响应时间
- 详细的性能日志记录用于监控和优化

## 集成说明

此API主要用于视频搜索功能，在执行实际搜索前自动处理查询翻译：

1. 视频搜索服务调用此API进行查询预处理
2. 使用翻译后的英语查询进行视频搜索
3. 保持搜索结果的国际化和准确性 