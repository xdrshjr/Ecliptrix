"""Agent 技能库 REST 端点（9 个）。

设计基线：docs/plans/agent-steering-and-skills/spec.md §3.3.4。
Origin / `x-tool-call-id` 守卫与错误信封**复用** `agent_toolkit_router` 的
实现（不复制）；本域只把它抛出的 `AgentToolkitError` 换成 `AgentSkillsError`，
这样错误码闭集仍是本域自己的。
"""
from fastapi import APIRouter, Request

from app.models.agent_skills_models import (
    AgentSkillsError,
    DuplicateSkillRequest,
    SetSkillEnabledRequest,
    SkillMarkdownRequest,
)
from app.models.agent_toolkit_models import AgentToolkitError
from app.models.base_models import BaseResponse
from app.routers import agent_toolkit_router as toolkit_guards
from app.services.agent_skills import get_skill_store, limits

router = APIRouter(prefix="/agent-skills", tags=["Agent Skills"])

# 信封形状与 agent_toolkit 完全一致（ErrorResponse + failure_class/retryable）。
error_response = toolkit_guards.error_response


def _translated(error: AgentToolkitError) -> AgentSkillsError:
    return AgentSkillsError(error.error_code, message=error.message,
                            status_code=error.status_code)


def _guard_read(request: Request, call_id: str | None = None) -> str | None:
    """Origin → `x-tool-call-id`（`required` 缺失即 400；`optional` 缺省）。"""
    try:
        toolkit_guards.validate_toolkit_origin(request, write=False)
        return toolkit_guards._call_id(request, required=call_id == "required")
    except AgentToolkitError as error:
        raise _translated(error) from None


def _guard_write(request: Request, *, has_body: bool) -> None:
    """写类：必须带 Origin；有请求体的才要求 JSON（DELETE 不带 content-type）。"""
    try:
        toolkit_guards.validate_toolkit_origin(
            request, write=True, require_json=has_body)
    except AgentToolkitError as error:
        raise _translated(error) from None


def _ok(data: object, message: str = "ok") -> BaseResponse:
    return BaseResponse(success=True, message=message, data=data)


# ── 读 ────────────────────────────────────────────────────────────────────


@router.get("")
async def list_skills(request: Request):
    _guard_read(request)
    records = await get_skill_store().list_skills()
    return _ok({
        "skills": [record.to_summary() for record in records],
        "max_user_skills": limits.MAX_USER_SKILLS,
    })


# 必须先于 `/{skill_id}` 声明，`index` 才不会被当成技能 id（并且它是保留字）。
@router.get("/index")
async def skill_index(request: Request):
    _guard_read(request, call_id="required")
    records, truncated = await get_skill_store().index()
    return _ok({
        "skills": [record.to_index_entry() for record in records],
        "truncated": truncated,
    })


@router.get("/{skill_id}")
async def get_skill(skill_id: str, request: Request):
    # Agent 读带 call id，设置面板读不带：call id 可选，带了则校验形态。
    _guard_read(request, call_id="optional")
    record = await get_skill_store().get_skill(skill_id)
    return _ok(record.to_detail())


# ── 写 ────────────────────────────────────────────────────────────────────


@router.post("/validate")
async def validate_skill(body: SkillMarkdownRequest, request: Request):
    _guard_write(request, has_body=True)
    document = get_skill_store().validate(body.markdown)
    return _ok({"valid": True, **document.to_dict()})


@router.post("")
async def create_skill(body: SkillMarkdownRequest, request: Request):
    _guard_write(request, has_body=True)
    record = await get_skill_store().create(body.markdown)
    return _ok(record.to_detail(), message="created")


@router.put("/{skill_id}")
async def update_skill(skill_id: str, body: SkillMarkdownRequest,
                       request: Request):
    _guard_write(request, has_body=True)
    record = await get_skill_store().update(skill_id, body.markdown)
    return _ok(record.to_detail())


@router.delete("/{skill_id}")
async def delete_skill(skill_id: str, request: Request):
    _guard_write(request, has_body=False)
    await get_skill_store().delete(skill_id)
    return _ok({"id": skill_id, "deleted": True})


@router.post("/{skill_id}/enabled")
async def set_skill_enabled(skill_id: str, body: SetSkillEnabledRequest,
                            request: Request):
    _guard_write(request, has_body=True)
    record = await get_skill_store().set_enabled(skill_id, body.enabled)
    return _ok({"id": record.id, "enabled": record.enabled})


@router.post("/{skill_id}/duplicate")
async def duplicate_skill(skill_id: str, body: DuplicateSkillRequest,
                          request: Request):
    _guard_write(request, has_body=True)
    record = await get_skill_store().duplicate(skill_id, body.new_id)
    return _ok(record.to_detail(), message="created")


def register(app) -> None:
    """Mount the router and its error handler (keeps `main.py` to one call)."""

    @app.exception_handler(AgentSkillsError)
    async def _agent_skills_error_handler(request: Request, exc: AgentSkillsError):
        return error_response(exc)

    app.include_router(router, prefix="/api")
