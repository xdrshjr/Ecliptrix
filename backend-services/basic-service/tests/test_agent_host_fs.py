"""文件工具：作用域逃逸、设备名、edit 唯一性、二进制、grep 上限。

覆盖 AC-G12 / AC-G13。
"""
import copy

import pytest

from app.models.agent_host_models import AgentHostError
from app.services.agent_host import fs_tools


@pytest.fixture
def host_settings(monkeypatch, tmp_path):
    """出厂设置 + 把 host 作用域的根指到 tmp_path（生产默认值不变）。"""
    from app.services import system_settings_service as module

    def apply(**overrides):
        base = copy.deepcopy(module.AGENT_HOST_DEFAULTS)
        base["host_read_roots"] = [str(tmp_path)]
        base["host_write_roots"] = [str(tmp_path)]
        base.update(overrides)
        monkeypatch.setattr(module, "AGENT_HOST_DEFAULTS", base)
        return base

    apply()
    return apply


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    """把工作区根指到 tmp_path/agent_workspace（与 toolkit 测试同法）。"""
    from app.services.agent_toolkit import workspace_store

    root = tmp_path / "agent_workspace"
    root.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(workspace_store, "workspace_root", lambda: root)
    return root


def failure(coroutine):
    import asyncio

    with pytest.raises(AgentHostError) as caught:
        asyncio.get_event_loop().run_until_complete(coroutine)
    return caught.value


# ── workspace 作用域：写、读、配额、二进制 ────────────────────────────────

@pytest.mark.asyncio
async def test_workspace_write_then_read_round_trip(host_settings, workspace):
    written = await fs_tools.write_file(None, "notes/a.md", "第一行\n第二行\n")
    assert written["bytes"] > 0
    assert written["scope"] == "workspace"
    page = fs_tools.read_file(None, "notes/a.md")
    assert page["content"].startswith("第一行")
    assert page["binary"] is False


@pytest.mark.asyncio
async def test_workspace_rejects_parent_escape_and_device_names(
        host_settings, workspace):
    # 复用 workspace_store 的既有码 `invalid_workspace_name`（不新造近义码），
    # 设备名与 `..` 都在同一张表里被拒（§4.5 / REV-P1-1）。
    for name in ("../escape.md", "con.md", "nul", "a/../../b.md"):
        with pytest.raises(AgentHostError) as caught:
            await fs_tools.write_file(None, name, "x")
        assert caught.value.error_code in {"path_forbidden",
                                           "invalid_workspace_name"}


@pytest.mark.asyncio
async def test_workspace_write_over_quota_is_rejected(host_settings, workspace,
                                                      monkeypatch):
    from app.services import system_settings_service as module

    base = copy.deepcopy(module.AGENT_TOOLKIT_DEFAULTS)
    base["workspace_quota_mb"] = 16
    monkeypatch.setattr(module, "AGENT_TOOLKIT_DEFAULTS", base)
    monkeypatch.setattr(module, "toolkit_settings", lambda: base)
    with pytest.raises(AgentHostError) as caught:
        await fs_tools.write_file(None, "big.md", "x" * (17 * 1024 * 1024))
    assert caught.value.error_code in {"workspace_quota_exceeded",
                                       "workspace_file_too_large"}


@pytest.mark.asyncio
async def test_binary_read_is_415(host_settings, workspace):
    from app.services.agent_toolkit.workspace_store import project_directory

    target = project_directory(None) / "files" / "blob.png"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"\x89PNG\r\n\x1a\n\x00\x00")
    with pytest.raises(AgentHostError) as caught:
        fs_tools.read_file(None, "blob.png")
    assert caught.value.error_code == "binary_file"
    assert caught.value.status_code == 415


# ── edit_file：唯一性 ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_edit_requires_a_unique_anchor(host_settings, workspace):
    await fs_tools.write_file(None, "dup.md", "a\na\n")
    with pytest.raises(AgentHostError) as caught:
        await fs_tools.edit_file(None, "dup.md", "a", "b")
    assert caught.value.error_code == "edit_not_unique"
    assert caught.value.status_code == 409
    page = fs_tools.read_file(None, "dup.md")
    assert page["content"] == "a\na\n"  # 未落盘


@pytest.mark.asyncio
async def test_edit_replace_all_and_diff(host_settings, workspace):
    await fs_tools.write_file(None, "dup.md", "a\na\n")
    result = await fs_tools.edit_file(None, "dup.md", "a", "b", replace_all=True)
    assert result["replacements"] == 2
    assert "+b" in result["diff"]
    assert fs_tools.read_file(None, "dup.md")["content"] == "b\nb\n"


# ── host 作用域：根白名单 ─────────────────────────────────────────────────

def test_host_scope_rejects_paths_outside_the_roots(host_settings, tmp_path):
    outside = tmp_path.parent / "elsewhere"
    outside.mkdir(exist_ok=True)
    with pytest.raises(AgentHostError) as caught:
        fs_tools.resolve_host_path(fs_tools._settings(), outside, write=False)
    assert caught.value.error_code == "path_forbidden"


def test_host_scope_accepts_paths_inside_the_roots(host_settings, tmp_path):
    inside = tmp_path / "ok" / "file.txt"
    inside.parent.mkdir(parents=True, exist_ok=True)
    inside.write_text("hello", encoding="utf-8")
    resolved = fs_tools.resolve_host_path(fs_tools._settings(), inside)
    assert resolved == inside.resolve()


# ── 目录 / glob / grep ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_and_glob_and_grep(host_settings, workspace):
    await fs_tools.write_file(None, "a.md", "alpha\nbeta\n")
    await fs_tools.write_file(None, "b.md", "alpha\ngamma\n")
    listing = fs_tools.list_dir(None, "")
    assert {item["name"] for item in listing["entries"]} >= {"a.md", "b.md"}
    matched = fs_tools.glob_files(None, "*.md")
    assert {item["path"] for item in matched["matches"]} >= {"a.md", "b.md"}
    hits = fs_tools.grep_files(None, "alpha")
    assert {hit["path"] for hit in hits["hits"]} == {"a.md", "b.md"}


@pytest.mark.asyncio
async def test_workspace_root_aliases_are_listable(host_settings, workspace):
    """`list_dir('.')` 必须能列根：`safe_relative_name` 拒绝 `.`。

    模型的第一个动作几乎总是列工作区根，`invalid_workspace_name` 会被翻译成
    `path_forbidden`，等于"根目录永远列不出来"。
    """
    await fs_tools.write_file(None, "root.md", "x")
    for alias in (".", "./", "/", "files"):
        listing = fs_tools.list_dir(None, alias)
        assert {item["name"] for item in listing["entries"]} >= {"root.md"}
    assert fs_tools.glob_files(None, "*.md", cwd=".")["matches"]
    assert fs_tools.grep_files(None, "^x$", path=".")["hits"]


def test_grep_rejects_an_invalid_regular_expression(host_settings, workspace):
    with pytest.raises(AgentHostError) as caught:
        fs_tools.grep_files(None, "([unclosed")
    assert caught.value.error_code == "invalid_argument"
    assert caught.value.status_code == 400


def test_grep_respects_the_hit_cap(host_settings, workspace):
    from app.services.agent_toolkit.workspace_store import project_directory

    target = project_directory(None) / "files" / "many.txt"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("\n".join("match" for _ in range(400)), encoding="utf-8")
    result = fs_tools.grep_files(None, "match")
    assert len(result["hits"]) == fs_tools.GREP_HIT_LIMIT
    assert result["truncated"] is True
