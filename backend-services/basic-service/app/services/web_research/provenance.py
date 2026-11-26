"""来源标识长期稳定，完整候选 URL 仅存在 run 的有界内存中。"""
import json
import re
from datetime import datetime, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import uuid4

from app.models.web_research_models import WebResearchError

SENSITIVE = re.compile(r"token|key|auth|signature|credential|secret|password|sig$", re.I)
# 发布时间只认 ISO-8601 形状：站点乱写年份时宁可 `None`，否则引用会带着假日期
# 进用户的稿子（spec agent-browser-article-reading AC-A4 / §7.2）。
ISO_SHAPE = re.compile(
    r"^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$")
CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def clip_bytes(text, maximum):
    return str(text).encode("utf-8")[:maximum].decode("utf-8", "ignore")


def display_url(url):
    try:
        parts = urlsplit(url)
        if parts.scheme not in {"http", "https"} or not parts.hostname:
            return ""
        query = [(k, "[redacted]" if SENSITIVE.search(k) else v)
                 for k, v in parse_qsl(parts.query, keep_blank_values=True)]
        return urlunsplit((parts.scheme, parts.netloc.rsplit("@", 1)[-1],
                           parts.path, urlencode(query), ""))
    except ValueError:
        return ""


def iso_or_none(value):
    """只接受可解析的 ISO-8601；形状不符即 `None`（宁缺勿造）。"""
    text = str(value or "").strip()[:64]
    if not ISO_SHAPE.match(text):
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return text if 1990 <= parsed.year <= 2100 else None


def author_or_none(value):
    """剥控制字符并截断：`author` 会被模型当引用读，页面可拿它做提示注入（§9）。"""
    text = CONTROL.sub(" ", str(value or "")).strip()[:120]
    return text or None


def source_record(url, title="", final_url=None, published_at=None,
                  author=None, canonical_url=None):
    """来源记录。三个元数据参数**可选**：不传时行为与旧调用逐字节相同。"""
    return {"id": str(uuid4()), "url": display_url(url),
            "final_url": display_url(final_url or url),
            "title": clip_bytes(title, 512),
            "domain": urlsplit(url).hostname or "",
            "retrieved_at": datetime.now(timezone.utc).isoformat(),
            "published_at": iso_or_none(published_at),
            "author": author_or_none(author),
            "canonical_url": display_url(canonical_url) or None,
            "license_status": "unknown", "license_url": None}


def add_candidate(run, url, source, **metadata):
    identifier = str(uuid4())
    record = {"url": url, "source": source, **metadata}
    run.candidates[identifier] = record
    while (len(run.candidates) > 256 or
           len(json.dumps(run.candidates).encode()) > 1024 * 1024):
        run.candidates.popitem(last=False)
    return {"candidate_id": identifier, "image_url": display_url(url),
            "source_page_url": source["url"], "source_id": source["id"],
            "license_status": "unknown", **metadata}


def resolve_candidate(run, identifier):
    record = run.candidates.get(str(identifier))
    if record is None:
        raise WebResearchError("candidate_expired")
    run.candidates.move_to_end(str(identifier))
    return record
