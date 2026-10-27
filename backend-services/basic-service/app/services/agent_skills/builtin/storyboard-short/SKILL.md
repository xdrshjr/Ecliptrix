---
id: storyboard-short
name: AI 分镜短片
description: 要做分镜、卡点或全程 AI 生成画面的高质量短片
version: 1
tools: [generate_storyboard, describe_storyboard, batch_storyboard_video, compose_storyboard]
---
目标：用 AI 为每个镜头生成视频，再按分镜合成为一条短片。质量高，但生成耗时、会消耗生成额度，先用 update_plan 列出步骤并让用户知道这一点。

1. 脚本：`generate_video_script` 起一份脚本草稿。
2. 分镜：`generate_storyboard({ script })`，必须传入上一步的脚本内容；返回 shots 数组。
3. 描述：`describe_storyboard({ storyboardId })` 为每个 shot 补镜头描述（如缺）。
4. 生成：`batch_storyboard_video({ storyboardId })` 批量为每个 shot 生成视频，这是异步任务，不要重复提交同一个分镜。
5. 合成：任务全部完成后 `compose_storyboard({ storyboardId })` 把 shot 组合到时间线。
6. 收尾：运行 `check_timeline`，修复阻断项后向用户汇报。

注意：生成任务未全部完成时不要合成；个别镜头失败时如实告诉用户，不要用不相关的素材悄悄顶替。
