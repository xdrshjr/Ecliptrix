"""Agent 视觉审阅 REST 端点（7 个，§5.1 / §5.2）。

设计基线：docs/plans/agent-visual-review/spec.md §5.1–§5.4。

与 `agent_toolkit_router.py` 同构的四处：Origin 校验、强制 JSON、
`x-tool-call-id` 闸门、`ErrorResponse` 信封 + `SETTINGS_HINTS` + 幂等。

三处刻意不同：

1. **`/capabilities` 与 `/usage` 不受能力开关限制**，且 `/capabilities`
   自己在服务层 catch 配置异常（AC-29：未配置视觉必须 200）。
2. **`/export-inspect` 由两个独立开关管**（`probe_enabled` 管技术探测、
   `enabled` 只管视觉抽检），两者都关才 `vision_disabled`（P1-5 / AC-24）。
3. **失败也记用量**：`model_not_multimodal` 落库 + 计数，避免当日反复试错。
"""
import asyncio
import hashlib
import re
from uuid import uuid4

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from app.logger import get_logger

from app.models.agent_vision_models import (
    AgentVisionError,
    CacheClearRequest,
    DescribeRequest,
    ExportInspectRequest,
    FramesRequest,
)
from app.models.base_models import BaseResponse, ErrorResponse
from app.services.agent_toolkit import toolkit_calls
from app.services.agent_vision import (
    capabilities as capabilities_service,
    contact_sheet,
    export_probe,
    frame_sampler,
    image_encode,
    image_source,
    observation_store,
    vision_client,
)

router = APIRouter(prefix="/agent-vision", tags=["Agent Vision"])
logger = get_logger(__name__)

# 每个错误码的设置跳转（§5.4）；没有 hint 的码不带 `settings_path`。
SETTINGS_HINTS = {
    "vision_disabled": "在“设置 › 视觉审阅”开启视觉审阅后重试",
    "vision_unavailable": "前往 模型设置 › 功能分配 › 视觉 绑定一个多模态模型",
    "model_not_multimodal": "当前模型不接受图像，请在 模型设置 中更换",
    "vision_quota_exceeded": "在“设置 › 视觉审阅”提高每日上限或明日再试",
    "ffmpeg_unavailable": "安装/重新安装桌面应用（内置 FFmpeg）",
    "inspect_unavailable": "成片探测与抽帧都不可用；请打开导出目录自查",
    "storage_unavailable": "视觉产物目录不可写，请检查磁盘空间与权限",
}
_MAX_CALL_ID = 128
_UNSAFE_CALL_ID = re.compile(r"[\\/\x00-\x1f]|\.\.")
# 视觉抽检的中心区段比例：只取中间 80%，避开片头片尾（§4.9）。
SPOT_CHECK_MARGIN = 0.1


# ── 闸门（§5.2） ──────────────────────────────────────────────────────────


def validate_vision_origin(request, *, write, require_json=True):
    """复用 `validate_ui_origin`，只把错误类型翻译成本域闭集。"""
    from app.models.web_research_models import WebResearchError
    from app.routers.research_run_router import validate_ui_origin

    try:
        if require_json:
            validate_ui_origin(request, write=write)
        else:
            validate_ui_origin(request, write=False)
            if write and not request.headers.get("origin"):
                raise WebResearchError("origin_forbidden", status_code=403)
    except WebResearchError as error:
        raise AgentVisionError(error.error_code, message=error.message,
                               status_code=error.status_code) from None


def _settings():
    from app.services.system_settings_service import agent_vision_settings

    return agent_vision_settings()


def require_vision():
    """`enabled=false` 只闸住"会产生出口与磁盘产物"的视觉调用（§4.12）。"""
    if not _settings()["enabled"]:
        raise AgentVisionError("vision_disabled")


def require_probe_or_vision():
    """任一可用即放行；两者都关 → `vision_disabled` + `reason=all_disabled`。"""
    settings = _settings()
    if settings["probe_enabled"] or settings["enabled"]:
        return
    error = AgentVisionError("vision_disabled")
    error.reason = "all_disabled"
    raise error


