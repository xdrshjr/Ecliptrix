"""SKILL.md 解析器：格式、保留字、不可信文本规范化、YAML 安全、字节上限。

覆盖 spec agent-steering-and-skills AC-B1/B11/B13 与评审 R-02/R-03/R-04/R-14。
"""
from pathlib import Path

import pytest

from app.models.agent_skills_models import AgentSkillsError
from app.services.agent_skills import limits
from app.services.agent_skills.parser import (
    check_skill_id,
    parse_skill,
    replace_skill_id,
)

BUILTIN_ROOT = (Path(__file__).resolve().parent.parent
                / "app" / "services" / "agent_skills" / "builtin")


def skill_text(front=None, body="第一步：做事。", **overrides):
    """拼一份最小合法 SKILL.md；`overrides` 覆盖 frontmatter 字段文本。"""
    fields = {"id": "demo-skill", "name": "演示", "description": "一个演示技能"}
    fields.update(overrides)
    lines = front if front is not None else [
        f"{key}: {value}" for key, value in fields.items() if value is not None]
    return "---\n" + "\n".join(lines) + "\n---\n" + body


def expect_error(markdown, code="invalid_skill"):
    with pytest.raises(AgentSkillsError) as info:
        parse_skill(markdown)
    assert info.value.error_code == code
    return info.value


# ── 正常路径 ────────────────────────────────────────────────────────────


def test_parses_minimal_skill():
    document = parse_skill(skill_text())
    assert (document.id, document.name, document.version) == (
        "demo-skill", "演示", 1)
    assert document.tools == () and document.requires == ()
    assert document.body == "第一步：做事。"


def test_parses_optional_fields_and_crlf():
    markdown = skill_text(
        version=3, tools="[search_video, add_to_track]",
        requires="[web, tts]").replace("\n", "\r\n")
    document = parse_skill(markdown)
    assert document.version == 3
    assert document.tools == ("search_video", "add_to_track")
    assert document.requires == ("web", "tts")


def test_description_with_markdown_char_inside_is_allowed():
    assert parse_skill(skill_text(description="A & B - 对比 #1")).description


# ── id / 保留字 ─────────────────────────────────────────────────────────


@pytest.mark.parametrize("reserved", sorted(limits.RESERVED_IDS))
def test_every_reserved_id_is_rejected(reserved):
    error = expect_error(skill_text(id=reserved))
    assert "保留字" in error.message


def test_reserved_set_covers_routes_and_windows_devices():
    expected = {"index", "validate", "con", "prn", "aux", "nul"}
    expected |= {f"com{n}" for n in range(1, 10)}
    expected |= {f"lpt{n}" for n in range(1, 10)}
    assert limits.RESERVED_IDS == expected


@pytest.mark.parametrize("bad", ["ab", "Abc", "1abc", "a_b_c", "a" * 41,
                                 "../x", "a b c", "demo.skill"])
def test_malformed_ids_are_rejected(bad):
    expect_error(skill_text(id=f'"{bad}"'))


def test_check_skill_id_uses_requested_code():
    with pytest.raises(AgentSkillsError) as info:
        check_skill_id("../x", code="invalid_parameters")
    assert info.value.error_code == "invalid_parameters"


def test_id_integer_is_not_coerced():
    error = expect_error(skill_text(id="123"))
    assert "字符串" in error.message


# ── 严格类型（R-14）──────────────────────────────────────────────────────


def test_name_yes_is_rejected_as_non_string():
    error = expect_error(skill_text(name="yes"))
    assert "name" in error.message


@pytest.mark.parametrize("value", ["true", "1.5", '"3"', "0", "-1", "[1]"])
def test_version_must_be_a_positive_integer(value):
    expect_error(skill_text(version=value))


def test_unknown_key_is_rejected_and_named():
    error = expect_error(skill_text(extra="x"))
    assert "extra" in error.message


