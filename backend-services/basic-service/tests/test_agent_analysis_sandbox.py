"""计算沙箱：AST 反例逐条、超时 kill、输出截断、产物白名单、helper 越界。

覆盖 AC-13、AC-14、AC-15。
"""
import pytest

from app.models.agent_toolkit_models import AgentToolkitError
from app.services.agent_toolkit import analysis_sandbox
from tests.agent_toolkit_support import (  # noqa: F401  (pytest fixtures)
    toolkit_settings_override,
    toolkit_workspace,
)

REJECTED = [
    ("import os\nos.system('echo hi')", "module_not_allowed:os"),
    ("import socket", "module_not_allowed:socket"),
    ("x = ().__class__", "private_attribute:__class__"),
    ("open('a.txt')", "forbidden_name:open"),
    ("eval('1')", "forbidden_name:eval"),
    ("while ", "syntax"),
    ("import json\nawait foo()", "async_not_supported"),
]


@pytest.mark.parametrize("code,reason", REJECTED)
def test_validate_code_rejects(code, reason):
    with pytest.raises(AgentToolkitError) as info:
        analysis_sandbox.validate_code(code)
    assert info.value.error_code == "analysis_rejected"
    assert info.value.reason == reason


def test_validate_code_rejects_oversized_code():
    with pytest.raises(AgentToolkitError) as info:
        analysis_sandbox.validate_code("# filler\n" * 1000)
    assert info.value.reason == "too_long"


def test_validate_code_accepts_allowed_modules():
    analysis_sandbox.validate_code(
        "import math\nimport statistics\nprint(math.pi)")


@pytest.mark.asyncio
async def test_disabled_by_default(toolkit_workspace, toolkit_settings_override):
    toolkit_settings_override(analysis_enabled=False)
    with pytest.raises(AgentToolkitError) as info:
        await analysis_sandbox.run("print(1)", "p1", "call-1")
    assert info.value.error_code == "analysis_disabled"
    assert info.value.status_code == 403
    assert "Settings" in info.value.next_step


@pytest.mark.asyncio
async def test_runs_and_returns_stdout(toolkit_workspace,
                                       toolkit_settings_override):
    toolkit_settings_override(analysis_enabled=True)
    result = await analysis_sandbox.run(
        "import json\nprint(json.dumps({'a': 1 + 1}))", "p1", "call-1")
    assert result["status"] == "ok"
    assert result["exit_code"] == 0
    assert '{"a": 2}' in result["stdout"]


@pytest.mark.asyncio
async def test_artifacts_land_in_call_directory(
        toolkit_workspace, toolkit_settings_override):
    toolkit_settings_override(analysis_enabled=True)
    code = ("write_csv('table.csv', [['a', 'b'], [1, 2]])\n"
            "write_svg('chart.svg', '<rect width=\"10\" height=\"10\"/>')\n")
    result = await analysis_sandbox.run(code, "p1", "call-2")
    names = sorted(item["name"] for item in result["files"])
    assert names == ["chart.svg", "table.csv"]
    directory = analysis_sandbox.project_directory("p1", toolkit_workspace)
    assert (directory / "out" / "call-2" / "table.csv").is_file()


@pytest.mark.asyncio
async def test_prelude_rejects_escaping_name(toolkit_workspace,
                                             toolkit_settings_override):
    toolkit_settings_override(analysis_enabled=True)
    result = await analysis_sandbox.run(
        "write_text('../escape.txt', 'nope')", "p1", "call-3")
    assert result["status"] == "error"
    assert "invalid output file name" in result["stderr"]


@pytest.mark.asyncio
async def test_timeout_kills_the_child(toolkit_workspace,
                                       toolkit_settings_override):
    toolkit_settings_override(analysis_enabled=True,
                              analysis_timeout_seconds=1)
    with pytest.raises(AgentToolkitError) as info:
        await analysis_sandbox.run("while True:\n    pass", "p1", "call-4")
    assert info.value.error_code == "analysis_timeout"
    assert info.value.status_code == 504
    assert info.value.partial["exit_code"] is not None


@pytest.mark.asyncio
async def test_stdout_is_truncated(toolkit_workspace,
                                   toolkit_settings_override):
    toolkit_settings_override(analysis_enabled=True,
                              analysis_max_output_kb=8)
    result = await analysis_sandbox.run(
        "print('x' * 40000)", "p1", "call-5")
    assert result["truncated"] is True
    assert result["stdout"].endswith(analysis_sandbox.TRUNCATION_MARK)


@pytest.mark.asyncio
async def test_environment_is_minimal(
        toolkit_workspace, toolkit_settings_override, monkeypatch):
    """子进程只拿到最小环境：HTTP(S)_PROXY / 密钥 / STORAGE_ROOT 都不继承。

    直接对 `_minimal_environment()` 断言，而不是在沙箱里 `sorted(_os.environ)`：
    前导把 `os` 关在闭包里之后，用户代码**读不到** `os.environ`（那正是
    「`_os.system` 可以绕过 AST 白名单」的另一面，见下一条用例）。
    """
    toolkit_settings_override(analysis_enabled=True)
    monkeypatch.setenv("STORAGE_ROOT", "should-not-leak")
    monkeypatch.setenv("HTTP_PROXY", "http://proxy.invalid:8080")
    environment = analysis_sandbox._minimal_environment()
    assert "STORAGE_ROOT" not in environment
    assert "HTTP_PROXY" not in environment
    assert "PATH" in environment


@pytest.mark.asyncio
async def test_prelude_does_not_leak_os_into_user_code(
        toolkit_workspace, toolkit_settings_override):
    """`_os` 不得出现在用户代码的命名空间里（否则 `_os.system` 可绕过白名单）。

    前导与用户代码共用同一个模块命名空间，平铺 `import os as _os` 等于把一个
    不受 `validate_code` 约束的 `os` 交给模型。这里同时钉住「跑不起来」与
    「没有产物」两件事。
    """
    toolkit_settings_override(analysis_enabled=True)
    result = await analysis_sandbox.run(
        "write_json('env.json', sorted(_os.environ))\n", "p1", "call-6")
    assert result["status"] == "error"
    assert "NameError" in result["stderr"]
    directory = analysis_sandbox.project_directory("p1", toolkit_workspace)
    assert not (directory / "out" / "call-6" / "env.json").exists()


@pytest.mark.asyncio
async def test_prelude_helpers_are_still_public(
        toolkit_workspace, toolkit_settings_override):
    """闭包化之后公开 helper 仍然可用（防止「安全改完功能没了」）。"""
    toolkit_settings_override(analysis_enabled=True)
    result = await analysis_sandbox.run(
        "write_json('ok.json', {'rows': 3})\n", "p1", "call-7")
    assert result["status"] == "ok"
    directory = analysis_sandbox.project_directory("p1", toolkit_workspace)
    dumped = (directory / "out" / "call-7" / "ok.json").read_text(
        encoding="utf-8")
    assert '"rows": 3' in dumped
