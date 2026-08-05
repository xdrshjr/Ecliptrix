"""N6 — the desktop gate: does the SHIPPED FFmpeg render the same move?

This is the metric Iteration 1 left open (its DoD #8), and the reason it matters
is concrete rather than procedural: the desktop package carries its own FFmpeg,
and on this machine it is a **different major version** from the development
box's. Camera motion is expressed as `perspective` expressions driven by the
`on` frame counter with `eval=frame` — a capability the code PROBES at runtime
rather than assumes. A probe that lands differently inside the package would
degrade every camera move to a single frozen framing, and nothing in the
development environment would ever show it.

So the packaged binary is not merely version-recorded here, it is USED: the same
production export path renders the same stills through it, and the frames are
compared against the development build's. That is what turns H4 from an
assumption into a measurement.

What this cannot do is drive the packaged application's user interface. Steps 3-8
of the plan's §8.4 checklist (import media, open the panel, apply a preset, watch
the canvas, export, play the result back) are human actions in a GUI, and this
node has no way to perform them honestly. They are reported as NOT RUN, with the
precondition work done so a person can execute them: the package is rebuilt from
this round's HEAD, which L11 requires and which the shipped package did not
satisfy — it predates camera motion entirely.
"""

from __future__ import annotations

import datetime
import json
from pathlib import Path
from typing import Any, Dict, List

import _harness as H
import export_runner as X
import stills_fixtures as F

#: Files that only exist once camera motion has been built into the backend.
#: Their presence in the packaged tree is the staleness test L11 asks for, and it
#: does not depend on timestamps, which a copy or a restore can forge.
CAMERA_MOTION_SOURCES = [
    "app/services/composition/camera_motion.py",
    "app/services/composition/camera_motion_filters.py",
    "app/services/composition/camera_motion_overlay.py",
]

PACKAGE_ROOT = H.REPO_ROOT / "desktop" / "release" / "win-unpacked"
PACKAGED_BACKEND = PACKAGE_ROOT / "resources" / "backend"

BOX_POSITION = {"x": 0.1, "y": 0.1, "width": 0.3, "height": 0.3}
BOX_REGION = {"x": 192, "y": 108, "width": 576, "height": 324}
#: One 2D and one 3D move — the two code paths through the emitter.
PRESETS = ["ken-burns", "orbit-left"]
SAMPLE_PROGRESS = 0.5
#: Two renders of the same move by two FFmpeg builds should be near identical;
#: anything below this is a real behavioural difference, not encoder noise.
MIN_CROSS_BINARY_SSIM = 0.98


def _package_identity(log: H.Log) -> Dict[str, Any]:
    head = H.git_head()
    exists = PACKAGE_ROOT.exists()
    built_at = (
        datetime.datetime.fromtimestamp(PACKAGE_ROOT.stat().st_mtime).isoformat()
        if exists
        else None
    )
    present = {
        name: (PACKAGED_BACKEND / name).exists() for name in CAMERA_MOTION_SOURCES
    }
    contains_round = all(present.values())
    log(
        f"  package built {built_at}; carries this round's backend sources: {contains_round} "
        f"({sum(present.values())}/{len(present)})"
    )
    return {
        "packageRoot": str(PACKAGE_ROOT),
        "exists": exists,
        "builtAt": built_at,
        "gitHead": head,
        "cameraMotionSourcesPresent": present,
        "containsThisRoundsCode": contains_round,
        "l11Satisfied": contains_round,
    }