def _call_id(request, required=True):
    identifier = request.headers.get("x-tool-call-id", "")
    if not identifier:
        if required:
            raise AgentVisionError("invalid_call_id",
                                  message="x-tool-call-id header is required")
        return None
    if len(identifier) > _MAX_CALL_ID:
        raise AgentVisionError(
            "invalid_call_id",
            message="x-tool-call-id must be at most 128 chars")
    if _UNSAFE_CALL_ID.search(identifier):
        raise AgentVisionError(
            "invalid_call_id",
            message="x-tool-call-id must not contain path separators")
    return identifier


def write_guard(request):
    """写类视觉工具闸门：Origin → JSON → 能力开关 → `x-tool-call-id`。"""
    validate_vision_origin(request, write=True, require_json=True)
    require_vision()
    return _call_id(request)


def inspect_guard(request):
    """`/export-inspect`：两个独立开关，任一可用即放行（P1-5）。"""
    validate_vision_origin(request, write=True, require_json=True)
    require_probe_or_vision()
    return _call_id(request)


# ── 错误信封（§5.4） ──────────────────────────────────────────────────────


def error_details(error):
    details = {
        "failure_class": error.failure_class,
        "retryable": error.failure_class == "transient",
        "request_id": str(uuid4()),
    }
    hint = SETTINGS_HINTS.get(error.error_code)
    settings_path = getattr(error, "settings_path", None)
    if hint and not settings_path:
        settings_path = "agent_vision"
    if settings_path:
        details["settings_path"] = settings_path
    if hint:
        details["settings_hint"] = hint
    for attribute in ("next_step", "reason", "skipped", "supported"):
        value = getattr(error, attribute, None)
        if value is not None:
            details[attribute] = value
    return details


def error_response(error):
    return JSONResponse(
        status_code=error.status_code,
        content=ErrorResponse(
            success=False, message=error.message,
            error_code=error.error_code,
            error_details=error_details(error),
        ).model_dump(mode="json"),
    )


def _ok(data, message="ok"):
    return BaseResponse(success=True, message=message, data=data)


# ── 用量 / 配额 ───────────────────────────────────────────────────────────


async def _check_quota(settings, project_id, image_count):
    used = await observation_store.quota_used(project_id)
    if used["calls"] >= int(settings["daily_call_cap"]):
        raise AgentVisionError("vision_quota_exceeded",
                              message="the daily vision call cap is reached")
    if used["images"] + int(image_count) > int(settings["daily_image_cap"]):
        raise AgentVisionError("vision_quota_exceeded",
                              message="the daily vision image cap is reached")


async def _record_failure(project_id, call_id, error, *, source_kind,
                          source_ref, mode):
    """失败也落库 + 计数（§4.6 的"记忆"），任何写库异常都不覆盖原错误。"""
    try:
        await observation_store.write_observation({
            "project_id": project_id, "call_id": call_id,
            "source_kind": source_kind, "source_ref": source_ref,
            "mode": mode, "verdict": "concern",
            "summary": f"{error.error_code}: {error.message}"[:2000],
            "failed": True, "error_code": error.error_code,
        })
        await observation_store.record_usage({
            "project_id": project_id, "calls": 1, "failures": 1,
            "error_code": error.error_code,
        })
    except Exception:  # noqa: BLE001 - 记账失败不得改变用户看到的错误
        pass


# ── 能力 / 用量（不受能力开关限制） ────────────────────────────────────────


@router.get("/capabilities")
async def get_capabilities(request: Request, project_id: str | None = None):
    validate_vision_origin(request, write=False)
    return _ok(await capabilities_service.capabilities(project_id))


@router.get("/usage")
async def get_usage(request: Request, project_id: str | None = None):
    validate_vision_origin(request, write=False)
    return _ok(await capabilities_service.usage(project_id))


# ── 观察读取 ──────────────────────────────────────────────────────────────


@router.get("/observations/{observation_id}")
async def read_observation(observation_id: str, request: Request,
                           offset: int = Query(0, ge=0),
                           max_bytes: int = Query(
                               observation_store.DEFAULT_READ_BYTES,
                               ge=1, le=observation_store.MAX_READ_BYTES)):
    validate_vision_origin(request, write=False)
    row = await observation_store.get_observation(observation_id)
    return _ok(observation_store.text_page(row, offset, max_bytes))


