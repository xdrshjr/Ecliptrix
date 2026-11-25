"""§6.3 新错误码全部登记且语义（HTTP/class/sticky）与表一致。"""
import pytest

from app.models.web_research_models import (
    FAILURE_CLASS_BY_CODE, STATUS, WebResearchError)

# code: (http, class, sticky)
SPEC = {
    "workspace_unavailable": (503, "configuration", False),
    "workspace_disabled": (403, "configuration", False),
    "workspace_locked": (423, "configuration", False),
    "file_chooser_blocked": (403, "policy", False),
    "screenshot_unavailable": (503, "transient", False),
    "consent_required": (403, "policy", True),
    "consent_denied": (403, "policy", True),
    "user_in_control": (409, "transient", False),
    "user_took_over": (409, "transient", False),
    "browser_busy": (429, "transient", False),
    "tab_crashed": (410, "transient", False),
    "tab_closed": (410, "transient", False),
    "stale_snapshot": (409, "transient", False),
    "stale_ref": (409, "transient", False),
    "element_not_found": (409, "transient", False),
    "element_obscured": (409, "transient", False),
    "sensitive_field": (422, "policy", False),
    "sensitive_site_blocked": (403, "policy", True),
    "private_network_blocked": (403, "policy", True),
    "navigation_blocked": (403, "policy", True),
    "risky_action_denied": (403, "policy", True),
    "risky_action_blocked_autonomous": (403, "policy", False),
    "handoff_timeout": (408, "transient", False),
    "handoff_cancelled": (409, "transient", False),
    "tab_limit_reached": (409, "policy", False),
    "action_unsupported_in_isolated": (422, "policy", False),
    "resource_not_image": (422, "policy", False),
    "resource_too_large": (422, "policy", False),
}


@pytest.mark.parametrize("code", sorted(SPEC))
def test_code_is_registered_with_spec_semantics(code):
    http, failure_class, sticky = SPEC[code]
    assert STATUS[code] == http
    assert FAILURE_CLASS_BY_CODE[code] == failure_class
    error = WebResearchError(code)
    assert error.status_code == http and error.sticky is sticky


def test_every_failure_class_member_has_a_status():
    """未登记状态的码会按 422 处理——开放映射正是 AC-40 要杜绝的。"""
    assert not [c for c in FAILURE_CLASS_BY_CODE if c not in STATUS]


def test_legacy_codes_keep_their_defaults():
    assert WebResearchError("url_forbidden").sticky is True
    assert WebResearchError("browser_unavailable").failure_class == "transient"
    assert WebResearchError("browser_session_lost").status_code == 410
