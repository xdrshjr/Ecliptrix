---
id: explainer-video
name: 解说视频
description: 有主题或稿子，要做带旁白的解说视频
version: 2
tools: [generate_video_script, batch_generate_tts]
---
目标：把一个主题或一份稿子做成"旁白 + 画面 + 背景音乐"的解说视频。先用 update_plan 列出下面的步骤，再逐步执行。

1. 目标与能力：保留用户明确时长及消息来源。计划使用结构化交付类型记录编辑、BGM、导出等承诺，不能通过改标题或省略字段删除承诺。无导出工具时将导出保留 blocked，说明须交接编辑器。
2. 脚本：`generate_video_script({ topic, duration_target })` 返回 segments（含 narration_text）。已有完整稿子则直接分段。
3. 旁白与预算：单段用 `generate_tts`，多段用 `batch_generate_tts`。按返回的真实时长重新分配镜头和字幕；超出目标时调整脚本或语速，重新生成必要段落；不足时可安排合法留白。视频覆盖音频即可，不能增加固定留尾扩大用户目标。
4. 画面：按主题调用 `search_video` / `search_image`，搜索结果是 candidate；使用真实返回链接下载并取得 materialized 回执，不能猜 URL。主体明确时先抽帧审阅再上轨，不将相似外形当作已确认犬种。图片先 `use_skill('still-to-clip')` 转成视频镜头。生成端点不可用时停止该能力，不靠换提示词重复提交。
5. 上轨：`add_to_track` 添加视频和旁白，`add_subtitles` 对齐字幕。BGM 放独立音轨（音量 10–20%）；下载失败后最多尝试一个替代来源，仍失败保留 blocked 并报告纯旁白降级。
6. 验收：`check_timeline_overlaps`，必要时 `auto_fix_overlaps`；`check_timeline` 验证用户目标、可渲染时长和内容聚合。先修阻断项，软提醒说明处理；audio_gap 不证明实际静音，不能为消警告增加旁白或时长。
7. 交付：区分已编辑、部分完成、待导出、已导出、已检查。没有本项目当前编辑版本的实际导出成功回执时，交接编辑器并报告“未导出”；仅有真实产物才运行 inspect_export。只剩 blocked 时停止自动续跑，保留未完成原因。

强制：TTS 的 text 必须使用 generate_video_script 返回的 narration_text，不要自行编写，也不要使用 scriptText（那是画面描述，不是旁白）。
