# TODO 05 - 前端设置面板

**对应规格:** `specs/05-frontend-panels.md`

## Dependencies

- `depends_on: [03, 04, 06]` — 需要后端 API 就绪、默认值已初始化、前端 proxy 路由就绪
- `blocks: []` — 最终交付物，无下游依赖
- `parallel_group: D`

**Why:** 前端面板是用户交互界面，必须在所有后端能力就绪后才能开发和测试。

## Tasks

### 通用组件
- [ ] 创建 `src/components/AdminSettings/components/SettingsSectionCard.tsx` — 设置分组卡片（标题、保存/重置按钮、脏状态提示）
- [ ] 创建 `src/components/AdminSettings/components/ResetDefaultsButton.tsx` — 恢复默认值按钮（带确认对话框）

### TTS 设置面板
- [ ] 创建 `src/components/AdminSettings/TTSSettingsPanel.tsx`
- [ ] 实现并发/超时/重试/限制/日志的表单编辑 sections
- [ ] 创建 `src/components/AdminSettings/components/VoiceListEditor.tsx` — 声音列表专用编辑组件
- [ ] VoiceListEditor: 按分类分组展示
- [ ] VoiceListEditor: 添加/编辑/删除声音
- [ ] VoiceListEditor: 搜索/筛选功能

### YouTube 设置面板
- [ ] 创建 `src/components/AdminSettings/YouTubeSettingsPanel.tsx`
- [ ] 实现下载/上传/质量/文件管理/日志的表单编辑 sections

### 上传设置面板
- [ ] 创建 `src/components/AdminSettings/UploadSettingsPanel.tsx`
- [ ] 实现并发上传/文件大小限制/重试/缩略图/临时文件/日志的表单编辑 sections

### 水印移除设置面板
- [ ] 创建 `src/components/AdminSettings/WatermarkSettingsPanel.tsx`
- [ ] 实现处理配置/日志的表单编辑 sections

### 视频分析设置面板
- [ ] 创建 `src/components/AdminSettings/VideoAnalysisSettingsPanel.tsx`
- [ ] 实现队列管理/VLM处理/帧提取（含时长策略子表单）/性能/临时文件/日志 sections

### 侧边栏与路由
- [ ] 更新 `SettingsSidebar.tsx` 添加 5 个新菜单项
- [ ] 更新 `AdminSettingsPage.tsx` 路由映射，添加新面板的渲染

### 国际化
- [ ] 在 `src/lib/i18n.ts` 中添加所有新设置面板的中英文翻译 key
