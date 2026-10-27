"""技能库的全部上限常量。

设计基线：docs/plans/agent-steering-and-skills/spec.md §3.3.1 / §3.3.2 / §3.3.4。
放宽或收紧任何一项都是对 `invalid_skill` 输入契约的变更（spec §12-7），
必须同步前端 `src/types/agentSkills.ts` 并写进变更日志。
"""
import re

SKILL_FILE_NAME = "SKILL.md"
STATE_FILE_NAME = "_state.json"

# id 同时是目录名与 URL 段：首字符为字母，长度 3..40。
SKILL_ID_PATTERN = re.compile(r"^[a-z][a-z0-9-]{2,39}$")
TOOL_NAME_PATTERN = re.compile(r"^[a-z][a-z0-9_]{2,47}$")

# 保留字：① 与 GET /index、POST /validate 路由碰撞；② Windows 设备名
# （桌面端主力平台为 Windows，对这些名字 mkdir 会失败或打开设备）。
ROUTE_RESERVED_IDS = frozenset({"index", "validate"})
WINDOWS_DEVICE_IDS = frozenset(
    {"con", "prn", "aux", "nul"}
    | {f"com{number}" for number in range(1, 10)}
    | {f"lpt{number}" for number in range(1, 10)}
)
RESERVED_IDS = ROUTE_RESERVED_IDS | WINDOWS_DEVICE_IDS

ALLOWED_FRONTMATTER_KEYS = frozenset(
    {"id", "name", "description", "version", "tools", "requires"})
ALLOWED_REQUIRES = frozenset({"web", "browser", "vision", "documents", "tts", "crew"})

MAX_NAME_CODEPOINTS = 20
MAX_DESCRIPTION_CODEPOINTS = 60
MAX_TOOLS = 8
MAX_VERSION = 1_000_000

# description 进入系统提示词：不得以这些字符开头，否则可伪装成标题/列表/引用/围栏。
DESCRIPTION_FORBIDDEN_PREFIXES = ("#", "-", "*", ">", "`")

# 正文：码点上限是对作者友好的提示，字节上限才是权威
# （工具结果硬上限 12 KiB，4 字节字符 3500 个即 14000 字节）。
MAX_BODY_CODEPOINTS = 3500
MAX_BODY_BYTES = 10240
MAX_FILE_BYTES = 64 * 1024
MAX_FRONTMATTER_BYTES = 4 * 1024
# 正文达到上限的该比例时给出 warning。
BODY_WARNING_RATIO = 0.9

MAX_USER_SKILLS = 50
MAX_INDEX_ENTRIES = 10
SCAN_CACHE_SECONDS = 5.0

# Windows 上杀软/预览占用目标文件时 os.replace 会抛 PermissionError。
REPLACE_RETRIES = 3
REPLACE_RETRY_DELAY_SECONDS = 0.05
