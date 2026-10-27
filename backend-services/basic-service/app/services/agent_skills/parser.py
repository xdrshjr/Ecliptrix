"""SKILL.md 解析与校验：纯函数，无 IO。

设计基线：docs/plans/agent-steering-and-skills/spec.md §3.3.2。
`description` 会进入系统提示词，因此一律按不可信文本处理：必须单行、无控制
字符、不得以 Markdown 块级前缀开头。YAML 安全：frontmatter 有体积上限，
拒绝锚点/别名（别名炸弹），字符串字段不做隐式类型转换。
"""
import re
import unicodedata
from dataclasses import asdict, dataclass

import yaml

from app.models.agent_skills_models import AgentSkillsError
from app.services.agent_skills import limits

_FRONTMATTER_FENCE = "---"
# 双向文本控制符可以让一行文字在界面/提示词里“看起来”不同于实际内容。
_BIDI_CONTROLS = frozenset(
    "؜‎‏‪‫‬‭‮"
    "⁦⁧⁨⁩﻿")
_ID_LINE = re.compile(r"^id:[^\n]*$", re.MULTILINE)


@dataclass(frozen=True)
class SkillDocument:
    """`parse_skill` 的结果：已通过全部校验的技能。"""

    id: str
    name: str
    description: str
    version: int
    tools: tuple[str, ...]
    requires: tuple[str, ...]
    body: str
    body_chars: int
    body_bytes: int
    warnings: tuple[str, ...]

    def to_dict(self) -> dict:
        data = asdict(self)
        data["tools"] = list(self.tools)
        data["requires"] = list(self.requires)
        data["warnings"] = list(self.warnings)
        return data


class _UniqueKeyLoader(yaml.SafeLoader):
    """重复键直接报错：`safe_load` 默认静默取最后一个，拼写错误会悄悄失效。"""

    def construct_mapping(self, node, deep=False):
        seen = set()
        for key_node, _ in node.value:
            key = self.construct_object(key_node, deep=deep)
            try:
                duplicated = key in seen
            except TypeError:
                break  # 不可哈希的键交给父类给出标准错误
            if duplicated:
                raise yaml.constructor.ConstructorError(
                    None, None, f"duplicate key: {key!r}", key_node.start_mark)
            seen.add(key)
        return super().construct_mapping(node, deep)


def _invalid(message: str) -> AgentSkillsError:
    return AgentSkillsError("invalid_skill", message=message)


def check_skill_id(value: object, *,
                   code: str = "invalid_skill") -> str:
    """校验 id 形态与保留字；`code` 区分来源（frontmatter / 请求参数）。"""
    if not isinstance(value, str):
        raise AgentSkillsError(code, message="id 必须是字符串")
    if not limits.SKILL_ID_PATTERN.match(value):
        raise AgentSkillsError(
            code, message="id 必须匹配 ^[a-z][a-z0-9-]{2,39}$")
    if value in limits.RESERVED_IDS:
        reserved = ", ".join(sorted(limits.RESERVED_IDS))
        raise AgentSkillsError(
            code, message=f"id 不能使用保留字：{reserved}")
    return value


def split_frontmatter(markdown: str) -> tuple[str, str]:
    """把已规范化换行的文本拆成 (frontmatter, 正文)。"""
    lines = markdown.split("\n")
    if lines[0].rstrip() != _FRONTMATTER_FENCE:
        raise _invalid("SKILL.md 必须以 --- 开头的 frontmatter 起始")
    for index in range(1, len(lines)):
        if lines[index].rstrip() == _FRONTMATTER_FENCE:
            return "\n".join(lines[1:index]), "\n".join(lines[index + 1:])
    raise _invalid("frontmatter 缺少结束的 --- 行")


def _normalize(markdown: object) -> str:
    if not isinstance(markdown, str):
        raise _invalid("markdown 必须是字符串")
    # 字符数 ≤ 字节数：先用便宜的长度判断挡住超大输入，再精确数字节。
    if len(markdown) > limits.MAX_FILE_BYTES or \
            len(markdown.encode("utf-8")) > limits.MAX_FILE_BYTES:
        raise AgentSkillsError(
            "skill_too_large",
            message=f"SKILL.md 超过 {limits.MAX_FILE_BYTES // 1024} KiB")
    text = markdown.lstrip("﻿").replace("\r\n", "\n").replace("\r", "\n")
    for char in text:
        if unicodedata.category(char) == "Cc" and char not in "\n\t":
            raise _invalid(f"文件含控制字符 U+{ord(char):04X}")
    return text


def _load_frontmatter(front: str) -> dict:
    if len(front.encode("utf-8")) > limits.MAX_FRONTMATTER_BYTES:
        raise _invalid(
            f"frontmatter 超过 {limits.MAX_FRONTMATTER_BYTES // 1024} KiB")
    try:
        # 先扫描 token 再构造：别名展开发生在构造阶段，扫描阶段不会膨胀。
        for token in yaml.scan(front, Loader=yaml.SafeLoader):
            if isinstance(token, (yaml.tokens.AnchorToken,
                                  yaml.tokens.AliasToken)):
                raise _invalid("frontmatter 不允许使用 YAML 锚点/别名")
        meta = yaml.load(front, Loader=_UniqueKeyLoader)  # SafeLoader 子类
    except yaml.YAMLError as error:
        detail = getattr(error, "problem", None) or "语法错误"
        raise _invalid(f"frontmatter 不是合法 YAML：{detail}") from None
    if not isinstance(meta, dict):
        raise _invalid("frontmatter 必须是 key: value 映射")
    unknown = sorted(str(key) for key in meta
                     if key not in limits.ALLOWED_FRONTMATTER_KEYS)
    if unknown:
        raise _invalid(f"未知的 frontmatter 键：{', '.join(unknown)}")
    return meta


