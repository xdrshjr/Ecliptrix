"""观察缓存 CRUD + TTL/LRU + 日用量计数 + 产物目录。

设计基线：docs/plans/agent-visual-review/spec.md §4.14 / §6.1 / §6.2。

三件事必须一起做对：

1. **缓存键** `sha256(encoded_sha256 + mode + question_template + model)`。
   键里含编码后的摘要，所以切换模型或改 `max_image_side_px` 会自然失效
   （§4.14 失效条款），不需要额外失效逻辑。
2. **淘汰**只在每次写入后抽样执行（过期行 + 超 2000 条按 `created_at` LRU），
   **不做**常驻后台任务——桌面端不该多一个循环。
3. **失败也要落库**：`model_not_multimodal` 的记忆避免当日重复试错（§4.6），
   因此 `error_code` 单独存一列而不是揉进 summary。
"""
import hashlib
import json
import re
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from sqlalchemy import select

from app.models.agent_vision_db_models import (
    AgentVisionObservation,
    AgentVisionUsage,
)
from app.models.agent_vision_models import AgentVisionError

# 条数上限与 TTL（§4.14：7 天 TTL + 2000 条 LRU）。
MAX_ENTRIES = 2000
DEFAULT_TTL_DAYS = 7
# 缓存键里的问题模板：折叠空白后取前 300 字符（与请求模型的 question 上限同阶）。
MAX_TEMPLATE_CHARS = 300
# 模型可见摘要上限：完整原文用 `/observations/{id}` 分页取（§4.7）。
MODEL_SUMMARY_CHARS = 400
# 观察正文分页默认值与上限（§5.1 `/observations/{id}`）。
DEFAULT_READ_BYTES = 4000
MAX_READ_BYTES = 8000
PROBE_JSON_MAX_BYTES = 64 * 1024

_CALL_ID_SAFE = re.compile(r"^[A-Za-z0-9._-]{1,128}$")
_WHITESPACE = re.compile(r"\s+")


