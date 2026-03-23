# TODO 05: TTS 语音合成工具

**Spec**: `specs/05-tts-tools.md`

## Dependencies
- **depends_on**: [01, 02] (需要 ToolRegistry + materialStore + asyncTaskStore)
- **blocks**: [09, 11]
- **parallel_group**: B

## Tasks

- [ ] 实现 `tools/generateTts.ts` — generate_tts 工具
  - [ ] 参数 schema (text, voice_type, speed, volume)
  - [ ] Handler: POST /api/tts/convert（同步等待）
  - [ ] 结果转 MaterialItem → materialStore.addMaterial()
  - [ ] 返回素材信息给 Agent
- [ ] 实现 `tools/batchGenerateTts.ts` — batch_generate_tts 工具
  - [ ] 参数 schema (segments[], speed, volume)
  - [ ] Handler: POST /api/tts/batch-convert（异步）
  - [ ] 创建 AsyncTask → asyncTaskStore
  - [ ] 返回 taskId
- [ ] 在 `categories.ts` 中注册 tts_tools 类别
  - [ ] usage_hints 包含常用音色列表
- [ ] AsyncTaskPoller 中添加 batch_tts 任务类型处理
  - [ ] 轮询间隔 3s
  - [ ] 完成后批量添加音频素材
- [ ] 边界处理: 空文本、无效音色、超长文本自动分段
