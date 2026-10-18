"""REST 端点：闸门矩阵、信封、幂等、缓存、日限、capabilities（AC-09..12/24/25/29）。"""
import json

import pytest

from app.models.agent_vision_models import AgentVisionError, DescribeRequest
from app.models.agent_vision_models import ImageRef
from app.routers import agent_vision_router as router_module
from app.services.agent_toolkit import toolkit_calls
from app.services.agent_vision import (
    capabilities as capabilities_service,
    observation_store,
    vision_client,
)
from tests.agent_vision_support import (  # noqa: F401  (pytest fixtures)
    FakeRequest,
    origin_headers,
    png_bytes,
    vision_engine,
    vision_settings,
    vision_storage,
    wire_database,
    write_request,
)

MODEL = {"provider": "vl.example.com", "model": "qwen-vl-max",
         "source": "database"}

GOOD_RESULT = {
    "verdict": "concern",
    "summary": "字幕压到了主体",
    "observations": [{"region": "bottom", "at_seconds": 3.0, "text": "字幕"}],
    "issues": [{"code": "subtitle_cover", "severity": "warning", "note": "遮挡"}],
    "text_lines": ["一键成片"],
    "model": MODEL,
    "elapsed_ms": 1200,
    "parse_error": False,
    "untrusted": True,
}


@pytest.fixture(autouse=True)
def reset_call_cache():
    toolkit_calls.toolkit_call_cache.clear()
    yield
    toolkit_calls.toolkit_call_cache.clear()


@pytest.fixture
def fake_vision(monkeypatch):
    """假视觉客户端：不联网，返回固定契约。"""
    calls = {"describe": 0}

    async def fake_describe(images, question, *, mode="look", checklist=None,
                            project_id=None):
        calls["describe"] += 1
        return dict(GOOD_RESULT)

    async def fake_model():
        return dict(MODEL)

    monkeypatch.setattr(vision_client, "describe_images", fake_describe)
    monkeypatch.setattr(vision_client, "resolve_vision_model", fake_model)
    return calls


@pytest.fixture
def picture(vision_storage):
    target = vision_storage / "files" / "pic.png"
    target.write_bytes(png_bytes(120, 90))
    return target


def describe_body(question="这画面能用吗", **extra):
    return DescribeRequest(images=[ImageRef(source="material",
                                            storage_key="files/pic.png")],
                           question=question, **extra)


def body_of(response):
    return json.loads(response.body)


# ── capabilities / usage ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_capabilities_returns_200_when_vision_is_unconfigured(
        monkeypatch, wire_database):
    """AC-29：未配置视觉必须 200 + available=false，不能逃逸成 500。"""
    async def unavailable():
        error = AgentVisionError("vision_unavailable")
        error.reason = "provider_not_configured"
        raise error

    monkeypatch.setattr(vision_client, "resolve_vision_model", unavailable)
    response = await router_module.get_capabilities(
        FakeRequest(origin_headers()))
    data = response.data
    assert data["vision"]["available"] is False
    assert data["vision"]["reason"] == "provider_not_configured"
    assert data["vision"]["model"] is None


@pytest.mark.asyncio
async def test_capabilities_exposes_limits_and_no_secrets(fake_vision,
                                                          wire_database):
    """AC-25：不含 api_key、不含视觉产物绝对路径；egress 只有枚举值。"""
    response = await router_module.get_capabilities(
        FakeRequest(origin_headers()), project_id="p1")
    data = response.data
    assert data["vision"]["available"] is True
    assert data["vision"]["model"] == MODEL
    assert data["vision"]["egress"] == capabilities_service.EGRESS
    assert set(data["limits"]) == {
        "max_images_per_call", "max_image_side_px", "max_image_bytes",
        "frame_sample_count", "daily_call_cap", "daily_image_cap",
        "request_timeout_seconds", "cache_ttl_days"}
    payload = json.dumps(data)
    assert "api_key" not in payload
    assert "secret" not in payload
    assert "agent_vision/" not in payload


