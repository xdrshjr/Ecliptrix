"""Request/response models for /api/integrations (zero secrets).

NEVER add a field here that carries a credential value. ``value`` is only
populated for ``text`` and ``choice`` fields (identifiers and option names).
"""

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel

FieldKind = Literal["secret", "secret_list", "text", "choice"]
FieldSource = Literal["database", "environment", "default", "none"]
IntegrationSource = Literal["database", "environment", "none"]
VerifyLevel = Literal["free", "handshake", "billed_minimal", "none"]
ProbeOutcome = Literal[
    "ok", "invalid_credentials", "not_entitled", "rate_limited",
    "unreachable", "upstream_error", "unverifiable",
]


class IntegrationFieldPublic(BaseModel):
    name: str
    kind: FieldKind
    required: bool
    configured: bool
    source: FieldSource
    value: Optional[str] = None
    choices: Optional[List[str]] = None
    count: Optional[int] = None
    max_items: Optional[int] = None


class IntegrationPublic(BaseModel):
    id: str
    capabilities: List[str]
    verify_level: VerifyLevel
    usable: bool
    source: IntegrationSource
    fields: List[IntegrationFieldPublic]


class IntegrationListData(BaseModel):
    integrations: List[IntegrationPublic]
    load_failed: bool = False


class IntegrationListResponse(BaseModel):
    success: bool
    data: IntegrationListData


class IntegrationResponse(BaseModel):
    success: bool
    data: IntegrationPublic


class IntegrationSaveRequest(BaseModel):
    """``fields``: omitted = unchanged, ``""``/``null`` = clear that field."""

    fields: Dict[str, Any]


class IntegrationTestData(BaseModel):
    outcome: ProbeOutcome
    verify_level: VerifyLevel
    elapsed_ms: int


class IntegrationTestResponse(BaseModel):
    success: bool
    data: IntegrationTestData
