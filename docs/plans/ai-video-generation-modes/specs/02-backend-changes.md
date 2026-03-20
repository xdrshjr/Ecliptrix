# Spec 02: 后端模型和服务层改动

## 目标

修改后端 `ark_video_models.py` 和 `ark_video_service.py`，支持前端传入生成模式（mode）参数，根据模式正确构建 ARK API 的 content 数组。

## 模型层改动

### ArkVideoGenerateRequest 改动

```pseudo
class ArkVideoGenerateRequest:
    prompt: str                          # 文字描述（必填）
    mode: Literal["description", "keyframe"] = "description"  # 新增：生成模式
    duration: Literal[5, 10] = 5
    camera_fixed: bool = False
    watermark: bool = False
    aspect_ratio: Literal["16:9", "9:16", "1:1"] = "16:9"
    resolution: Literal["480p", "720p", "1080p"] = "720p"

    # 模式A（描述生成）专用
    image_url: Optional[str] = None           # 保留向后兼容
    image_urls: Optional[List[str]] = None    # 保留向后兼容

    # 模式B（关键帧生成）专用 — 新增
    first_frame_url: Optional[str] = None     # 首帧图片URL（模式B必填）
    last_frame_url: Optional[str] = None      # 尾帧图片URL（模式B可选）
```

**向后兼容**：`mode` 默认值为 `"description"`，旧的 `image_url` / `image_urls` 字段保留，不影响已有调用方。

## 服务层改动

### create_task() 逻辑分支

```pseudo
function create_task(request):
    content = [{ type: "text", text: request.prompt }]

    if request.mode == "keyframe":
        # 模式B：关键帧生成
        validate: first_frame_url 必须存在
        content.append({
            type: "image_url",
            image_url: { url: request.first_frame_url },
            role: "first_frame"
        })
        if request.last_frame_url:
            content.append({
                type: "image_url",
                image_url: { url: request.last_frame_url },
                role: "last_frame"
            })
        ratio = "adaptive"  # 关键帧模式强制 adaptive

    else:
        # 模式A：描述生成（保持现有逻辑）
        all_images = merge(request.image_urls, request.image_url)
        image_roles = ["first_frame", "last_frame"]
        for i, img_url in enumerate(all_images[:2]):
            content.append({
                type: "image_url",
                image_url: { url: img_url },
                role: image_roles[i]
            })
        ratio = "adaptive" if all_images else request.aspect_ratio

    payload = {
        model: ARK_MODEL,
        content: content,
        duration: request.duration,
        ratio: ratio,
        resolution: request.resolution,
    }

    # 发送请求...
```

### 验证规则

- 模式B (`keyframe`) 时 `first_frame_url` 为空 → 返回 400 错误
- 模式B 时忽略 `image_url` / `image_urls`（即使传了也不用）
- 模式A 时忽略 `first_frame_url` / `last_frame_url`

## Router 层

- `ark_video_router.py` 无需改动，已使用 `ArkVideoGenerateRequest` 模型自动解析
- 新增的字段是可选的，路由层透传即可

## 影响范围

| 文件 | 改动类型 |
|------|----------|
| `app/models/ark_video_models.py` | 新增字段 |
| `app/services/ark_video_service.py` | 修改 `create_task()` 逻辑 |
| `app/routers/ark_video_router.py` | 无需改动 |

## 测试策略

- 单元测试验证两种模式下 content 数组构建正确
- 模式B 缺少 first_frame_url 时返回 400
- 向后兼容：不传 mode 参数时行为与现有一致
