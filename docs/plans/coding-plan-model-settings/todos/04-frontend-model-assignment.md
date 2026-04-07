# TODO 04: 模型分配 Tab 与 Coding 类型集成

**对应 Spec:** `specs/04-frontend-model-assignment.md`

## Dependencies

- **depends_on:** [01, 03] (后端 CODING 类型已支持，Tab 框架已搭建)
- **blocks:** [05] (清理工作在功能完成后执行)
- **parallel_group:** B

Tab 2 内容实现依赖 Tab 框架（TODO 03）和后端分配 API（TODO 01）。

## Tasks

### FunctionType 扩展
- [ ] 将 `FunctionType` 类型扩展为 `'chat' | 'fast' | 'video_cut' | 'vision' | 'coding'`
- [ ] `FUNCTION_TYPES` 数组增加 `'coding'`
- [ ] `assignments` 初始状态增加 `coding: null`
- [ ] `assignmentForms` 初始状态增加 `coding: { provider_id: null, model_name: '', temperature: 1.0, modelInputMode: 'select' }`（注意 temperature 默认 1.0）

### Tab 标签与 i18n
- [ ] `tabLabels` 增加 `coding: t.adminSettings.modelCoding`

### 模型分配卡片
- [ ] 在模型分配 Tab 中渲染 5 个功能类型卡片（含 coding）
- [ ] 每个卡片：提供商下拉 → 模型选择（下拉/手动切换）→ 温度滑块 → 状态指示 → 保存/重置
- [ ] coding 卡片不做提供商筛选，显示所有已保存提供商

### 模型选择智能化
- [ ] 选择提供商后自动获取其模型列表（优先使用缓存/default_models）
- [ ] 支持 select 和 manual 两种输入模式切换
- [ ] coding 类型提供商使用 default_models 预填模型下拉

### 数据获取适配
- [ ] `fetchData` 中 assignments 解析逻辑覆盖 coding 类型
- [ ] 保存分配后刷新数据
- [ ] 重置分配（DELETE assignment）后 UI 正确恢复

### 高级设置 Tab（Tab 3）
- [ ] 实现环境变量回退说明表格（5 个功能类型的 env var 映射）
- [ ] 实现当前生效配置概览：调用 `/api/model-settings/resolve/{type}` 获取每个类型的实际配置
- [ ] 只读展示：提供商/URL、模型名、配置来源（数据库/环境变量）