# ── 缓存 ──────────────────────────────────────────────────────────────────


@router.post("/cache/clear")
async def clear_cache(body: CacheClearRequest, request: Request):
    validate_vision_origin(request, write=True, require_json=True)
    _call_id(request)
    return _ok(await observation_store.clear_cache(body.project_id))


# ── 观察结果装配 ──────────────────────────────────────────────────────────


def _image_digest(encoded) -> str:
    """多图时把各图摘要再摘要一次，落 `image_sha256` 列（只存摘要，不存图像）。"""
    material = "".join(item.sha256 for item in encoded)
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def _source_kind(resolved) -> str:
    kinds = {item.source_kind for item in resolved}
    return kinds.pop() if len(kinds) == 1 else "material"


def _source_ref(resolved) -> str:
    return ";".join(item.source_ref for item in resolved)[:255]


def _thumbs(encoded) -> list[str]:
    return [image_encode.thumbnail_data_url(item) for item in encoded]


def _details(thumbs, labels, model, elapsed_ms) -> dict:
    """卡片专用扩展（§4.7）：`thumbs` 只进 `details`，模型永远看不到。"""
    return {"ui": {"thumbs": thumbs, "source_labels": labels,
                   "model": model, "elapsed_ms": int(elapsed_ms or 0)}}


def _payload(result, observation_id, images, cached=False,
             next_step=None) -> dict:
    payload = {
        "ok": result["verdict"] != "fail",
        "verdict": result["verdict"],
        "summary": (result.get("summary") or "")[
            :observation_store.MODEL_SUMMARY_CHARS],
        "observations": result.get("observations") or [],
        "issues": result.get("issues") or [],
        "text_lines": result.get("text_lines") or [],
        "images": int(images),
        "cached": bool(cached),
        "observation_id": observation_id,
    }
    if next_step:
        payload["next_step"] = next_step
    return payload


def _record(result, *, project_id, call_id, source_kind, source_ref,
            cache_key, mode, image_sha256) -> dict:
    model = result.get("model") or {}
    return {
        "project_id": project_id, "call_id": call_id,
        "source_kind": source_kind, "source_ref": source_ref,
        "image_sha256": image_sha256, "cache_key": cache_key, "mode": mode,
        "model_provider": model.get("provider"),
        "model_name": model.get("model"),
        "verdict": result["verdict"], "summary": result.get("summary"),
        "observations": result.get("observations"),
        "issues": result.get("issues"),
        "text_lines": result.get("text_lines"),
    }


async def _resolve_all(refs, project_id):
    resolved = []
    for ref in refs:
        resolved.append(await image_source.resolve_image(ref, project_id))
    return resolved


def _encode_all(resolved, settings) -> list:
    return [
        image_encode.encode_resolved(
            item,
            max_side=int(settings["max_image_side_px"]),
            max_bytes=int(settings["max_image_bytes"]),
            max_input_bytes=int(settings["max_input_bytes"]),
        )
        for item in resolved
    ]


async def _store_frames(call_id, frames, sheet_bytes) -> None:
    """§6.2 的产物落盘；失败只记日志，观察结果仍返回文本（§4.12）。"""
    try:
        observation_store.run_directory(call_id)
        for index, (moment, body) in enumerate(frames, start=1):
            observation_store.write_blob(
                f"{call_id}/frames/{index}-{moment:.2f}.jpg", body)
        observation_store.write_blob(f"{call_id}/sheet.jpg", sheet_bytes)
    except AgentVisionError as error:
        logger.warning("Vision artifact write skipped: %s", error.error_code)


# ── /describe ─────────────────────────────────────────────────────────────


@router.post("/describe")
async def describe(body: DescribeRequest, request: Request):
    call_id = write_guard(request)

    async def run():
        return await _describe(body, call_id)

    return _ok(await toolkit_calls.toolkit_call_cache.run(
        call_id, "vision_describe", run))


