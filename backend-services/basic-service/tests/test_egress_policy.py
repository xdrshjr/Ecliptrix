"""出口策略的判定矩阵：模式 × 地址 × 端口 × allow/deny（AC-G01/AC-G02）。

纯函数表驱动：没有一个用例发网络请求，因此可以覆盖完整组合。
"""
import pytest

from app.services.web_research import egress_policy as policy_module
from app.services.web_research.egress_policy import (
    EgressPolicy, EgressViolation, check_answers, normalize_proxy_url_value,
    normalize_url_value, reason_details, resolve_proxy)


def _reason(url, policy):
    with pytest.raises(EgressViolation) as caught:
        normalize_url_value(url, policy)
    return caught.value.reason


# ── URL 层（reason 即顺序码） ──────────────────────────────────────────────

def test_normalizes_and_keeps_query_drops_fragment():
    url, host = normalize_url_value('HTTPS://Example.com/A?q=Secret#x')
    assert url == 'https://example.com/A?q=Secret'
    assert host == 'example.com'


@pytest.mark.parametrize('url,reason', [
    ('ftp://example.com/x', 'scheme_not_allowed'),
    ('https://user:pass@example.com/', 'userinfo_not_allowed'),
    ('http://127.0.0.1/', 'host_literal_non_global'),
    ('http://[::ffff:127.0.0.1]/', 'host_literal_non_global'),
    ('http://224.0.0.1/', 'host_literal_non_global'),
    ('http://[ff02::1]/', 'host_literal_non_global'),
    ('http://localhost/x', 'host_literal_non_global'),
    ('http://169.254.169.254/latest/meta-data', 'host_literal_non_global'),
    ('http://example.com:8080/', 'port_not_allowed'),
    ('http://exa mple.com/', 'url_control_char'),
])
def test_url_violations(url, reason):
    assert _reason(url, EgressPolicy()) == reason


def test_url_too_long_is_reported_before_parsing():
    assert _reason('https://a.example/' + 'x' * 5000,
                   EgressPolicy()) == 'url_too_long'


def test_allow_hosts_skips_port_and_literal_rules_only():
    policy = EgressPolicy(mode='balanced', allow_hosts=('*.example.com',))
    url, _host = normalize_url_value('https://a.example.com:8443/x', policy)
    assert url.endswith(':8443/x')
    # deny 永远优先于 allow（deny wins）。
    denied = EgressPolicy(allow_hosts=('*.example.com',),
                          deny_hosts=('bad.example.com',))
    assert _reason('https://bad.example.com/', denied) == 'host_denied'


def test_open_mode_allows_any_port_but_still_blocks_loopback():
    open_policy = EgressPolicy(mode='open')
    assert normalize_url_value('http://example.com:8081/x', open_policy)[0]
    assert _reason('http://127.0.0.1:8081/', open_policy) == \
        'host_literal_non_global'
    assert _reason('http://[fd00::1]/', open_policy) == 'host_literal_non_global'


# ── DNS 层（C-2） ─────────────────────────────────────────────────────────

def test_strict_rejects_benchmarking_answer_balanced_allows_it():
    strict = EgressPolicy(mode='strict')
    with pytest.raises(EgressViolation) as caught:
        check_answers('upload.example', ['198.18.0.7'], strict)
    assert caught.value.reason == 'dns_answer_non_global'
    balanced = EgressPolicy(mode='balanced')
    assert check_answers('upload.example', ['198.18.0.7'], balanced) == \
        ('198.18.0.7',)


def test_balanced_still_rejects_locally_reachable_answers():
    with pytest.raises(EgressViolation) as caught:
        check_answers('evil.example', ['8.8.8.8', '127.0.0.1'],
                      EgressPolicy(mode='balanced'))
    assert caught.value.reason == 'dns_answer_non_global'


def test_open_mode_skips_dns_validation_entirely():
    assert check_answers('any.example', ['10.0.0.5'],
                         EgressPolicy(mode='open')) == ('10.0.0.5',)


def test_empty_answers_is_dns_no_answer_and_not_sticky():
    with pytest.raises(EgressViolation) as caught:
        check_answers('empty.example', [], EgressPolicy())
    assert caught.value.reason == 'dns_no_answer'
    assert reason_details('dns_no_answer')['sticky'] is False


# ── 代理解析（C-1：永不抛错） ──────────────────────────────────────────────

def test_auto_mode_degrades_to_direct_on_invalid_env():
    resolution = resolve_proxy({'proxy_mode': 'auto', 'custom_proxy_url': ''},
                               {'HTTP_PROXY': 'http://127.0.0.1'})
    assert resolution.proxy_url == ''
    assert resolution.resolved_from == 'direct'
    assert resolution.invalid_source == 'env'
    assert resolution.proxy_error == ''  # auto 降级不算错误，只是留痕


def test_custom_mode_keeps_the_error_instead_of_raising():
    resolution = resolve_proxy(
        {'proxy_mode': 'custom', 'custom_proxy_url': 'http://127.0.0.1'}, {})
    assert resolution.proxy_error == 'proxy_config_invalid'
    assert resolution.invalid_source == 'settings'


def test_settings_win_over_env_and_system_proxy():
    resolution = resolve_proxy(
        {'proxy_mode': 'auto', 'custom_proxy_url': 'http://10.10.10.10:7890'},
        {'HTTPS_PROXY': 'http://127.0.0.1:2',
         'WEB_RESEARCH_SYSTEM_PROXY': 'http://127.0.0.1:3'})
    assert resolution.proxy_url == 'http://10.10.10.10:7890'
    assert resolution.resolved_from == 'settings'


def test_proxy_url_requires_explicit_port():
    with pytest.raises(EgressViolation):
        normalize_proxy_url_value('http://127.0.0.1')
    assert normalize_proxy_url_value(
        'http://user:sec%40ret@127.0.0.1:7890') == \
        'http://user:sec%40ret@127.0.0.1:7890'


# ── reason 表与错误码映射 ─────────────────────────────────────────────────

@pytest.mark.parametrize('reason', [
    'proxy_config_invalid', 'dns_no_answer', 'dns_answer_non_global',
    'port_not_allowed'])
def test_configuration_and_dns_reasons_are_own_codes_and_non_sticky(reason):
    details = reason_details(reason)
    assert details['sticky'] is False
    assert policy_module.ERROR_CODE_BY_REASON[reason] == reason


@pytest.mark.parametrize('reason', ['robots_disallowed', 'host_denied',
                                    'url_too_long'])
def test_policy_reasons_stay_sticky(reason):
    assert reason_details(reason)['sticky'] is True
    assert policy_module.ERROR_CODE_BY_REASON.get(reason) is None


def test_every_reason_has_a_layer_and_remediation():
    for reason in policy_module._REASONS:
        details = reason_details(reason)
        assert details['remediation']
        assert details['failure_class'] in {
            'configuration', 'policy', 'user_input', 'transient', 'internal'}
