"""技能存储：内置+用户、遮蔽、损坏文件、路径安全、并发上限、Windows 占用重试。

覆盖 spec agent-steering-and-skills AC-B2/B3/B4/B11 与评审 R-02/R-15。
"""
import asyncio
import json
import logging
import os
from pathlib import Path

import pytest

from app.models.agent_skills_models import AgentSkillsError
from app.services.agent_skills import limits
from app.services.agent_skills.store import SkillStore

BUILTIN_ROOT = (Path(__file__).resolve().parent.parent
                / "app" / "services" / "agent_skills" / "builtin")
BUILTIN_IDS = {path.name for path in BUILTIN_ROOT.iterdir() if path.is_dir()}


def skill_text(skill_id="my-skill", name="我的技能", description="一个技能",
               body="步骤一。", extra=""):
    return (f"---\nid: {skill_id}\nname: {name}\n"
            f"description: {description}\n{extra}---\n{body}")


def place(user_root: Path, skill_id: str, text: str) -> Path:
    """绕过 API，直接把文件放进用户目录（模拟用户手工拷入）。"""
    directory = user_root / skill_id
    directory.mkdir(parents=True)
    (directory / "SKILL.md").write_text(text, encoding="utf-8")
    return directory


@pytest.fixture
def user_root(tmp_path):
    return tmp_path / "agent_skills"


@pytest.fixture
def store(user_root):
    # scan_ttl=0：每次读都重扫，使“手工放文件”立刻可见。
    return SkillStore(BUILTIN_ROOT, user_root, scan_ttl=0)


async def expect_code(awaitable, code):
    with pytest.raises(AgentSkillsError) as info:
        await awaitable
    assert info.value.error_code == code
    return info.value


# ── 内置 ────────────────────────────────────────────────────────────────


def test_builtin_directory_is_non_empty():
    assert len(BUILTIN_IDS) == 8


@pytest.mark.asyncio
async def test_lists_all_builtin_skills_valid_and_enabled(store):
    records = await store.list_skills()
    assert {r.id for r in records} == BUILTIN_IDS
    assert all(r.builtin and r.valid and r.enabled and not r.shadowed
               for r in records)


@pytest.mark.asyncio
async def test_builtin_is_read_only(store):
    text = skill_text("explainer-video")
    await expect_code(store.update("explainer-video", text), "builtin_readonly")
    await expect_code(store.delete("explainer-video"), "builtin_readonly")


@pytest.mark.asyncio
async def test_creating_with_a_builtin_id_is_skill_exists(store):
    await expect_code(store.create(skill_text("quick-assemble")),
                      "skill_exists")


# ── 用户技能全链路 ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_get_update_delete_roundtrip(store, user_root):
    created = await store.create(skill_text())
    assert not created.builtin and created.valid
    assert (user_root / "my-skill" / "SKILL.md").is_file()

    updated = await store.update("my-skill", skill_text(body="新的步骤。"))
    assert updated.document.body == "新的步骤。"
    assert (await store.get_skill("my-skill")).document.body == "新的步骤。"

    await store.delete("my-skill")
    assert not (user_root / "my-skill").exists()
    await expect_code(store.get_skill("my-skill"), "skill_not_found")


@pytest.mark.asyncio
async def test_duplicate_create_is_skill_exists(store):
    await store.create(skill_text())
    await expect_code(store.create(skill_text()), "skill_exists")


@pytest.mark.asyncio
async def test_update_requires_matching_id_and_existing_skill(store):
    await store.create(skill_text())
    await expect_code(store.update("my-skill", skill_text("other-skill")),
                      "invalid_skill")
    await expect_code(store.update("ghost-skill", skill_text("ghost-skill")),
                      "skill_not_found")
    await expect_code(store.delete("ghost-skill"), "skill_not_found")


@pytest.mark.asyncio
async def test_invalid_markdown_never_touches_disk(store, user_root):
    await expect_code(store.create("not a skill"), "invalid_skill")
    assert not user_root.exists()


@pytest.mark.asyncio
async def test_validate_writes_nothing(store, user_root):
    document = store.validate(skill_text())
    assert document.id == "my-skill"
    assert not user_root.exists()
    with pytest.raises(AgentSkillsError):
        store.validate("bad")
    assert not user_root.exists()


# ── 路径安全（AC-B3 / R-02）─────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("bad_id", [
    "../escape", "..\\escape", "/abs/path", "C:\\x", "a\x00b", "ab",
    "UPPER", "a" * 41, "con", "nul", "com1", "lpt9", "index", "validate",
])
async def test_unsafe_ids_are_invalid_parameters_and_leave_disk_alone(
        store, user_root, tmp_path, bad_id):
    await expect_code(store.get_skill(bad_id), "invalid_parameters")
    await expect_code(store.update(bad_id, skill_text()), "invalid_parameters")
    await expect_code(store.delete(bad_id), "invalid_parameters")
    await expect_code(store.set_enabled(bad_id, False), "invalid_parameters")
    await expect_code(store.duplicate("quick-assemble", bad_id),
                      "invalid_parameters")
    assert not user_root.exists()
    assert sorted(p.name for p in tmp_path.iterdir()) == []


