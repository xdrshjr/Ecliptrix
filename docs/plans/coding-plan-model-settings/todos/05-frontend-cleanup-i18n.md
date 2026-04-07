# TODO 05: 前端清理、菜单调整与 i18n

**对应 Spec:** `specs/05-frontend-cleanup-i18n.md`

## Dependencies

- **depends_on:** [03, 04] (Tab 布局和 coding 功能完成后才能安全删除旧组件)
- **blocks:** [] (最终任务，无下游依赖)
- **parallel_group:** C

必须在 Tab 布局重构完成后执行，避免删除正在使用的组件。

## Tasks

### 删除旧组件
- [ ] 删除 `src/components/AdminSettings/CodingPlanPanel.tsx`

### 侧边栏菜单调整
- [ ] 从 `SettingsSidebar.tsx` 的 `SettingsMenuItem` 类型中移除 `'codingPlan'`
- [ ] 从 `menuItems` 数组中移除 codingPlan 对象

### 管理页面调整
- [ ] 从 `AdminSettingsPage.tsx` 中移除 `import CodingPlanPanel`
- [ ] 从 `renderContent` 的 switch 中移除 `case 'codingPlan'`

### i18n 翻译新增
- [ ] 在 `src/lib/i18n.ts` 的 `adminSettings` 命名空间下新增中英文翻译 key：modelCoding, tabProviders, tabAssignments, tabAdvanced, apiFormat, apiFormatAuto, apiFormatOpenai, apiFormatAnthropic, defaultModels, effectiveConfig, configSource, configFromDb, configFromEnv, envFallbackDesc, testConnectionFormat, modelInfo, formatUsed, providerCard

### 清理验证
- [ ] 全项目搜索 `CodingPlanPanel` 确认无残留引用
- [ ] 全项目搜索 `'codingPlan'` 字符串确认无残留引用
- [ ] 运行 `npm run type-check` 确认无类型错误
- [ ] 运行 `npm run build` 确认构建通过
