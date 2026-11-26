"""浏览器工作台的行数棘轮（spec §5.2 / §10）：新文件不超预算，旧文件不增长。"""
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app"

NEW_BUDGETS = {
    "services/browser_workspace/__init__.py": 10,
    "services/browser_workspace/control_client.py": 200,
    "services/browser_workspace/driver.py": 250,
    "services/browser_workspace/service.py": 350,
    "services/browser_workspace/policy.py": 200,
    "services/browser_workspace/result.py": 150,
    "services/browser_workspace/resources.py": 200,
    "services/browser_workspace/settings.py": 80,
    "services/browser_workspace/dispatch.py": 200,   # spec 120；含 capabilities/隔离回落（见 spec 缺陷）
    "services/browser_workspace/approvals.py": 120,  # 从 service.py 拆出（spec 未列）
    "services/browser_workspace/article.py": 150,   # 正文抽取（spec agent-browser-article-reading）
    "services/web_research/browser_result.py": 90,
    "routers/browser_workspace_router.py": 120,
    "routers/research_browser_router.py": 150,
}
# 已存在文件：相对 HEAD 的最大净增行数
GROWTH_LIMITS = {
    "services/web_research/browser_service.py": 0,
    "main.py": 2,
}


def count(path):
    return len(path.read_text(encoding="utf-8").splitlines())


@pytest.mark.parametrize("name,budget", sorted(NEW_BUDGETS.items()))
def test_new_files_stay_within_budget(name, budget):
    assert count(APP / name) <= budget, name


def head_lines(relative):
    repo = ROOT.parents[1]
    path = (ROOT / "app" / relative).relative_to(repo).as_posix()
    done = subprocess.run(["git", "show", f"HEAD:{path}"], cwd=repo,
                          capture_output=True)
    return None if done.returncode else len(done.stdout.decode("utf-8").splitlines())


@pytest.mark.parametrize("name,growth", sorted(GROWTH_LIMITS.items()))
def test_existing_files_do_not_grow_past_limit(name, growth):
    baseline = head_lines(name)
    if baseline is None:
        pytest.skip("git HEAD 不可用")
    assert count(APP / name) - baseline <= growth, name
