"""正文抽取：归一化 / 预算 / 错误归类 / 续读校验（spec agent-browser-article-reading §4.4）。

`services/browser_workspace/` 逐文件限行，故沿用 `images.py` 的处置：逻辑留在本模块。"""
import json
from collections import OrderedDict

from app.models.web_research_models import WebResearchError
from app.services.web_research.provenance import display_url, iso_or_none

ARTICLE_MAX_BYTES = 6000  # 与 IMAGES_MAX_BYTES 同口径：单类内容的独立预算
MAX_FROM, MAX_BLOCKS = 399, 40
ARTICLE_HINT = "isolated mode cannot extract article text; use the workspace browser or web_fetch"
# 续读坐标 = tab 上一次抽取的页面指纹：DOM 一变就作废（版本号每次自增，单拿它比对会把每一次合法续读
# 都判成失效，spec 缺陷 I-1）。
_STATE: OrderedDict = OrderedDict()


def _clamp(value, low, high, fallback):
    try:
        return max(low, min(high, int(value)))
    except (TypeError, ValueError):
        return fallback


def _remember(session_id, url="", blocks=0, chars=0, reset=None):
    state = _STATE.setdefault(str(session_id), {"reset": False})
    state.update({"url": url, "blocks": blocks, "chars": chars})
    state["reset"] = bool(reset) if reset is not None else state["reset"]
    _STATE.move_to_end(str(session_id))
    while len(_STATE) > 64:
        _STATE.popitem(last=False)


def snapshot_args(entry, session_id, article=None, article_from=None,
                  article_blocks=None):
    """并进快照命令字典的增量；`article` 为假时返回 `{}`（老调用零影响）。"""
    if not article:
        return {}
    start = _clamp(article_from, 0, MAX_FROM, 0)
    state = _STATE.get(str(session_id))
    # 页面换了（或本 tab 从未抽过正文）时偏移无意义：先拉回 0，而不是拿旧偏移切新 DOM。
    if start > 0 and (state is None or (entry.url and state.get("url") != entry.url)):
        _remember(session_id, entry.url or "", 0, 0, reset=True)
        start = 0
    return {"article": True, "article_from": start,
            "article_blocks": _clamp(article_blocks, 1, MAX_BLOCKS, 12)}


async def read_snapshot(service, run, session_id, entry, base_args, wanted):
    """读一次快照；`article_from>0` 而页面已换时从第 0 块重取一次（AC-A17）。"""
    args = {**base_args, **snapshot_args(entry, session_id, **(wanted or {}))}
    snap = await service._run_command(run, "snapshot", args, session_id, 10)
    if "article" not in args:      # 未要求正文：载荷一律丢弃，老响应零变化
        snap.pop("article", None)
        return snap
    state = _STATE.get(str(session_id)) or {}
    blocks = int((snap.get("article") or {}).get("total_blocks") or 0)
    # 指纹两侧必须同一形态：`attach` 记的是脱敏 URL，带 `signature`/`sig` 的原始 URL 与它永不相等。
    page = display_url(snap.get("url", ""))
    moved = bool(state.get("url")) and (state["url"] != page or
                                        (bool(blocks) and blocks != state.get("blocks")))
    if args.get("article_from") and moved:
        # 坐标失效：偏移作废，从第 0 块重给，绝不静默错位（AC-A17）。
        args["article_from"] = 0
        _remember(session_id, page, 0, 0, reset=True)
        snap = await service._run_command(run, "snapshot", args, session_id, 10)
    return snap


def unsupported(result):
    """沙盒没有页面脚本通路（E22）：显式标记不可用，**不**假装成功、也不抛错。"""
    result["article_unsupported_in_isolated"] = True
    result["article_hint"] = ARTICLE_HINT
    return result


def attach(result, payload, source, ctx):
    """把抽取结果归一化进 `result["article"]`，元数据写进既有 `source`（唯一通路）。"""
    if payload is None:
        return None
    if payload.get("ok") is False:
        return _rejected(payload, ctx["requested"])
    article = _normalise(payload.get("article") or {}, ctx)
    if not article["blocks"]:
        return _rejected({"code": "article_not_found"}, ctx["requested"])
    # 重置标记是「这一次读取」的属性：报出后立刻清零，否则续读会一直声称已重置。
    article["article_offset_reset"] = bool(
        (_STATE.get(str(ctx["session_id"])) or {}).get("reset"))
    _remember(ctx["session_id"], ctx["url"], article["total_blocks"],
              article["char_count"])
    if isinstance(source, dict):   # 复用旧 source 的分支也必须补写（P1-9）
        for key, value in (("published_at", article["published_at"]),
                           ("author", (article["byline"] or "")[:120] or None),
                           ("canonical_url", article["canonical_url"])):
            if value:
                source[key] = value
    result["article"] = article
    return article


def _rejected(payload, requested):
    """显式要求正文却没抽到 → 404；未要求时静默忽略（老调用零影响）。"""
    code = payload.get("code") or "article_not_found"
    if not requested:
        return None
    details = payload.get("details") or {}
    raise WebResearchError(code, status_code=404, details={
        "suggestion": "open the concrete article page", "reason": details.get("reason"),
        "weak": bool(details.get("weak")),
        "hint": "retry without article:true to get the plain page text"})


def _clean(value, limit):
    """剥控制字符并截断：这些字符串会被模型当引用读（§9 注入面）。"""
    text = "".join(" " if ord(c) < 32 or ord(c) == 127 else c for c in str(value or ""))
    return text.strip()[:limit] or None


def _normalise(raw, ctx):
    window = {"from": 0, "next_from": None, "window_truncated": False,
              "count": len(raw.get("blocks") or []), **(raw.get("window") or {}),
              "snapshot_version": ctx["version"], "page_url": ctx["url"]}
    # 元数据一律过同一道闸：`published_at` 走形状校验（AC-A4），文本剥控制字符（§9）；
    # 复用旧 `source` 的分支直接读这几个字段，不在此净化就等于绕过 provenance 的校验。
    return {"title": _clean(raw.get("title"), 200) or "",
            "byline": _clean(raw.get("byline"), 120),
            "published_at": iso_or_none(raw.get("published_at")),
            "canonical_url": display_url(raw.get("canonical_url") or "") or None,
            "site": _clean(raw.get("site"), 120) or "",
            "weak": bool(raw.get("weak")),
            "stripped": int(raw.get("stripped") or 0),
            "blocks_overflow": bool(raw.get("blocks_overflow")),
            "total_blocks": int(raw.get("total_blocks") or 0),
            "char_count": int(raw.get("char_count") or 0),
            "blocks": [{"kind": str(b.get("kind") or "p"), "text": str(b.get("text") or ""),
                        **({"level": b["level"]} if b.get("level") else {})}
                       for b in (raw.get("blocks") or []) if b.get("text")],
            "window": window}


def fit_article(article, limit=ARTICLE_MAX_BYTES):
    """削块到独立预算内；幂等（images 挂载后会再跑一次）。`None` = 块已空须整键删除。"""
    if not isinstance(article, dict) or not article.get("blocks"):
        return None
    blocks = article["blocks"]
    while blocks and len(json.dumps(article, ensure_ascii=False).encode()) > limit:
        blocks.pop()
        article["article_truncated"] = True
        article.setdefault("window", {})["window_truncated"] = True
    return article if article["blocks"] else None
