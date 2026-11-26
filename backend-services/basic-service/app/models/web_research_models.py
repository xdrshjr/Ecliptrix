"""网络研究的严格请求契约与安全错误。"""
from typing import Annotated, Any, Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, model_validator

# 逐码登记（AC-40）：未登记的码按 422 处理属于开放映射，正文列出的
# 每个错误码都必须在这里有明确状态，否则 UI 与重试语义会漂移。
STATUS = {
    # 请求 / 参数
    "invalid_parameters": 422, "invalid_offset": 422,
    "invalid_page_size": 422, "invalid_project_id": 422,
    "invalid_call_id": 422, "json_required": 415,
    "no_sources": 422, "media_validation_failed": 422,
    "unsupported_content_type": 422, "unsupported_media_type": 415,
    "redirect_unsupported": 422, "configuration_invalid": 422,
    # 策略 / 归属
    "url_forbidden": 403, "robots_disallowed": 403,
    "robots_unavailable": 503, "browser_action_blocked": 403,
    "origin_forbidden": 403, "blocked_repeat": 403,
    # 出口策略的精确原因（agent-general-assistant §7.3）：四个都是 403，但
    # sticky=false —— 用户改完代理/档位后同一调用可以重试成功（C-1/C-2/C-4）。
    "proxy_config_invalid": 403, "dns_no_answer": 403,
    "dns_answer_non_global": 403, "port_not_allowed": 403,
    "research_disabled": 403, "browser_disabled": 403,
    "downloads_disabled": 403, "network_disabled": 403,
    # 生命周期
    "artifact_not_found": 404, "image_not_found": 404,
    "article_not_found": 404,
    "stale_element": 409, "idempotency_conflict": 409,
    "run_closed": 410, "artifact_expired": 410,
    "candidate_expired": 410, "call_cancelled": 410,
    "browser_session_lost": 410,
    # 体积 / 预算
    "response_too_large": 413, "browser_budget_exceeded": 413,
    "screenshot_too_large": 413, "context_budget_exceeded": 413,
    # 搜索与传输
    "research_busy": 429, "upstream_timeout": 504,
    "upstream_error": 502, "source_unavailable": 502,
    "download_failed": 502, "cache_integrity_error": 502,
    # 搜索供应商
    "provider_not_configured": 503, "provider_rejected": 503,
    "provider_quota_exceeded": 503, "provider_rate_limited": 429,
    "provider_request_invalid": 502,
    "provider_response_too_large": 502, "provider_response_invalid": 502,
    # 浏览器宿主
    "browser_unavailable": 503,
    # 浏览器工作台（agent-browser-workspace §6.3）
    "workspace_unavailable": 503, "workspace_disabled": 403,
    "workspace_locked": 423, "file_chooser_blocked": 403,
    "screenshot_unavailable": 503, "consent_required": 403,
    "consent_denied": 403, "user_in_control": 409, "user_took_over": 409,
    "browser_busy": 429, "tab_crashed": 410, "tab_closed": 410,
    "stale_snapshot": 409, "stale_ref": 409, "element_not_found": 409,
    "element_obscured": 409, "sensitive_field": 422,
    "sensitive_site_blocked": 403, "private_network_blocked": 403,
    "navigation_blocked": 403, "risky_action_denied": 403,
    "risky_action_blocked_autonomous": 403, "handoff_timeout": 408,
    "handoff_cancelled": 409, "tab_limit_reached": 409,
    "action_unsupported_in_isolated": 422, "resource_not_image": 422,
    "resource_too_large": 422, "inline_image_unsupported": 400,
    # 研究模型
    "research_model_rejected": 503,
    "research_model_rate_limited": 429,
    "research_model_unavailable": 502,
    "research_model_failed": 502,
    "research_model_timeout": 504,
    "research_model_response_too_large": 502,
    "research_model_response_invalid": 502,
    "research_model_output_incomplete": 502,
    "research_model_report_invalid": 502,
    # 存储 / 内部
    "artifact_quota_exceeded": 507, "cache_commit_failed": 507,
    "internal_error": 500,
}

