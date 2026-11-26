"""页面图片候选与保存链路（spec §2.2 / §2.3 / §4.1 / §4.2）。

为什么单独成模块：`services/browser_workspace/` 有逐文件行数预算
（`tests/test_line_budgets_bw.py`，service.py 350 行、dispatch.py 200 行）。
本轮图片链路要加归一化、候选注册、保存三段，放进 service.py 会让它一次长 60+ 行，
所以按「一个职责一个模块」拆出来，service.py / dispatch.py 只保留薄委托
（与上一轮把审批拆到 `approvals.py` 同一种处置。
实施偏差已记入 spec.md 的「实施过程发现的方案缺陷」）。
"""
from app.models.web_research_models import WebResearchError

# 主进程固定取前 100（actions.js）；这里只是后端截断的上限（spec P2-1）。
MAX_IMAGES = 100


def normalise(raw, page_url, version, images_max=None):
    """候选归一化：**只增字段、不改既有名**（`width`/`height` 保留）。

    `web_image_service.py` 正消费 `width`/`height`；改名会让它静默丢宽高
    （spec P1-2 / AC-I21），故 `natural_w`/`natural_h` 是新增别名。
    逐项补 `page_url` 与 `snapshot_version`，使候选成为不可歧义的快照引用。
    """
    limit = min(images_max or 40, MAX_IMAGES)
    candidates, seen = [], set()
    for item in raw:
        url = item.get("image_url") or ""
        if not url or url in seen:
            continue
        seen.add(url)
        natural_w, natural_h = item.get("natural_w"), item.get("natural_h")
        candidates.append({
            "image_id": "i%d" % (len(candidates) + 1),
            "image_url": url,
            "kind": item.get("kind") or "url",
            "alt": item.get("alt", ""),
            "natural_w": natural_w, "natural_h": natural_h,
            "width": natural_w, "height": natural_h,  # 沿用既有字段名
            "rendered_w": item.get("rendered_w"),
            "rendered_h": item.get("rendered_h"),
            "in_viewport": item.get("in_viewport"),
            "is_og": item.get("is_og"),
            "via_srcset_best": item.get("via_srcset_best"),
            "page_url": page_url,
            "snapshot_version": version,
        })
        if len(candidates) >= limit:
            break
    return candidates


async def attach(service, run, session_id, entry, result, images_max):
    """把候选归一化进结果与 `TabEntry.images`（spec §2.2 第 1、2、6、7 条）。

    截断只发生在后端归一化阶段：主进程固定取前 100，不为 `images_max` 增改
    主进程（spec P2-1）。`_finish_snapshot` 不碰 `entry.images`，所以
    `read -> act -> save` 仍可用（P2-7）。
    """
    page_url = result.get("final_url") or entry.url
    raw = await service._run_command(run, "images", {}, session_id, 10)
    raw = [item for item in raw.get("images", []) if item.get("image_url")]
    candidates = normalise(raw, page_url, entry.version, images_max)
    entry.images = {item["image_id"]: item for item in candidates}
    result["images"] = candidates
    # 只有真的丢了候选才标记：页面本来就只有 3 条、上限 40 时不算截断。
    if len(raw) > len(candidates):
        result["images_truncated"] = True
    # 裁剪必须**在挂载之后**重跑：`_finish_snapshot` 里的 `fit_result` 只见
    # 过 text/elements，100 条候选实测 35 KB 会直接突破 11.5 KB 上限（spec
    # P0-2 / AC-I19）。`fit_result` 就地收敛并按 images -> elements -> text
    # 的顺序削，故这里只需再调一次。
    from app.services.web_research.browser_result import fit_result
    fit_result(result)


async def save(service, run, session_id, image_id, name=None,
               snapshot_version=None):
    """把候选图片经该标签页的会话取回并入库（spec §2.3 / §4.2）。

    `image_id` 是**闭集**：只认 `read(images=True)` 登记过的候选，绝不接受
    裸 URL（否则后端会变成任意 URL 的取字节代理，spec R-3）。
    """
    entry = service._entry(run, session_id)
    candidate = entry.images.get(str(image_id))
    if candidate is None:
        raise WebResearchError("image_not_found", status_code=404)
    if snapshot_version is not None and snapshot_version != entry.version:
        raise WebResearchError("stale_snapshot", status_code=409)
    # 页面自跳转不会改 version，故必须另比一次页面 URL（spec P2-6）。
    recorded = candidate.get("page_url")
    if recorded and entry.url and recorded != entry.url:
        raise WebResearchError("stale_snapshot", status_code=409)
    if candidate.get("kind") == "inline":
        raise WebResearchError("inline_image_unsupported", status_code=400)
    await service._spend(run)
    from .resources import save_agent_image
    return await save_agent_image(run, str(session_id),
                                  candidate["image_url"], entry.url, name)


async def isolated_candidates(run, session_id, images_max):
    """沙盒也有候选能力，但只读（spec P2-5 / R-4）。

    沙盒是新开的隐藏窗口、没有 Cookie 分区，也没有会话条目可登记 `image_id`，
    所以只回清单并显式标记不可保存 —— 不假装成功。

    形状与工作台对齐（`natural_w`/`natural_h`/`rendered_w`/`rendered_h`/`kind`/
    `page_url`），但**不发 `image_id`**：沙盒没有 `TabEntry` 可登记闭集，给了 id
    就等于暗示 `browser_save_image` 能用。按 `images_max` 截断由本函数负责；
    响应总量的裁剪要等合并进 read 结果之后，见 `attach_isolated`。
    """
    from .dispatch import _bounded, _isolated
    page = await _bounded(_isolated().images(run, session_id))
    raw = [{"image_url": item["image_url"], "kind": "url",
            "alt": item.get("alt") or "",
            "natural_w": item.get("width"), "natural_h": item.get("height"),
            "width": item.get("width"), "height": item.get("height"),
            "in_viewport": item.get("in_viewport"),
            "is_og": item.get("is_og"), "page_url": page.get("final_url", "")}
           for item in page.get("images", []) if item.get("image_url")]
    return {"images": raw[:images_max or 40],
            "images_save_supported": False,
            "images_hint": "isolated mode cannot save images; "
                           "switch to the workspace browser first"}


async def attach_isolated(run, session_id, result, images_max):
    """把沙盒候选合并进 read 结果，**合并之后**再裁剪一次。

    候选是合进来才有的，`_isolated().read` 内部的 `fit_result` 见不到它们；
    对增量单独裁剪又挡不住「候选 + 正文」的总量，故只能在合并后统一收一次。
    """
    from app.services.web_research.browser_result import fit_result
    result.update(await isolated_candidates(run, session_id, images_max))
    fit_result(result)


async def save_for_dispatch(run, body):
    """保存只在工作台成立；沙盒明确回不支持（spec R-4）。"""
    from .dispatch import get_workspace_service
    service = get_workspace_service()
    session_id = str(body["session_id"])
    if not service.owns(session_id):
        raise WebResearchError("action_unsupported_in_isolated",
                               status_code=422)
    return await save(service, run, session_id, body["image_id"],
                      body.get("name"), body.get("snapshot_version"))
