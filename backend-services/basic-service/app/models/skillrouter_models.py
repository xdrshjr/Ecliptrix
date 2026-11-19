"""Request/response models for /api/skillrouter (zero secrets).

NEVER add a field that carries the gateway key: only ``keyConfigured`` and the
masked ``keyHint`` (last four characters) may describe it.
"""

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

ModeLiteral = Literal["manual", "router"]
ModeStateLiteral = Literal["unset", "manual", "router"]
ProtocolLiteral = Literal["openai", "anthropic"]
VerifyOutcome = Literal[
    "ok", "invalid_credentials", "unreachable", "upstream_error", "unverifiable",
]


class SkillRouterUpdateRequest(BaseModel):
    """Patch semantics: omitted = unchanged, ``""``/``null`` = clear where allowed."""

    model_config = ConfigDict(populate_by_name=True, protected_namespaces=())

    mode: Optional[ModeLiteral] = None
    api_key: Optional[str] = Field(default=None, alias="apiKey")
    base_url: Optional[str] = Field(default=None, alias="baseUrl")
    manual_capabilities: Optional[List[str]] = Field(default=None, alias="manualCapabilities")
    slot_models: Optional[Dict[str, str]] = Field(default=None, alias="slotModels")
    slot_protocols: Optional[Dict[str, ProtocolLiteral]] = Field(default=None, alias="slotProtocols")


class SkillRouterVerifyRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    api_key: Optional[str] = Field(default=None, alias="apiKey")
    base_url: Optional[str] = Field(default=None, alias="baseUrl")


class SkillRouterTestSlotRequest(BaseModel):
    slot: str


class LastVerified(BaseModel):
    ok: bool
    at: int
    outcome: str


class SkillRouterStatus(BaseModel):
    model_config = ConfigDict(populate_by_name=True, protected_namespaces=())

    mode: ModeLiteral
    modeState: ModeStateLiteral
    baseUrl: str
    keyConfigured: bool
    keyHint: Optional[str] = None
    enabled: bool = True
    manualCapabilities: List[str] = []
    slotModels: Dict[str, str] = {}
    defaults: Dict[str, str] = {}
    lastVerified: Optional[LastVerified] = None
    revision: str


class SkillRouterStatusResponse(BaseModel):
    success: bool
    data: SkillRouterStatus


class VerifyCapability(BaseModel):
    id: str
    available: bool
    unavailableReason: Optional[str] = None
    quota: Optional[Dict[str, Any]] = None


class VerifyCoverage(BaseModel):
    routed: List[str]
    manualOnly: List[str]


class SkillRouterVerifyData(BaseModel):
    outcome: VerifyOutcome
    latencyMs: int
    capabilities: List[VerifyCapability] = []
    coverage: VerifyCoverage


class SkillRouterVerifyResponse(BaseModel):
    success: bool
    data: SkillRouterVerifyData


class SkillRouterCatalogData(BaseModel):
    models: List[Dict[str, Any]]
    capabilities: List[Dict[str, Any]]
    defaults: Dict[str, str]
    stale: bool
    fetchedAt: Optional[float] = None
    error: Optional[str] = None


class SkillRouterCatalogResponse(BaseModel):
    success: bool
    data: SkillRouterCatalogData


class SkillRouterUsageResponse(BaseModel):
    success: bool
    data: Dict[str, Any]


class SkillRouterTestSlotData(BaseModel):
    ok: bool
    message: str
    latencyMs: Optional[int] = None
    model: Optional[str] = None


class SkillRouterTestSlotResponse(BaseModel):
    success: bool
    data: SkillRouterTestSlotData
