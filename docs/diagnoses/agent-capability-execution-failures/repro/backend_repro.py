"""离线诊断：真实 robots 判定与 TTS 错误映射，不访问公网或真实密钥。"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
import sys
from unittest.mock import AsyncMock

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "backend-services/basic-service"))

from app.services.web_research.safe_http_client import HttpResult, SafeHttpClient
from app.models.web_research_models import WebResearchError
from app.services.skillrouter.errors import RouterError
from app.services.skillrouter.tts_adapter import map_router_error


async def main():
    observations = []
    client = SafeHttpClient(proxy_settings={"proxy_mode": "direct"})
    client.fetch = AsyncMock(return_value=HttpResult(
        "https://cdn.example.invalid/robots.txt", 503, {}, b"fixture unavailable"))
    codes = []
    for name in ("one.mp3", "two.mp3"):
        try:
            await client.check_robots(f"https://cdn.example.invalid/{name}")
        except WebResearchError as error:
            codes.append(error.error_code)
    assert codes == ["robots_unavailable", "robots_unavailable"]
    assert client.fetch.await_count == 1
    observations.append({"用例": "P1", "说明": "同源 robots 503 缓存跨文件生效", "错误": codes, "实际抓取次数": client.fetch.await_count})

    client = SafeHttpClient(proxy_settings={"proxy_mode": "direct"})
    client.fetch = AsyncMock(side_effect=WebResearchError("upstream_timeout"))
    try:
        await client.check_robots("https://cdn.example.invalid/one.mp3")
        raise AssertionError("应拒绝下载")
    except WebResearchError as error:
        assert error.error_code == "robots_unavailable"
        observations.append({"用例": "P2", "说明": "robots 获取超时也会归为 robots_unavailable，不能单凭此码判定源站 5xx", "错误": error.error_code})

    failure = map_router_error(RouterError("capability_unavailable", 503, "fixture unavailable"))
    assert failure.error_code == "TTS_PROVIDER_ERROR"
    observations.append({"用例": "P3", "说明": "能力不可用不会映射为音色不可用", "错误": failure.error_code})
    report = json.dumps({"通过": 3, "结果": observations}, ensure_ascii=False, indent=2)
    Path(__file__).with_name("backend-results.json").write_text(report + "\n", encoding="utf-8")
    print(report)


if __name__ == "__main__":
    asyncio.run(main())
