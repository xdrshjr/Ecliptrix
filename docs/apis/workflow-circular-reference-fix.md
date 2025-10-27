# Workflow Circular Reference Error Fix

## 问题描述 (Problem Description)

### 错误信息 (Error Message)
```
Node failed: Chat LLM
{
  "error": "LLM request failed: Converting circular structure to JSON
    --> starting at object with constructor 'HTMLSpanElement'
    |     property '__reactFiber$mij4vn904' -> object with constructor 'FiberNode'
    --- property 'stateNode' closes the circle",
  "errorType": "Error",
  "stack": "Error: LLM request failed: Converting circular structure to JSON..."
}
```

### 根本原因 (Root Cause)
在 `WorkflowExecutor.ts` 中的 `executeChatLLMNode` 方法中，当尝试序列化输入数据时，输入对象包含了 React DOM 元素或 React Fiber 引用，这些对象具有循环引用结构。当使用 `JSON.stringify()` 尝试序列化这些对象时，会抛出 "Converting circular structure to JSON" 错误。

The root cause was in the `executeChatLLMNode` method in `WorkflowExecutor.ts`. When attempting to serialize input data, the input object contained React DOM elements or React Fiber references, which have circular reference structures. When trying to serialize these objects with `JSON.stringify()`, it throws a "Converting circular structure to JSON" error.

## 解决方案 (Solution)

### 实现的修复 (Implemented Fixes)

#### 1. 添加安全序列化函数 (Added Safe Serialization Functions)

**`createSafeLogObject(obj: any)`**
- 创建对象的安全版本用于日志记录
- 移除循环引用和 DOM 元素
- 过滤掉 React 内部属性（以 `_`, `__react`, `__fiber` 开头的属性）

Creates a safe version of objects for logging by removing circular references and DOM elements, and filtering out React internal properties.

**`safeSerialize(obj: any): string`**
- 将对象安全地序列化为字符串
- 处理各种数据类型（string, number, boolean, DOM elements, objects）
- 优先提取已知的文本字段（text, message, content）
- 使用自定义 JSON.stringify replacer 处理循环引用

Safely serializes objects to strings by handling various data types and using a custom JSON.stringify replacer to handle circular references.

#### 2. 更新 `executeChatLLMNode` 方法 (Updated executeChatLLMNode Method)

**改进点 (Improvements):**
- 使用 `safeSerialize()` 替代直接的 `JSON.stringify()`
- 添加更多的输入字段提取选项（text, message, content）
- 添加输入验证，确保消息不为空
- 改进日志记录，使用安全的输入预览

Replaced direct `JSON.stringify()` with `safeSerialize()`, added more input field extraction options, added input validation, and improved logging with safe input previews.

#### 3. 更新节点执行日志 (Updated Node Execution Logging)

**改进的位置 (Improved Locations):**
- `executeNode()` - 使用 `createSafeLogObject()` 处理输入和输出
- 节点状态存储 - 存储安全版本的输入/输出
- 完成日志 - 使用安全的输出预览

Updated `executeNode()` to use `createSafeLogObject()` for input/output handling, storing safe versions in node state, and using safe output previews in completion logs.

## 技术细节 (Technical Details)

### 循环引用检测 (Circular Reference Detection)
```typescript
const seen = new WeakSet();
JSON.stringify(obj, (key, value) => {
  if (typeof value === 'object' && value !== null) {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);
  }
  return value;
});
```

### DOM 元素检测 (DOM Element Detection)
```typescript
if (obj instanceof Element || obj instanceof Node) {
  return '[DOM Element]';
}
```

### React 内部属性过滤 (React Internals Filtering)
```typescript
if (key.startsWith('_') || key.startsWith('__react') || key.startsWith('__fiber')) {
  return undefined;
}
```

## 影响的文件 (Modified Files)