# 失败分组是重试与 blocked_repeat 的唯一依据；507 与存储提交失败
# 不得落入 transient（spec §12.3 D-15）。
FAILURE_CLASS = {
    "configuration": frozenset({
        "provider_not_configured", "configuration_invalid",
        "provider_rejected", "provider_quota_exceeded",
        "research_model_rejected", "research_disabled",
        "browser_disabled", "downloads_disabled", "network_disabled",
        "proxy_config_invalid",
        "workspace_unavailable", "workspace_disabled", "workspace_locked",
    }),
    "policy": frozenset({
        "url_forbidden", "robots_disallowed", "robots_unavailable",
        "origin_forbidden", "browser_action_blocked", "blocked_repeat",
        "invalid_parameters", "invalid_offset", "invalid_page_size",
        "invalid_project_id", "invalid_call_id", "json_required",
        "unsupported_content_type", "unsupported_media_type",
        "no_sources", "media_validation_failed", "artifact_not_found",
        "image_not_found", "inline_image_unsupported",
        "article_not_found",
        "artifact_expired", "candidate_expired", "artifact_quota_exceeded",
        "response_too_large", "screenshot_too_large",
        "browser_budget_exceeded", "context_budget_exceeded",
        "redirect_unsupported", "stale_element", "idempotency_conflict",
        # 工作台策略类（§6.3）：sticky 者见 NON_STICKY_CODES 之外的子集。
        "file_chooser_blocked", "consent_required", "consent_denied",
        "sensitive_field", "sensitive_site_blocked",
        "private_network_blocked", "navigation_blocked",
        "risky_action_denied", "risky_action_blocked_autonomous",
        "tab_limit_reached", "action_unsupported_in_isolated",
        "resource_not_image", "resource_too_large",
        # DNS 答复被档位拒绝 / 端口未放行：策略失败，但**不**永久封禁（sticky=false）。
        "dns_no_answer", "dns_answer_non_global", "port_not_allowed",
    }),
    "transient": frozenset({
        "provider_rate_limited", "research_model_rate_limited",
        "research_model_unavailable", "research_model_timeout",
        "research_model_failed", "research_busy", "upstream_timeout",
        "upstream_error", "source_unavailable", "download_failed",
        "browser_unavailable", "browser_session_lost",
        "cache_integrity_error",
        "screenshot_unavailable", "user_in_control", "user_took_over",
        "browser_busy", "tab_crashed", "tab_closed", "stale_snapshot",
        "stale_ref", "element_not_found", "element_obscured",
        "handoff_timeout", "handoff_cancelled",
    }),
    "cancelled": frozenset({"run_closed", "call_cancelled"}),
    "internal": frozenset({
        "provider_request_invalid", "provider_response_too_large",
        "provider_response_invalid", "research_model_response_too_large",
        "research_model_response_invalid",
        "research_model_output_incomplete",
        "research_model_report_invalid", "internal_error",
        "cache_commit_failed",
    }),
}
FAILURE_CLASS_BY_CODE = {code: name for name, codes in FAILURE_CLASS.items()
                         for code in codes}


def failure_class_for(code, status_code=None):
    """逐码分组；未登记码落在 policy（不重试、可 blocked_repeat）。

    刻意不看状态码：`>= 500 → transient` 的兜底会把 507 与存储提交失败
    误判为可重试并绕过 blocked_repeat（spec §12.3 D-15）。新增码必须显式
    登记到 FAILURE_CLASS，AC-40 逐码断言。
    """
    return FAILURE_CLASS_BY_CODE.get(code, "policy")

