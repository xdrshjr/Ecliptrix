"""主进程回环控制服务的 aiohttp 客户端（spec §4.3.1 / §6.2）。

为什么这样：令牌只在进程 env 里（§4.3.5），所以这里是后端唯一能说话的出口。
- `trust_env=False` + `proxy=None`：回环请求绝不经系统代理（R2-9）。
- 写操作（POST/DELETE）不自动重试：重放一次点击/提交是真实副作用；只有
  幂等的 GET 在传输错误时重试一次。
- 主进程的 `{ok:false, error_code}` 原样还原成 WebResearchError，使 sticky /
  failure_class 语义与 §6.3 登记表一致。
"""
import asyncio
import os

import aiohttp

from app.models.web_research_models import WebResearchError

URL_ENV = "BROWSER_WORKSPACE_CONTROL_URL"
TOKEN_ENV = "BROWSER_WORKSPACE_CONTROL_TOKEN"
CONNECT_TIMEOUT = 2.0


def control_endpoint():
    """`(url, token)`；dev 浏览器调试路径两者皆空。"""
    return ((os.environ.get(URL_ENV) or "").rstrip("/"),
            os.environ.get(TOKEN_ENV) or "")


def error_from_payload(status, payload):
    """主进程错误体 → WebResearchError；未知体按 workspace_unavailable。"""
    payload = payload if isinstance(payload, dict) else {}
    code = payload.get("error_code") or "workspace_unavailable"
    details = payload.get("details") or {}
    if code == "workspace_locked":
        status = 423
    return WebResearchError(code, message=str(details.get("message") or code),
                            status_code=status if status >= 400 else None,
                            details=details if isinstance(details, dict) else {})


class ControlClient:
    def __init__(self, endpoint=None):
        self.endpoint = endpoint  # 测试注入 (url, token)；None 时读 env

    def _target(self):
        url, token = self.endpoint if self.endpoint else control_endpoint()
        if not url or not token:
            raise WebResearchError("workspace_unavailable", status_code=503)
        return url, token

    def configured(self):
        url, token = self.endpoint if self.endpoint else control_endpoint()
        return bool(url and token)

    async def request(self, method, path, json=None, timeout=10.0,
                      params=None, binary=False):  # 后四个均为具名可选参数
        """单次请求；GET 传输错误重试一次，写操作绝不重试。"""
        url, token = self._target()
        attempts = 2 if method == "GET" else 1
        last = None
        for _ in range(attempts):
            try:
                return await self._once(
                    method, url + path, token,
                    {"json": json, "timeout": timeout, "params": params,
                     "binary": binary})
            except (aiohttp.ClientConnectionError, ConnectionError,
                    aiohttp.ServerDisconnectedError) as error:
                last = error
            except TimeoutError:
                raise WebResearchError("upstream_timeout") from None
        raise WebResearchError("browser_session_lost" if method != "GET"
                               else "workspace_unavailable",
                               status_code=410 if method != "GET" else 503
                               ) from last

    async def _once(self, method, url, token, options):
        binary = options["binary"]
        headers = {"Authorization": f"Bearer {token}"}
        total = aiohttp.ClientTimeout(total=options["timeout"],
                                      connect=CONNECT_TIMEOUT)
        async with aiohttp.ClientSession(trust_env=False, timeout=total,
                                         headers=headers) as client:
            async with client.request(method, url, json=options["json"],
                                      params=options["params"],
                                      proxy=None) as response:
                if binary and response.status == 200:
                    return {"body": await response.read(),
                            "content_type": response.headers.get(
                                "content-type", ""),
                            "final_url": response.headers.get(
                                "x-final-url", "")}
                payload = await _payload(response)
                if response.status >= 400 or (
                        isinstance(payload, dict) and payload.get("ok") is False):
                    raise error_from_payload(response.status, payload)
                return payload


async def _payload(response):
    try:
        return await response.json(content_type=None)
    except (aiohttp.ContentTypeError, ValueError, asyncio.TimeoutError):
        return {}
