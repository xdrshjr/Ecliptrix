"""与主进程 navigationGuard.js 共享的 URL 判定向量（spec §4.2.6 / R2-1）。"""
import json
from pathlib import Path

import pytest

from app.services.browser_workspace import policy

VECTORS = (Path(__file__).resolve().parents[3] / "desktop" / "main" /
           "browserWorkspace" / "__fixtures__" / "url-guard-vectors.json")


def _load():
    if not VECTORS.exists():
        return []
    return json.loads(VECTORS.read_text(encoding="utf-8"))


def test_vector_file_present():
    if not VECTORS.exists():
        pytest.skip("desktop 向量文件尚未生成（主进程线负责）")
    assert len(_load()) >= 30


@pytest.mark.parametrize("vector", _load(),
                         ids=lambda v: f"{v['actor']}:{v['input'][:40]}")
def test_python_mirror_agrees_with_shared_vectors(vector):
    verdict = policy.check_url(
        vector["input"], vector["actor"], vector.get("allowPrivate", False),
        vector.get("ownPorts", ()), vector.get("denyHosts", ()))
    expected = vector["expect"]
    assert verdict["ok"] is expected["ok"], vector
    if not expected["ok"]:
        assert verdict["code"] == expected["code"]
