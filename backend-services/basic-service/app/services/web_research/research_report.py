"""来源证据与报告纯函数；模型不能覆盖质量、取得方式或来源限制。"""
import copy
import json
import re
from dataclasses import dataclass
from typing import Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from app.models.web_research_models import WebResearchData, WebResearchError
from .provenance import SENSITIVE, clip_bytes, display_url
from .research_model_client import normalize_unicode, strict_json_object

REPORT_LIMIT = 393216
KINDS = ("page_text", "search_snippet", "unavailable")
SOURCE_ERRORS = {
    "robots_disallowed",
    "url_forbidden",
    "unsupported_content_type",
    "upstream_timeout",
    "candidate_expired",
    "empty_source",
    "source_unavailable",
}
URL_PATTERN = re.compile(r'https?://[^\s<>"，。；！？、：‘’“”]+', re.I)
EXTRA_SENSITIVE = re.compile(r"authorization|api.?key|^x-amz-|^x-goog-", re.I)
GENERIC_LIMITATION = "来源覆盖可能不足，请结合原文核实。"
SECOND_SEARCH_LIMITATION = "补充搜索未完成，报告仅使用已取得的来源。"


@dataclass(frozen=True)
class SourceEvidence:
    source: dict
    kind: Literal["page_text", "search_snippet", "unavailable"]
    text: str
    fetch_error_code: str | None = None


def safe_source_url(value):
    """复用展示规则，再删除敏感参数；绝不返回截断或非法链接。"""
    if not isinstance(value, str) or not value:
        return ""
    try:
        value = normalize_unicode(value)
        if re.search(r"[\s\\]", value):
            return ""
        original = urlsplit(value)
        _ = original.port
        safe = display_url(value)
        if not safe:
            return ""
        parts = urlsplit(safe)
        pairs = [
            (key, val)
            for key, val in parse_qsl(parts.query, keep_blank_values=True)
            if not SENSITIVE.search(key) and not EXTRA_SENSITIVE.search(key)
        ]
        safe = urlunsplit(
            (parts.scheme, parts.netloc, parts.path, urlencode(pairs), "")
        )
        return safe if len(safe.encode("utf-8")) <= 4096 else ""
    except (ValueError, UnicodeError):
        return ""


def _replace_url(match):
    raw = match.group(0)
    candidate = raw.rstrip(".,;!")
    prefix = match.string[match.start() - 1] if match.start() else ""
    if prefix == "'" and candidate.endswith("'"):
        candidate = candidate[:-1]
    # Markdown 包裹符不属于 URL；成对括号仍可能位于密码、查询或 IPv6 主机中。
    pairs = {")": "(", "]": "[", "}": "{"}
    while candidate and candidate[-1] in pairs:
        closing = candidate[-1]
        if candidate.count(closing) <= candidate.count(pairs[closing]):
            break
        candidate = candidate[:-1]
    suffix = raw[len(candidate) :]
    return (safe_source_url(candidate) or "链接已隐藏") + suffix


def sanitize_text(text, maximum=None):
    cleaned = URL_PATTERN.sub(_replace_url, normalize_unicode(text)).strip()
    return (
        clip_bytes(cleaned, maximum).strip() if maximum is not None else cleaned
    )


def _source_copy(source):
    result = {}
    for key, size in (
        ("id", 128),
        ("title", 512),
        ("domain", 256),
        ("retrieved_at", 64),
        ("published_at", 64),
        ("author", 512),
    ):
        value = source.get(key)
        nullable = key in {"retrieved_at", "published_at", "author"}
        result[key] = (
            sanitize_text(value, size)
            if isinstance(value, str)
            else (None if nullable else "")
        )
    for key in ("url", "final_url", "license_url"):
        value = safe_source_url(source.get(key))
        result[key] = value or ("" if key == "url" else None)
    result["license_status"] = (
        source.get("license_status")
        if source.get("license_status") in {"unknown", "declared"}
        else "unknown"
    )
    return result