@pytest.mark.asyncio
@pytest.mark.parametrize("reserved", sorted(limits.RESERVED_IDS))
async def test_creating_every_reserved_id_is_rejected(store, reserved):
    await expect_code(store.create(skill_text(reserved)), "invalid_skill")


@pytest.mark.asyncio
async def test_hand_placed_reserved_and_malformed_directories_are_ignored(
        store, user_root, caplog):
    place(user_root, "index", skill_text("index"))
    place(user_root, "validate", skill_text("validate"))
    place(user_root, "BadName", skill_text("bad-name"))
    for device in ("con", "nul", "com1"):
        try:  # Windows 可能直接拒绝创建设备名目录，这正是要避免的场景。
            place(user_root, device, skill_text(device))
        except OSError:
            pass
    place(user_root, "fine-skill", skill_text("fine-skill"))

    with caplog.at_level(logging.WARNING):
        records = await store.list_skills()

    user_ids = {r.id for r in records if not r.builtin}
    assert user_ids == {"fine-skill"}
    assert "ignored directory" in caplog.text
    await expect_code(store.get_skill("index"), "invalid_parameters")


# ── 损坏文件（AC-B4）───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_broken_files_are_listed_invalid_and_excluded_from_index(
        store, user_root):
    place(user_root, "broken-yaml", "---\nid: [oops\n---\n正文")
    place(user_root, "id-mismatch", skill_text("someone-else"))
    place(user_root, "too-big", "---\nid: too-big\n---\n"
          + "a" * (limits.MAX_FILE_BYTES + 1))
    (user_root / "empty-dir").mkdir()
    (user_root / "binary-skill").mkdir()
    (user_root / "binary-skill" / "SKILL.md").write_bytes(b"\xff\xfe\x00bad")

    records = {r.id: r for r in await store.list_skills()}
    for broken in ("broken-yaml", "id-mismatch", "too-big", "empty-dir",
                   "binary-skill"):
        assert not records[broken].valid
        assert records[broken].problem["error_code"] in {
            "invalid_skill", "skill_too_large"}
        assert records[broken].to_summary()["problem"]["message"]
    assert records["too-big"].problem["error_code"] == "skill_too_large"

    entries, _ = await store.index()
    assert not {e.id for e in entries} & set(records) - BUILTIN_IDS


# ── 启停与遮蔽 ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_disable_hides_from_index_and_enable_restores(store, user_root):
    await store.create(skill_text())
    await store.set_enabled("my-skill", False)
    await store.set_enabled("quick-assemble", False)

    state = json.loads((user_root / "_state.json").read_text("utf-8"))
    assert state["disabled"] == ["my-skill", "quick-assemble"]
    entries, _ = await store.index()
    ids = {e.id for e in entries}
    assert "my-skill" not in ids and "quick-assemble" not in ids
    assert not (await store.get_skill("my-skill")).enabled

    await store.set_enabled("my-skill", True)
    entries, _ = await store.index()
    assert "my-skill" in {e.id for e in entries}


@pytest.mark.asyncio
async def test_set_enabled_on_unknown_skill_is_not_found(store):
    await expect_code(store.set_enabled("ghost-skill", False),
                      "skill_not_found")


@pytest.mark.asyncio
async def test_deleting_a_skill_clears_its_disabled_flag(store, user_root):
    await store.create(skill_text())
    await store.set_enabled("my-skill", False)
    await store.delete("my-skill")
    state = json.loads((user_root / "_state.json").read_text("utf-8"))
    assert state["disabled"] == []


@pytest.mark.asyncio
async def test_corrupt_state_file_is_treated_as_empty(store, user_root):
    user_root.mkdir()
    (user_root / "_state.json").write_text("{not json", encoding="utf-8")
    records = await store.list_skills()
    assert all(r.enabled for r in records)
    entries, truncated = await store.index()
    assert len(entries) == 8 and not truncated


@pytest.mark.asyncio
async def test_user_directory_with_builtin_id_is_shadowed(store, user_root):
    place(user_root, "quick-assemble", skill_text("quick-assemble"))
    records = [r for r in await store.list_skills() if r.id == "quick-assemble"]
    assert sorted((r.builtin, r.shadowed) for r in records) == [
        (False, True), (True, False)]
    assert (await store.get_skill("quick-assemble")).builtin
    entries, _ = await store.index()
    assert [e.id for e in entries].count("quick-assemble") == 1


