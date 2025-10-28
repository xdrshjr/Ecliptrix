# Pexels Video Search Node - Array Input Support

## 概述

本文档描述了 Pexels Video Search 节点的数组输入支持功能更新。该更新使节点能够接受字符串数组作为输入，并自动对每个关键词执行搜索，最后将所有结果合并输出。

## 更新日期

2025-10-28

## 功能描述

### 新增功能

1. **数组输入支持**
   - 节点现在可以接受单个字符串或字符串数组作为输入
   - 当输入为字符串数组时，节点会对数组中的每个关键词分别执行搜索
   - 所有搜索结果会自动合并为一个输出

2. **可配置的数据格式**
   - 新增 `inputFormat` 配置项：控制输入数据的解析方式
   - 新增 `outputFormat` 配置项：控制输出数据的格式
   - 支持三种格式：`text/plain`、`application/json`、`array`

3. **批量处理**
   - 对多个关键词自动执行顺序搜索
   - 每个关键词的搜索结果会被标记（添加 `keyword` 字段）
   - 提供详细的进度日志

4. **增强的错误处理**
   - 单个关键词搜索失败不会导致整体失败
   - 失败的搜索会记录警告日志，继续处理下一个关键词
   - 最终返回所有成功搜索的结果

## 使用场景

### 场景 1: 单字符串输入（向后兼容）

**输入**:
```json
"nature sunset"
```

**行为**: 
- 使用单个关键词 "nature sunset" 搜索视频
- 返回配置的视频数量（默认 5 个）

**输出** (outputFormat = 'application/json'):
```json
{
  "videos": [...],
  "videoUrls": ["url1", "url2", ...],
  "keywords": ["nature sunset"],
  "count": 5
}
```

### 场景 2: 字符串数组输入

**输入**:
```json
["beach", "sunset", "ocean waves"]
```

**行为**:
- 对 "beach" 搜索 5 个视频
- 对 "sunset" 搜索 5 个视频
- 对 "ocean waves" 搜索 5 个视频
- 合并所有结果（共 15 个视频）

**输出** (outputFormat = 'application/json'):
```json
{
  "videos": [
    {
      "id": 123,
      "videoUrl": "...",
      "keyword": "beach",
      ...
    },
    {
      "id": 456,
      "videoUrl": "...",
      "keyword": "sunset",
      ...
    },
    ...
  ],
  "videoUrls": ["url1", "url2", ..., "url15"],
  "keywords": ["beach", "sunset", "ocean waves"],
  "keywordCount": 3,
  "count": 15
}
```

### 场景 3: 配合 To Array 节点使用

**工作流**: `To Array` → `Pexels Video Search` → `End`

**To Array 节点配置**:
- Items: `coffee shop, barista, espresso machine`
- Output Format: `array`

**Pexels Video Search 节点配置**:
- Input Format: `array`
- Output Format: `array`
- Video Count: 3

**流程**:
1. To Array 输出: `["coffee shop", "barista", "espresso machine"]`
2. Pexels Video Search 批量搜索并合并结果
3. 输出: 9 个视频 URL 的数组

## 配置说明

### Input Format (输入格式)

控制节点如何解析输入数据：

- **`text/plain`**: 期望纯文本字符串输入
  - 任何输入都会被转换为字符串并作为单个关键词处理
  
- **`application/json`** (默认): 自动检测输入类型
  - 字符串 → 单个关键词
  - 数组 → 多个关键词
  - 对象 → 提取 `keywords`、`text` 或 `message` 字段
  
- **`array`**: 期望数组输入
  - 数组 → 直接使用
  - 非数组 → 转换为单元素数组

### Output Format (输出格式)

控制节点输出数据的格式：

- **`application/json`** (默认): 返回完整的结构化对象
  ```json
  {
    "videos": [...],
    "videoUrls": [...],
    "totalFound": 450,
    "keywords": ["keyword1", "keyword2"],
    "keywordCount": 2,
    "count": 10
  }
  ```

- **`array`**: 返回简单的 URL 数组
  ```json
  ["url1", "url2", "url3", ...]
  ```

- **`text/plain`**: 返回换行符分隔的 URL 字符串
  ```
  url1
  url2
  url3
  ```

### Video Count (视频数量)

- 每个关键词搜索的视频数量
- 范围：1-50
- 默认：5
- 注意：搜索多个关键词时，总视频数 = 关键词数 × 每个关键词的视频数

## 日志记录

### 单个关键词搜索

```
[INFO] Searching Pexels for videos: "nature sunset"
[SUCCESS] Found 5 videos from Pexels
```

### 多个关键词批量搜索

```
[INFO] Searching Pexels for videos with 3 queries
[INFO] Searching: "beach" (1/3)
[SUCCESS] Found 5 videos for "beach"
[INFO] Searching: "sunset" (2/3)
[SUCCESS] Found 5 videos for "sunset"
[INFO] Searching: "ocean" (3/3)
[SUCCESS] Found 5 videos for "ocean"
[SUCCESS] Completed: Found 15 total videos from 3 searches
```

