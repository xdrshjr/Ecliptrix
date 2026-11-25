"""浏览器工作台的 UI 来源端点（spec §4.3.4）。

只有两个：用户右键「保存到素材库」与诊断状态。其余用户动作（导航、标签、用户切换…）
一律走主进程 IPC，**不经后端**。鉴权沿用 `validate_ui_origin`；响应里永远没有令牌/URL。
"""
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import Field

from app.models import BaseResponse
from app.models.web_research_models import StrictRequest, WebResearchError
from app.services.browser_workspace.dispatch import get_workspace_service
from app.services.browser_workspace.resources import save_resource
from .research_run_router import validate_ui_origin

router = APIRouter(prefix="/browser-workspace", tags=["Browser Workspace"])


class SaveResourceRequest(StrictRequest):
    tab_id: str = Field(min_length=1, max_length=128)
    url: str = Field(min_length=1, max_length=4096)
    kind: Literal["image", "media"]
    page_url: str | None = Field(default=None, max_length=4096)
    name: str | None = Field(default=None, max_length=120)
    project_id: str | None = Field(default=None, max_length=64)


@router.post("/resources/save")
async def save(body: SaveResourceRequest, request: Request):
    validate_ui_origin(request, write=True)
    material = await save_resource(body.tab_id, body.url, body.kind,
                                   body.page_url, body.name)
    return BaseResponse(success=True, message="ok", data=material)


@router.get("/state")
async def state(request: Request):
    """诊断用：只含可达性/版本/计数，不含令牌与 URL。"""
    validate_ui_origin(request)
    driver = get_workspace_service().driver
    reachable, version, profiles, tabs = False, None, 0, 0
    try:
        if not hasattr(driver, "configured") or driver.configured():
            health = await driver.health()
            reachable = True
            version = health.get("version")
            profiles = int(health.get("profiles") or 0)
            tabs = int(health.get("tabs") or 0)
    except WebResearchError:
        pass
    return BaseResponse(success=True, message="ok", data={
        "reachable": reachable, "version": version,
        "profiles": profiles, "tabs": tabs})
