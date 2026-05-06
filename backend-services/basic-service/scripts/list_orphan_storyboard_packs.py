"""Operator script — enumerate storyboard packs whose metadata.json lacks
``project_id``. These are "legacy unowned" packs that the per-project list
endpoint deliberately hides; an operator can read this output to decide
whether to delete them on disk or attribute them manually.

Read-only. No DB writes. Safe to run on production:

    python scripts/list_orphan_storyboard_packs.py

The script consults the same ``settings.storage.root`` used by the
service, so it always inspects the live filesystem layout.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import List, Tuple

# Allow running from the repository root without manual PYTHONPATH gymnastics.
HERE = Path(__file__).resolve()
APP_ROOT = HERE.parent.parent  # backend-services/basic-service/
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from app.config import settings  # noqa: E402  (sys.path tweak above)


STORYBOARD_STORAGE_DIR = "storyboard"


def _storyboard_base_dir() -> str:
    return os.path.join(settings.storage.root, STORYBOARD_STORAGE_DIR)


def find_orphans() -> List[Tuple[str, str]]:
    base = _storyboard_base_dir()
    out: List[Tuple[str, str]] = []
    if not os.path.isdir(base):
        return out
    for date_dir_name in sorted(os.listdir(base)):
        date_dir = os.path.join(base, date_dir_name)
        if not os.path.isdir(date_dir):
            continue
        for pack_id in os.listdir(date_dir):
            pack_path = os.path.join(date_dir, pack_id)
            meta_path = os.path.join(pack_path, "metadata.json")
            if not os.path.isfile(meta_path):
                continue
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    meta = json.load(f)
            except Exception as exc:
                print(f"[warn] {pack_path}: cannot read metadata ({exc})", file=sys.stderr)
                continue
            if not meta.get("project_id"):
                out.append((meta.get("pack_id", pack_id), meta.get("created_at", "")))
    return out


def main() -> int:
    orphans = find_orphans()
    if not orphans:
        print("No orphan storyboard packs found.")
        return 0
    print(f"Found {len(orphans)} orphan storyboard pack(s):")
    print("pack_id,created_at")
    for pack_id, created_at in orphans:
        print(f"{pack_id},{created_at}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