@pytest.mark.asyncio
async def test_usage_reports_today(fake_vision, wire_database):
    response = await router_module.get_usage(FakeRequest(origin_headers()))
    assert set(response.data) == {"calls", "images", "cached_calls",
                                  "failures", "by_code", "day"}


# ── 闸门 ──────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_describe_without_origin_is_forbidden(vision_storage):
    request = FakeRequest({"content-type": "application/json",
                           "x-tool-call-id": "call-1"})
    with pytest.raises(AgentVisionError) as info:
        await router_module.describe(describe_body(), request)
    assert info.value.error_code == "origin_forbidden"
    assert info.value.status_code == 403


@pytest.mark.asyncio
async def test_describe_requires_call_id(vision_storage):
    request = FakeRequest(
        origin_headers(**{"content-type": "application/json"}))
    with pytest.raises(AgentVisionError) as info:
        await router_module.describe(describe_body(), request)
    assert info.value.error_code == "invalid_call_id"


@pytest.mark.asyncio
async def test_describe_rejects_path_separator_in_call_id(vision_storage):
    request = write_request(**{"x-tool-call-id": "a/../b"})
    with pytest.raises(AgentVisionError) as info:
        await router_module.describe(describe_body(), request)
    assert info.value.error_code == "invalid_call_id"


@pytest.mark.asyncio
async def test_describe_is_disabled_by_the_switch(vision_storage,
                                                  vision_settings):
    vision_settings(enabled=False)
    with pytest.raises(AgentVisionError) as info:
        await router_module.describe(describe_body(), write_request())
    assert info.value.error_code == "vision_disabled"
    details = router_module.error_details(info.value)
    assert details["settings_path"] == "agent_vision"


# ── /describe 主路径 ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_describe_returns_the_observation_contract(
        picture, fake_vision, vision_storage, wire_database):
    response = await router_module.describe(describe_body(), write_request())
    data = response.data
    assert data["verdict"] == "concern"
    assert data["ok"] is True
    assert data["cached"] is False
    assert data["images"] == 1
    assert data["observation_id"]
    assert data["details"]["ui"]["model"] == MODEL
    assert data["details"]["ui"]["source_labels"] == ["素材：pic.png"]
    assert data["details"]["ui"]["thumbs"][0].startswith("data:image/jpeg")
    # 模型可见文本里不能出现 base64（像素只走 details）。
    visible = json.dumps({key: value for key, value in data.items()
                          if key != "details"})
    assert "data:image" not in visible


@pytest.mark.asyncio
async def test_describe_is_idempotent_per_call_id(
        picture, fake_vision, vision_storage, wire_database):
    """AC-09：同一 `x-tool-call-id` 重放不重复计费、返回同一 observation_id。"""
    first = await router_module.describe(describe_body(), write_request())
    second = await router_module.describe(describe_body(), write_request())
    assert first.data["observation_id"] == second.data["observation_id"]
    assert fake_vision["describe"] == 1
    usage = await observation_store.daily_usage(None)
    assert usage["calls"] == 1


@pytest.mark.asyncio
async def test_describe_cache_hit_marks_cached_and_counts_separately(
        picture, fake_vision, vision_storage, wire_database):
    """AC-10：命中缓存时 cached=true，cached_calls+1 而 calls 不再+1。"""
    await router_module.describe(describe_body(), write_request())
    second = await router_module.describe(
        describe_body(), write_request(**{"x-tool-call-id": "call-2"}))
    assert second.data["cached"] is True
    assert fake_vision["describe"] == 1
    usage = await observation_store.daily_usage(None)
    assert usage["calls"] == 1
    assert usage["cached_calls"] == 1


@pytest.mark.asyncio
async def test_describe_daily_call_cap(picture, fake_vision, vision_storage,
                                       vision_settings, wire_database):
    """AC-12：日限用尽 → vision_quota_exceeded。"""
    vision_settings(daily_call_cap=1)
    await observation_store.record_usage({"project_id": None, "calls": 1})
    with pytest.raises(AgentVisionError) as info:
        await router_module.describe(describe_body(), write_request())
    assert info.value.error_code == "vision_quota_exceeded"
    assert "每日上限" in router_module.error_details(info.value)["settings_hint"]


