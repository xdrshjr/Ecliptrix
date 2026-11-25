"""浏览器快照结果的共用拼装与 11.5 KB 裁剪（从 `BrowserService._capture` 抽出）。

为什么独立：隔离浏览器与工作台浏览器要给模型**同形**的结果；裁剪规则只能有
一份，否则两条路径的 `truncated` / 元素截断语义会漂移（spec §4.3.1 重构点）。
"""
import json

from .provenance import clip_bytes

MAX_RESULT_BYTES = 11500


def assemble(captured, session_id, url, source, artifact_id):
    """把 `captured`（已弹出 `full_text`）拼成 Agent 可见的结果字典。"""
    result = {**captured, "text": captured.pop("content"),
              "session_id": session_id, "final_url": url,
              "snapshot_artifact_id": artifact_id, "artifact_id": artifact_id,
              "source_id": source["id"], "sources": [source]}
    result.pop("content", None)
    return result


def fit_result(result, limit=MAX_RESULT_BYTES):
    """超限时先丢元素、再裁正文，并标记 `truncated`。"""
    while len(json.dumps(result, ensure_ascii=False).encode()) > limit:
        result["truncated"] = True
        if result.get("elements"):
            result["elements"].pop()
        else:
            result["text"] = clip_bytes(
                result["text"], max(0, len(result["text"].encode()) - 512))
    return result
