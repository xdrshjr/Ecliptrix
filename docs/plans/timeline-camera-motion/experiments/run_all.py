"""Run the whole timeline-camera-motion experiment suite, in order.

    python docs/plans/timeline-camera-motion/experiments/run_all.py

Order matters: E2 renders the films whose frames E4 scores, and E3 captures the
preview frames for the same instants. Each stage is independently runnable and
writes its own ``results/*.json`` plus ``results/logs/*.log``, so a single stage
can be re-run after a fix without repeating the rest.

Every stage returns 0 only when its metric passes; this driver keeps going after
a failure so one red metric does not hide the state of the others, and reports
the roll-up at the end.
"""

from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path
from typing import List, Tuple

STAGES: List[Tuple[str, str]] = [
    ("e0_environment.py", "environment + FFmpeg capability probe"),
    ("e1_m1_geometry.py", "M1 geometry parity (TS kernel vs Python kernel)"),
    ("e2_m4_export.py", "M4 export robustness + guardrails (renders every preset)"),
    ("e3_preview_capture.py", "preview capture (M2 input) + M3 performance"),
    ("e4_m2_visual.py", "M2 preview/export SSIM + orientation sentinel"),
    ("e5_m5_regression.py", "M5 zero-regression for motion-free timelines"),
    ("e6_m6_ux_audit.py", "M6 interaction quality audit"),
]

HERE = Path(__file__).resolve().parent


def main() -> int:
    outcomes = []
    for script, description in STAGES:
        print(f"\n=== {script} — {description} ===", flush=True)
        started = time.time()
        result = subprocess.run([sys.executable, str(HERE / script)], cwd=str(HERE))
        outcomes.append((script, result.returncode, time.time() - started))
        print(f"=== {script} exit={result.returncode} in {time.time() - started:.0f}s ===", flush=True)

    print("\n---- roll-up ----")
    for script, code, seconds in outcomes:
        print(f"{'PASS' if code == 0 else 'FAIL'}  {script:<24} {seconds:6.0f}s")
    return 0 if all(code == 0 for _, code, _ in outcomes) else 1


if __name__ == "__main__":
    raise SystemExit(main())
