"""REST 端点：守卫矩阵、错误信封、builtin_readonly、validate 不落盘。

覆盖 spec agent-steering-and-skills AC-B2/B3/B4/B11 与评审 R-10/R-20。
端点函数直接调用（同 test_agent_toolkit_router 的做法），闸门只看 headers。
"""
import json
from pathlib import Path

import pytest

from app.models.agent_skills_models import (
    DuplicateSkillRequest,
    SetSkillEnabledRequest,
    SkillMarkdownRequest,
    STATUS,
)
from app.models.agent_skills_models import AgentSkillsError
from app.routers import agent_skills_router as router_module
from app.services.agent_skills.store import SkillStore
from tests.agent_toolkit_support import FakeRequest, origin_headers

BUILTIN_ROOT = (Path(__file__).resolve().parent.parent
                / "app" / "services" / "agent_skills" / "builtin")
SKILL = ("---\nid: my-skill\nname: 我的技能\ndescription: 一个技能\n"
         "tools: [search_video]\n---\n步骤一。")


@pytest.fixture
def user_root(tmp_path):
    return tmp_path / "agent_skills"


@pytest.fixture(autouse=True)
def isolated_store(monkeypatch, user_root):
    store = SkillStore(BUILTIN_ROOT, user_root, scan_ttl=0)
    monkeypatch.setattr(router_module, "get_skill_store", lambda: store)
    return store


def json_request(**extra):
    return FakeRequest(origin_headers(**{
        "content-type": "application/json", **extra}))


def read_request(**extra):
    return FakeRequest(origin_headers(**extra))


def envelope_of(error):
    return json.loads(router_module.error_response(error).body)


async def error_of(awaitable):
    with pytest.raises(AgentSkillsError) as info:
        await awaitable
    return info.value


# ── 读端点与守卫 ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_management_list_needs_only_origin():
    response = await router_module.list_skills(read_request())
    skills = response.data["skills"]
    assert len(skills) == 7 and all(s["builtin"] for s in skills)
    assert set(skills[0]) >= {
        "id", "name", "description", "version", "tools", "requires",
        "builtin", "enabled", "valid", "shadowed", "problem", "body_chars",
        "updated_at"}


@pytest.mark.asyncio
async def test_index_requires_call_id_and_returns_entries():
    error = await error_of(router_module.skill_index(read_request()))
    assert error.error_code == "invalid_call_id" and error.status_code == 400

    response = await router_module.skill_index(
        read_request(**{"x-tool-call-id": "call-1"}))
    assert response.data["truncated"] is False
    assert {e["id"] for e in response.data["skills"]} == {
        "explainer-video", "storyboard-short", "quick-assemble",
        "news-digest-video", "web-footage-sourcing", "final-qc-and-export",
        "parallel-sourcing"}
    assert set(response.data["skills"][0]) == {
        "id", "name", "description", "requires", "builtin"}


@pytest.mark.asyncio
async def test_get_skill_call_id_is_optional_but_validated():
    ok = await router_module.get_skill("explainer-video", read_request())
    assert ok.data["markdown"].startswith("---") and ok.data["body"]
    with_id = await router_module.get_skill(
        "explainer-video", read_request(**{"x-tool-call-id": "call-9"}))
    assert with_id.data["id"] == "explainer-video"
    error = await error_of(router_module.get_skill(
        "explainer-video", read_request(**{"x-tool-call-id": "../x"})))
    assert error.error_code == "invalid_call_id"


@pytest.mark.asyncio
async def test_get_unknown_skill_and_bad_id_codes():
    missing = await error_of(router_module.get_skill(
        "ghost-skill", read_request()))
    assert (missing.error_code, missing.status_code) == ("skill_not_found", 404)
    bad = await error_of(router_module.get_skill("../x", read_request()))
    assert (bad.error_code, bad.status_code) == ("invalid_parameters", 422)


@pytest.mark.asyncio
async def test_cross_site_and_foreign_origin_are_forbidden():
    foreign = FakeRequest({"origin": "http://evil.example"})
    cross = FakeRequest(origin_headers(**{"sec-fetch-site": "cross-site"}))
    for request in (foreign, cross):
        error = await error_of(router_module.list_skills(request))
        assert (error.error_code, error.status_code) == ("origin_forbidden", 403)


# ── 写端点守卫矩阵（R-10）──────────────────────────────────────────────


BODY = SkillMarkdownRequest(markdown=SKILL)


@pytest.mark.asyncio
async def test_write_without_origin_is_forbidden():
    request = FakeRequest({"content-type": "application/json"})
    error = await error_of(router_module.create_skill(BODY, request))
    assert (error.error_code, error.status_code) == ("origin_forbidden", 403)


@pytest.mark.asyncio
async def test_write_with_body_requires_json_content_type():
    error = await error_of(router_module.create_skill(
        BODY, FakeRequest(origin_headers())))
    assert (error.error_code, error.status_code) == ("json_required", 415)


@pytest.mark.asyncio
async def test_delete_without_content_type_passes_the_guard():
    await router_module.create_skill(BODY, json_request())
    response = await router_module.delete_skill(
        "my-skill", FakeRequest(origin_headers()))
    assert response.data == {"id": "my-skill", "deleted": True}


@pytest.mark.asyncio
async def test_delete_without_origin_is_forbidden():
    error = await error_of(router_module.delete_skill("my-skill", FakeRequest()))
    assert error.error_code == "origin_forbidden"


