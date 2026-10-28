# Image to Video Conversion API

Turns one still image into one MP4 clip with a camera move. It runs on the
local FFmpeg, costs nothing and needs no network for local images. It serves two
callers: the material panel's "image to video" dialog and the editing agent's
`image_to_video` / `batch_image_to_video` tools
(`docs/plans/agent-still-to-clip/spec.md`).

## Endpoint

```
POST /api/video/image-to-video
```

No authentication (single-user desktop app, bound to `127.0.0.1`).

## Request

```jsonc
{
  "image_url": "/api/storage/files/uploads/images/a.jpg",
  "storage_key": "uploads/images/a.jpg",
  "image_data": null,
  "effect": "ken_burns",
  "duration": 5.0,
  "ken_burns_direction": "zoom_in",
  "pan_direction": "left_to_right",
  "focus_x": 0.5,
  "focus_y": 0.5,
  "aspect_ratio": null,
  "max_long_side": 1920
}
```

| Field | Type | Default | Notes |
|---|---|---|---|
| `image_data` | string | - | Base64 or `data:` URL. Highest precedence (browser-only `blob:` images). |
| `storage_key` | string | - | `STORAGE_ROOT`-relative key (no drive letter, no leading `/`, no `..`, at most 256 chars). Second precedence. |
| `image_url` | string | - | Same-origin path (`/api/storage/files/...`), loopback URL, or public `http(s)` URL. Lowest precedence. |
| `effect` | `static` \| `ken_burns` \| `pan` | required | |
| `duration` | float | 5.0 | 1.0 - 30.0 seconds. |
| `ken_burns_direction` | `zoom_in` \| `zoom_out` | `zoom_in` | Only read for `ken_burns`. |
| `pan_direction` | `left_to_right` \| `right_to_left` | `left_to_right` | Only read for `pan`. A direction that belongs to another effect is ignored. |
| `focus_x`, `focus_y` | float 0..1 | 0.5 | Subject centre. Ignored for `static`. |
| `aspect_ratio` | `16:9` \| `9:16` \| `1:1` \| `4:3` \| `21:9` | `null` | Output frame. `null` keeps the image's own ratio. |
| `max_long_side` | int 480..3840 | 1920 | Upper bound for the output's longer side; width and height are made even. |
| `task_id` | string | - | Queue tracking only. |
| `custom_filename` | string | - | Deprecated and ignored: output names are content-addressed. |

At least one of `image_data`, `storage_key`, `image_url` is required.

### Image sources

* **`storage_key`** is validated, then resolved through the
  `/api/storage/files/<key>` route branch of `local_media_resolver`, which is
  anchored at `STORAGE_ROOT` and containment-checked. (Passing a bare relative
  string to the resolver would anchor it at the service directory instead.)
* **Same-origin path / loopback URL** resolve the same way and are read from
  disk.
* **Remote `http(s)`** goes through `validate_external_url` (loopback, private,
  link-local and cloud-metadata hosts are refused), is downloaded with a 30 s
  timeout and a 25 MB cap, must answer `image/*`, and every redirect hop is
  validated again (at most 3 hops).
* Images over 25 MB or 64 megapixels are refused before decoding.
  Phone photos are rotated by their EXIF orientation; transparency is flattened
  onto black.

## Effects

| Effect | What it renders |
|---|---|
| `static` | The picture, scaled. When `aspect_ratio` differs from the image's ratio, the frame is filled with the same blurred, darkened backdrop the exporter uses (no black bars). |
| `ken_burns` | Slow push (`zoom_in`: 1.00 to 1.12x) or pull (`zoom_out`: 1.12 to 1.00x) on a 2x supersampled frame, so it does not shimmer. The crop window is clamped inside the image, so an off-centre focus never shows black. |
| `pan` | Horizontal drift across a strip 1.25x the frame width with smooth-step easing. |

Output: H.264 (`libx264`, CRF 18, `veryfast`), `yuv420p`, 30 fps, `+faststart`,
no audio.

## Response

Success (HTTP 200):

```jsonc
{
  "success": true,
  "message": "Image converted to video successfully",
  "video_url": "/api/storage/files/video/generated/i2v_3f9a1c0b2e7d4a55.mp4",
  "storage_key": "video/generated/i2v_3f9a1c0b2e7d4a55.mp4",
  "thumbnail_url": "/api/storage/files/video/generated/i2v_3f9a1c0b2e7d4a55_thumb.jpg",
  "file_size": 123456,
  "duration": 5.0,
  "width": 1920,
  "height": 1080,
  "effect_applied": "ken_burns",
  "processing_time": 2.4,
  "reused": false
}
```

### Idempotency

The file name is `i2v_<16 hex>` where the hex is
`sha1(image bytes + canonical parameters + filter version)[:16]`. A repeat call
with the same image and parameters returns the same file with `reused: true` and
does not render again. Bump `FILTER_VERSION` in `image_to_video_filters.py`
whenever a filter string changes so stale renders are never served as new.
Files are written under a temporary name and moved into place atomically, so a
half-written clip is never a cache hit. `video/generated/` is not touched by
`derived_gc_service`.

### Failure

Business failures return HTTP 200 with `success: false` (the material panel
depends on this); only a malformed body returns 422.

```json
{
  "success": false,
  "message": "Image could not be decoded",
  "error_code": "IMAGE_UNREADABLE",
  "details": "cannot identify image file"
}
```

| `error_code` | Meaning |
|---|---|
| `MISSING_IMAGE_SOURCE` | None of `image_data`, `storage_key`, `image_url` was given. |
| `INVALID_DURATION` | Duration outside 1-30 s. |
| `INVALID_ARGUMENT` | Unsafe `storage_key`, or a direction that is not valid for the chosen effect. |
| `IMAGE_NOT_FOUND` | The source could not be resolved, read or downloaded (including refused internal URLs). |
| `IMAGE_UNREADABLE` | Not a decodable image, or a remote resource that is not `image/*`. |
| `IMAGE_TOO_LARGE` | Over 25 MB or 64 megapixels. |
| `FFMPEG_UNAVAILABLE` | FFmpeg is not on `PATH`. |
| `FFMPEG_ERROR` | FFmpeg exited non-zero; `details` carries the tail of its stderr. |
| `QUEUE_TIMEOUT` | FFmpeg did not finish within `max(60, duration x 12)` seconds and was killed. |
| `FILE_NOT_CREATED` | FFmpeg reported success but produced no output. |
| `INTERNAL_ERROR` | Unexpected server error. |
| `QUEUE_ERROR`, `CONVERSION_ERROR`, `UPLOAD_FAILED` | Legacy codes, kept for compatibility. Clients treat them as `conversion_failed`. |

Error codes are public API; renaming one is a breaking change.

## Concurrency

The route runs through the `image_to_video` queue with at most 2 conversions at
once. FFmpeg is an `asyncio` subprocess (never `subprocess.run`), so a render
does not block other requests, and a cancelled request kills its FFmpeg.

## Example

```bash
curl -X POST "http://127.0.0.1:8000/api/video/image-to-video" \
  -H "Content-Type: application/json" \
  -d '{
    "storage_key": "uploads/images/a.jpg",
    "effect": "ken_burns",
    "duration": 5,
    "aspect_ratio": "16:9",
    "focus_x": 0.3
  }'
```
