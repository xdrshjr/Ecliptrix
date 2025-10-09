# Provider 顺序修复文档

## 问题描述

在实现 Toast 通知功能后，应用启动时出现以下错误：

```
Error: useNotification must be used within a NotificationProvider
    at useNotification (src\contexts\NotificationContext.tsx:105:10)
    at AuthProvider (src\contexts\AuthContext.tsx:14:38)
```

## 根本原因

**Provider 嵌套顺序错误**

原来的 Provider 嵌套结构：

```tsx
<LocaleProvider>
  <AuthProvider>              ← AuthProvider 在外层
    <NotificationProvider>    ← NotificationProvider 在内层
      {children}
    </NotificationProvider>
  </AuthProvider>
</LocaleProvider>
```

问题：
- `AuthProvider` 内部调用了 `useNotification()`
- 但 `NotificationProvider` 在 `AuthProvider` 的内部
- 这违反了 React Context 的使用规则：**子组件只能访问父组件提供的 Context**

## 解决方案

调整 Provider 嵌套顺序，将 `NotificationProvider` 移到 `AuthProvider` 外层：

```tsx
<LocaleProvider>
  <NotificationProvider>      ← NotificationProvider 移到外层
    <AuthProvider>            ← AuthProvider 在内层
      {children}
    </AuthProvider>
  </NotificationProvider>
</LocaleProvider>
```

## 修复的文件

**src/app/layout.tsx**

```diff
  <body>
    <LocaleProvider>
-     <AuthProvider>
-       <NotificationProvider>
+     <NotificationProvider>
+       <AuthProvider>
          {children}
          <GlobalMobileDetection />
-       </NotificationProvider>
-     </AuthProvider>
+     </AuthProvider>
+   </NotificationProvider>
    </LocaleProvider>
  </body>
```

## Provider 依赖关系

正确的嵌套顺序应该遵循依赖关系：

```
LocaleProvider (最外层 - 无依赖)
  └─ NotificationProvider (依赖: 无)
      └─ AuthProvider (依赖: NotificationProvider, LocaleProvider)
          └─ 应用内容
```

### 依赖说明

1. **LocaleProvider**
   - 无依赖
   - 提供国际化功能
   - 在最外层

2. **NotificationProvider**
   - 无依赖
   - 提供 Toast 通知功能
   - 需要在 AuthProvider 外层

3. **AuthProvider**
   - 依赖 `NotificationProvider`（用于显示登录成功/失败通知）
   - 依赖 `LocaleProvider`（用于国际化文本）
   - 在最内层

## React Context 规则

### ✅ 正确的用法

子组件可以访问父组件提供的 Context：

```tsx
<ProviderA>        ← 提供 ContextA
  <ProviderB>      ← 提供 ContextB，可以使用 ContextA
    <Component>    ← 可以使用 ContextA 和 ContextB
  </ProviderB>
</ProviderA>
```

### ❌ 错误的用法

父组件无法访问子组件提供的 Context：

```tsx
<ProviderA>        ← 无法使用 ContextB（还未提供）
  <ProviderB>      ← 提供 ContextB
    <Component>    ← 可以使用 ContextA 和 ContextB
  </ProviderB>
</ProviderA>
```

## 验证修复

### 1. 检查应用是否正常启动

```bash
npm run dev
```

应该不再出现 `useNotification must be used within a NotificationProvider` 错误。

### 2. 测试功能

- ✅ 登录成功显示绿色 Toast
- ✅ 登录失败显示红色 Toast
- ✅ 会话失效显示黄色 Toast
- ✅ 所有功能正常工作

## 最佳实践

### Provider 排序原则

1. **按依赖关系排序**
   - 无依赖的在最外层
   - 有依赖的在内层

2. **按功能层级排序**
   - 基础功能（国际化、主题）在外层
   - 业务功能（认证、通知）在中间层
   - 页面特定功能在内层

3. **示例排序**

```tsx
<ThemeProvider>           // 1. 主题 - 无依赖
  <LocaleProvider>        // 2. 国际化 - 无依赖
    <NotificationProvider> // 3. 通知 - 无依赖
      <AuthProvider>       // 4. 认证 - 依赖通知
        <RouterProvider>   // 5. 路由 - 依赖认证
          <App />
        </RouterProvider>
      </AuthProvider>
    </NotificationProvider>
  </LocaleProvider>
</ThemeProvider>
```

## 常见错误模式

### 错误1：循环依赖

```tsx
// ❌ 错误
<ProviderA>  // 依赖 ProviderB
  <ProviderB>  // 依赖 ProviderA
    <App />
  </ProviderB>
</ProviderA>
```

**解决方案：** 重构代码，消除循环依赖

### 错误2：顺序错误

```tsx
// ❌ 错误
<AuthProvider>  // 需要使用 NotificationContext
  <NotificationProvider>
    <App />
  </NotificationProvider>
</AuthProvider>
```

**解决方案：** 调整顺序（如本次修复）

### 错误3：缺少 Provider

```tsx
// ❌ 错误
<AuthProvider>  // 使用 useNotification
  <App />
  // 缺少 NotificationProvider
</AuthProvider>
```

**解决方案：** 添加缺失的 Provider

## 调试技巧

### 1. 识别依赖关系

在每个 Provider 组件中查找 `useContext` 调用：

```typescript
// AuthProvider.tsx
const notification = useNotification();  // ← 依赖 NotificationContext
const locale = useLocale();              // ← 依赖 LocaleContext
```

### 2. 画出依赖图

```
AuthProvider
  ↓ 依赖
NotificationProvider
  ↓ 依赖
LocaleProvider
```

### 3. 自底向上嵌套

从无依赖的开始，向上嵌套：

```tsx
<LocaleProvider>        // 最底层（无依赖）
  <NotificationProvider>  // 中间层
    <AuthProvider>        // 最上层（依赖最多）
      <App />
    </AuthProvider>
  </NotificationProvider>
</LocaleProvider>
```

## 总结

这次修复解决了 Provider 嵌套顺序错误的问题：

- ✅ 修复了 `useNotification must be used within a NotificationProvider` 错误
- ✅ 确保了正确的依赖关系
- ✅ 遵循了 React Context 的使用规则
- ✅ 应用可以正常启动和运行

**核心原则：** 被依赖的 Provider 必须在外层，依赖它的 Provider 必须在内层。

