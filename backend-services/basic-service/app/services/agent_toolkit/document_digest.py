"""文档分层摘要：小模型做整理、大模型只读摘要 + 按页精读。

设计基线：docs/plans/agent-general-toolkit/spec.md §3.3.5。

三条纪律：
1. 摘要是**后台任务**，失败/超时/上下文不足都不影响 `read_document`；
2. 单文档单任务锁（同一 `document_id` 同时只有一个摘要任务）；
3. 摘要**不是证据**——读取结果始终带 `digest_is_summary: true`。
"""
import asyncio
import json
import time
from pathlib import Path

from app.logger import get_logger

logger = get_logger(__name__)

DOCUMENT_DIGEST_THRESHOLD_CHARS = 60_000
MAX_BATCHES = 12
MAX_BATCH_CHARS = 12_000
BATCH_MAX_TOKENS = 900
SUMMARY_CHAR_LIMIT = 400
LLM_TIMEOUT_SECONDS = 90

_locks: dict[str, asyncio.Lock] = {}
_tasks: dict[str, asyncio.Task] = {}


def utcnow():
    return time.monotonic()


def should_digest(text):
    return len(text) > DOCUMENT_DIGEST_THRESHOLD_CHARS


def _batches(text, offsets):
    """按页切成 ≤12 批、每批 ≤12k 字符（保留页区间标签）。"""
    page_starts = [(item["page"], item["start"], item["end"]) for item in offsets]
    chunks = []
    for page, start, end in page_starts:
        body = text[start:end]
        if not body:
            continue
        chunks.append((page, page, body))
    batches = []
    current = {"pages": [], "body": ""}
    for first, last, body in chunks:
        if current["body"] and (len(current["body"]) + len(body) > MAX_BATCH_CHARS
                                or len(batches) >= MAX_BATCHES - 1):
            batches.append(current)
            current = {"pages": [], "body": ""}
        if not current["pages"]:
            current["pages"] = [first, last]
        else:
            current["pages"][1] = last
        current["body"] += body + "\n"
    if current["body"]:
        batches.append(current)
    return batches[:MAX_BATCHES]


def _messages(pages, body):
    system = (
        "You compress long documents for a video-editing assistant. "
        "Answer with plain text only, no markdown headings."
    )
    user = (
        f"Summarise pages {pages[0]}-{pages[1]} in at most "
        f"{SUMMARY_CHAR_LIMIT} characters. Keep named entities, numbers, "
        "dates and decisions; drop pleasantries and repeated phrasing.\n\n"
        f"{body}"
    )
    return [{"role": "system", "content": system},
            {"role": "user", "content": user}]


async def _model_config():
    from app.services.model_settings_service import get_model_settings_service

    return await get_model_settings_service().resolve_toolkit_digest_config()


def digest_path(directory, document_id):
    return Path(directory) / "digest" / (document_id + ".json")


def read_digest(directory, document_id):
    path = digest_path(directory, document_id)
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


async def _summarise(document_id, text, offsets, directory, session_factory):
    from app.models.agent_toolkit_db_models import AgentDocument
    from app.services.web_research.research_model_client import (
        ResearchModelClient,
    )

    client = ResearchModelClient()
    summaries = []
    try:
        config = await _model_config()
    except Exception as error:  # noqa: BLE001 - 摘要失败不影响读取
        await _set_state(document_id, "failed", session_factory)
        logger.info("Document digest skipped for %s: %s", document_id, error)
        return
    for batch in _batches(text, offsets):
        deadline = asyncio.get_running_loop().time() + LLM_TIMEOUT_SECONDS
        try:
            summary = await client.complete(
                config, _messages(batch["pages"], batch["body"]),
                BATCH_MAX_TOKENS, deadline=deadline)
        except Exception as error:  # noqa: BLE001
            await _set_state(document_id, "failed", session_factory)
            logger.info("Document digest failed for %s: %s", document_id, error)
            return
        summaries.append({
            "pages": batch["pages"],
            "summary": (summary or "").strip()[:SUMMARY_CHAR_LIMIT],
        })
    payload = {
        "digest": "\n".join(item["summary"] for item in summaries),
        "chunks": summaries,
        "model": getattr(config, "model_name", None),
        "document_id": document_id,
    }
    path = digest_path(directory, document_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)
    await _set_state(document_id, "ready", session_factory)


async def _set_state(document_id, state, session_factory):
    from sqlalchemy import select

    from app.models.agent_toolkit_db_models import AgentDocument

    if session_factory is None:
        from app.database import async_session_factory

        session_factory = async_session_factory
    try:
        async with session_factory() as session:
            row = (await session.execute(select(AgentDocument).where(
                AgentDocument.id == document_id))).scalar_one_or_none()
            if row is not None:
                row.digest_state = state
                await session.commit()
    except Exception as error:  # noqa: BLE001 - 只是状态标记
        logger.warning("Could not record digest_state for %s: %s",
                       document_id, error)


def schedule(document_id, text, offsets, directory, session_factory=None):
    """非阻塞启动摘要；同一文档同时只允许一个任务。"""
    if not should_digest(text):
        return None
    existing = _tasks.get(document_id)
    if existing is not None and not existing.done():
        return existing
    lock = _locks.setdefault(document_id, asyncio.Lock())

    async def runner():
        async with lock:
            try:
                await _summarise(document_id, text, offsets, directory,
                                 session_factory)
            except asyncio.CancelledError:
                raise
            except Exception as error:  # noqa: BLE001
                logger.warning("Document digest crashed for %s: %s",
                               document_id, error)
                await _set_state(document_id, "failed", session_factory)
            finally:
                _tasks.pop(document_id, None)

    task = asyncio.create_task(runner())
    _tasks[document_id] = task
    return task


async def wait_all():
    """测试与关停用：等待所有进行中的摘要任务。"""
    pending = [task for task in _tasks.values() if not task.done()]
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)
