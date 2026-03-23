# Spec 01: 前端废弃代码扫描与清理

## 概述

扫描 `src/` 目录下的所有 TypeScript/React 代码，识别并删除未使用的导入、组件、函数、hooks、服务函数、类型定义和变量。

## 扫描目标

### 1. 未使用的导入（Unused Imports）

**检查方法：**
- 使用 TypeScript 编译器 + ESLint 的 `no-unused-vars` 规则
- grep 扫描所有 `import` 语句，交叉验证引用情况

**处理：** 直接删除未使用的 import 行

### 2. 未使用的组件（Unused Components）

**检查范围：**
- `src/components/` 下所有 `.tsx` 组件文件
- 特别关注 `src/components/video/components/` 下的 28+ 模态组件
- `src/components/ui/` 下的 shadcn 组件

**检查方法：**
- 对每个导出的组件名，全局 grep 查找引用次数
- 引用次数 = 0（仅定义处）→ 标记为废弃
- 注意排除：动态导入 (`dynamic()`)、条件渲染、`React.lazy()`

**特殊处理：**
- `src/components/ui/` 中的 shadcn 组件需要额外谨慎，可能通过 barrel exports 使用
- timeline 领域层组件需要检查 store/infrastructure 层的引用

### 3. 未使用的 Hooks（Unused Hooks）

**检查范围：**
- `src/components/video/hooks/` — 20+ 自定义 hooks
- 其他组件目录下的 hooks

**检查方法：**
- 对每个 `use*` 导出，全局 grep 查找调用
- 检查 hook 的返回值是否有未被使用的字段（解构后未引用的部分）

### 4. 未使用的服务函数（Unused Service Functions）

**检查范围：**
- `src/components/video/services/` — 工厂函数和服务方法
- `src/lib/api/` — API 客户端函数

**检查方法：**
- 对每个导出的函数名，全局 grep 查找调用次数
- 工厂函数返回的对象中，检查每个方法是否被使用

### 5. 未使用的类型定义（Unused Types）

**检查范围：**
- `src/types/index.ts` — 集中类型定义（~682 行）
- `src/components/video/types/videoEditingTypes.ts` — 视频编辑扩展类型
- 各组件文件内的局部类型定义

**检查方法：**
- 对每个 `export type/interface`，全局 grep 查找引用
- 对非导出的局部 type/interface，检查同文件内引用

### 6. 未使用的变量和常量

**检查方法：**
- `const`/`let`/`var` 声明后未在后续代码中引用
- 模块级常量未被导出且未在本文件使用

## 安全检查清单

扫描前需要考虑的边界情况：

- [ ] `dynamic()` 动态导入的组件不能误删
- [ ] `React.lazy()` 懒加载的组件不能误删
- [ ] 通过字符串名引用的组件（如 node type mapping）不能误删
- [ ] 作为 `children`/`render prop` 传递的组件不能误删
- [ ] Context Provider 组件虽然不被直接调用但通过 `useContext` 间接使用
- [ ] shadcn/ui 组件可能通过 re-export 使用

## 验证方式

每批清理后执行：
```
npm run type-check   # TypeScript 编译检查
npm run build        # 构建验证（ESLint 错误被忽略）
```

## 产出

- 删除所有确认废弃的代码
- 清理空文件或仅剩 import 的文件