### 1. `src/components/workflow/WorkflowExecutor.ts`
**新增方法 (New Methods):**
- `createSafeLogObject(obj: any): any` - 创建安全的日志对象
- `safeSerialize(obj: any): string` - 安全序列化为字符串

**修改的方法 (Modified Methods):**
- `executeNode()` - 使用安全的输入/输出处理
- `executeChatLLMNode()` - 使用安全序列化和改进的错误处理
- `execute()` - 使用安全的日志对象

## 测试建议 (Testing Recommendations)

### 测试场景 (Test Scenarios)

1. **基本文本输入 (Basic Text Input)**
   - 测试使用简单字符串作为输入
   - 验证 LLM 节点正常执行

2. **对象输入 (Object Input)**
   - 测试使用包含 text/message/content 字段的对象
   - 验证正确提取消息内容

3. **复杂对象输入 (Complex Object Input)**
   - 测试包含嵌套对象的输入
   - 验证安全序列化功能

4. **边界情况 (Edge Cases)**
   - 空输入
   - null/undefined 输入
   - 包含循环引用的对象（不应再发生错误）

## 日志示例 (Logging Examples)

### 成功执行日志 (Successful Execution Log)
```
[WorkflowExecutor] ========== Executing Node ==========
{
  nodeId: "chat-llm-1",
  nodeType: "chat-llm",
  nodeLabel: "Chat LLM",
  hasInput: true,
  inputType: "object",
  inputPreview: {text: "Hello, world!"},
  timestamp: "2025-10-27T..."
}

[WorkflowExecutor] Extracted user message
{
  messageLength: 13,
  messagePreview: "Hello, world!"
}

[WorkflowExecutor] LLM response received
{
  nodeId: "chat-llm-1",
  responseLength: 245,
  contentPreview: "Hello! How can I help you today?...",
  timestamp: "2025-10-27T..."
}
```

### 错误处理日志 (Error Handling Log)
```
[WorkflowExecutor] Could not create safe log object: [error details]
[WorkflowExecutor] Detected DOM element in input, extracting text content
```

## 最佳实践 (Best Practices)

### 对于开发者 (For Developers)

1. **输入验证 (Input Validation)**
   - 始终验证输入数据的类型和内容
   - 提供清晰的错误消息

2. **安全序列化 (Safe Serialization)**
   - 在序列化用户输入或复杂对象时使用 `safeSerialize()`
   - 避免直接使用 `JSON.stringify()` 处理未知对象

3. **日志记录 (Logging)**
   - 使用 `createSafeLogObject()` 创建安全的日志对象
   - 限制日志中的数据大小（使用预览）

4. **错误处理 (Error Handling)**
   - 捕获序列化错误并提供回退
   - 记录警告但不中断执行流程

## 性能考虑 (Performance Considerations)

- `createSafeLogObject()` 和 `safeSerialize()` 涉及对象遍历和序列化，对大型对象可能有性能影响
- 建议在日志中使用数据预览（前 100-200 字符）
- WeakSet 用于循环检测，不会造成内存泄漏

## 向后兼容性 (Backward Compatibility)

此修复完全向后兼容：
- 不改变公共 API
- 现有的工作流继续正常工作
- 仅改进错误处理和日志记录

This fix is fully backward compatible - it doesn't change the public API, existing workflows continue to work, and only improves error handling and logging.

## 未来改进 (Future Improvements)

1. **类型安全 (Type Safety)**
   - 为输入/输出定义更严格的 TypeScript 类型
   - 使用泛型提高类型推断

2. **性能优化 (Performance Optimization)**
   - 实现对象缓存以避免重复序列化
   - 考虑使用流式处理大型数据

3. **测试覆盖 (Test Coverage)**
   - 添加单元测试覆盖安全序列化函数
   - 添加集成测试验证工作流执行

## 相关文档 (Related Documentation)

- [Workflow Node Testing](./workflow-node-testing.md)
- [Workflow Chat Interface](./workflow-chat-interface.md)
- [Workflow API](./workflow-api.md)

