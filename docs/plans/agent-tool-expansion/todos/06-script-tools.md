# TODO 06: 脚本工具

**Spec**: `specs/06-script-tools.md`

## Dependencies
- **depends_on**: [01, 02] (需要 ToolRegistry + scriptStore)
- **blocks**: [07, 09, 11] (分镜工具可能依赖脚本)
- **parallel_group**: B

## Tasks

- [ ] 实现 `tools/generateVideoScript.ts` — generate_video_script 工具
  - [ ] 参数 schema (topic, style, duration_target, language, additional_requirements)
  - [ ] Handler: POST /api/ai-video-script-generation（流式）
  - [ ] 流式更新 scriptStore: resetScript → setGenerating → appendScriptContent → setGenerating(false)
  - [ ] 返回脚本摘要 (word_count, estimated_duration)
- [ ] 实现 `tools/expandVideoScript.ts` — expand_video_script 工具
  - [ ] 参数 schema (outline, expansion_type, target_word_count)
  - [ ] Handler: 如果 outline 为空则从 scriptStore.scriptContent 读取
  - [ ] POST /api/ai-video-script-expand
  - [ ] 更新 scriptStore
- [ ] 实现 `tools/understandVideoScript.ts` — understand_video_script 工具
  - [ ] 参数 schema (material_ids, style, language)
  - [ ] Handler: POST /api/video-understanding-script
  - [ ] 更新 scriptStore
- [ ] 在 `categories.ts` 中注册 script_tools 类别
- [ ] 流式脚本事件支持: SSE `script_delta` 事件类型