# 工作台新码里 sticky=false 的全部码（§6.3 sticky 列）；老码保持
# `sticky=True` 默认不变。sticky 的只有 consent_*、站点/私网/导航拦截、risky_action_denied。
NON_STICKY_CODES = frozenset({
    "file_chooser_blocked", "sensitive_field",
    "risky_action_blocked_autonomous", "tab_limit_reached",
    "action_unsupported_in_isolated", "resource_not_image",
    "resource_too_large", "workspace_unavailable", "workspace_disabled",
    "workspace_locked", "screenshot_unavailable", "user_in_control",
    "user_took_over", "browser_busy", "tab_crashed", "tab_closed",
    "stale_snapshot", "stale_ref", "element_not_found", "element_obscured",
    "handoff_timeout", "handoff_cancelled",
    "article_not_found"})

MODEL_ERRORS = frozenset(
    key for key in STATUS if key.startswith('research_model_')
) | {'configuration_invalid', 'provider_not_configured'}


class WebResearchError(Exception):
    def __init__(self, error_code, message=None, status_code=None,
                 failure_class=None, reason=None, layer=None, sticky=None,
                 remediation=None, details=None):
        self.error_code = error_code
        self.message = message or error_code
        self.status_code = status_code or STATUS.get(error_code, 422)
        self.failure_class = (failure_class or
                              failure_class_for(error_code, self.status_code))
        self.sticky = (error_code not in NON_STICKY_CODES
                       if sticky is None else bool(sticky))
        self.reason = reason
        self.layer = layer
        self.remediation = remediation
        self.details = details or {}
        super().__init__(self.message)

    def sticky_failure(self):
        """是否值得写进 `run.blocked`（永久拒绝同一调用）。"""
        return self.sticky


class StrictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class WebSearchRequest(StrictRequest):
    query: str = Field(min_length=1, max_length=512)
    max_results: int = Field(default=5, ge=1, le=8)
    search_depth: Literal["basic", "advanced"] = "basic"
    include_images: bool = False


class WebFetchRequest(StrictRequest):
    """抓取一次即固化；offset>0 必须指向既有 artifact（spec D-02 / AC-34）。"""
    url: str | None = Field(default=None, max_length=4096)
    artifact_id: UUID | None = None
    output_format: Literal["text", "markdown", "metadata"] = "text"
    max_bytes: int = Field(default=4000, ge=500, le=8000)
    max_length: int | None = Field(default=None, ge=500, le=12000)
    offset: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def one_source(self):
        if bool(self.url) == bool(self.artifact_id):
            raise ValueError("exactly_one_source_required")
        if self.offset and not self.artifact_id:
            raise ValueError("offset_requires_artifact")
        return self

    @model_validator(mode="after")
    def legacy_length(self):
        if "max_bytes" not in self.model_fields_set and self.max_length:
            self.max_bytes = min(self.max_length, 8000)
        return self


class WebExtractImagesRequest(StrictRequest):
    url: str | None = Field(default=None, max_length=4096)
    session_id: UUID | None = None
    max_images: int = Field(default=8, ge=1, le=12)
    min_width: int = Field(default=0, ge=0, le=4096)

    @model_validator(mode="after")
    def one_source(self):
        if bool(self.url) == bool(self.session_id):
            raise ValueError("exactly_one_source_required")
        return self


class WebDownloadRequest(StrictRequest):
    kind: Literal["image", "media"]
    candidate_id: UUID | None = None
    url: str | None = Field(default=None, max_length=4096)
    name: str | None = Field(default=None, max_length=120)
    source_page_url: str | None = Field(default=None, max_length=4096)

    @model_validator(mode="after")
    def one_source(self):
        if bool(self.url) == bool(self.candidate_id):
            raise ValueError("exactly_one_source_required")
        return self


class WebResearchRequest(StrictRequest):
    topic: str = Field(min_length=1, max_length=512)
    questions: list[Annotated[str, Field(max_length=256)]] = Field(
        default_factory=list, max_length=5)
    max_sources: int = Field(default=4, ge=2, le=5)
    focus: str | None = Field(default=None, max_length=256)


class RunRequest(StrictRequest):
    project_id: UUID | None = None
    remaining_ms: int = Field(ge=1, le=7200000)


