"""Agent 技能库的严格请求契约与安全错误（闭集）。

设计基线：docs/plans/agent-steering-and-skills/spec.md §3.3.4。
与 `agent_toolkit_models.py` 同构：`STATUS` / `FAILURE_CLASS` 逐码登记，
新增错误码即新增契约，必须同步 BFF、`src/types/agentSkills.ts` 与测试。
"""
from pydantic import BaseModel, ConfigDict, Field, StrictBool

STATUS = {
    "invalid_skill": 422,
    "invalid_parameters": 422,
    "skill_not_found": 404,
    "skill_exists": 409,
    "builtin_readonly": 403,
    "skill_limit": 409,
    "skill_too_large": 413,
    "origin_forbidden": 403,
    "invalid_call_id": 400,
    # 守卫复用 `validate_ui_origin`，它会在缺 JSON 头时给出 415。
    "json_required": 415,
    "internal_error": 500,
}

FAILURE_CLASS_BY_CODE = {
    "invalid_skill": "user_input",
    "invalid_parameters": "user_input",
    "skill_not_found": "user_input",
    "skill_exists": "user_input",
    "skill_too_large": "user_input",
    "origin_forbidden": "user_input",
    "invalid_call_id": "user_input",
    "json_required": "user_input",
    "builtin_readonly": "policy",
    "skill_limit": "policy",
    "internal_error": "internal",
}


class AgentSkillsError(Exception):
    """本域唯一异常类型；`error_details` 里带 failure_class/retryable。"""

    def __init__(self, error_code: str, message: str | None = None,
                 status_code: int | None = None,
                 failure_class: str | None = None) -> None:
        self.error_code = error_code
        self.message = message or error_code
        self.status_code = status_code or STATUS.get(error_code, 400)
        self.failure_class = (
            failure_class or FAILURE_CLASS_BY_CODE.get(error_code, "user_input"))
        super().__init__(self.message)


class StrictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SkillMarkdownRequest(StrictRequest):
    """创建 / 更新 / 校验共用：长度上限由解析器按字节判定（`skill_too_large`）。"""

    markdown: str


class SetSkillEnabledRequest(StrictRequest):
    enabled: StrictBool


class DuplicateSkillRequest(StrictRequest):
    new_id: str = Field(min_length=1, max_length=64)
