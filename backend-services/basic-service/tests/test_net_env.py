"""``net_env.loopback_env_kwargs`` (spec R2-03 / AC-18)."""
import os
import subprocess
import sys

import httpx
import pytest

from app.services.net_env import is_loopback_host, loopback_env_kwargs
from app.services.skillrouter.client import env_kwargs


@pytest.mark.parametrize("url", [
    "http://127.0.0.1:3000", "http://localhost:3000/api", "http://[::1]:3000",
    "http://127.5.6.7", "HTTP://LOCALHOST",
])
def test_loopback_targets_opt_out_of_system_proxies(url):
    assert loopback_env_kwargs(url) == {"trust_env": False}
    assert env_kwargs(url) == {"trust_env": False}


@pytest.mark.parametrize("url", [
    "https://www.skillrouter.net", "https://api.example.com/v1", "http://10.0.0.5:8000",
    "https://127.0.0.1.example.com", "not a url", "",
])
def test_real_hosts_keep_the_default_environment(url):
    assert loopback_env_kwargs(url) == {}


def test_is_loopback_host_handles_brackets_and_garbage():
    assert is_loopback_host("[::1]") and is_loopback_host("localhost")
    assert not is_loopback_host("") and not is_loopback_host("localhost.evil.test")


@pytest.mark.asyncio
async def test_a_client_built_with_the_kwargs_ignores_proxy_env(monkeypatch):
    monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:9")
    monkeypatch.delenv("NO_PROXY", raising=False)
    monkeypatch.delenv("no_proxy", raising=False)
    async with httpx.AsyncClient(**loopback_env_kwargs("http://127.0.0.1:1")) as client:
        assert client._mounts == {}  # no proxy mounts when trust_env is off


def test_module_imports_standalone_without_cycles():
    result = subprocess.run(
        [sys.executable, "-c", "import app.services.net_env as n; import app.services.llm_client"],
        capture_output=True, text=True,
        cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        env={**os.environ, "PYTHONPATH": "."},
    )
    assert result.returncode == 0, result.stderr