@pytest.mark.asyncio
async def test_describe_too_many_images_is_rejected(picture, vision_storage,
                                                    vision_settings):
    vision_settings(max_images_per_call=1)
    body = DescribeRequest(images=[
        ImageRef(source="material", storage_key="files/pic.png"),
        ImageRef(source="material", storage_key="files/pic.png")])
    with pytest.raises(AgentVisionError) as info:
        await router_module.describe(body, write_request())
    assert info.value.error_code == "invalid_argument"


@pytest.mark.asyncio
async def test_describe_failure_is_persisted_for_memory(
        picture, vision_storage, wire_database, monkeypatch):
    """§4.6：`model_not_multimodal` 要落库 + 计数，避免当日重复试错。"""
    async def failing(images, question, **kwargs):
        raise AgentVisionError("model_not_multimodal")

    async def fake_model():
        return dict(MODEL)

    monkeypatch.setattr(vision_client, "describe_images", failing)
    monkeypatch.setattr(vision_client, "resolve_vision_model", fake_model)
    with pytest.raises(AgentVisionError):
        await router_module.describe(describe_body(), write_request())
    usage = await observation_store.daily_usage(None)
    assert usage["failures"] == 1
    assert usage["by_code"] == {"model_not_multimodal": 1}


# ── /export-inspect ───────────────────────────────────────────────────────


PROBE = {
    "available": True,
    "metadata": {"duration": 10.0, "width": 1920, "height": 1080,
                 "has_audio": True},
    "black": [], "freeze": [], "silence": [],
    "loudness": {"integrated_lufs": -16.0, "true_peak_dbtp": -2.0},
    "issues": [], "skipped": [], "thresholds": {},
}


@pytest.fixture
def composition(vision_storage, monkeypatch):
    target = vision_storage / "static" / "video" / "composed" / "out.mp4"
    target.write_bytes(b"fake-mp4")
    monkeypatch.setattr(
        router_module.image_source, "resolve_composition_path",
        lambda composition_id=None, project_id=None: (target,
                                                      "composition/c1"))
    return target


@pytest.mark.asyncio
async def test_export_inspect_survives_disabled_vision(composition,
                                                       vision_settings,
                                                       wire_database,
                                                       monkeypatch):
    """AC-24：`enabled=false` 时仍返回技术探测结果，`visual` 记进 skipped。"""
    vision_settings(enabled=False, probe_enabled=True)

    async def fake_probe(path, **kwargs):
        return dict(PROBE)

    monkeypatch.setattr(router_module.export_probe, "probe_export", fake_probe)
    body = router_module.ExportInspectRequest(timeline_duration=10.0)
    response = await router_module.inspect_export(body, write_request())
    data = response.data
    assert data["ok"] is True
    assert data["duration_seconds"] == 10.0
    assert data["visual"] if "visual" in data else True
    assert "visual" not in data
    assert "visual:disabled" in data["skipped"]
    assert data["loudness"]["integrated_lufs"] == -16.0


@pytest.mark.asyncio
async def test_export_inspect_honours_probe_enabled_off(composition,
                                                        vision_settings,
                                                        wire_database,
                                                        monkeypatch):
    """`probe_enabled=false` 必须真的不跑探测，且每一项都进 `skipped[]`。

    否则它就是个"配置了但无效"的假开关（P1-5 的同一类缺陷）：用户关掉了
    探测，每次自检仍白烧 5 次 ffmpeg。
    """
    vision_settings(enabled=True, probe_enabled=False)
    calls = []

    async def fake_probe(path, **kwargs):
        calls.append(path)
        return dict(PROBE)

    monkeypatch.setattr(router_module.export_probe, "probe_export", fake_probe)
    # 视觉抽检关掉：这条用例只验证"探测开关真的生效"，不碰 cv2。
    response = await router_module.inspect_export(
        router_module.ExportInspectRequest(visual_spot_check=False),
        write_request())
    data = response.data
    assert calls == []
    assert "probe:disabled" in data["skipped"]
    assert "loudness" in data["skipped"]
    assert data["technical"]["available"] is False
    assert "关闭" in data["next_step"]


