"""Run the whole stills / desktop-gate metric set, in dependency order.

N0 runs first and is a GATE: if the two sides cannot agree on where a MOTIONLESS
still sits, every later number is measuring that disagreement as well as the
camera move, and the team debugs the wrong thing. Nothing downstream runs until
it is green.

Everything else is independent and reported individually, because a failed metric
is data. Only the run's exit code aggregates.

Usage:
    python docs/plans/camera-motion-stills-and-desktop-gate/experiments/run_all.py
    python .../run_all.py n1 n4        # a subset, by metric id
"""

from __future__ import annotations

import importlib
import sys
import time
from typing import Dict, List, Tuple

import _harness as H

#: (id, module, human title). Order matters: `env` first for the snapshot, `n0`
#: second because it gates.
STAGES: List[Tuple[str, str, str]] = [
    ("env", "e5_environment", "Environment and fixture snapshot"),
    ("n0", "e6_n0_box_baseline", "N0 motionless box baseline (GATE)"),
    ("n1", "e7_n1_stills_geometry", "N1 stills geometry parity + N1-c coverage contract"),
    ("n2", "e8_n2_stills_visual", "N2 preview vs export, pixel level"),
    ("n3", "e9_n3_dual_track", "N3 dual-track 3D see-through"),
    ("n4", "e10_n4_regression", "N4 zero regression against 8c702ec"),
    ("n5", "e11_n5_panel", "N5 panel perspective, degradation, lifecycle"),
    ("n6", "e12_n6_desktop_gate", "N6 desktop gate (packaged FFmpeg)"),
    ("n7", "e13_n7_budget", "N7 draw budget, i18n, repository standards"),
]

GATE = "n0"


def main(argv: List[str]) -> int:
    wanted = {arg.lower() for arg in argv} or {stage[0] for stage in STAGES}
    results: Dict[str, Dict[str, object]] = {}
    failures: List[str] = []
    started = time.time()

    for stage_id, module_name, title in STAGES:
        if stage_id not in wanted:
            continue
        print(f"\n{'=' * 78}\n{stage_id.upper()}  {title}\n{'=' * 78}", flush=True)
        module = importlib.import_module(module_name)
        began = time.time()
        try:
            code = module.main()
        except Exception as exc:  # a crashed metric is a failed metric, not a crash
            print(f"[{stage_id}] raised {type(exc).__name__}: {exc}", flush=True)
            code = 2
        seconds = round(time.time() - began, 1)
        results[stage_id] = {"exit": code, "seconds": seconds, "title": title}
        if code != 0:
            failures.append(stage_id)
        print(f"[{stage_id}] exit={code} in {seconds}s", flush=True)

        if stage_id == GATE and code != 0:
            print(
                f"\n{GATE.upper()} is the prerequisite and did not pass. Stopping: any "
                "deviation measured downstream would be unattributable.",
                flush=True,
            )
            break

    H.write_json(
        "run-summary.json",
        {
            "startedAtEpoch": started,
            "totalSeconds": round(time.time() - started, 1),
            "gate": GATE,
            "stages": results,
            "failed": failures,
            "pass": not failures,
        },
    )
    print(f"\n{'=' * 78}")
    for stage_id, entry in results.items():
        print(f"  {stage_id.upper():<4} {'PASS' if entry['exit'] == 0 else 'FAIL'}  {entry['title']}")
    print(f"{'=' * 78}\n{'ALL PASS' if not failures else 'FAILED: ' + ', '.join(failures)}")
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
