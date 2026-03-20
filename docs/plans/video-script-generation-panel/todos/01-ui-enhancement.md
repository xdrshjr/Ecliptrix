# TODO 01: UI 增强

**对应规格**: specs/01-ui-enhancement.md

## Dependencies

- `depends_on: []` — 无前置依赖，可首先开始
- `blocks: [03, 04]` — UI 组件完成后才能集成 Hook 和生成流程
- `parallel_group: A` — 可与 TODO 02 并行

## 任务清单

- [ ] 在 `src/lib/i18n.ts` 中添加所有新增的国际化文案 key
- [ ] 在 VideoUnderstandingScriptModal 顶部添加 Tab 标签切换组件（AI视频脚本 / 普通脚本）
- [ ] 新增对话内容区域：Toggle 开关 + 状态文字（消息数量 / 不可用提示）
- [ ] 新增自定义提示词区域：Textarea + 字数统计（500字限制）
- [ ] 在 Textarea 右侧/右上角添加 ✨ 优化按钮（含 loading 状态）
- [ ] 实现撤销按钮：优化后出现，手动编辑后消失
- [ ] 修改视频选择验证逻辑：不再强制要求至少选一个视频
- [ ] 更新生成按钮的 disabled 条件和文案（根据 Tab 切换）
- [ ] 更新 Modal 的 props 接口，新增 chatMessages 相关 props
- [ ] 验证现有功能不受影响：视频选择、分析模式选择、进度显示
