# TODO 04: Hook 重构 — 统一生成逻辑

**对应规格**: specs/04-hook-refactoring.md

## Dependencies

- `depends_on: [01, 02, 03]` — 需要 UI 组件、润色 API、生成 API 全部就绪
- `blocks: []` — 最终集成，无后续依赖
- `parallel_group: C`

## 任务清单

- [ ] 创建 `src/components/video/hooks/useEnhancedScriptGeneration.ts`
- [ ] 实现 Tab 状态管理（activeTab: 'ai-video' | 'normal'）
- [ ] 实现对话开关状态管理和对话消息获取逻辑
- [ ] 实现自定义提示词状态管理（含字数限制）
- [ ] 实现 polishPrompt() — 调用润色 API + 保存原文 + 替换
- [ ] 实现 undoPolish() — 恢复原文 + 清除撤销状态
- [ ] 实现撤销状态自动清除（手动编辑时清除 previousPrompt）
- [ ] 实现 canGenerate 计算逻辑
- [ ] 实现 generate() 路由决策：根据 Tab + 有无视频选择对应 API
- [ ] 实现 buildVideoAnalysisContext() 辅助函数
- [ ] 实现 buildEnrichedReferenceText() 辅助函数
- [ ] 实现 serializeChatMessages() 辅助函数
- [ ] 扩展 useVideoUnderstandingScript 参数：新增 chatMessages + customPrompt
- [ ] 扩展 useScriptGeneration.handleGenerateScriptWithConfig 参数：新增 customPrompt
- [ ] 集成到 VideoUnderstandingScriptModal 组件
- [ ] 传递 conversations 和 activeConversationId 到 Modal（从父组件获取）
- [ ] 端到端测试：各种输入组合下的生成流程
