"""浏览器快照结果的共用拼装与 11.5 KB 裁剪（从 `BrowserService._capture` 抽出）。

为什么独立：隔离浏览器与工作台浏览器要给模型**同形**的结果；裁剪规则只能有
一份，否则两条路径的 `truncated` / 元素截断语义会漂移（spec §4.3.1 重构点）。
"""
import json

from .provenance import clip_bytes

MAX_RESULT_BYTES = 11500
# 图片候选的独立预算（spec P0-2）：不与 elements/text 争夺同一个 11.5 KB 池，
# 否则 40 条候选（约 8 KB）叠加正文与元素会稳定超限。
IMAGES_MAX_BYTES = 6000
# 正文块的独立预算（spec agent-browser-article-reading §4.4）。
ARTICLE_MAX_BYTES = 6000


def assemble(captured, session_id, url, source, artifact_id):
    """把 `captured`（已弹出 `full_text`）拼成 Agent 可见的结果字典。"""
    result = {**captured, "text": captured.pop("content"),
              "session_id": session_id, "final_url": url,
              "snapshot_artifact_id": artifact_id, "artifact_id": artifact_id,
              "source_id": source["id"], "sources": [source]}
    result.pop("content", None)
    return result


def _over(result, limit):
    return len(json.dumps(result, ensure_ascii=False).encode()) > limit


def fit_result(result, limit=MAX_RESULT_BYTES):
    """超限时按 images -> elements -> text 收敛，并标记 `truncated`。

    收敛顺序有依据（spec 4.1）：图片候选是最可重建的一类（重新 `read` 即可
    拿回），正文最贵（模型可能已经用它做了判断），故先砍图片尾部。

    三类都空仍超限时必须 `break`：`images` 作为第三类字段接入后，旧实现的
    `max(0, len - 512)` 会恒为 0、`text` 恒为 `""`，`while` 条件永真，请求
    永久挂死（spec P0-2 / R-11 / AC-I19）。
    """
    images = result.get("images")
    if images and _size(images) > IMAGES_MAX_BYTES:
        # 独立预算先落地：图片尾部先砍到 IMAGES_MAX_BYTES 以内，再进共享池，
        # 否则候选会靠「正文与元素让路」留在结果里（spec P0-2）。
        while images and _size(images) > IMAGES_MAX_BYTES:
            images.pop()
        # 砍了候选就是丢了内容，`truncated` 必须为真；两个标记同义。
        result["images_truncated"] = result["truncated"] = True
    article = result.get("article")
    if article and not article.get("blocks"):
        # 只剩元数据的正文块对模型毫无用处，且会让下面的 `while` 永远收敛不到它
        # 这一支（块空即删，D-A7 / AC-A6）。
        result.pop("article", None)
    elif article and _size(article) > ARTICLE_MAX_BYTES:
        # 独立预算：与 images 同口径，先在自己的池里收敛，再进共享池。
        from app.services.browser_workspace.article import fit_article
        if fit_article(article) is None:
            result.pop("article", None)
        result["article_truncated"] = result["truncated"] = True
    while _over(result, limit):
        result["truncated"] = True
        images = result.get("images")
        if images:
            images.pop()  # 最可重建的一类：重新 read 就能拿回
            result["images_truncated"] = True
        elif result.get("elements"):
            result["elements"].pop()
        elif result.get("text"):
            trimmed = max(0, len(result["text"].encode()) - 512)
            result["text"] = clip_bytes(result["text"], trimmed) if trimmed else ""
            if not trimmed:
                continue  # 清空后下一轮必然落到 break
        elif result.get("article", {}).get("blocks"):
            # 正文是本次交付物，排在噪声 text 之后削；块空即整键删除，
            # 否则只剩元数据的 dict 仍为真值，循环原地打转（D-A7 / AC-A6）。
            result["article"]["blocks"].pop()
            result["article"]["article_truncated"] = True
            result["article"].setdefault("window", {})["window_truncated"] = True
            if not result["article"]["blocks"]:
                result.pop("article", None)
        else:
            break  # 三类皆空仍超限：只能接受超限，绝不能空转（P0-2）
    return result


def _size(value):
    return len(json.dumps(value, ensure_ascii=False).encode())