def _single_line_text(meta: dict, key: str, max_codepoints: int) -> str:
    value = meta.get(key)
    if not isinstance(value, str):
        raise _invalid(f"{key} 必须是字符串（不做类型转换，必填）")
    text = value.strip()
    if not text or len(text) > max_codepoints:
        raise _invalid(f"{key} 长度必须在 1..{max_codepoints} 个码点")
    for char in text:
        category = unicodedata.category(char)
        if category in ("Cc", "Zl", "Zp") or char in _BIDI_CONTROLS:
            raise _invalid(f"{key} 必须是单行文本，且不含控制字符")
    return text


def _description(meta: dict) -> str:
    text = _single_line_text(
        meta, "description", limits.MAX_DESCRIPTION_CODEPOINTS)
    if text.startswith(limits.DESCRIPTION_FORBIDDEN_PREFIXES):
        raise _invalid("description 不能以 # - * > ` 开头")
    return text


def _version(meta: dict) -> int:
    value = meta.get("version")
    if value is None:
        return 1
    if isinstance(value, bool) or not isinstance(value, int) \
            or not 1 <= value <= limits.MAX_VERSION:
        raise _invalid(f"version 必须是 1..{limits.MAX_VERSION} 的整数")
    return value


def _string_list(meta: dict, key: str) -> tuple[str, ...]:
    value = meta.get(key)
    if value is None:
        return ()
    if not isinstance(value, list) or not all(
            isinstance(item, str) for item in value):
        raise _invalid(f"{key} 必须是字符串列表")
    if len(set(value)) != len(value):
        raise _invalid(f"{key} 含重复项")
    return tuple(value)


def _tools(meta: dict) -> tuple[str, ...]:
    tools = _string_list(meta, "tools")
    if len(tools) > limits.MAX_TOOLS:
        raise _invalid(f"tools 最多 {limits.MAX_TOOLS} 个")
    for tool in tools:
        # 存在性由前端 use_skill 在执行时校验；后端只管格式。
        if not limits.TOOL_NAME_PATTERN.match(tool):
            raise _invalid(f"tools 含非法工具名：{tool[:50]}")
    return tools


def _requires(meta: dict) -> tuple[str, ...]:
    requires = _string_list(meta, "requires")
    unknown = [item for item in requires if item not in limits.ALLOWED_REQUIRES]
    if unknown:
        allowed = ", ".join(sorted(limits.ALLOWED_REQUIRES))
        raise _invalid(f"requires 含未知能力 {unknown[0][:30]}，可选：{allowed}")
    return requires


def _body(raw_body: str) -> tuple[str, int, int]:
    body = raw_body.strip()
    chars, size = len(body), len(body.encode("utf-8"))
    if not chars:
        raise _invalid("正文不能为空")
    if chars > limits.MAX_BODY_CODEPOINTS or size > limits.MAX_BODY_BYTES:
        raise AgentSkillsError(
            "skill_too_large",
            message=(f"正文必须 ≤ {limits.MAX_BODY_CODEPOINTS} 个码点且 ≤ "
                     f"{limits.MAX_BODY_BYTES} 字节（当前 {chars} 码点 / "
                     f"{size} 字节）"))
    return body, chars, size


def _warnings(body: str, chars: int, size: int) -> tuple[str, ...]:
    found = []
    ratio = limits.BODY_WARNING_RATIO
    if chars >= limits.MAX_BODY_CODEPOINTS * ratio \
            or size >= limits.MAX_BODY_BYTES * ratio:
        found.append("正文接近长度上限")
    if "</skill" in body.lower():
        found.append("正文含 </skill>，注入提示时会被转义")
    return tuple(found)


def parse_skill(markdown: str) -> SkillDocument:
    """解析并校验一份 SKILL.md。

    Args:
        markdown: 文件全文。
    Returns:
        通过全部校验的 `SkillDocument`。
    Raises:
        AgentSkillsError: `invalid_skill`（格式/字段）或 `skill_too_large`。
    """
    text = _normalize(markdown)
    front, raw_body = split_frontmatter(text)
    meta = _load_frontmatter(front)
    body, chars, size = _body(raw_body)
    return SkillDocument(
        id=check_skill_id(meta.get("id")),
        name=_single_line_text(meta, "name", limits.MAX_NAME_CODEPOINTS),
        description=_description(meta),
        version=_version(meta),
        tools=_tools(meta),
        requires=_requires(meta),
        body=body, body_chars=chars, body_bytes=size,
        warnings=_warnings(body, chars, size),
    )


def replace_skill_id(markdown: str, new_id: str) -> str:
    """把 frontmatter 里的 `id:` 行换成 `new_id`（复制技能用）；结果须再解析。"""
    text = _normalize(markdown)
    front, raw_body = split_frontmatter(text)
    if not _ID_LINE.search(front):
        raise _invalid("frontmatter 缺少顶层 id 行")
    front = _ID_LINE.sub(f"id: {new_id}", front, count=1)
    return f"---\n{front}\n---\n{raw_body}"
