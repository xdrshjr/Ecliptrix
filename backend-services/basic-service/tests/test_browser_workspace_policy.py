"""工作台策略：敏感站点、风险分类、YOLO 拒绝、口令字段（spec §4.5.3 / §6.5）。"""
import pytest

from app.models.web_research_models import WebResearchError
from app.services.browser_workspace import policy


def test_precheck_blocks_sensitive_private_and_denied_hosts():
    base = {"agent_allow_private_network": False, "agent_deny_hosts": ["corp.test"]}
    for url, code in [("https://www.paypal.com/x", "sensitive_site_blocked"),
                      ("http://10.0.0.5/", "private_network_blocked"),
                      ("https://a.corp.test/", "sensitive_site_blocked"),
                      ("https://x.test/account/security", "sensitive_site_blocked"),
                      ("javascript:alert(1)", "navigation_blocked")]:
        with pytest.raises(WebResearchError) as caught:
            policy.precheck_url(url, base)
        assert caught.value.error_code == code
        assert caught.value.status_code == 403
    policy.precheck_url("http://10.0.0.5/", {**base, "agent_allow_private_network": True})


def test_sticky_matches_spec_table():
    with pytest.raises(WebResearchError) as caught:
        policy.precheck_url("https://stripe.com/", {})
    assert caught.value.sticky is True
    assert WebResearchError("sensitive_field").sticky is False
    assert WebResearchError("risky_action_blocked_autonomous").sticky is False
    assert WebResearchError("risky_action_denied").sticky is True


@pytest.mark.parametrize("name,cookies,expected", [
    ("立即支付", False, "confirm"), ("Place order", False, "confirm"),
    ("发布", False, "none"), ("发布", True, "confirm"),
    ("搜索", True, "none")])
def test_risk_tiers(name, cookies, expected):
    assert policy.classify_risk("click", {"name": name}, True, cookies) == expected


def test_risk_confirm_setting_cannot_disable_always_tier():
    assert policy.classify_risk("click", {"name": "结算"}, False, True) == "confirm"
    assert policy.classify_risk("click", {"name": "发布"}, False, True) == "none"


def test_decide_action_yolo_denies_and_interactive_asks():
    risky = {"name": "立即支付"}
    request = {"action": "click", "element_ref": "e1"}
    assert policy.decide_action(request, risky, {}, "yolo").code == \
        "risky_action_blocked_autonomous"
    assert policy.decide_action(request, risky, {}, "interactive").kind == "need_approval"
    assert policy.decide_action(request, {"name": "国际"}, {}, "yolo").kind == "allow"


def test_fill_into_sensitive_field_is_refused():
    request = {"action": "fill", "element_ref": "e3", "text": "x"}
    with pytest.raises(WebResearchError) as caught:
        policy.decide_action(request, {"name": "密码", "sensitive": True}, {}, "interactive")
    assert caught.value.error_code == "sensitive_field"
    with pytest.raises(WebResearchError):
        policy.decide_action(request, {"name": "验证码"}, {}, "interactive")
