"""The machine, the binaries and the fixtures every other number was taken on.

Schema is the plan's §2.3 minimum field set (P2-14). Two things in it are load-
bearing rather than decorative:

* ``ffmpeg_caps`` is the PRODUCTION probe's landing, not a version string. Every
  degradation in the export path switches on those flags, so a result read
  without them cannot be reproduced or refuted.
* ``fixtures`` carries a SHA256 per file. The fixtures are synthesized from code
  rather than committed, so the hash is what makes "the same fixture" checkable
  by someone who reruns this a month from now.
"""

from __future__ import annotations

import platform
import sys
from typing import Any, Dict

import _harness as H
import stills_fixtures as F


def _caps(binary: str) -> Dict[str, Any]:
    from app.services.composition import ffmpeg_caps

    caps = ffmpeg_caps.probe(binary)
    return {
        field: getattr(caps, field)
        for field in sorted(vars(caps))
        if not field.startswith("_")
    }


def _webgl(log: H.Log) -> Dict[str, Any]:
    """Ask the real Chromium what GPU it got — a software fallback changes N7."""
    import json

    work = H.work_dir()
    kernel_dir = work / "preview-kernel"
    build = H.run(
        ["node", str(H.preview_harness_dir() / "build-kernel.mjs"), str(kernel_dir)],
        cwd=H.REPO_ROOT,
    )
    if not build.ok:
        return {"error": build.stderr[-300:]}
    job_path = work / "job-env.json"
    out_path = work / "job-env-result.json"
    job_path.write_text(
        json.dumps(
            {
                "mode": "lifecycle",
                "kernelDir": str(kernel_dir),
                "canvas": {"width": 320, "height": 180},
                "lifecycle": {"cycles": 1},
            }
        ),
        encoding="utf-8",
    )
    if out_path.exists():
        out_path.unlink()
    H.run(
        [str(H.ELECTRON_BIN), str(H.preview_harness_dir()), f"--job={job_path}", f"--out={out_path}"],
        cwd=H.REPO_ROOT,
        timeout=600,
    )
    if not out_path.exists():
        return {"error": "electron produced no result"}
    return H.read_json(out_path).get("webgl", {})


def main() -> int:
    log = H.Log("env")
    H.add_backend_to_path()
    H.install_cv2_stub_if_broken()

    dev_version = H.run([H.FFMPEG, "-version"], timeout=120)
    packaged_version = (
        H.run([str(H.PACKAGED_FFMPEG), "-version"], timeout=120)
        if H.PACKAGED_FFMPEG.exists()
        else None
    )
    node = H.run(["node", "--version"], cwd=H.REPO_ROOT)
    electron = H.run(
        ["node", "-p", "require('./desktop/node_modules/electron/package.json').version"],
        cwd=H.REPO_ROOT,
    )
    webgl = _webgl(log)

    payload = {
        "ffmpeg_version": (dev_version.stdout or "").splitlines()[:1],
        "ffmpeg_path": H.FFMPEG,
        "ffmpeg_caps": _caps(H.FFMPEG),
        "packaged_ffmpeg_version": (
            (packaged_version.stdout or "").splitlines()[:1] if packaged_version else None
        ),
        "packaged_ffmpeg_path": str(H.PACKAGED_FFMPEG),
        "packaged_ffmpeg_caps": _caps(str(H.PACKAGED_FFMPEG)) if packaged_version else None,
        "gpu_renderer": webgl.get("renderer"),
        "webgl_version": webgl.get("version"),
        "electron_version": (electron.stdout or "").strip(),
        "node_version": (node.stdout or "").strip(),
        "python_version": sys.version.split()[0],
        "os_release": f"{platform.system()} {platform.release()} {platform.version()}",
        "git_head": H.git_head(),
        "fixtures": F.manifest(),
    }
    path = H.write_json("env.json", payload)
    log(f"environment snapshot -> {path.name}")
    log(f"  developer ffmpeg: {payload['ffmpeg_version']}")
    log(f"  packaged  ffmpeg: {payload['packaged_ffmpeg_version']}")
    log(f"  gpu: {payload['gpu_renderer']}")
    log.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
