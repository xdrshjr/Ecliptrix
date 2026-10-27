"""Agent 技能库：解析、存储与对外单例。"""
from pathlib import Path

from app.services.agent_skills.store import SkillStore

_store: SkillStore | None = None


def user_skills_root() -> Path:
    """用户技能目录。

    与 `workspace_store.workspace_root` 同样放在 STORAGE_ROOT 的**同级**目录：
    STORAGE_ROOT 内的文件由 `/api/storage/files` 静态挂载对外服务，技能文件
    没有理由经这条路径暴露。
    """
    from app.config import settings

    return Path(settings.storage.root).resolve().parent / "agent_skills"


def builtin_skills_root() -> Path:
    """内置技能目录（随 `app/` 整目录打包）。"""
    return Path(__file__).resolve().parent / "builtin"


def get_skill_store() -> SkillStore:
    """进程内单例；测试通过 `reset_skill_store()` 或自建 `SkillStore` 隔离。"""
    global _store
    if _store is None:
        _store = SkillStore(builtin_skills_root(), user_skills_root())
    return _store


def reset_skill_store() -> None:
    global _store
    _store = None
