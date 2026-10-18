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
    "screenshot_unavailable": 422,
    # 策略 / 归属
    "url_forbidden": 403, "robots_disallowed": 403,
    "robots_unavailable": 503, "browser_action_blocked": 403,
    "origin_forbidden": 403, "blocked_repeat": 403,
    "research_disabled": 403, "browser_disabled": 403,
    "downloads_disabled": 403, "network_disabled": 403,
    # 生命周期
    "artifact_not_found": 404,
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
    }),
    "policy": frozenset({
        "url_forbidden", "robots_disallowed", "robots_unavailable",
        "origin_forbidden", "browser_action_blocked", "blocked_repeat",
        "invalid_parameters", "invalid_offset", "invalid_page_size",
        "invalid_project_id", "invalid_call_id", "json_required",
        "unsupported_content_type", "unsupported_media_type",
        "no_sources", "media_validation_failed", "artifact_not_found",
        "artifact_expired", "candidate_expired", "artifact_quota_exceeded",
        "response_too_large", "screenshot_too_large",
        "browser_budget_exceeded", "context_budget_exceeded",
        "redirect_unsupported", "stale_element", "idempotency_conflict",
        "screenshot_unavailable",
    }),
    "transient": frozenset({
        "provider_rate_limited", "research_model_rate_limited",
        "research_model_unavailable", "research_model_timeout",
        "research_model_failed", "research_busy", "upstream_timeout",
        "upstream_error", "source_unavailable", "download_failed",
        "browser_unavailable", "browser_session_lost",
        "cache_integrity_error",
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

MODEL_ERRORS = frozenset(
    key for key in STATUS if key.startswith('research_model_')
) | {'configuration_invalid', 'provider_not_configured'}


class WebResearchError(Exception):
    def __init__(self, error_code, message=None, status_code=None,
                 failure_class=None):
        self.error_code = error_code
        self.message = message or error_code
        self.status_code = status_code or STATUS.get(error_code, 422)
        self.failure_class = (failure_class or
                              failure_class_for(error_code, self.status_code))
        super().__init__(self.message)


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


class BrowserReadRequest(StrictRequest):
    session_id: UUID
    max_bytes: int = Field(default=4000, ge=500, le=8000)
    screenshot: bool = False


class BrowserAction(StrictRequest):
    session_id: UUID
    snapshot_version: int = Field(ge=0)


class ClickAction(BrowserAction):
    action: Literal["click"]
    element_ref: str = Field(min_length=1, max_length=64)


class FillAction(BrowserAction):
    action: Literal["fill"]
    element_ref: str = Field(min_length=1, max_length=64)
    text: str = Field(max_length=256)


class PressAction(BrowserAction):
    action: Literal["press"]
    element_ref: str = Field(min_length=1, max_length=64)
    key: Literal["Enter"]


class ScrollAction(BrowserAction):
    action: Literal["scroll"]
    delta_y: int = Field(ge=-1440, le=1440)


BrowserActRequest = ClickAction | FillAction | PressAction | ScrollAction


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
