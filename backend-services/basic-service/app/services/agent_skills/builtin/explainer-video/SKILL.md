---
id: explainer-video
name: 解说视频
description: 有主题或稿子，要做带旁白的解说视频
version: 2
tools: [generate_video_script, batch_generate_tts]
---
目标：把一个主题或一份稿子做成"旁白 + 画面 + 背景音乐"的解说视频。先用 update_plan 列出下面的步骤，再逐步执行。

1. 脚本：`generate_video_script({ topic, duration_target })` 生成结构化脚本，返回 segments 数组（每段含 narration_text）。用户已经给出完整稿子时，直接按段落拆分，不必再生成。
2. 旁白：单段用 `generate_tts({ text: segment.narration_text })`；多段用 `batch_generate_tts({ segments: [{ text: ... }, ...] })`。
3. 画面：根据 segment.content_preview / segment.title 调用 `search_video` / `search_image` 检索素材；也可以用 `generate_ai_image` 补足画面。图片不能直接上轨：先 `use_skill('still-to-clip')` 载入图片成片流程，按每段旁白时长把图片转成视频镜头。
4. 上轨：用 `add_to_track` 把视频素材（含图片转出的视频）放到视频轨、TTS 放到音频轨；按需用 `search_audio` 取一段 BGM 放到独立音频轨（音量 10–20%）。
5. 收尾：`check_timeline_overlaps`，若 valid=false 则 `auto_fix_overlaps`；最后运行 `check_timeline`，先修阻断项再修提醒项。

强制：TTS 的 text 必须使用 generate_video_script 返回的 narration_text，不要自行编写，也不要使用 scriptText（那是画面描述，不是旁白）。