async def _describe(body: DescribeRequest, call_id: str) -> dict:
    settings = _settings()
    limit = int(settings["max_images_per_call"])
    if len(body.images) > limit:
        raise AgentVisionError(
            "invalid_argument",
            message=f"at most {limit} images are allowed per call")
    await _check_quota(settings, body.project_id, len(body.images))
    resolved = await _resolve_all(body.images, body.project_id)
    # 读字节 + Pillow 解码/缩放/降质是同步重活（单图可达百毫秒级），必须离开
    # 事件循环，否则一次看 6 张图会把 /health 之类无关请求一起卡住。
    encoded = await asyncio.to_thread(_encode_all, resolved, settings)
    model = await vision_client.resolve_vision_model()
    template = observation_store.question_template(
        body.question, body.checklist)
    key = observation_store.cache_key(
        [item.sha256 for item in encoded], mode=body.mode,
        template=template, model_name=model["model"])
    thumbs, labels = _thumbs(encoded), [item.label for item in resolved]
    cached = await observation_store.find_cached(key)
    if cached is not None:
        await observation_store.record_usage(
            {"project_id": body.project_id, "cached": 1})
        payload = observation_store.payload_for_model(
            cached, images=len(encoded), cached=True)
        payload["details"] = _details(thumbs, labels, model, 1)
        return payload
    try:
        result = await vision_client.describe_images(
            encoded, body.question, mode=body.mode,
            checklist=body.checklist, project_id=body.project_id)
    except AgentVisionError as error:
        await _record_failure(
            body.project_id, call_id, error,
            source_kind=_source_kind(resolved),
            source_ref=_source_ref(resolved),
            mode=body.mode)
        raise
    written = await observation_store.write_observation(_record(
        result, project_id=body.project_id, call_id=call_id,
        source_kind=_source_kind(resolved), source_ref=_source_ref(resolved),
        cache_key=key, mode=body.mode, image_sha256=_image_digest(encoded)))
    await observation_store.record_usage(
        {"project_id": body.project_id, "calls": 1, "images": len(encoded)})
    payload = _payload(result, written["observation_id"], len(encoded))
    payload["details"] = _details(
        thumbs, labels, result.get("model") or model, result.get("elapsed_ms"))
    return payload


# ── /frames ───────────────────────────────────────────────────────────────


@router.post("/frames")
async def review_frames(body: FramesRequest, request: Request):
    call_id = write_guard(request)

    async def run():
        return await _frames(body, call_id)

    return _ok(await toolkit_calls.toolkit_call_cache.run(
        call_id, "vision_frames", run))


async def _frames(body: FramesRequest, call_id: str) -> dict:
    settings = _settings()
    count = int(body.count or settings["frame_sample_count"])
    # 先按"要审阅的帧数"占额度：联系表虽是一张图，成本按帧计（§4.14）。
    await _check_quota(settings, body.project_id, count)
    source = body.source
    path, reference = await image_source.resolve_video_path(
        source.kind, material_id=source.id, storage_key=source.storage_key,
        composition_id=source.id, name=source.id, project_id=body.project_id)
    duration = await frame_sampler.video_duration(path)
    start = float(body.start_seconds or 0.0)
    end = (float(body.end_seconds) if body.end_seconds is not None
           else float(duration or start))
    times, frames, skipped = await frame_sampler.sample_frames(
        path, start, end, count)
    if not frames:
        raise AgentVisionError(
            "image_invalid",
            message="no decodable frame in the requested range")
    sheet_bytes = await asyncio.to_thread(contact_sheet.build_sheet, frames)
    sheet = image_encode.encode_bytes(
        sheet_bytes, max_side=int(settings["max_image_side_px"]),
        max_bytes=int(settings["max_image_bytes"]),
        max_input_bytes=int(settings["max_input_bytes"]))
    await _store_frames(call_id, frames, sheet_bytes)
    return await _frames_observation(
        body, call_id, sheet, frames, times, skipped, reference, start, end)


