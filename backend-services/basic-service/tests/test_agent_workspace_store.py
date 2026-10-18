"""工作区存储层：路径安全 / 原子写 / 配额 / 分页 / 二进制拒绝。

覆盖 AC-01、AC-02、AC-03、AC-04、AC-30、AC-31。
"""
import os

import pytest

from app.models.agent_toolkit_models import AgentToolkitError
from app.services.agent_toolkit import workspace_store
from tests.agent_toolkit_support import (  # noqa: F401  (pytest fixtures)
    toolkit_engine,
    toolkit_settings_override,
    toolkit_workspace,
    write_project_file,
)

BAD_NAMES = [
    "../x",
    "/abs",
    "a/../../b",
    "CON",
    "x.txt.",
    "a//b",
    "a\x00b",
    "a<b",
    "x" * 181,
    "a/b/c/d/e/f",
    "COM1.txt",
    "\\\\server\\share",
]


@pytest.mark.parametrize("name", BAD_NAMES)
def test_safe_relative_name_rejects(name, toolkit_workspace):
    with pytest.raises(AgentToolkitError) as info:
        workspace_store.safe_relative_name(name, toolkit_workspace)
    assert info.value.error_code == "invalid_workspace_name"


@pytest.mark.parametrize("name", ["script/outline.md", "out/chart.svg"])
def test_safe_relative_name_accepts_and_checks_extensions(
        name, toolkit_workspace):
    assert workspace_store.safe_relative_name(
        name, toolkit_workspace, for_write=True) == name


def test_write_rejects_media_extension(toolkit_workspace):
    """媒体扩展名只允许导入，不允许 Agent 手写伪造（§3.3.2 步骤 7）。"""
    with pytest.raises(AgentToolkitError) as info:
        workspace_store.safe_relative_name(
            "fake.mp4", toolkit_workspace, for_write=True)
    assert info.value.error_code == "invalid_workspace_name"


@pytest.mark.asyncio
async def test_atomic_write_leaves_no_partial_file(
        toolkit_workspace, monkeypatch):
    def boom(source, target):
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(workspace_store.os, "replace", boom)
    with pytest.raises(AgentToolkitError) as info:
        await workspace_store.write_file("p1", "script/outline.md", b"hello")
    assert info.value.error_code == "storage_unavailable"
    directory = workspace_store.project_directory("p1")
    leftovers = [path.name for path in (directory / "files").rglob("*")
                 if path.is_file()]
    assert leftovers == []
    assert not (directory / "files" / "script" / "outline.md").exists()


@pytest.mark.asyncio
async def test_quota_exceeded_writes_nothing(toolkit_workspace, monkeypatch):
    monkeypatch.setattr(workspace_store, "quota_bytes", lambda: 4)
    with pytest.raises(AgentToolkitError) as info:
        await workspace_store.write_file("p1", "a.txt", b"0123456789")
    assert info.value.error_code == "workspace_quota_exceeded"
    assert info.value.status_code == 507
    directory = workspace_store.project_directory("p1")
    assert list((directory / "files").rglob("*")) == []


@pytest.mark.asyncio
async def test_write_requires_overwrite_for_existing(toolkit_workspace):
    await workspace_store.write_file("p1", "a.txt", b"one")
    with pytest.raises(AgentToolkitError) as info:
        await workspace_store.write_file("p1", "a.txt", b"two")
    assert info.value.error_code == "invalid_argument"
    target = workspace_store.project_directory("p1") / "files" / "a.txt"
    assert target.read_bytes() == b"one"
    result = await workspace_store.write_file(
        "p1", "a.txt", b"two", overwrite=True)
    assert result["overwritten"] is True
    assert target.read_bytes() == b"two"


def test_byte_page_round_trips_multibyte_text():
    body = ("中文段落🙂" * 1200).encode("utf-8")
    collected = []
    offset = 0
    while offset is not None and offset < len(body):
        page = workspace_store.byte_page(body, offset, 4000)
        collected.append(page["content"])
        offset = page["next_offset"]
    assert "".join(collected).encode("utf-8") == body


def test_byte_page_rejects_mid_codepoint_offset():
    body = "中".encode("utf-8")
    with pytest.raises(AgentToolkitError) as info:
        workspace_store.byte_page(body, 1, 10)
    assert info.value.error_code == "invalid_offset"


@pytest.mark.asyncio
async def test_read_rejects_binary_and_points_to_next_step(toolkit_workspace):
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
    write_project_file(toolkit_workspace, "p1", "chart.png", png)
    with pytest.raises(AgentToolkitError) as info:
        workspace_store.read_page("p1", "chart.png")
    assert info.value.error_code == "binary_file"
    assert info.value.status_code == 415
    assert "workspace_import_material" in info.value.next_step


@pytest.mark.asyncio
async def test_read_accepts_utf8_text(toolkit_workspace):
    await workspace_store.write_file("p1", "notes.md", "中文🙂".encode("utf-8"))
    page = workspace_store.read_page("p1", "notes.md")
    assert page["content"] == "中文🙂"
    assert page["truncated"] is False


@pytest.mark.asyncio
async def test_quota_counts_all_five_trees(toolkit_workspace):
    await workspace_store.write_file("p1", "a.txt", b"1234")
    directory = workspace_store.project_directory("p1")
    (directory / "extracted").mkdir(parents=True, exist_ok=True)
    (directory / "extracted" / "doc.txt").write_bytes(b"x" * 100)
    (directory / "uploads").mkdir(parents=True, exist_ok=True)
    (directory / "uploads" / "doc.pdf").write_bytes(b"y" * 50)
    current = workspace_store.usage(directory)
    assert sum(current["used_by_kind"].values()) == current["used_bytes"]
    assert current["used_bytes"] == 4 + 100 + 50


@pytest.mark.asyncio
async def test_list_files_excludes_uploaded_originals(toolkit_workspace):
    await workspace_store.write_file("p1", "script/outline.md", b"body")
    directory = workspace_store.project_directory("p1")
    (directory / "uploads").mkdir(parents=True, exist_ok=True)
    (directory / "uploads" / "doc-1.pdf").write_bytes(b"%PDF-1.4")
    listing = workspace_store.list_files("p1")
    assert [item["name"] for item in listing["files"]] == ["script/outline.md"]


@pytest.mark.asyncio
async def test_delete_file_and_prune_empty_dirs(toolkit_workspace):
    await workspace_store.write_file("p1", "script/outline.md", b"body")
    result = workspace_store.delete_file("p1", "script/outline.md")
    assert result == {"deleted": True, "name": "script/outline.md"}
    directory = workspace_store.project_directory("p1")
    assert not (directory / "files" / "script").exists()


def test_project_directory_never_contains_user_input(toolkit_workspace):
    first = workspace_store.project_directory("p1", toolkit_workspace)
    assert first.name.startswith("project-")
    assert "p1" not in first.name
    assert len(first.name) == len("project-") + 12


def test_global_bucket_for_missing_project_id(toolkit_workspace):
    assert workspace_store.project_directory(None, toolkit_workspace).name \
        == "global"


def test_realpath_escape_is_rejected(toolkit_workspace, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    link = toolkit_workspace / "linked"
    try:
        os.symlink(outside, link, target_is_directory=True)
    except (OSError, NotImplementedError):
        pytest.skip("symlinks unavailable on this platform")
    with pytest.raises(AgentToolkitError):
        workspace_store.safe_relative_name(
            "linked/escape.txt", toolkit_workspace)