def normalize_source(source, page=None, snippet="", error_code=None):
    result = _source_copy(source)
    body = (
        sanitize_text(page.get("text", ""), 12000) if page is not None else ""
    )
    if body:
        kind, text, error_code = "page_text", body, None
        if isinstance(page.get("title"), str):
            result["title"] = sanitize_text(page["title"], 512)
        if "final_url" in page:
            result["final_url"] = safe_source_url(page["final_url"]) or None
    else:
        text = sanitize_text(snippet, 400)
        kind = "search_snippet" if text else "unavailable"
        if page is not None:
            error_code = "empty_source"
        error_code = (
            error_code if error_code in SOURCE_ERRORS else "source_unavailable"
        )
    result.update(evidence_kind=kind, fetch_error_code=error_code)
    return SourceEvidence(result, kind, text, error_code)


def summarize_coverage(evidence):
    if len(evidence) > 5 or any(item.kind not in KINDS for item in evidence):
        raise ValueError("invalid_evidence")
    coverage = {
        "selected": len(evidence),
        **{kind: sum(item.kind == kind for item in evidence) for kind in KINDS},
    }
    if coverage["unavailable"] == coverage["selected"]:
        quality = "none"
    elif coverage["page_text"] == coverage["selected"]:
        quality = "full_text"
    elif coverage["page_text"] == 0:
        quality = "snippets_only"
    else:
        quality = "mixed"
    return quality, coverage


def _report_text(text, maximum, required=False):
    if not isinstance(text, str):
        raise ValueError("invalid_report")
    text = sanitize_text(text)
    if len(text.encode("utf-8")) > maximum or (required and not text):
        raise ValueError("invalid_report")
    return text


def _validate_fact(fact, source_ids):
    if not isinstance(fact, dict) or set(fact) != {"text", "source_ids"}:
        raise ValueError("invalid_citation")
    ids = _citation_ids(fact["source_ids"])
    if not set(ids) <= source_ids:
        raise ValueError("invalid_citation")
    return {
        "text": _report_text(fact["text"], 1000, required=True),
        "source_ids": ids,
    }


def _citation_ids(ids):
    if not isinstance(ids, list) or not 1 <= len(ids) <= 5:
        raise ValueError("invalid_citation")
    if any(not isinstance(key, str) for key in ids):
        raise ValueError("invalid_citation")
    ids = [normalize_unicode(key) for key in ids]
    if any(
        not key.strip() or len(key.encode("utf-8")) > 128 for key in ids
    ) or len(set(ids)) != len(ids):
        raise ValueError("invalid_citation")
    return ids


def _report_collections(report, source_ids):
    if not isinstance(report, dict) or set(report) != {
        "brief",
        "facts",
        "uncertainties",
    }:
        raise ValueError("invalid_report")
    facts, uncertainties = report["facts"], report["uncertainties"]
    if (
        not isinstance(facts, list)
        or len(facts) > 20
        or (source_ids and not facts)
    ):
        raise ValueError("invalid_report")
    if not isinstance(uncertainties, list) or len(uncertainties) > 10:
        raise ValueError("invalid_report")
    return facts, uncertainties


def validate_report(report, source_ids):
    """保留二参数接口，原始文本走严格 JSON，旧 dict 调用仍可验证。"""
    try:
        if isinstance(report, str):
            report = strict_json_object(report)
        facts, uncertainties = _report_collections(report, source_ids)
        return {
            "brief": _report_text(report["brief"], 6000, required=True),
            "facts": [_validate_fact(fact, source_ids) for fact in facts],
            "uncertainties": [
                _report_text(item, 512) for item in uncertainties
            ],
        }
    except (UnicodeError, RecursionError):
        raise ValueError("invalid_report") from None