@pytest.mark.asyncio
async def test_export_inspect_all_switches_off(composition, vision_settings):
    vision_settings(enabled=False, probe_enabled=False)
    body = router_module.ExportInspectRequest()
    with pytest.raises(AgentVisionError) as info:
        await router_module.inspect_export(body, write_request())
    assert info.value.error_code == "vision_disabled"
    assert info.value.reason == "all_disabled"


@pytest.mark.asyncio
async def test_export_inspect_without_ffmpeg_degrades(composition,
                                                      vision_settings,
                                                      wire_database,
                                                      monkeypatch):
    vision_settings(enabled=False, probe_enabled=True)

    async def missing(path, **kwargs):
        error = AgentVisionError("ffmpeg_unavailable")
        error.skipped = ["metadata", "blackdetect"]
        raise error

    monkeypatch.setattr(router_module.export_probe, "probe_export", missing)
    response = await router_module.inspect_export(
        router_module.ExportInspectRequest(), write_request())
    data = response.data
    assert any(item["code"] == "ffmpeg_unavailable" for item in data["issues"])
    assert data["skipped"][:2] == ["metadata", "blackdetect"]
    assert "FFmpeg" in data["next_step"]


@pytest.mark.asyncio
async def test_export_inspect_composition_missing(composition,
                                                  vision_settings,
                                                  monkeypatch):
    def missing(_composition_id=None, _project_id=None):
        raise router_module.image_source._composition_missing()

    monkeypatch.setattr(
        router_module.image_source, "resolve_composition_path", missing)

    async def fake_probe(path, **kwargs):
        return dict(PROBE)

    monkeypatch.setattr(router_module.export_probe, "probe_export", fake_probe)
    with pytest.raises(AgentVisionError) as info:
        await router_module.inspect_export(
            router_module.ExportInspectRequest(), write_request())
    assert info.value.error_code == "composition_not_found"


# ── /frames ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_frames_builds_a_contact_sheet(fake_vision, vision_storage,
                                             wire_database, monkeypatch):
    from pathlib import Path

    from app.models.agent_vision_models import FramesRequest, FramesSource
    from tests.agent_vision_support import jpeg_bytes

    async def fake_video_path(_kind, **_kwargs):
        return Path("clip.mp4"), "cached_materials/pexels/clip.mp4"

    async def fake_duration(_path):
        return 8.0

    async def fake_frames(_path, _start, _end, _count):
        times = [1.0, 3.0]
        return times, [(moment, jpeg_bytes(320, 180)) for moment in times], []

    monkeypatch.setattr(router_module.image_source, "resolve_video_path",
                        fake_video_path)
    monkeypatch.setattr(router_module.frame_sampler, "video_duration",
                        fake_duration)
    monkeypatch.setattr(router_module.frame_sampler, "sample_frames",
                        fake_frames)
    body = FramesRequest(source=FramesSource(kind="material", id="m1"),
                         start_seconds=0.0, end_seconds=8.0, count=2)
    response = await router_module.review_frames(body, write_request())
    data = response.data
    assert data["sheet"] == {"frame_count": 2, "start": 0.0, "end": 8.0}
    assert data["images"] == 2
    assert data["details"]["ui"]["thumbs"][0].startswith("data:image/jpeg")
    assert data["details"]["ui"]["skipped"] == []


