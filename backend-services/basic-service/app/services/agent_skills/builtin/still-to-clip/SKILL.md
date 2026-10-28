---
id: still-to-clip
name: 图片做成视频镜头
description: 把多张图片做成幻灯片、图文解说或带运镜的镜头
version: 1
tools: [image_to_video, batch_image_to_video]
---
目标：把图片变成可放上视频轨的镜头。图片不要直接 add_to_track——静图会变成居中的叠加贴图，不是全屏镜头。

1. 盘点：`list_materials` 找出要用的图片；只说"找图/生成图"时到入库为止，不上轨。
2. 定时长：有旁白就按每句时长（`duration` ≈ 该句时长，上限 30）；没有旁白每张 3–5 秒。
3. 定画幅：知道项目画幅就传 `aspect_ratio`（如 9:16）；不确定就省略，保持原图比例。
4. 批量转换：2 张以上用 `batch_image_to_video`（一次最多 12 张，超过分批）；默认 `variety` 会交替推拉与平移，不要给每张都指定同一效果。人物或主体偏一侧时给 `focus_x` / `focus_y`。
5. 上轨：按返回 `clips[]` 的顺序逐个 `add_to_track(materialId)`，不要自己编 id；`failed[]` 里的图如实告诉用户，不要用别的图顶替。
6. 检查：`check_timeline_overlaps`，再运行 `check_timeline`。

例外：Logo、水印、贴纸、画中画才用 `add_to_track` 的 `as_still: true`。转换不可用（`ffmpeg_unavailable`）时先告诉用户，再降级为 `as_still: true`，并说明这是静图叠加。