def test_duplicate_key_is_rejected():
    expect_error(skill_text(front=[
        "id: demo-skill", "name: 演示", "name: 另一个",
        "description: 一个演示技能"]))


@pytest.mark.parametrize("front", [
    ["id: &a demo-skill", "name: 演示", "description: 描述"],
    ["id: demo-skill", "name: &n 演示", "description: *n"],
])
def test_anchors_and_aliases_are_rejected(front):
    error = expect_error(skill_text(front=front))
    assert "锚点" in error.message


def test_frontmatter_over_4_kib_is_rejected():
    padding = "# " + "x" * (limits.MAX_FRONTMATTER_BYTES)
    error = expect_error(skill_text(
        front=["id: demo-skill", "name: 演示", "description: 描述", padding]))
    assert "frontmatter" in error.message


def test_malformed_yaml_is_rejected_without_traceback():
    expect_error(skill_text(front=["id: [unclosed", "name: x"]))


def test_python_object_tags_are_rejected():
    expect_error(skill_text(front=[
        "id: demo-skill", "name: !!python/object:os.system x",
        "description: 描述"]))


# ── description / name 规范化（R-04）─────────────────────────────────────


@pytest.mark.parametrize("description", [
    # `>` 折叠标量只有折叠结果仍含换行（空行分段）时才被拒；折叠成单行的值
    # 本身就是合法的单行文本。
    "|\n  第一行\n  第二行", ">\n  折叠\n\n  文本",
])
def test_multiline_block_scalar_description_is_rejected(description):
    front = ["id: demo-skill", "name: 演示"]
    front += ["description: " + description.split("\n")[0]]
    front += description.split("\n")[1:]
    expect_error(skill_text(front=front))


def test_description_with_embedded_newline_is_rejected():
    expect_error(skill_text(description='"第一行\\n## 伪造规则"'))


@pytest.mark.parametrize("escape", ["\\r", "\\u2028", "\\u2029", "\\x85",
                                    "\\u202e", "\\x07"])
def test_description_with_line_or_control_chars_is_rejected(escape):
    expect_error(skill_text(description=f'"ab{escape}cd"'))


@pytest.mark.parametrize("prefix", ["#", "-", "*", ">", "`"])
def test_description_markdown_prefix_is_rejected(prefix):
    expect_error(skill_text(description=f'"{prefix} 伪装"'))


def test_name_is_single_line_too():
    expect_error(skill_text(name='"两行\\n名称"'))


def test_length_limits_in_codepoints():
    parse_skill(skill_text(description="好" * limits.MAX_DESCRIPTION_CODEPOINTS))
    expect_error(skill_text(
        description="好" * (limits.MAX_DESCRIPTION_CODEPOINTS + 1)))
    expect_error(skill_text(name="好" * (limits.MAX_NAME_CODEPOINTS + 1)))


# ── tools / requires ─────────────────────────────────────────────────────


def test_tools_limit_format_and_duplicates():
    names = ", ".join(f"tool_{n}" for n in range(limits.MAX_TOOLS))
    parse_skill(skill_text(tools=f"[{names}]"))
    expect_error(skill_text(tools=f"[{names}, tool_x]"))
    expect_error(skill_text(tools="[Bad-Name]"))
    expect_error(skill_text(tools="[web_search, web_search]"))
    expect_error(skill_text(tools="web_search"))


def test_requires_must_be_known_capabilities():
    expect_error(skill_text(requires="[telepathy]"))


# ── 正文与字节上限（R-03）────────────────────────────────────────────────


def test_empty_body_is_rejected():
    expect_error(skill_text(body="  \n"))


def test_chinese_body_is_bound_by_bytes_before_codepoints():
    # 3 字节字符：10240 // 3 = 3413 个才是字节上限下的真实最大值；
    # 3500 个汉字（10500 字节）会被字节上限拒绝（spec 两个上限互相冲突）。
    most = limits.MAX_BODY_BYTES // 3
    assert most < limits.MAX_BODY_CODEPOINTS
    parse_skill(skill_text(body="字" * most))
    expect_error(skill_text(body="字" * (most + 1)), code="skill_too_large")