@pytest.mark.asyncio
async def test_frames_without_decodable_frame_is_invalid(
        fake_vision, vision_storage, wire_database, monkeypatch):
    from pathlib import Path

    from app.models.agent_vision_models import FramesRequest, FramesSource

    async def fake_video_path(_kind, **_kwargs):
        return Path("clip.mp4"), "clip.mp4"

    async def fake_duration(_path):
        return 4.0

    async def fake_frames(_path, _start, _end, _count):
        return [1.0], [], ["frame 1 @ 1.00s: no decodable frame"]

    monkeypatch.setattr(router_module.image_source, "resolve_video_path",
                        fake_video_path)
    monkeypatch.setattr(router_module.frame_sampler, "video_duration",
                        fake_duration)
    monkeypatch.setattr(router_module.frame_sampler, "sample_frames",
                        fake_frames)
    body = FramesRequest(source=FramesSource(kind="material", id="m1"))
    with pytest.raises(AgentVisionError) as info:
        await router_module.review_frames(body, write_request())
    assert info.value.error_code == "image_invalid"


# ── 观察分页 / 缓存清空 ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_observation_paging(picture, fake_vision, vision_storage,
                                 wire_database):
    created = await router_module.describe(describe_body(), write_request())
    identifier = created.data["observation_id"]
    page = await router_module.read_observation(
        identifier, FakeRequest(origin_headers()),
        offset=0, max_bytes=4000)
    assert page.data["text"].startswith("字幕压到了主体")
    assert page.data["next_offset"] is None


@pytest.mark.asyncio
async def test_observation_missing_is_404(wire_database):
    with pytest.raises(AgentVisionError) as info:
        await router_module.read_observation(
            "nope", FakeRequest(origin_headers()))
    assert info.value.error_code == "observation_not_found"
    assert info.value.status_code == 404


@pytest.mark.asyncio
async def test_cache_clear_reports_removed(picture, fake_vision, vision_storage,
                                           wire_database):
    await router_module.describe(describe_body(), write_request())
    response = await router_module.clear_cache(
        router_module.CacheClearRequest(project_id=None), write_request())
    assert response.data["removed"] == 1


# ── 路由注册 ──────────────────────────────────────────────────────────────


def test_router_registers_the_seven_endpoints():
    paths = {route.path for route in router_module.router.routes}
    assert paths == {
        "/agent-vision/capabilities",
        "/agent-vision/usage",
        "/agent-vision/describe",
        "/agent-vision/frames",
        "/agent-vision/export-inspect",
        "/agent-vision/observations/{observation_id}",
        "/agent-vision/cache/clear",
    }


def test_main_mounts_the_router_and_the_exception_handler():
    from pathlib import Path

    source = (Path(router_module.__file__).resolve().parents[1] / "main.py"
              ).read_text(encoding="utf-8")
    assert 'agent_vision_router.router, prefix="/api"' in source
    assert "@app.exception_handler(AgentVisionError)" in source


# ── 信封 ──────────────────────────────────────────────────────────────────


def test_error_envelope_has_failure_class_and_request_id():
    error = AgentVisionError("vision_unavailable")
    error.reason = "provider_not_configured"
    envelope = body_of(router_module.error_response(error))
    assert envelope["success"] is False
    assert envelope["error_code"] == "vision_unavailable"
    details = envelope["error_details"]
    assert details["failure_class"] == "configuration"
    assert details["retryable"] is False
    assert details["request_id"]
    assert details["settings_path"] == "agent_vision"


def test_transient_errors_are_retryable():
    details = router_module.error_details(AgentVisionError("model_timeout"))
    assert details["failure_class"] == "transient"
    assert details["retryable"] is True


def test_every_closed_set_code_has_a_status():
    from app.models.agent_vision_models import STATUS

    for code in router_module.SETTINGS_HINTS:
        assert code in STATUS


def test_unsupported_source_is_user_input():
    details = router_module.error_details(
        AgentVisionError("source_unsupported"))
    assert details["failure_class"] == "user_input"


def test_unknown_source_kind_reaches_the_service(vision_storage):
    """`ImageRef` 的 source 是闭集；越界值在模型层就被拒（这里是双保险）。"""
    with pytest.raises(Exception):
        ImageRef(source="dvd")