# ── 索引 ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_index_orders_builtin_first_then_newest_user_and_truncates(
        store, user_root):
    for number in range(6):
        directory = place(user_root, f"user-skill-{number}",
                          skill_text(f"user-skill-{number}"))
        stamp = 1_700_000_000 + number * 100
        os.utime(directory / "SKILL.md", (stamp, stamp))

    entries, truncated = await store.index()
    assert truncated and len(entries) == limits.MAX_INDEX_ENTRIES
    assert [e.builtin for e in entries] == [True] * 8 + [False] * 2
    assert [e.id for e in entries[8:]] == [
        "user-skill-5", "user-skill-4"]
    assert set(entries[0].to_index_entry()) == {
        "id", "name", "description", "requires", "builtin"}


# ── 复制 ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_duplicate_builtin_creates_editable_user_copy(store):
    copy = await store.duplicate("explainer-video", "my-explainer")
    assert not copy.builtin and copy.id == "my-explainer"
    original = await store.get_skill("explainer-video")
    assert copy.document.body == original.document.body
    await store.update("my-explainer", copy.markdown.replace("旁白", "配音"))


@pytest.mark.asyncio
async def test_duplicate_rejects_existing_target_and_missing_source(store):
    await expect_code(store.duplicate("explainer-video", "quick-assemble"),
                      "skill_exists")
    await expect_code(store.duplicate("ghost-skill", "new-skill"),
                      "skill_not_found")


@pytest.mark.asyncio
async def test_duplicate_of_invalid_source_is_rejected(store, user_root):
    place(user_root, "broken-one", "---\nid: [x\n---\nbody")
    await expect_code(store.duplicate("broken-one", "copy-of-broken"),
                      "invalid_skill")


# ── 上限与并发（R-15）──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_concurrent_creates_cannot_exceed_the_user_limit(store, user_root):
    already = limits.MAX_USER_SKILLS - 2
    for number in range(already):
        place(user_root, f"seed-skill-{number:02d}",
              skill_text(f"seed-skill-{number:02d}"))

    attempts = [store.create(skill_text(f"racer-{n}")) for n in range(6)]
    results = await asyncio.gather(*attempts, return_exceptions=True)

    created = [r for r in results if not isinstance(r, Exception)]
    refused = [r for r in results if isinstance(r, AgentSkillsError)]
    assert len(created) == 2
    assert {r.error_code for r in refused} == {"skill_limit"}
    user = [r for r in await store.list_skills() if not r.builtin]
    assert len(user) == limits.MAX_USER_SKILLS


@pytest.mark.asyncio
async def test_exactly_at_limit_further_create_is_refused(store, user_root):
    for number in range(limits.MAX_USER_SKILLS):
        place(user_root, f"seed-skill-{number:02d}",
              skill_text(f"seed-skill-{number:02d}"))
    await expect_code(store.create(skill_text()), "skill_limit")
    await expect_code(store.duplicate("quick-assemble", "copy-skill"),
                      "skill_limit")


# ── os.replace 重试（Windows 杀软/预览占用）────────────────────────────


def patch_replace(monkeypatch, failures):
    real_replace, calls = os.replace, []

    def flaky(source, target):
        calls.append(str(target))
        if len(calls) <= failures:
            raise PermissionError(13, "in use")
        return real_replace(source, target)

    monkeypatch.setattr(os, "replace", flaky)
    return calls


@pytest.mark.asyncio
async def test_permission_error_is_retried_then_succeeds(
        store, user_root, monkeypatch):
    calls = patch_replace(monkeypatch, failures=2)
    record = await store.create(skill_text())
    assert record.valid and len(calls) == 3
    assert not list((user_root / "my-skill").glob("*.tmp"))


@pytest.mark.asyncio
async def test_permanent_permission_error_is_internal_and_cleans_up(
        store, user_root, monkeypatch):
    calls = patch_replace(monkeypatch, failures=10 ** 6)
    error = await expect_code(store.create(skill_text()), "internal_error")
    assert "占用" in error.message
    assert len(calls) == limits.REPLACE_RETRIES + 1
    # 创建失败要回滚整个目录，不留下只有 .tmp 的半成品。
    assert not (user_root / "my-skill").exists()


@pytest.mark.asyncio
async def test_failed_update_keeps_old_content_and_no_tmp(
        store, user_root, monkeypatch):
    await store.create(skill_text())
    patch_replace(monkeypatch, failures=10 ** 6)
    await expect_code(store.update("my-skill", skill_text(body="新内容")),
                      "internal_error")
    directory = user_root / "my-skill"
    assert "步骤一。" in (directory / "SKILL.md").read_text("utf-8")
    assert not list(directory.glob("*.tmp"))


# ── 缓存 ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_edits_on_disk_are_picked_up_by_mtime(user_root):
    cached = SkillStore(BUILTIN_ROOT, user_root, scan_ttl=0)
    directory = place(user_root, "edited-skill", skill_text("edited-skill"))
    first = await cached.get_skill("edited-skill")
    target = directory / "SKILL.md"
    target.write_text(skill_text("edited-skill", body="改过的正文，更长一些。"),
                      encoding="utf-8")
    second = await cached.get_skill("edited-skill")
    assert first.document.body != second.document.body
