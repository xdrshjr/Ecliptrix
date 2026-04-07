# TODO 03: 前端 Tab 布局重构与提供商管理

**对应 Spec:** `specs/03-frontend-tab-layout.md`

## Dependencies

- **depends_on:** [01, 02] (后端 API 返回 api_format/default_models 字段，测试接口增强)
- **blocks:** [04] (模型分配 Tab 依赖 Tab 布局框架和提供商数据)
- **parallel_group:** B

需要后端 CRUD 接口已支持 api_format 字段。

## Tasks

### Tab 框架搭建
- [ ] 在 `ModelSettingsPanel.tsx` 顶部新增 Tab 切换状态 `activeTab: 'providers' | 'assignments' | 'advanced'`
- [ ] 实现 Tab 切换 UI（三个 Tab 按钮 + 内容区域切换）
- [ ] 将现有提供商管理部分的 JSX 移入 Tab 1 内容区域
- [ ] 将现有模型分配部分的 JSX 移入 Tab 2 内容区域（暂时保持原样）
- [ ] 新建 Tab 3 高级设置的占位区域

### 提供商表单增强
- [ ] 扩展 `ProviderFormState` 接口：新增 `api_format`、`urlManuallyEdited`、`formatManuallyEdited` 字段
- [ ] 扩展 `SavedProvider` 接口：新增 `api_format` 字段
- [ ] 扩展 `KnownProvider` 接口：新增 `api_format` 和 `default_models` 字段
- [ ] provider_type 选择时自动填充 `api_url` 和 `api_format`（仅当用户未手动修改时）
- [ ] 新增 API 格式下拉选择器（自动/OpenAI/Anthropic）

### 提供商卡片改造
- [ ] 已保存提供商以卡片样式展示（名称、类型、URL、Key 状态、API 格式）
- [ ] coding 类型提供商用蓝色标签区分
- [ ] 每个卡片包含：编辑、测试连接、删除按钮

### 连接测试 UI 增强
- [ ] 测试连接时传递 `api_format` 参数到后端
- [ ] 显示测试结果：成功（绿色 + 延迟 + model_info）/ 失败（红色 + 错误信息）
- [ ] 测试时使用 default_models[0] 或已获取的模型列表第一项

### 模型列表展示
- [ ] coding 类提供商直接显示 `default_models`（不调用 fetch API）
- [ ] 通用提供商点击"获取模型列表"调用 fetch API
- [ ] 模型以 tag/chip 样式展示

### 数据获取适配
- [ ] 确保 `fetchData` 函数正确解析后端返回的 `api_format` 字段
- [ ] 三个 Tab 共享同一份数据状态，Tab 切换不重新请求