class CredentialsRequest(StrictRequest):
    tavily_api_keys: list[Annotated[str, Field(min_length=1, max_length=512)]] = Field(max_length=5)


class BrowserOpenRequest(StrictRequest):
    url: str = Field(min_length=1, max_length=4096)
    new_tab: bool = False


class BrowserReadRequest(StrictRequest):
    session_id: UUID
    max_bytes: int = Field(default=4000, ge=500, le=8000)
    screenshot: bool = False
    elements_max: int | None = Field(default=None, ge=20, le=120)
    images: bool = False
    images_max: int = Field(default=40, ge=20, le=100)
    article: bool = False
    article_from: int = Field(default=0, ge=0, le=399)
    article_blocks: int = Field(default=12, ge=1, le=40)


class BrowserSaveImageRequest(StrictRequest):
    """保存页面图片：只接受 `image_id` 闭集，绝不接受裸 URL（spec §2.2 第 3 条）。

    schema 的 `pattern` 只挡形状（`i1`…`i99`），归属由后端 `TabEntry.images`
    闭集校验。两层各自可验证，任何一层都不单独承担 SSRF 防护（spec AC-I4）。
    """
    image_id: str = Field(pattern=r"^i[1-9][0-9]?$")
    name: str | None = Field(default=None, max_length=80)
    snapshot_version: int | None = Field(default=None, ge=1)


class BrowserAction(StrictRequest):
    session_id: UUID
    snapshot_version: int = Field(ge=0)


class ClickAction(BrowserAction):
    action: Literal["click"]
    element_ref: str = Field(min_length=1, max_length=64)


class FillAction(BrowserAction):
    action: Literal["fill"]
    element_ref: str = Field(min_length=1, max_length=64)
    text: str = Field(max_length=512)


PRESS_KEYS = Literal["Enter", "Tab", "Escape", "ArrowUp", "ArrowDown",
                     "ArrowLeft", "ArrowRight", "PageUp", "PageDown",
                     "Home", "End", "Space"]


class PressAction(BrowserAction):
    action: Literal["press"]
    element_ref: str | None = Field(default=None, min_length=1, max_length=64)
    key: PRESS_KEYS


class ScrollAction(BrowserAction):
    action: Literal["scroll"]
    delta_y: int = Field(ge=-1440, le=1440)


class SelectAction(BrowserAction):
    action: Literal["select"]
    element_ref: str = Field(min_length=1, max_length=64)
    option_text: str | None = Field(default=None, max_length=256)
    value: str | None = Field(default=None, max_length=256)

    @model_validator(mode="after")
    def one_choice(self):
        if bool(self.option_text) == bool(self.value):
            raise ValueError("exactly_one_of_option_text_or_value")
        return self


class HoverAction(BrowserAction):
    action: Literal["hover"]
    element_ref: str = Field(min_length=1, max_length=64)


class BrowserSessionAction(StrictRequest):
    """back/forward/reload/wait 不依赖元素引用，snapshot_version 可省略。"""
    session_id: UUID
    snapshot_version: int | None = Field(default=None, ge=0)


class BackAction(BrowserSessionAction):
    action: Literal["back"]


class ForwardAction(BrowserSessionAction):
    action: Literal["forward"]


class ReloadAction(BrowserSessionAction):
    action: Literal["reload"]


class WaitAction(BrowserSessionAction):
    action: Literal["wait"]
    ms: int | None = Field(default=None, ge=0, le=5000)
    until_text: str | None = Field(default=None, min_length=1, max_length=80)
    until_gone_text: str | None = Field(default=None, min_length=1,
                                        max_length=80)
    timeout_ms: int = Field(default=10000, ge=0, le=15000)

    @model_validator(mode="after")
    def one_condition(self):
        chosen = [v is not None for v in
                  (self.ms, self.until_text, self.until_gone_text)]
        if sum(chosen) != 1:
            raise ValueError("exactly_one_wait_condition_required")
        return self