def utcnow() -> datetime:
    """SQLite 侧统一存 naive UTC（与 agent_toolkit / research 同口径）。"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _session_factory(session_factory=None):
    if session_factory is not None:
        return session_factory
    from app.database import async_session_factory

    return async_session_factory


# ── 缓存键 ────────────────────────────────────────────────────────────────


def question_template(question: str, checklist=None) -> str:
    """把自由问题收敛成稳定的模板串，避免同一提问的措辞差异打穿缓存。"""
    parts = [_WHITESPACE.sub(" ", str(question or "")).strip().lower()]
    parts.extend(sorted(str(item).lower() for item in (checklist or [])))
    return "|".join(part for part in parts if part)[:MAX_TEMPLATE_CHARS]


def cache_key(image_sha256, *, mode: str, template: str,
              model_name: str) -> str:
    """`sha256(image digest + mode + template + model)`。"""
    digests = image_sha256 if isinstance(image_sha256, str) else "".join(
        image_sha256)
    material = "\u0000".join([digests, str(mode or ""),
                              str(template or ""), str(model_name or "")])
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


# ── 产物目录（§6.2） ──────────────────────────────────────────────────────


def observation_root() -> Path:
    """`<STORAGE_ROOT 父目录>/agent_vision`；不做静态挂载。"""
    from app.config import settings

    root = Path(settings.storage.root).resolve().parent / "agent_vision"
    return root


def run_directory(call_id: str, *, create: bool = True) -> Path:
    """`<root>/<call_id>/`；目录名只由已校验的 `call_id` 派生（§4.13.3）。"""
    if not _CALL_ID_SAFE.match(str(call_id or "")):
        raise AgentVisionError("invalid_call_id",
                              message="call id contains unsafe characters")
    directory = observation_root() / str(call_id)
    if not create:
        return directory
    try:
        for name in ("input", "frames"):
            (directory / name).mkdir(parents=True, exist_ok=True)
    except OSError as error:
        raise AgentVisionError(
            "storage_unavailable",
            message=("vision artifact directory is not writable: "
                     f"{error.strerror}"),
        ) from None
    return directory


def write_blob(relative: str, body: bytes) -> str:
    """写一个小产物（帧/联系表/probe.json），返回相对 run 目录的路径。"""
    target = observation_root() / relative
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
    except OSError as error:
        raise AgentVisionError(
            "storage_unavailable",
            message=f"vision artifact write failed: {error.strerror}",
        ) from None
    return relative


def write_probe_json(call_id: str, payload: dict) -> str:
    """`probe.json` 截断 64 KiB 后落盘（§4.9）。

    截断的是**字段内容**而不是序列化后的字节：把 JSON 从中间切断会留下一个
    解析不了的 `probe.json`（"截断"变成"损坏"）。超预算时保留元数据并显式
    标记 `truncated`，让读它的人知道少了什么。
    """
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    if len(body) > PROBE_JSON_MAX_BYTES:
        trimmed = dict(payload)
        probe = dict(trimmed.get("probe") or {})
        for key in ("black", "freeze", "silence"):
            probe[key] = (probe.get(key) or [])[:20]
        trimmed["probe"] = probe
        trimmed["truncated"] = True
        trimmed["truncated_reason"] = (
            f"probe output exceeded {PROBE_JSON_MAX_BYTES} bytes")
        body = json.dumps(trimmed, ensure_ascii=False).encode("utf-8")
        if len(body) > PROBE_JSON_MAX_BYTES:
            body = json.dumps(
                {"truncated": True,
                 "probe": {"available": probe.get("available")},
                 "issues": (trimmed.get("issues") or [])[:10],
                 "skipped": (trimmed.get("skipped") or [])[:10],
                 "truncated_reason": (
                     f"probe output exceeded {PROBE_JSON_MAX_BYTES} bytes")},
                ensure_ascii=False).encode("utf-8")
    return write_blob(f"{call_id}/probe.json", body)


# ── 观察读写 ──────────────────────────────────────────────────────────────


def _ttl_days() -> int:
    from app.services.system_settings_service import agent_vision_settings

    return int(agent_vision_settings()["cache_ttl_days"])


async def find_cached(cache_key_value: str, *, session_factory=None):
    """命中即 `hits + 1` 并返回该行；`cached_calls` 由调用方单独记账。"""
    factory = _session_factory(session_factory)
    now = utcnow()
    async with factory() as session:
        statement = (select(AgentVisionObservation)
                     .where(AgentVisionObservation.cache_key == cache_key_value)
                     .order_by(AgentVisionObservation.created_at.desc()))
        row = (await session.execute(statement)).scalars().first()
        if row is None:
            return None
        if row.expires_at is not None and row.expires_at <= now:
            return None
        row.hits = (row.hits or 0) + 1
        await session.commit()
        return row


async def write_observation(record: dict, *, session_factory=None) -> dict:
    """写入一条观察（成功或失败）；返回 `{observation_id, expires_at}`。"""
    factory = _session_factory(session_factory)
    now = utcnow()
    ttl = int(record.get("ttl_days", _ttl_days()))
    identifier = str(uuid4())
    row = AgentVisionObservation(
        id=identifier,
        project_id=record.get("project_id"),
        call_id=str(record.get("call_id") or ""),
        source_kind=str(record.get("source_kind") or "material")[:16],
        source_ref=str(record.get("source_ref") or "")[:255],
        image_sha256=str(record.get("image_sha256") or "")[:64],
        cache_key=str(record.get("cache_key") or "")[:64],
        mode=str(record.get("mode") or "look")[:8],
        model_provider=str(record.get("model_provider") or "")[:64],
        model_name=str(record.get("model_name") or "")[:128],
        verdict=str(record.get("verdict") or "concern")[:8],
        summary=str(record.get("summary") or ""),
        observations_json=json.dumps(record.get("observations") or [],
                                     ensure_ascii=False),
        issues_json=json.dumps(record.get("issues") or [], ensure_ascii=False),
        text_lines_json=(json.dumps(record["text_lines"], ensure_ascii=False)
                         if record.get("text_lines") else None),
        chars=len(str(record.get("summary") or "")),
        failed=bool(record.get("failed")),
        error_code=record.get("error_code"),
        created_at=now,
        expires_at=(now + timedelta(days=ttl) if ttl > 0 else None),
        hits=0,
    )
    async with factory() as session:
        session.add(row)
        await session.commit()
    await prune(session_factory=factory)
    return {"observation_id": identifier, "expires_at": row.expires_at}


async def get_observation(identifier: str, *, session_factory=None):
    """按 id 取行；过期/不存在 → `observation_not_found`。"""
    factory = _session_factory(session_factory)
    async with factory() as session:
        row = await session.get(AgentVisionObservation, str(identifier))
    # 过期判定与 `find_cached` 同口径：`cache_ttl_days` 是承诺，不能只靠抽样
    # 清理兑现（清理按条数触发，安静的项目可能几天不跑）。
    if row is not None and row.expires_at is not None and row.expires_at <= utcnow():
        row = None
    if row is None:
        raise AgentVisionError("observation_not_found",
                              message="observation not found")
    return row


def row_summary(row) -> str:
    """拼接完整观察正文（分页读取的源）。"""
    parts = [row.summary or ""]
    observations = _loads(row.observations_json)
    for item in observations:
        text = item.get("text") if isinstance(item, dict) else None
        if text:
            parts.append(f"- {text}")
    for item in _loads(row.issues_json):
        if isinstance(item, dict) and item.get("note"):
            parts.append(f"! [{item.get('severity')}] {item.get('note')}")
    lines = _loads(row.text_lines_json)
    if lines:
        parts.append("text_lines: " + " / ".join(str(line) for line in lines))
    return "\n".join(part for part in parts if part).strip()


def _loads(raw):
    if not raw:
        return []
    try:
        return json.loads(raw)
    except ValueError:  # pragma: no cover - 库里只存我们自己写的 JSON
        return []


def text_page(row, offset: int = 0,
              max_bytes: int = DEFAULT_READ_BYTES) -> dict:
    """UTF-8 边界安全的字节分页（同 artifact_store / workspace_store 口径）。"""
    body = row_summary(row).encode("utf-8")
    if offset < 0 or offset > len(body):
        raise AgentVisionError("invalid_argument",
                              message="offset out of range")
    if offset < len(body) and body[offset] & 0xC0 == 0x80:
        raise AgentVisionError("invalid_argument",
                              message="offset is not a UTF-8 boundary")
    if not 1 <= int(max_bytes) <= MAX_READ_BYTES:
        raise AgentVisionError(
            "invalid_argument",
            message=f"max_bytes must be 1..{MAX_READ_BYTES}")
    end = min(len(body), offset + int(max_bytes))
    while end < len(body) and end > offset and body[end] & 0xC0 == 0x80:
        end -= 1
    return {
        "text": body[offset:end].decode("utf-8"),
        "offset": offset,
        "next_offset": end if end < len(body) else None,
        "chars": len(row.summary or ""),
    }


def payload_for_model(row, *, images: int, cached: bool,
                      next_step: str | None = None) -> dict:
    """§4.7 的模型可见形状；像素一律不进这里（`untrusted` 由路由补）。"""
    summary = (row.summary or "")[:MODEL_SUMMARY_CHARS]
    payload = {
        "ok": (row.verdict or "concern") != "fail" and not row.failed,
        "verdict": row.verdict or "concern",
        "summary": summary,
        "observations": _loads(row.observations_json),
        "issues": _loads(row.issues_json),
        "text_lines": _loads(row.text_lines_json) or [],
        "images": int(images),
        "cached": bool(cached),
        "observation_id": row.id,
    }
    if next_step:
        payload["next_step"] = next_step
    return payload


# ── 淘汰 ──────────────────────────────────────────────────────────────────


async def prune(*, session_factory=None) -> dict:
    """过期行删除 + 超 `MAX_ENTRIES` 按 `created_at` LRU（写后抽样，§4.14）。"""
    factory = _session_factory(session_factory)
    now = utcnow()
    removed = 0
    call_ids: list[str] = []
    async with factory() as session:
        statement = select(AgentVisionObservation).where(
            AgentVisionObservation.expires_at.is_not(None),
            AgentVisionObservation.expires_at <= now)
        doomed = list((await session.execute(statement)).scalars())
        survivors = list((await session.execute(
            select(AgentVisionObservation)
            .order_by(AgentVisionObservation.created_at.asc()))).scalars())
        overflow = len(survivors) - MAX_ENTRIES
        doomed.extend(survivors[:max(0, overflow)])
        # 先取纯字符串：删行的对象不宜再被用于路径拼接。
        call_ids = [row.call_id for row in doomed if row.call_id]
        removed = len(doomed)
        for row in doomed:
            await session.delete(row)
        if removed:
            await session.commit()
    return {"removed_rows": removed,
            "removed_dirs": _remove_directories(call_ids)}


def _remove_directories(call_ids) -> int:
    removed = 0
    for call_id in call_ids:
        if call_id and _CALL_ID_SAFE.match(call_id):
            removed += _remove_directory(call_id)
    return removed


def _remove_directory(call_id: str) -> int:
    directory = observation_root() / call_id
    if not directory.is_dir() or directory.is_symlink():
        return 0
    try:
        shutil.rmtree(directory)
        return 1
    except OSError:  # pragma: no cover - 文件被占用时下次再清
        return 0


async def clear_cache(project_id=None, *, session_factory=None) -> dict:
    """设置面板的「清空缓存」；`project_id=None` 清全部（§5.1）。"""
    factory = _session_factory(session_factory)
    removed = 0
    call_ids: list[str] = []
    async with factory() as session:
        statement = select(AgentVisionObservation)
        if project_id is not None:
            statement = statement.where(
                AgentVisionObservation.project_id == project_id)
        rows = list((await session.execute(statement)).scalars())
        call_ids = [row.call_id for row in rows if row.call_id]
        removed = len(rows)
        for row in rows:
            await session.delete(row)
        if rows:
            await session.commit()
    _remove_directories(call_ids)
    return {"removed": removed}


# ── 日用量 ────────────────────────────────────────────────────────────────


def today() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def _local_day_start_utc(day: str) -> datetime:
    """本地日 `day` 起点对应的 **naive UTC** 时刻。

    `created_at` 存的是 naive UTC，而 `today()` 是本地日：直接拿本地零点当
    UTC 比较会把本地 00:00–08:00（UTC+8）之间写的行全部漏掉。
    """
    return datetime.strptime(day, "%Y-%m-%d").astimezone(
        timezone.utc).replace(tzinfo=None)


def _local_day_of(created_at: datetime) -> str:
    """naive UTC 的 `created_at` → 本地日 `YYYY-MM-DD`（与 `today()` 同口径）。"""
    return created_at.replace(tzinfo=timezone.utc).astimezone().strftime(
        "%Y-%m-%d")


async def record_usage(delta: dict, *, session_factory=None) -> dict:
    """按 `(day, project_id)` 累加；唯一性由 select-then-insert 保证（§6.1）。"""
    factory = _session_factory(session_factory)
    day = str(delta.get("day") or today())
    project_id = delta.get("project_id")
    async with factory() as session:
        statement = select(AgentVisionUsage).where(
            AgentVisionUsage.day == day,
            AgentVisionUsage.project_id.is_(None) if project_id is None
            else AgentVisionUsage.project_id == project_id)
        row = (await session.execute(statement)).scalars().first()
        if row is None:
            row = AgentVisionUsage(id=str(uuid4()), day=day,
                                   project_id=project_id, calls=0, images=0,
                                   cached_calls=0, failures=0)
            session.add(row)
        row.calls = (row.calls or 0) + int(delta.get("calls", 0))
        row.images = (row.images or 0) + int(delta.get("images", 0))
        row.cached_calls = (row.cached_calls or 0) + int(delta.get("cached", 0))
        row.failures = (row.failures or 0) + int(delta.get("failures", 0))
        if delta.get("error_code"):
            row.last_error_code = str(delta["error_code"])[:48]
        row.updated_at = utcnow()
        await session.commit()
        snapshot = {"calls": row.calls, "images": row.images,
                    "cached_calls": row.cached_calls, "failures": row.failures,
                    "last_error_code": row.last_error_code, "day": day}
    return snapshot


async def daily_usage(project_id=None, *, session_factory=None) -> dict:
    """`/usage` 的 `data`：今日计数 + 失败码分布（§5.1）。"""
    factory = _session_factory(session_factory)
    day = today()
    async with factory() as session:
        statement = select(AgentVisionUsage).where(AgentVisionUsage.day == day)
        if project_id is not None:
            statement = statement.where(
                AgentVisionUsage.project_id == project_id)
        rows = list((await session.execute(statement)).scalars())
        # 失败码分布直接在 SQL 里限定"今天 + 本项目"：全表扫 failed 行会随
        # 使用量无限增长，而这里只需要当天的一小撮。
        day_start = _local_day_start_utc(day)
        failed_statement = select(AgentVisionObservation).where(
            AgentVisionObservation.failed.is_(True),
            AgentVisionObservation.created_at >= day_start)
        if project_id is not None:
            failed_statement = failed_statement.where(
                AgentVisionObservation.project_id == project_id)
        failed = list((await session.execute(failed_statement)).scalars())
    by_code = {}
    for row in failed:
        if row.created_at is None or _local_day_of(row.created_at) != day:
            continue
        code = row.error_code or "model_failed"
        by_code[code] = by_code.get(code, 0) + 1
    return {
        "calls": sum(row.calls or 0 for row in rows),
        "images": sum(row.images or 0 for row in rows),
        "cached_calls": sum(row.cached_calls or 0 for row in rows),
        "failures": sum(row.failures or 0 for row in rows),
        "by_code": by_code,
        "day": day,
    }


async def quota_used(project_id=None, *, session_factory=None) -> dict:
    """日限判定只需要 `calls` / `images`（§4.12 `vision_quota_exceeded`）。

    与 `daily_usage` 不同，这里**严格按桶**统计（`project_id` 或全局桶）：
    日限是 `(day, project_id)` 维度的，混算会让某个项目借全局桶绕过自己的上限。
    """
    factory = _session_factory(session_factory)
    day = today()
    async with factory() as session:
        statement = select(AgentVisionUsage).where(AgentVisionUsage.day == day)
        statement = statement.where(
            AgentVisionUsage.project_id.is_(None) if project_id is None
            else AgentVisionUsage.project_id == project_id)
        rows = list((await session.execute(statement)).scalars())
    return {"calls": sum(row.calls or 0 for row in rows),
            "images": sum(row.images or 0 for row in rows)}


def ensure_root() -> Path:
    """启动时确保产物根存在；失败不阻塞（写入时再报 storage_unavailable）。"""
    root = observation_root()
    try:
        root.mkdir(parents=True, exist_ok=True)
    except OSError:  # pragma: no cover - 只读安装目录
        return root
    return root


def is_safe_call_id(call_id: str) -> bool:
    return bool(_CALL_ID_SAFE.match(str(call_id or "")))


def remove_run_directory(call_id: str) -> int:
    """给路由用的一层薄封装（失败只记账，不抛）。"""
    if not is_safe_call_id(call_id):  # pragma: no cover - 路由已校验
        return 0
    return _remove_directory(call_id)


__all__ = [
    "MAX_ENTRIES", "DEFAULT_READ_BYTES", "MAX_READ_BYTES",
    "PROBE_JSON_MAX_BYTES",
    "utcnow", "question_template", "cache_key", "observation_root",
    "run_directory", "write_blob", "write_probe_json", "find_cached",
    "write_observation", "get_observation", "row_summary", "text_page",
    "payload_for_model", "prune", "clear_cache", "today", "record_usage",
    "daily_usage", "quota_used", "ensure_root", "is_safe_call_id",
    "remove_run_directory", "MODEL_SUMMARY_CHARS",
]