def _packaged_ffmpeg(log: H.Log) -> Dict[str, Any]:
    if not H.PACKAGED_FFMPEG.exists():
        return {"available": False, "path": str(H.PACKAGED_FFMPEG)}
    version = H.run([str(H.PACKAGED_FFMPEG), "-version"], timeout=120)
    probe_version = H.run([str(H.PACKAGED_FFPROBE), "-version"], timeout=120)
    dev_version = H.run([H.FFMPEG, "-version"], timeout=120)
    log(f"  packaged: {version.stdout.splitlines()[0] if version.ok else version.stderr[:120]}")
    log(f"  developer: {dev_version.stdout.splitlines()[0] if dev_version.ok else '?'}")
    return {
        "available": True,
        "path": str(H.PACKAGED_FFMPEG),
        "ffmpegVersionRaw": (version.stdout or "").strip().splitlines()[:3],
        "ffprobeVersionRaw": (probe_version.stdout or "").strip().splitlines()[:1],
        "developerFfmpegVersionRaw": (dev_version.stdout or "").strip().splitlines()[:1],
        "differsFromDeveloperBuild": (
            (version.stdout or "").splitlines()[:1] != (dev_version.stdout or "").splitlines()[:1]
        ),
    }


def _smoke_test(log: H.Log) -> Dict[str, Any]:
    """Boot the packaged app and check its services come up.

    Not a substitute for the GUI walkthrough, and not claimed as one. It answers
    the narrower question the walkthrough steps all depend on: does the package
    built from THIS round's HEAD actually run? A checklist whose first four items
    are "not run here" is worth more if the thing they would have been run against
    is known to start rather than assumed to.
    """
    script = H.REPO_ROOT / "desktop" / "scripts" / "smoke-test.js"
    if not script.exists():
        return {"ran": False, "reason": "desktop/scripts/smoke-test.js not present"}
    # The smoke test asserts the app reports an UNCONFIGURED LLM on a clean
    # profile. The packaged app inherits the launching process's environment, and
    # this harness runs inside a shell that exports LLM credentials — so an
    # inherited env makes the app answer `configured: true` and the test fail for
    # a reason that has nothing to do with the package. Stripping those keys
    # reproduces the condition the test is actually about.
    env = H.child_env()
    stripped = sorted(
        key for key in env
        if "LLM" in key.upper() or key.upper() in {"OPENAI_API_KEY", "ANTHROPIC_API_KEY"}
    )
    for key in stripped:
        env.pop(key, None)
    result = H.run(["node", str(script)], cwd=H.REPO_ROOT / "desktop", timeout=1800, env=env)
    (H.LOGS_DIR / "n6-smoke-test.log").write_text(
        result.stdout + "\n" + result.stderr, encoding="utf-8"
    )
    steps = [
        line.strip()
        for line in (result.stdout or "").splitlines()
        if line.strip().startswith("[smoke-test]")
    ]
    log(f"  packaged-app smoke test exit={result.returncode} ({len(steps)} steps)")
    return {
        "ran": True,
        "exit": result.returncode,
        "pass": result.ok,
        "steps": steps,
        "envKeysStripped": stripped,
        "log": "logs/n6-smoke-test.log",
    }


def _capability_probe(log: H.Log) -> Dict[str, Any]:
    """Run the PRODUCTION probe against both binaries and compare its landing."""
    from app.services.composition import ffmpeg_caps

    def landing(binary: str) -> Dict[str, Any]:
        caps = ffmpeg_caps.probe(binary)
        return {
            field: getattr(caps, field)
            for field in sorted(vars(caps))
            if not field.startswith("_")
        }

    packaged = landing(str(H.PACKAGED_FFMPEG))
    developer = landing(H.FFMPEG)
    # `version` is the binary's banner and MUST differ — that is the whole reason
    # this metric exists. What has to match is where the probe LANDS, i.e. the
    # capability flags the degradation ladder switches on.
    flags_packaged = {k: v for k, v in packaged.items() if k != "version"}
    flags_developer = {k: v for k, v in developer.items() if k != "version"}
    identical = flags_packaged == flags_developer
    differing = sorted(
        key for key in flags_packaged
        if flags_packaged.get(key) != flags_developer.get(key)
    )
    log(f"  caps packaged: {json.dumps(packaged, default=str)}")
    log(f"  capability flags identical to developer build: {identical}")
    return {
        "packaged": packaged,
        "developer": developer,
        "comparedFields": sorted(flags_packaged),
        "differingFields": differing,
        "identical": identical,
    }


