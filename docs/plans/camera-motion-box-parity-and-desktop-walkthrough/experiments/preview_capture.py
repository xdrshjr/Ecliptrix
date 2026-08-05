"""Drive the Electron preview harness — one place, so every metric drives it the same.

Iteration 2 had this inline in its N0 module and every later metric imported it
from there. Splitting it out is the same decision one level up: Q2, Q4 and Q7 all
need a real Chromium, and three copies of the spawn/parse/log dance would drift.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Optional

import _harness as H


def build_kernel(work: Path, mutation: Optional[str] = None) -> Path:
    """Transpile the shipping preview modules; returns the kernel directory."""
    suffix = f"-{mutation}" if mutation else ""
    kernel_dir = work / f"preview-kernel{suffix}"
    cmd = ["node", str(H.preview_harness_dir() / "build-kernel.mjs"), str(kernel_dir)]
    if mutation:
        cmd += ["--mutate", mutation]
    build = H.run(cmd, cwd=H.REPO_ROOT)
    if not build.ok:
        raise RuntimeError(f"kernel transpile failed: {build.stderr[-800:]}")
    return kernel_dir


def run_electron(log: H.Log, job: Dict[str, Any], name: str, timeout: int = 900) -> Dict[str, Any]:
    """Run one harness job in a real Chromium and return its payload.

    Args:
        log: The calling metric's logger.
        job: The job document the renderer reads.
        name: Short id — names the electron log file.
        timeout: Seconds before the child is killed.

    Returns:
        The renderer's payload.

    Raises:
        RuntimeError: the harness produced no result, or reported a failure.
    """
    work = H.work_dir()
    job_path = work / f"job-{name}.json"
    out_path = work / f"job-{name}-result.json"
    job_path.write_text(json.dumps(job, indent=2), encoding="utf-8")
    if out_path.exists():
        out_path.unlink()
    result = H.run(
        [str(H.ELECTRON_BIN), str(H.preview_harness_dir()), f"--job={job_path}", f"--out={out_path}"],
        cwd=H.REPO_ROOT,
        timeout=timeout,
    )
    (H.LOGS_DIR / f"electron-{name}.log").write_text(
        f"exit={result.returncode}\n--- stdout ---\n{result.stdout}\n--- stderr ---\n{result.stderr}",
        encoding="utf-8",
    )
    for line in result.stdout.splitlines():
        if line.startswith("[renderer]"):
            log(f"    {line}")
    if not out_path.exists():
        raise RuntimeError(f"electron harness produced no result (exit {result.returncode})")
    payload = H.read_json(out_path)
    if not payload.get("ok"):
        raise RuntimeError(f"electron harness failed: {payload.get('error')}")
    return payload
