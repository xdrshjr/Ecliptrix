# TODO 01: ARK API 首尾帧调用测试

**对应 Spec:** `specs/01-api-testing.md`

## Dependencies

- depends_on: []
- blocks: [02, 03, 04]
- parallel_group: A

**原因：** 必须先验证 API 行为正确后才能修改后端和前端代码。所有其他任务都依赖此测试结果。

## Tasks

- [x] 创建测试脚本 `backend-services/basic-service/tests/test_ark_api_modes.py`
- [x] 实现场景1：纯文本生成（基线验证）
- [x] 实现场景2：首帧图 + 描述生成
- [x] 实现场景3：首帧 + 尾帧 + 描述生成
- [x] 实现场景4：仅尾帧（验证 API 是否允许）
- [x] 运行全部场景，记录结果
- [x] 如有 API 行为与预期不符，记录差异并更新 Spec

## Test Results (2026-03-21)

| Scenario | Status | Elapsed | Notes |
|----------|--------|---------|-------|
| 1: Pure text-to-video | PASSED | ~42s | Baseline confirmed working. ratio=16:9, resolution=720p |
| 2: First frame + text | PASSED | ~84s | `role: "first_frame"` accepted. API returned `ratio: "4:3"` (adaptive to image aspect) |
| 3: First + last frame + text | PASSED | ~42s | Both `first_frame` and `last_frame` roles accepted. ratio="4:3" (adaptive) |
| 4: Last frame only | FAILED (expected) | <1s | API rejects last_frame without first_frame at HTTP 400 level |

### Key API Behavior Findings

1. **Base64 data URIs are supported**: The API accepts `data:image/jpeg;base64,...` in the `image_url.url` field. This avoids the need for publicly accessible image hosting.
2. **Minimum image dimensions**: Height must be >= 300px (320x240 was rejected, 640x480 works).
3. **`ratio: "adaptive"` behavior**: When images are provided, the API auto-detects the ratio from the image (e.g., 640x480 -> 4:3). The `"adaptive"` value is required when images are present.
4. **last_frame without first_frame is NOT allowed**: API returns `InvalidParameter: "last frame image content cannot be mixed with first frame or reference image content"`. Frontend/backend must enforce first_frame as required when using keyframe mode.
5. **Response structure confirmed**:
   - Create response: `{"id": "cgt-xxx"}` (just the task ID)
   - Status response: `{"id", "model", "status", "content": {"video_url": "..."}, "usage", "created_at", "updated_at", "seed", "resolution", "ratio", "duration", "framespersecond", "service_tier", "execution_expires_after", "generate_audio", "draft"}`
   - Status values observed: `queued` -> `running` -> `succeeded`
6. **Network stability**: The ARK API polling endpoint occasionally drops TLS connections (EndOfStream, RemoteProtocolError). Retry logic in polling is recommended.
7. **External image URLs may not work**: Pexels/Unsplash URLs failed with "resource download failed" — the ARK API server in cn-beijing cannot reach these hosts. Use base64 data URIs or Chinese CDN-hosted images.
8. **Token usage**: Text-only uses 108,900 tokens; image-to-video uses 109,586 tokens (slightly more).
