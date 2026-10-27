---
id: quick-assemble
name: 现有素材速剪
description: 用现有或检索到的素材快速拼出一条视频，速度优先
version: 1
tools: [search_video, search_image, search_audio]
---
目标：不写脚本、不生成，直接用现有素材（素材库或检索结果）快速组装。速度优先。

1. 素材：先 `list_materials` 看素材库里已有什么；不够时再用 `search_video` / `search_image` 拉取候选素材到素材库。
2. 配乐：需要时 `search_audio` 取 BGM。
3. 入轨：`add_to_track` 把素材依次放上轨道；用 `resize_clip` / `trim_clip` 调整时长，`move_clip` 调位置。
4. 检查：操作完成后 `check_timeline_overlaps`；若 valid=false 则 `auto_fix_overlaps`。
5. 自检：运行 `check_timeline`，先修阻断项。

注意：用户只说"找几段"时只入库不上轨；明确说"拼起来"/"放到视频里"才上轨。