def test_ascii_body_is_bound_by_codepoints():
    parse_skill(skill_text(body="a" * limits.MAX_BODY_CODEPOINTS))
    expect_error(skill_text(body="a" * (limits.MAX_BODY_CODEPOINTS + 1)),
                 code="skill_too_large")


def test_four_byte_body_is_judged_by_bytes():
    # 😀 为 4 字节：2560 个正好 10240 字节（远少于 3500 码点）。
    exact = parse_skill(skill_text(body="😀" * (limits.MAX_BODY_BYTES // 4)))
    assert exact.body_bytes == limits.MAX_BODY_BYTES
    error = expect_error(
        skill_text(body="😀" * (limits.MAX_BODY_BYTES // 4 + 1)),
        code="skill_too_large")
    assert "字节" in error.message


def test_file_over_64_kib_is_too_large():
    expect_error(skill_text(body="a" * limits.MAX_FILE_BYTES),
                 code="skill_too_large")


def test_control_characters_in_body_are_rejected():
    expect_error(skill_text(body="正文\x00结尾"))
    parse_skill(skill_text(body="正文\t缩进\n下一行"))


def test_near_limit_and_closing_tag_produce_warnings():
    body = "字" * int(limits.MAX_BODY_CODEPOINTS * 0.95) + " </SKILL>"
    document = parse_skill(skill_text(body=body))
    assert len(document.warnings) == 2


def test_body_may_contain_horizontal_rules():
    document = parse_skill(skill_text(body="上\n\n---\n\n下"))
    assert document.body.endswith("下") and "---" in document.body


# ── 结构 ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("markdown", [
    "没有 frontmatter", "---\nid: demo-skill\n没有结束", "", "---\n---\n正文",
    "---\n- a\n- b\n---\n正文",
])
def test_structure_errors(markdown):
    expect_error(markdown)


def test_non_string_input_is_rejected():
    expect_error(None)  # type: ignore[arg-type]


def test_bom_is_tolerated():
    assert parse_skill("﻿" + skill_text()).id == "demo-skill"


# ── replace_skill_id ────────────────────────────────────────────────────


def test_replace_skill_id_rewrites_only_the_id_line():
    markdown = skill_text(tools="[search_video]")
    replaced = replace_skill_id(markdown, "copy-skill")
    document = parse_skill(replaced)
    assert document.id == "copy-skill"
    assert document.name == "演示" and document.tools == ("search_video",)
    assert document.body == "第一步：做事。"


# ── 内置技能（AC-B1）────────────────────────────────────────────────────


EXPECTED_BUILTIN = {
    "explainer-video", "storyboard-short", "quick-assemble",
    "news-digest-video", "web-footage-sourcing", "final-qc-and-export",
}


def test_builtin_directory_is_non_empty_and_complete():
    found = {path.parent.name for path in BUILTIN_ROOT.glob("*/SKILL.md")}
    assert found == EXPECTED_BUILTIN


@pytest.mark.parametrize("skill_id", sorted(EXPECTED_BUILTIN))
def test_every_builtin_passes_parse_skill(skill_id):
    text = (BUILTIN_ROOT / skill_id / "SKILL.md").read_text(encoding="utf-8")
    document = parse_skill(text)
    assert document.id == skill_id
    assert document.body_chars <= limits.MAX_BODY_CODEPOINTS
    assert document.body_bytes <= limits.MAX_BODY_BYTES
    assert len(document.description) <= limits.MAX_DESCRIPTION_CODEPOINTS
    assert not document.warnings


def test_explainer_keeps_the_narration_text_mandate():
    text = (BUILTIN_ROOT / "explainer-video" / "SKILL.md").read_text(
        encoding="utf-8")
    assert "narration_text" in parse_skill(text).body
