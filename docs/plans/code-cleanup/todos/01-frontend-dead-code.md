# TODO 01: 前端废弃代码扫描与清理

**对应 Spec:** `specs/01-frontend-dead-code.md`

## Dependencies
- `depends_on: []` — 无前置依赖，可独立执行
- `blocks: [03]` — API 路由清理需要先完成前端死代码清理
- `parallel_group: A` — 可与 TODO 02 并行

## 任务清单

### 未使用导入
- [ ] 扫描 `src/` 下所有 `.ts`/`.tsx` 文件的未使用 import
- [ ] 删除所有确认未使用的 import 行
- [ ] 运行 `npm run type-check` 验证

### 未使用组件
- [ ] 列出 `src/components/` 下所有导出的组件名
- [ ] 对每个组件名 grep 全局引用次数
- [ ] 排除动态导入和 barrel export 场景
- [ ] 删除引用次数 = 0 的废弃组件文件
- [ ] 运行 `npm run type-check` 验证

### 未使用 Hooks
- [ ] 列出 `src/components/video/hooks/` 下所有 `use*` 导出
- [ ] 对每个 hook grep 全局调用次数
- [ ] 删除未被调用的 hooks
- [ ] 检查 hook 返回值中未被使用的字段

### 未使用服务函数
- [ ] 扫描 `src/components/video/services/` 导出函数引用
- [ ] 扫描 `src/lib/api/` 导出函数引用
- [ ] 删除未被引用的服务函数

### 未使用类型定义
- [ ] 扫描 `src/types/index.ts` 中每个导出类型的引用
- [ ] 扫描 `src/components/video/types/` 中每个导出类型的引用
- [ ] 扫描各文件内局部 type/interface 的引用
- [ ] 删除未被引用的类型定义

### 未使用变量/常量
- [ ] 扫描模块级 const/let 声明的引用
- [ ] 删除未被引用的变量

### 最终验证
- [ ] 运行 `npm run type-check`
- [ ] 运行 `npm run build`