def _render_with(log: H.Log, work: Path, binary: Path, label: str, wires) -> Dict[str, Path]:
    """Render the same stills through one FFmpeg binary, via the real service."""
    service = X.make_service()
    service._get_ffmpeg_path = lambda: str(binary)  # noqa: SLF001 — the whole point
    _png, clip = F.base_clip()
    frame_index = int(round((H.STILL_START + H.STILL_DURATION * SAMPLE_PROGRESS) * H.FPS))
    frames: Dict[str, Path] = {}
    for preset_id in PRESETS:
        item = X.still_item(
            f"still-{preset_id}", F.still("still_4x3"), H.STILL_START, H.STILL_DURATION,
            BOX_POSITION, camera_motion=X.motion_spec(wires[preset_id]),
        )
        output = work / "renders" / f"n6_{label}_{preset_id}.mp4"
        output.parent.mkdir(parents=True, exist_ok=True)
        run = X.run_overlay_pass(service, [item], clip, output, work / "tmp" / f"n6-{label}-{preset_id}")
        if not run.ok:
            raise RuntimeError(f"[{label}] export failed for {preset_id}: {run.error}")
        frames[preset_id] = X.extract_frame(
            output, frame_index, work / "frames" / "n6" / f"{label}_{preset_id}.png",
            ffmpeg=str(binary),
        )
        log(f"  [{label}] rendered {preset_id}")
    return frames


def _cross_binary(log: H.Log, work: Path) -> Dict[str, Any]:
    wire_path = work / "preset-wire.json"
    if not wire_path.exists():
        dump = H.run(
            ["node", str(H.ITER1_EXPERIMENTS / "dump-preset-wire.mjs"), str(wire_path)],
            cwd=H.REPO_ROOT,
        )
        if not dump.ok:
            raise RuntimeError(f"preset wire dump failed: {dump.stderr[-400:]}")
    wires = {entry["presetId"]: entry["wire"] for entry in H.read_json(wire_path)["presets"]}
    F.manifest()

    log("Rendering through the DEVELOPER FFmpeg...")
    developer = _render_with(log, work, Path(H.FFMPEG), "dev", wires)
    log("Rendering the same moves through the PACKAGED FFmpeg...")
    packaged = _render_with(log, work, H.PACKAGED_FFMPEG, "packaged", wires)

    rows: List[Dict[str, Any]] = []
    for preset_id in PRESETS:
        score = X.ssim_region(developer[preset_id], packaged[preset_id], BOX_REGION, scale="288:162")
        passed = score is not None and score >= MIN_CROSS_BINARY_SSIM
        rows.append({"presetId": preset_id, "ssimBox": score, "pass": passed})
        log(
            f"  {preset_id:<12} developer vs packaged SSIM {score:.4f} "
            f"(>= {MIN_CROSS_BINARY_SSIM}) {'PASS' if passed else 'FAIL'}"
        )
        X.downscale(packaged[preset_id], H.SAMPLES_DIR / f"n6-{preset_id}-packaged-ffmpeg.jpg")
    return {
        "threshold": MIN_CROSS_BINARY_SSIM,
        "sampleProgress": SAMPLE_PROGRESS,
        "cases": rows,
        "pass": all(row["pass"] for row in rows),
    }