BrowserActRequest = (ClickAction | FillAction | PressAction | ScrollAction |
                     SelectAction | HoverAction | BackAction | ForwardAction |
                     ReloadAction | WaitAction)
# isolated 沙盒浏览器只认老四件；其余动作 → action_unsupported_in_isolated。
ISOLATED_ACTIONS = frozenset({"click", "fill", "press", "scroll"})


class BrowserRequestUserRequest(StrictRequest):
    reason: str = Field(min_length=1, max_length=200)
    kind: Literal["login", "captcha", "confirm", "other"]
    handoff_id: UUID | None = None
    timeout_s: int = Field(default=120, ge=10, le=120)


# 保留草稿的公开响应类名，服务内部使用相同 JSON 数据。
class WebSearchResultItem(BaseModel):
    title: str = ""
    url: str
    domain: str = ""
    snippet: str = ""
    source_id: str = ""
    score: float | None = None


class WebSearchData(BaseModel):
    configured: bool = True
    results: list[dict] = Field(default_factory=list)
    images: list[dict] = Field(default_factory=list)
    sources: list[dict] = Field(default_factory=list)
    artifact_id: str | None = None


class WebFetchData(BaseModel):
    model_config = ConfigDict(extra="allow")
    url: str = ""
    final_url: str = ""
    title: str = ""
    content: str = ""
    artifact_id: str | None = None
    source_id: str = ""
    next_offset: int | None = None
    truncated: bool = False
    js_page_suspected: bool = False


class WebImageCandidate(BaseModel):
    model_config = ConfigDict(extra="allow")
    image_url: str = ""
    url: str = ""
    alt: str = ""
    width: int | None = None
    height: int | None = None
    candidate_id: str = ""
    source_page_url: str = ""
    license_status: str = "unknown"


class WebExtractImagesData(BaseModel):
    images: list[WebImageCandidate] = Field(default_factory=list)


