"""W1 —— 打包产物里的运镜/盒几何源码是否就是工作树里的这一份（L-Q5 / L11）。

为什么必须单独有这一条：W2 的驱动跑的是 `Ecliptrix.exe`，而「这个 exe 里装的是不是
本轮的代码」它自己回答不了。少了这一步，walkthrough 再绿也只能证明"某个版本"能跑。
Iteration 1 立 L11 就是为了堵这个缺口。

方法：对打包产物 `resources/backend/` 里逐字节拷贝的后端源码取 SHA256，与工作树同名
文件比对。**只比后端**是有意的 —— 前端进了 Next.js 的编译产物，哈希天然对不上，拿
它比会得到一个必然失败或必须放宽的判据；后端是原样拷贝，比得干净。前端那一半由 W2
在真实窗口里跑出来的行为负责。

用法：
    python w1_package_identity.py [out.json]
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from typing import Any, Dict, List

import _harness as H

#: 本轮契约涉及的后端文件：盒量化的孪生实现、它的调用点、以及运镜发射链。
TRACKED = [
    "app/services/composition/overlay_box.py",
    "app/services/composition/video_scaling.py",
    "app/services/composition/camera_motion.py",
    "app/services/composition/camera_motion_filters.py",
    "app/services/composition/camera_motion_overlay.py",
    "app/services/video_composition_service.py",
]

PACKAGE_BACKEND = H.REPO_ROOT / "desktop" / "release" / "win-unpacked" / "resources" / "backend"
WORKTREE_BACKEND = H.REPO_ROOT / "backend-services" / "basic-service"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run() -> Dict[str, Any]:
    rows: List[Dict[str, Any]] = []
    for relative in TRACKED:
        packaged, worktree = PACKAGE_BACKEND / relative, WORKTREE_BACKEND / relative
        row: Dict[str, Any] = {"path": relative}
        if not packaged.exists() or not worktree.exists():
            row.update({
                "packagedExists": packaged.exists(),
                "worktreeExists": worktree.exists(),
                "identical": False,
            })
        else:
            packaged_hash, worktree_hash = _sha256(packaged), _sha256(worktree)
            row.update({
                "packagedSha256": packaged_hash,
                "worktreeSha256": worktree_hash,
                "identical": packaged_hash == worktree_hash,
            })
        rows.append(row)
    return {
        "metric": "W1",
        "title": "The packaged app carries THIS working tree's camera-motion sources",
        "packageRoot": str(PACKAGE_BACKEND),
        "scope": (
            "Backend only. The frontend is compiled into a Next.js build, so a byte "
            "comparison there is meaningless rather than reassuring; W2 exercises that "
            "half by driving the real window."
        ),
        "files": rows,
        "pass": all(row["identical"] for row in rows),
    }


if __name__ == "__main__":
    result = run()
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if out:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"pass": result["pass"], "files": len(result["files"])}))
    raise SystemExit(0 if result["pass"] else 1)