def _checklist(
    identity: Dict[str, Any],
    caps: Dict[str, Any],
    cross: Dict[str, Any],
    smoke: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """The plan's §8.4 checklist, each item with an honest status."""
    automated = "automated"
    manual = "not-run-here"
    return [
        {
            "step": 1,
            "title": "Repackage so the walkthrough tests this round's code (L11)",
            "status": automated if identity["l11Satisfied"] else "failed",
            "evidence": {
                "builtAt": identity["builtAt"],
                "gitHead": identity["gitHead"]["head"],
                "cameraMotionSourcesPresent": identity["cameraMotionSourcesPresent"],
                "packagedAppSmokeTest": smoke,
            },
        },
        {
            "step": 2,
            "title": "Record the packaged FFmpeg version and the capability probe's landing",
            "status": automated,
            "evidence": {"capabilityProbe": caps},
        },
        {
            "step": 3,
            "title": "Create a project and import the D4 media (video + image + subtitle)",
            "status": manual,
            "reason": "GUI action; this node cannot drive the packaged application's interface.",
        },
        {
            "step": 4,
            "title": "Apply a 3D preset to the VIDEO clip and check the canvas preview",
            "status": manual,
            "reason": "GUI action. The equivalent pixel evidence outside the package is N2 and Iteration 1's M2.",
        },
        {
            "step": 5,
            "title": "Apply a 2D preset to the IMAGE clip (Ken Burns) and check the canvas preview",
            "status": manual,
            "reason": "GUI action. Covered outside the package by N2's 24 grids on the real compositor.",
        },
        {
            "step": 6,
            "title": "Apply a 3D preset to the image and confirm the lower track shows through",
            "status": manual,
            "reason": "GUI action. Covered outside the package by N3's pixel-level see-through assertion.",
        },
        {
            "step": 7,
            "title": "Export and play the result back, confirming all three moves are present",
            "status": "partially-automated",
            "reason": (
                "Playback in the packaged player is a human check. The rendering half — "
                "the packaged FFmpeg actually producing the move — IS measured here."
            ),
            "evidence": {"crossBinaryRender": cross},
        },
        {
            "step": 8,
            "title": "Remove every move and export again; the result must match the pre-feature output",
            "status": automated,
            "reason": "Byte-identity of the motionless command is proved against 8c702ec by N4-②.",
            "evidence": {"see": "n4-regression.json -> frozenCommands.motionlessOverlay"},
        },
    ]


def main() -> int:
    log = H.Log("n6-desktop-gate")
    H.add_backend_to_path()
    H.install_cv2_stub_if_broken()
    work = H.work_dir()

    identity = _package_identity(log)
    ffmpeg = _packaged_ffmpeg(log)
    if not ffmpeg["available"]:
        H.write_json(
            "n6-desktop-walkthrough.json",
            {"metric": "N6", "pass": False, "error": "packaged ffmpeg not found", "package": identity},
        )
        log("Packaged FFmpeg missing — the desktop gate cannot be evaluated")
        log.close()
        return 1

    caps = _capability_probe(log)
    cross = _cross_binary(log, work)
    smoke = _smoke_test(log)
    checklist = _checklist(identity, caps, cross, smoke)

    manual = [item for item in checklist if item["status"] == "not-run-here"]
    failures = [item for item in checklist if item["status"] == "failed"]
    # The gate this node CAN close: the packaged binary renders the move the same
    # way the development one does, and the probe lands identically.
    verdict = (
        cross["pass"]
        and caps["identical"]
        and not failures
        and (smoke.get("pass", False) if smoke.get("ran") else True)
    )

    payload = {
        "metric": "N6",
        "title": "Desktop gate — the packaged FFmpeg renders the same camera move",
        "package": identity,
        "ffmpeg": ffmpeg,
        "capabilityProbe": caps,
        "crossBinaryRender": cross,
        "packagedAppSmokeTest": smoke,
        "checklist": checklist,
        "manualStepsNotRun": [item["step"] for item in manual],
        "failures": [item["step"] for item in failures],
        "dodEightClosed": False,
        "dodEightStatus": (
            "PARTIAL. The version-skew risk H4 exists for — a differently-versioned "
            "packaged FFmpeg degrading camera motion — is measured and clear. The "
            f"remaining {len(manual)} checklist steps are GUI actions in the packaged "
            "app and are recorded as not run rather than assumed."
        ),
        "pass": verdict,
    }
    path = H.write_json("n6-desktop-walkthrough.json", payload)
    log(
        f"N6 {'PASS (automatable half)' if verdict else 'FAIL'} — "
        f"{len(manual)} GUI steps not run -> {path.name}"
    )
    log.close()
    return 0 if verdict else 1


if __name__ == "__main__":
    raise SystemExit(main())
