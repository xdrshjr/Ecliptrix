"""把主进程快照拼成与隔离浏览器**同形**的结果，并落 artifact（spec §4.3.1 / R1-7）。

留存：工作台来源的 artifact 一律 `retention_days=1` 且 provenance 标
`source:'workspace'`——已登录页面正文不应落盘一周；素材库入库物不受此限。
"""
import base64
import binascii

from app.models.web_research_models import WebResearchError
from app.services.web_research.browser_result import assemble, fit_result
from app.services.web_research.provenance import display_url, source_record

WORKSPACE_RETENTION_DAYS = 1
PASSTHROUGH = ("snapshot_version", "title", "elements", "viewport",
               "truncated", "frames_unsupported")


def artifact_context(run, source):
    return {"run_id": run.run_id, "project_id": run.project_id,
            "sources": [source], "source": "workspace"}


def clean_elements(elements):
    """敏感元素永不带值（D-BW2-8）；其余原样透传给模型。"""
    cleaned = []
    for element in elements or []:
        element = dict(element)
        if element.get("sensitive"):
            element.pop("value", None)
        cleaned.append(element)
    return cleaned


def decode_screenshot(payload):
    """主进程回传 base64（已缩放）；解码失败按不可用处理。"""
    raw = (payload or {}).get("image_b64") or ""
    try:
        return base64.b64decode(raw, validate=True) if raw else None
    except (binascii.Error, ValueError):
        return None


async def build_snapshot(run, tab_id, snap, previous_source, store, extras):
    """返回 `(result, source)`；`extras` 为 profile/control/mode 等固定字段。"""
    url = display_url(snap.get("url", ""))
    title = snap.get("title", "")
    source = previous_source
    if not source or source["final_url"] != url:
        source = source_record(snap.get("url", ""), title)
    full_text = snap.get("full_text") or snap.get("text") or ""
    artifact = await store.write(
        "browser_snapshot", full_text.encode(), artifact_context(run, source),
        retention_days=WORKSPACE_RETENTION_DAYS)
    captured = {key: snap[key] for key in PASSTHROUGH if key in snap}
    captured["elements"] = clean_elements(snap.get("elements"))
    captured["content"] = snap.get("text", "")
    result = assemble(captured, tab_id, url, source, artifact.id)
    result.update(extras)
    return fit_result(result), source


async def attach_screenshot(run, result, image, source, store):
    """截图落 artifact；失败只在结果里记码，不让整次读取失败（§4.2.3 第 4 条）。"""
    if image is None:
        result["screenshot_error"] = "screenshot_unavailable"
        return result
    try:
        row = await store.write("screenshot", image,
                                artifact_context(run, source),
                                retention_days=WORKSPACE_RETENTION_DAYS)
        result["screenshot_artifact_id"] = row.id
    except WebResearchError as error:
        result["screenshot_error"] = ("screenshot_too_large"
                                      if error.error_code == "response_too_large"
                                      else error.error_code)
    return result
