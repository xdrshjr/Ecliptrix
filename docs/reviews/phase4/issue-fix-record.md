# Phase 4 问题修复记录 — AI 图像生成面板布局修复

---

## Fix #1：StoryboardTab 移动端子列高度回归

### 问题定位
- **文件**：`src/components/video/components/AiImageModal/StoryboardTab.tsx`
- **行号**：第 274 行、第 285 行
- **问题类别**：正确性 / 响应式回归（Critical）

### 原因分析
Phase 3 为清理 "flex/grid 混用"，将左、右列容器从：
```
flex flex-col min-h-0 flex-1 md:flex-none md:h-full
```
改为：
```
flex flex-col min-h-0 h-full overflow-hidden
```
在桌面端（`md:grid` 父容器）`h-full` 配合 `overflow-hidden` 表现正常；但在移动端（`flex flex-col` 父容器）下，两个子元素均声明 `height: 100%`，导致总需求高度约 200% + gap，第二列被祖父容器的 `overflow-hidden` 完全裁剪。

### 修复内容
恢复原有的响应式断点结构，并追加 `overflow-hidden` 作为安全兜底：
```diff
- <div className="flex flex-col min-h-0 h-full overflow-hidden">
+ <div className="flex flex-col min-h-0 flex-1 md:flex-none md:h-full overflow-hidden">
```
（左右两列均作相同修改）

### 验证
- `npx vitest run src/.../layoutFixes.test.tsx`：通过
- `npx vitest run`（全量 197 项）：全部通过
- `npx next build`：编译通过

---

## Fix #2：StoryboardScriptReview 聊天面板输入框裁剪

### 问题定位
- **文件**：`src/components/video/components/AiImageModal/StoryboardScriptReview.tsx`
- **行号**：第 86 ~ 129 行
- **问题类别**：可用性 / 布局健壮性（Major）

### 原因分析
聊天面板被限制为 `max-h-[28%] overflow-hidden`，消息区内部使用固定的 `max-h-32 overflow-y-auto`。当消息较多且视口高度较小时，消息区占满 128px，加上标题、输入框、padding、gap 的固定高度后可能超过 28% 上限，导致底部的输入框被 `overflow-hidden` 裁剪。

### 修复内容
将聊天面板改为内部 Flex 布局，让消息区动态吸收可用空间，并移除固定 `max-h-32`：
```diff
- <div className="shrink-0 max-h-[28%] overflow-hidden border border-border rounded-md p-3 space-y-2 bg-card/60">
-   <div className="text-xs font-medium text-foreground">与 AI 对话修改剧本</div>
+ <div className="shrink-0 max-h-[28%] overflow-hidden border border-border rounded-md p-3 bg-card/60 flex flex-col gap-2">
+   <div className="text-xs font-medium text-foreground shrink-0">与 AI 对话修改剧本</div>
    {messages.length > 0 && (
-     <div className="space-y-1 max-h-32 overflow-y-auto text-xs">
+     <div className="space-y-1 overflow-y-auto text-xs min-h-0 flex-1">
        ...
      </div>
    )}
-   <div className="flex gap-2">
+   <div className="flex gap-2 shrink-0">
```

### 验证
- 全量测试 197/197 通过
- 构建通过
- 逻辑验证：
  - `shrink-0` 保证面板不会弹性撑大挤压确认按钮
  - `max-h-[28%]` 仍限制面板最大高度
  - `flex-1 min-h-0` 使消息区在 28% 内动态分配剩余空间
  - 输入框始终 `shrink-0` 保持在底部可见

---

## Fix #3：layoutFixes.test.tsx 断言与错误实现耦合

### 问题定位
- **文件**：`src/components/video/components/AiImageModal/__tests__/layoutFixes.test.tsx`
- **问题类别**：测试质量（Medium）

### 修复内容
将原本断言 "不含 `flex-1 md:flex-none md:h-full`" 的测试，改为断言正确的响应式类名存在：
```diff
- it('left and right columns use h-full overflow-hidden without flex-1 md:flex-none', () => {
-   expect(src).toContain('flex flex-col min-h-0 h-full overflow-hidden');
-   expect(src).not.toContain('flex-1 md:flex-none md:h-full');
+ it('left and right columns use responsive flex/grid classes with overflow-hidden', () => {
+   expect(src).toContain('flex flex-col min-h-0 flex-1 md:flex-none md:h-full overflow-hidden');
  });
```

同步更新 StoryboardScriptReview 的类名断言：
```diff
- expect(src).toContain('shrink-0 max-h-[28%] overflow-hidden border border-border rounded-md p-3 space-y-2 bg-card/60');
+ expect(src).toContain('shrink-0 max-h-[28%] overflow-hidden border border-border rounded-md p-3 bg-card/60 flex flex-col gap-2');
```

### 验证
- `npx vitest run src/.../layoutFixes.test.tsx`：8/8 通过

---

## Fix #4：arkImage.test.ts 陈旧超时断言

### 问题定位
- **文件**：`src/lib/api/__tests__/arkImage.test.ts`
- **问题类别**：测试维护（Minor / 前置债务）

### 修复内容
将期望值从 120_000 修正为与源码一致的 300_000：
```diff
- expect(spy.mock.calls[0][2]).toEqual({ timeoutMs: 120_000 });
+ expect(spy.mock.calls[0][2]).toEqual({ timeoutMs: 300_000 });
```

### 验证
- `npx vitest run src/lib/api/__tests__/arkImage.test.ts`：3/3 通过
- 全量测试套件 197/197 全部通过
