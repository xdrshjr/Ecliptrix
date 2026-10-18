"""来源标识长期稳定，完整候选 URL 仅存在 run 的有界内存中。"""
import json
import re
from datetime import datetime, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import uuid4

from app.models.web_research_models import WebResearchError

SENSITIVE = re.compile(r"token|key|auth|signature|credential|secret|password|sig$", re.I)


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


def source_record(url, title="", final_url=None):
    return {"id": str(uuid4()), "url": display_url(url),
            "final_url": display_url(final_url or url),
            "title": clip_bytes(title, 512),
            "domain": urlsplit(url).hostname or "",
            "retrieved_at": datetime.now(timezone.utc).isoformat(),
            "published_at": None, "author": None,
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