async def _frames_observation(body, call_id, sheet, frames, times, skipped,
                              reference, start, end) -> dict:
    """联系表 → 视觉调用 → 观察（与 `/describe` 共用缓存与计数口径）。"""
    model = await vision_client.resolve_vision_model()
    template = observation_store.question_template(body.question, [])
    key = observation_store.cache_key(
        sheet.sha256, mode=body.mode, template=template,
        model_name=model["model"])
    sheet_info = {"frame_count": len(frames),
                  "start": round(start, 3), "end": round(end, 3)}
    cached = await observation_store.find_cached(key)
    if cached is not None:
        await observation_store.record_usage(
            {"project_id": body.project_id, "cached": 1})
        payload = observation_store.payload_for_model(
            cached, images=len(frames), cached=True)
        payload["sheet"] = sheet_info
        payload["details"] = _details(
            [image_encode.thumbnail_data_url(sheet)],
            [f"抽帧：{reference}"], model, 1)
        # 跳过的帧也要让模型知道：这是没测的记账，不是通过。
        payload["frame_skipped"] = list(skipped)
        payload["details"]["ui"]["skipped"] = skipped
        return payload
    try:
        result = await vision_client.describe_images(
            [sheet], body.question, mode=body.mode, checklist=None,
            project_id=body.project_id)
    except AgentVisionError as error:
        await _record_failure(
            body.project_id, call_id, error, source_kind="frames",
            source_ref=reference, mode=body.mode)
        raise
    written = await observation_store.write_observation(_record(
        result, project_id=body.project_id, call_id=call_id,
        source_kind="frames", source_ref=reference, cache_key=key,
        mode=body.mode, image_sha256=_image_digest([sheet])))
    await observation_store.record_usage(
        {"project_id": body.project_id, "calls": 1, "images": len(frames)})
    payload = _payload(result, written["observation_id"], len(frames))
    payload["sheet"] = sheet_info
    payload["frame_skipped"] = list(skipped)
    payload["details"] = _details(
        [image_encode.thumbnail_data_url(sheet)],
        [f"抽帧：{reference}"], result.get("model") or model,
        result.get("elapsed_ms"))
    payload["details"]["ui"]["skipped"] = skipped
    return payload


# ── /export-inspect ───────────────────────────────────────────────────────

_SPOT_QUESTION = (
    "Inspect this exported video contact sheet. Look for black or corrupted "
    "frames, subtitles covering the main subject, leftover watermarks, "
    "unreadable text and focus or exposure problems.")


@router.post("/export-inspect")
async def inspect_export(body: ExportInspectRequest, request: Request):
    call_id = inspect_guard(request)

    async def run():
        return await _export_inspect(body, call_id)

    return _ok(await toolkit_calls.toolkit_call_cache.run(
        call_id, "vision_export_inspect", run))


def _next_step(issues, probe, skipped=()) -> str:
    if any(item["severity"] == "blocker" for item in issues):
        return "先修复阻塞项，再重新导出并让 Agent 自检。"
    if any(item["severity"] == "warning" for item in issues):
        return "按警告逐条核对；必要时调整后重新导出。"
    if probe is not None and not probe.get("available", True):
        if "probe:disabled" in skipped:
            return "成片探测已在设置里关闭；需要硬指标时请打开后再自检。"
        return "先安装内置 FFmpeg，或手动打开导出目录自查。"
    return "成片硬指标正常，可以交付；视觉抽检见 visual 字段。"


def _technical(probe) -> dict:
    if not probe:
        return {"available": False}
    metadata = probe.get("metadata") or {}
    return {
        "available": bool(probe.get("available", True)),
        "width": metadata.get("width"),
        "height": metadata.get("height"),
        "has_audio": metadata.get("has_audio"),
        "black_segments": len(probe.get("black") or []),
        "freeze_segments": len(probe.get("freeze") or []),
        "silence_segments": len(probe.get("silence") or []),
    }


async def _export_inspect(body: ExportInspectRequest, call_id: str) -> dict:
    settings = _settings()
    path, reference = image_source.resolve_composition_path(
        body.composition_id, body.project_id)
    probe, issues, skipped = await _run_probe(path, body, settings)
    await _write_probe_artifact(call_id, probe, issues, skipped)
    visual = await _spot_check(
        body, settings, path, reference, call_id, skipped)
    data = {
        "ok": not any(item["severity"] == "blocker" for item in issues),
        "duration_seconds": (probe.get("metadata") or {}).get("duration"),
        "issues": issues,
        "skipped": skipped,
        "next_step": _next_step(issues, probe, skipped),
        "technical": _technical(probe),
    }
    if probe.get("loudness"):
        data["loudness"] = probe["loudness"]
    if visual is not None:
        data["visual"] = visual
    return data