class WebMaterialData(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    name: str
    type: Literal["image", "video", "audio"]
    format: str = ""
    size: int = 0
    local_url: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class WebDownloadData(BaseModel):
    material: WebMaterialData
    status: str = "ready"
    reused: bool = False


class WebResearchSource(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str = ""
    url: str
    title: str = ""
    domain: str = ""


class ResearchReportSource(BaseModel):
    id: str = ""
    url: str = ""
    final_url: str | None = None
    title: str = ""
    domain: str = ""
    retrieved_at: str | None = None
    published_at: str | None = None
    author: str | None = None
    license_status: Literal["unknown", "declared"] = "unknown"
    license_url: str | None = None
    evidence_kind: Literal[
        "page_text", "search_snippet", "unavailable"
    ] | None = None
    fetch_error_code: str | None = None

    def __getitem__(self, key):
        return getattr(self, key)

    def get(self, key, default=None):
        return getattr(self, key, default)


class ResearchReportFact(BaseModel):
    text: str
    source_ids: list[str]
    evidence_kind: Literal["page_text", "includes_snippet"] | None = None

    def __getitem__(self, key):
        return getattr(self, key)


class ResearchCoverage(StrictRequest):
    selected: int = Field(ge=0, le=5, strict=True)
    page_text: int = Field(ge=0, le=5, strict=True)
    search_snippet: int = Field(ge=0, le=5, strict=True)
    unavailable: int = Field(ge=0, le=5, strict=True)

    @model_validator(mode="after")
    def consistent_counts(self):
        if (
            self.selected
            != self.page_text + self.search_snippet + self.unavailable
        ):
            raise ValueError("invalid_coverage")
        return self


class ResearchModelStage(StrictRequest):
    status: Literal["disabled", "skipped", "succeeded", "failed"]
    attempts: int = Field(default=0, ge=0, le=2, strict=True)
    model_name: str | None = None
    error_code: str | None = None
    reason: Literal[
        "no_sources",
        "insufficient_time",
        "prior_stage_failed",
        "context_budget",
    ] | None = None

    @model_validator(mode="after")
    def consistent_stage(self):
        if self.attempts > 0:
            if (
                not self.model_name
                or len(self.model_name.encode("utf-8")) > 256
            ):
                raise ValueError("invalid_model_name")
        elif self.model_name is not None:
            raise ValueError("invalid_model_name")
        if not self._valid_status():
            raise ValueError("invalid_model_stage")
        return self

    def _valid_status(self):
        if self.status == "disabled":
            return (
                self.attempts == 0
                and self.error_code is None
                and self.reason is None
            )
        elif self.status == "skipped":
            return (
                self.attempts == 0
                and self.error_code is None
                and self.reason is not None
            )
        elif self.status == "succeeded":
            return (
                self.attempts > 0
                and self.error_code is None
                and self.reason is None
            )
        return self._valid_failure()

    def _valid_failure(self):
        if self.reason is not None or self.error_code not in MODEL_ERRORS:
            return False
        return self.attempts > 0 or self.error_code in {
            "configuration_invalid",
            "provider_not_configured",
        }


class ResearchModelUsage(StrictRequest):
    query: ResearchModelStage
    synthesis: ResearchModelStage

    @model_validator(mode="after")
    def valid_attempts(self):
        if self.query.attempts > 1:
            raise ValueError("invalid_query_attempts")
        if self.synthesis.status == "failed" and self.synthesis.attempts == 0:
            raise ValueError("invalid_synthesis_attempts")
        return self


class WebResearchData(BaseModel):
    brief: str
    facts: list[ResearchReportFact] = Field(default_factory=list)
    uncertainties: list[str] = Field(default_factory=list)
    sources: list[ResearchReportSource] = Field(default_factory=list)
    artifact_id: str | None = None
    elapsed_ms: int = 0
    degraded: str | None = None
    model_used: str | None = None
    quality: Literal[
        "full_text", "mixed", "snippets_only", "none"
    ] | None = None
    coverage: ResearchCoverage | None = None
    model_usage: ResearchModelUsage | None = None

    @model_validator(mode="after")
    def consistent_report(self):
        if self.quality is None:
            return self
        if self.coverage is None or self.model_usage is None:
            raise ValueError("missing_research_metadata")
        counts = {
            kind: sum(item.evidence_kind == kind for item in self.sources)
            for kind in ("page_text", "search_snippet", "unavailable")
        }
        if self.coverage.model_dump() != {
            "selected": len(self.sources),
            **counts,
        }:
            raise ValueError("invalid_source_coverage")
        if self.quality != self._expected_quality(counts):
            raise ValueError("invalid_source_quality")
        self._validate_fact_sources()
        synthesis = self.model_usage.synthesis
        expected_model = (
            synthesis.model_name if synthesis.status == "succeeded" else None
        )
        if self.model_used != expected_model:
            raise ValueError("invalid_model_used")
        return self

    def _expected_quality(self, counts):
        if counts["unavailable"] == len(self.sources):
            return "none"
        if counts["page_text"] == len(self.sources):
            return "full_text"
        return "snippets_only" if counts["page_text"] == 0 else "mixed"

    def _validate_fact_sources(self):
        kinds = {item.id: item.evidence_kind for item in self.sources}
        if len(kinds) != len(self.sources) or any(not key for key in kinds):
            raise ValueError("invalid_source_ids")
        for fact in self.facts:
            self._validate_fact_kind(fact, kinds)

    @staticmethod
    def _validate_fact_kind(fact, kinds):
        ids = fact.source_ids
        if (
            not ids
            or len(ids) > 5
            or len(set(ids)) != len(ids)
            or any(
                kinds.get(key) not in {"page_text", "search_snippet"}
                for key in ids
            )
        ):
            raise ValueError("invalid_fact_sources")
        expected = (
            "includes_snippet"
            if any(kinds[key] == "search_snippet" for key in ids)
            else "page_text"
        )
        if fact.evidence_kind != expected:
            raise ValueError("invalid_fact_evidence_kind")