# ── CRUD 全链路 ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_full_user_skill_lifecycle():
    created = await router_module.create_skill(BODY, json_request())
    assert created.data["builtin"] is False and created.data["tools"] == [
        "search_video"]

    again = await error_of(router_module.create_skill(BODY, json_request()))
    assert (again.error_code, again.status_code) == ("skill_exists", 409)

    changed = SkillMarkdownRequest(markdown=SKILL.replace("步骤一", "步骤二"))
    updated = await router_module.update_skill("my-skill", changed, json_request())
    assert "步骤二" in updated.data["body"]

    toggled = await router_module.set_skill_enabled(
        "my-skill", SetSkillEnabledRequest(enabled=False), json_request())
    assert toggled.data == {"id": "my-skill", "enabled": False}
    index = await router_module.skill_index(
        read_request(**{"x-tool-call-id": "c1"}))
    assert "my-skill" not in {e["id"] for e in index.data["skills"]}

    copy = await router_module.duplicate_skill(
        "my-skill", DuplicateSkillRequest(new_id="my-skill-copy"),
        json_request())
    assert copy.data["id"] == "my-skill-copy"

    await router_module.delete_skill("my-skill", read_request())
    listing = await router_module.list_skills(read_request())
    assert "my-skill" not in {s["id"] for s in listing.data["skills"]}
    assert "my-skill-copy" in {s["id"] for s in listing.data["skills"]}


@pytest.mark.asyncio
async def test_builtin_modification_and_deletion_are_forbidden():
    update = await error_of(router_module.update_skill(
        "explainer-video", SkillMarkdownRequest(
            markdown=SKILL.replace("my-skill", "explainer-video")),
        json_request()))
    assert (update.error_code, update.status_code) == ("builtin_readonly", 403)
    delete = await error_of(router_module.delete_skill(
        "explainer-video", read_request()))
    assert (delete.error_code, delete.status_code) == ("builtin_readonly", 403)


@pytest.mark.asyncio
async def test_builtin_can_be_disabled_and_duplicated():
    toggled = await router_module.set_skill_enabled(
        "explainer-video", SetSkillEnabledRequest(enabled=False), json_request())
    assert toggled.data["enabled"] is False
    copy = await router_module.duplicate_skill(
        "explainer-video", DuplicateSkillRequest(new_id="my-explainer"),
        json_request())
    assert copy.data["builtin"] is False


@pytest.mark.asyncio
async def test_traversal_ids_are_invalid_parameters_and_leave_no_files(user_root):
    for bad in ("../x", "..\\x", "a/b", "con", "index"):
        error = await error_of(router_module.update_skill(
            bad, BODY, json_request()))
        assert (error.error_code, error.status_code) == (
            "invalid_parameters", 422)
        error = await error_of(router_module.delete_skill(bad, read_request()))
        assert error.error_code == "invalid_parameters"
    assert not user_root.exists()


# ── validate ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_validate_returns_parse_result_and_writes_nothing(user_root):
    response = await router_module.validate_skill(BODY, json_request())
    data = response.data
    assert data["valid"] is True and data["id"] == "my-skill"
    assert data["tools"] == ["search_video"] and data["warnings"] == []
    assert not user_root.exists()


@pytest.mark.asyncio
@pytest.mark.parametrize("reserved", ["index", "validate", "con", "com1"])
async def test_validate_rejects_reserved_ids(reserved, user_root):
    body = SkillMarkdownRequest(markdown=SKILL.replace("my-skill", reserved))
    error = await error_of(router_module.validate_skill(body, json_request()))
    assert (error.error_code, error.status_code) == ("invalid_skill", 422)
    assert not user_root.exists()


# ── 信封 ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_error_envelope_shape_and_every_code_is_registered():
    error = await error_of(router_module.get_skill("ghost-skill", read_request()))
    body = envelope_of(error)
    assert body["success"] is False and body["error_code"] == "skill_not_found"
    assert body["error_details"]["failure_class"] == "user_input"
    assert body["error_details"]["retryable"] is False
    assert body["error_details"]["request_id"]

    policy = envelope_of(AgentSkillsError("builtin_readonly"))
    assert policy["error_details"]["failure_class"] == "policy"
    internal = envelope_of(AgentSkillsError("internal_error"))
    assert internal["error_details"]["failure_class"] == "internal"
    assert set(STATUS) == {
        "invalid_skill", "invalid_parameters", "skill_not_found",
        "skill_exists", "builtin_readonly", "skill_limit", "skill_too_large",
        "origin_forbidden", "invalid_call_id", "json_required",
        "internal_error"}


def test_router_registers_index_before_the_id_route():
    paths = [route.path for route in router_module.router.routes
             if "GET" in getattr(route, "methods", set())]
    assert paths.index("/agent-skills/index") < paths.index(
        "/agent-skills/{skill_id}")


# ── register(app)：main.py 只剩一行调用，这里证明它真的把路由与异常处理器挂上 ──

def test_register_mounts_routes_and_maps_skill_errors_to_the_envelope():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    router_module.register(app)
    client = TestClient(app, raise_server_exceptions=False)

    paths = {route.path for route in app.routes}
    assert "/api/agent-skills/index" in paths
    assert "/api/agent-skills/{skill_id}" in paths

    origin = "http://localhost:3000"
    ok = client.get("/api/agent-skills/index",
                    headers={"Origin": origin, "x-tool-call-id": "call-1"})
    assert ok.status_code == 200
    assert ok.json()["data"]["skills"]

    # An AgentSkillsError raised inside an endpoint reaches the registered handler
    # and becomes the closed-set envelope, not a 500.
    missing = client.get("/api/agent-skills/no-such-skill",
                         headers={"Origin": origin, "x-tool-call-id": "call-2"})
    assert missing.status_code == 404
    assert missing.json()["error_code"] == "skill_not_found"