async def _run_probe(path, body, settings):
    """技术探测；`probe_enabled=false` 或 ffmpeg 缺失时降级而非整体失败。"""
    if not settings["probe_enabled"]:
        # 设置里关掉探测就必须真的不跑：否则它是个"配置了但无效"的假开关
        # （P1-5 的同一类缺陷），而且每次自检白烧 5 次 ffmpeg。
        return ({"available": False, "metadata": {}}, [],
                ["probe:disabled", *export_probe.METADATA_SKIP])
    try:
        probe = await export_probe.probe_export(
            path, settings=settings, expected=body.expected,
            timeline_duration=body.timeline_duration,
            check_audio=body.check_audio)
    except AgentVisionError as error:
        if error.error_code != "ffmpeg_unavailable":
            raise
        issues = [{"code": "ffmpeg_unavailable", "severity": "note",
                   "at_seconds": None, "note": error.message}]
        return {"available": False, "metadata": {}}, issues, list(
            getattr(error, "skipped", ()))
    return probe, probe["issues"], probe["skipped"]


async def _write_probe_artifact(call_id, probe, issues, skipped) -> None:
    try:
        observation_store.write_probe_json(
            call_id, {"probe": probe, "issues": issues, "skipped": skipped})
    except AgentVisionError as error:
        logger.warning("Probe artifact write skipped: %s", error.error_code)


async def _spot_check(body, settings, path, reference, call_id, skipped):
    """视觉抽检；关闭或不可用都必须记账，绝不静默跳过（§4.12）。"""
    if not (body.visual_spot_check and settings["enabled"]
            and settings["visual_spot_check"]):
        skipped.append("visual:disabled")
        return None
    try:
        return await _spot_check_observation(
            body, settings, path, reference, call_id, skipped)
    except AgentVisionError as error:
        skipped.append(f"visual:{error.error_code}")
        if error.failure_class == "transient":
            logger.warning("Visual spot check failed: %s", error.error_code)
        return None


async def _spot_check_observation(body, settings, path, reference, call_id,
                                  skipped):
    # 日限用尽时只降级视觉抽检：技术探测结果必须照常返回（§4.12 / AC-24）。
    count = int(body.count or settings["frame_sample_count"])
    # 按"要看的帧数"占额度：一次抽检花的是 count 张图，不是一个。
    await _check_quota(settings, body.project_id, count)
    duration = await frame_sampler.video_duration(path)
    start = (duration or 0.0) * SPOT_CHECK_MARGIN
    end = (duration or 0.0) * (1.0 - SPOT_CHECK_MARGIN)
    _, frames, frame_skips = await frame_sampler.sample_frames(
        path, start, end, count)
    # 抽帧失败同样是"没测"：不记账的话，6 帧里坏掉 4 帧会渲染成一次干净的
    # 全绿抽检（§10.3 门禁 7 禁止的假绿）。
    skipped.extend(frame_skips)
    if not frames:
        raise AgentVisionError("image_invalid",
                              message="no decodable frame in the export")
    sheet_bytes = await asyncio.to_thread(contact_sheet.build_sheet, frames)
    sheet = image_encode.encode_bytes(
        sheet_bytes, max_side=int(settings["max_image_side_px"]),
        max_bytes=int(settings["max_image_bytes"]),
        max_input_bytes=int(settings["max_input_bytes"]))
    await _store_frames(call_id, frames, sheet_bytes)
    result = await vision_client.describe_images(
        [sheet], _SPOT_QUESTION, mode="scan",
        checklist=["watermark", "text_legible", "safe_area", "quality"],
        project_id=body.project_id)
    written = await observation_store.write_observation(_record(
        result, project_id=body.project_id, call_id=call_id,
        source_kind="export_probe", source_ref=reference, cache_key="",
        mode="scan", image_sha256=_image_digest([sheet])))
    await observation_store.record_usage(
        {"project_id": body.project_id, "calls": 1, "images": len(frames)})
    payload = _payload(result, written["observation_id"], len(frames))
    payload["details"] = _details(
        [image_encode.thumbnail_data_url(sheet)], [f"成品：{reference}"],
        result.get("model") or {}, result.get("elapsed_ms"))
    return payload
