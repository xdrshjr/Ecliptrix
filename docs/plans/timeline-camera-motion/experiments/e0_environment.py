"""E0 — record the machine the experiment ran on, and probe FFmpeg's capabilities.

Two reasons this is its own step rather than a footnote:

* The export path chooses between a per-frame animated ``perspective``, a frozen
  single framing, and an outright failure based on a runtime capability probe
  (``composition/ffmpeg_caps.py``). Which branch the recorded metrics came from
  is therefore part of the result, not trivia — and the desktop build ships its
  own FFmpeg, which may answer differently (R-P2-5).
* Every other experiment's numbers are only comparable against a run on the same
  binaries.
"""

from __future__ import annotations

from typing import Any, Dict

import _common as C


def main() -> int:
    log = C.Log("environment")
    C.add_backend_to_path()
    C.install_cv2_stub_if_broken()

    versions: Dict[str, Any] = {}
    for key, cmd in {
        "ffmpeg": [C.FFMPEG, "-version"],
        "ffprobe": [C.FFPROBE, "-version"],
        "node": ["node", "--version"],
        "python": ["python", "--version"],
    }.items():
        result = C.run(cmd, timeout=60)
        first = (result.stdout or result.stderr).strip().splitlines()
        versions[key] = first[0] if first else f"<exit {result.returncode}>"
        log(f"{key}: {versions[key]}")

    electron = {"path": str(C.ELECTRON_BIN), "present": C.ELECTRON_BIN.exists()}
    if electron["present"]:
        result = C.run([str(C.ELECTRON_BIN), "--version"], timeout=120)
        electron["version"] = (result.stdout or result.stderr).strip().splitlines()[:1]
    log(f"electron: {electron}")

    from app.services.composition import ffmpeg_caps

    caps = ffmpeg_caps.probe(C.FFMPEG)
    caps_payload = {
        "has_perspective": bool(getattr(caps, "has_perspective", False)),
        "perspective_supports_eval_frame": bool(
            getattr(caps, "perspective_supports_eval_frame", False)
        ),
        "supports_filter_complex_script": bool(
            getattr(caps, "supports_filter_complex_script", False)
        ),
    }
    log(f"ffmpeg_caps.probe -> {caps_payload}")
    ladder = (
        "tier-1 animated perspective"
        if caps_payload["has_perspective"] and caps_payload["perspective_supports_eval_frame"]
        else "tier-2 static framing"
        if caps_payload["has_perspective"]
        else "tier-3 hard failure"
    )
    log(f"Degradation ladder in force: {ladder}")

    payload = {
        "metric": "E0",
        "title": "Run environment and FFmpeg capability probe",
        "environment": "local",
        "platform": "win32 (Windows 11, 10.0.26200)",
        "git": C.git_head(),
        "versions": versions,
        "electron": electron,
        "ffmpegCaps": caps_payload,
        "activeDegradationTier": ladder,
        "canvas": {"width": C.CANVAS_WIDTH, "height": C.CANVAS_HEIGHT, "fps": C.FPS},
        "workDir": str(C.work_dir()),
    }
    path = C.write_json("env.json", payload)
    log(f"Wrote {path.name}")
    log.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