def _local_report(evidence):
    facts = [
        {"text": clip_bytes(item.text, 700), "source_ids": [item.source["id"]]}
        for item in evidence
        if item.kind != "unavailable" and item.text.strip()
    ]
    return {
        "brief": "已收集来源摘录，尚需结合原文核实。" if facts else "未取得可引用资料。",
        "facts": facts,
        "uncertainties": [],
    }


def _limitations(evidence, additional, second_search_failed):
    values = []
    for index, item in enumerate(evidence, 1):
        if item.kind == "search_snippet":
            values.append(f"来源[{index}]未取得原文，仅使用搜索摘要。")
        elif item.kind == "unavailable":
            values.append(f"来源[{index}]未取得可引用内容。")
    if second_search_failed:
        values.append(SECOND_SEARCH_LIMITATION)
    values.extend(additional)
    unique = list(
        dict.fromkeys(sanitize_text(value, 512) for value in values if value)
    )
    # 模型的补充说明不能挤掉服务端固定的核实提示。
    unique = [value for value in unique if value != GENERIC_LIMITATION]
    return unique[:9] + [GENERIC_LIMITATION]


def _degradation(quality, coverage, usage):
    if not coverage["selected"]:
        return "no_sources"
    if quality in {"none", "snippets_only"}:
        return "sources_unavailable"
    if usage["query"]["status"] == "failed":
        return "research_model_unavailable"
    if usage["synthesis"]["status"] != "succeeded":
        return "excerpts_only"
    return "partial_sources" if quality == "mixed" else None


def _safe_model_usage(usage):
    result = copy.deepcopy(usage)
    for stage in result.values():
        if stage.get("model_name") is not None:
            original = stage["model_name"]
            name = sanitize_text(original, 256)
            stage["model_name"] = (
                name if name and not URL_PATTERN.search(original) else "已配置研究模型"
            )
    return result


def finalize_report(options):
    evidence = options["evidence"]
    quality, coverage = summarize_coverage(evidence)
    usage = _safe_model_usage(options["model_usage"])
    adopted = options.get("report")
    if adopted is not None:
        ids = {
            item.source["id"]
            for item in evidence
            if item.kind != "unavailable" and item.text.strip()
        }
        report = validate_report(adopted, ids)
    else:
        report = _local_report(evidence)
    _annotate_facts(report, evidence)
    report["uncertainties"] = _limitations(
        evidence,
        report["uncertainties"],
        options.get("second_search_failed", False),
    )
    model_used = (
        usage["synthesis"]["model_name"] if adopted is not None else None
    )
    result = {
        **report,
        "sources": [
            {
                **item.source,
                "evidence_kind": item.kind,
                "fetch_error_code": item.fetch_error_code,
            }
            for item in evidence
        ],
        "quality": quality,
        "coverage": coverage,
        "model_usage": usage,
        "degraded": _degradation(quality, coverage, usage),
        "model_used": model_used,
    }
    validated = WebResearchData(**result).model_dump()
    return {key: validated[key] for key in result}


def _annotate_facts(report, evidence):
    kinds = {item.source["id"]: item.kind for item in evidence}
    for fact in report["facts"]:
        fact["evidence_kind"] = (
            "includes_snippet"
            if any(kinds[key] == "search_snippet" for key in fact["source_ids"])
            else "page_text"
        )


def serialize_report(report, evidence):
    document = {
        key: value
        for key, value in report.items()
        if key not in {"artifact_id", "elapsed_ms"}
    }
    document.update(
        schema_version=2,
        evidence=[
            {
                "source_id": item.source["id"],
                "kind": item.kind,
                "text": item.text,
                "fetch_error_code": item.fetch_error_code,
            }
            for item in evidence
        ],
    )
    raw = json.dumps(
        document, ensure_ascii=False, separators=(",", ":"), allow_nan=False
    ).encode("utf-8")
    if len(raw) > REPORT_LIMIT:
        raise WebResearchError("response_too_large")
    return raw