### 错误处理示例

```
[INFO] Searching Pexels for videos with 3 queries
[INFO] Searching: "validkeyword" (1/3)
[SUCCESS] Found 5 videos for "validkeyword"
[INFO] Searching: "invalidkeyword123" (2/3)
[WARNING] No results for "invalidkeyword123": No videos found
[INFO] Searching: "anotherkeyword" (3/3)
[SUCCESS] Found 5 videos for "anotherkeyword"
[SUCCESS] Completed: Found 10 total videos from 3 searches
```

## 代码修改

### 修改的文件

1. **src/components/workflow/WorkflowExecutor.ts**
   - 更新 `executePexelsVideoSearchNode` 方法
   - 添加输入格式解析逻辑
   - 添加批量搜索循环
   - 添加输出格式化逻辑

2. **src/lib/workflow/ServerWorkflowExecutor.ts**
   - 与 WorkflowExecutor.ts 相同的更新
   - 用于服务端工作流执行

3. **src/app/api/workflow/test-node/route.ts**
   - 更新 `executePexelsVideoSearchNode` 函数
   - 支持节点测试时的数组输入

4. **backend-services/basic-service/docs/apis/pexels-video-search-node.md**
   - 更新文档以反映新功能
   - 添加数组输入示例
   - 添加配置说明

### 核心实现逻辑

```typescript
// 1. 解析输入获取关键词数组
let keywordsArray: string[] = [];

if (inputFormat === 'array') {
  keywordsArray = Array.isArray(input) ? input : [input];
} else if (inputFormat === 'text/plain') {
  keywordsArray = [String(input)];
} else {
  // application/json - 自动检测
  if (Array.isArray(input)) {
    keywordsArray = input;
  } else if (typeof input === 'string') {
    keywordsArray = [input];
  } else {
    keywordsArray = [input?.keywords || input?.text || input?.message];
  }
}

// 2. 批量搜索
const allVideoResults = [];
for (const keyword of keywordsArray) {
  const response = await fetch('/api/video-search', {
    body: JSON.stringify({ query: keyword, ... })
  });
  const data = await response.json();
  allVideoResults.push(...data.videos);
}

// 3. 格式化输出
if (outputFormat === 'array') {
  return allVideoResults.map(v => v.videoUrl);
} else if (outputFormat === 'text/plain') {
  return allVideoResults.map(v => v.videoUrl).join('\n');
} else {
  return { videos: allVideoResults, ... };
}
```

## 最佳实践

1. **选择合适的输入格式**
   - 从 "To Array" 节点接收数据时，使用 `array` 格式
   - 从 LLM 节点接收单个关键词时，使用 `application/json` 自动检测
   - 需要严格文本输入时，使用 `text/plain`

2. **选择合适的输出格式**
   - 传递给视频合成节点时，使用 `array` 格式（简单高效）
   - 需要调试或查看详细信息时，使用 `application/json` 格式
   - 传递给文本处理节点时，使用 `text/plain` 格式

3. **控制搜索规模**
   - 单个关键词：5-20 个视频
   - 多个关键词：每个关键词 3-10 个视频
   - 避免过大的批量搜索（如 10 个关键词 × 50 个视频 = 500 个视频）

4. **处理错误**
   - 检查日志面板中的警告信息
   - 单个关键词失败不会影响其他关键词
   - 确保至少有一些关键词能返回结果

5. **性能考虑**
   - 搜索是顺序执行的（一个接一个）
   - 更多关键词 = 更长的执行时间
   - 权衡搜索覆盖面和执行速度

## 向后兼容性

此更新完全向后兼容：

- 所有现有的单字符串输入仍然正常工作
- 默认配置保持不变（`application/json` 格式）
- 现有工作流无需修改即可继续使用

## 测试建议

### 测试用例 1: 单字符串输入
```json
{
  "input": "nature landscape",
  "config": {
    "count": 5,
    "inputFormat": "application/json",
    "outputFormat": "application/json"
  }
}
```

### 测试用例 2: 字符串数组输入
```json
{
  "input": ["beach", "sunset", "ocean"],
  "config": {
    "count": 3,
    "inputFormat": "array",
    "outputFormat": "array"
  }
}
```

### 测试用例 3: 对象输入与关键词数组
```json
{
  "input": {
    "keywords": ["coffee", "barista", "espresso"]
  },
  "config": {
    "count": 5,
    "inputFormat": "application/json",
    "outputFormat": "application/json"
  }
}
```

## 相关文档

- [Pexels Video Search Node API Documentation](../../backend-services/basic-service/docs/apis/pexels-video-search-node.md)
- [To Array Node](./to-array-node.md)
- [Workflow Node Format Support](./workflow-node-format-support.md)

## 技术支持

如有问题或建议，请：
1. 检查工作流日志面板获取详细错误信息
2. 验证输入/输出格式配置是否正确
3. 确认 Pexels API 密钥配置正常
4. 查看后端日志了解 API 级别的问题

