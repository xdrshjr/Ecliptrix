"""M4 — export robustness, driven through the real composition service.

What this exercises is deliberately NOT a copy of the export path: it builds a
genuine ``VideoCompositionRequest``, hands it to the shipping
``VideoCompositionService._compose_videos_filtergraph`` with a real normalized
clip on disk, and lets the production code probe FFmpeg, plan the filtergraph,
choose a degradation tier and spawn the encoder. A harness that re-assembled the
argv itself could not catch a regression in any of those steps.

Measured (experiment-plan.md §2.2 M4 / §4.3 / §9):

* every shipped preset renders — exit code, frame count, duration, filesize;
* the three guardrails that stop an effect-free video being reported as a
  success: L1 (a motion can never take the concat shortcut), L11 (a filtergraph
  failure with a motion present retries once and then RAISES) and the tier-2 /
  tier-3 capability degradations, each with its warning text;
* the graph-size ladder (L7): how close a real preset gets to the inline limit.

Side effect used by M2: one PNG per (preset, sample time), extracted by exact
frame index, is left in the work directory for ``e4_m2_visual.py``.
"""

from __future__ import annotations

import shutil
from dataclasses import replace
from pathlib import Path
from typing import Any, Dict, List, Optional

import _common as C
import fixture_media

#: Frame indices sampled from every render. `perspective` numbers its first
#: output frame `on = 1`, so clip-local time is (on-1)/fps — frame index n maps
#: to t = n/fps, the same t the preview capture is asked for.
SAMPLE_FRAMES = [15, 45, 90, 135, 165]


def _build_request(preset_id: str, wire: Dict[str, Any], clip_id: str = "clip-a"):
    from app.models.video_models import VideoCompositionItem, VideoCompositionRequest

    item = VideoCompositionItem(
        id=clip_id,
        name=f"{preset_id} fixture",
        url=f"file://{clip_id}.mp4",
        start_time=0.0,
        duration=C.CLIP_DURATION,
        track_id="track-1",
        clip_start=0.0,
        clip_end=C.CLIP_DURATION,
        track_z=0,
        camera_motion=wire,
    )
    return VideoCompositionRequest(
        task_id=f"exp-{preset_id}",
        video_items=[item],
        total_duration=C.CLIP_DURATION,
        output_fps=C.FPS,
    )


def _extract_frames(source: Path, out_dir: Path, tag: str) -> Dict[int, str]:
    """Pull the sampled frames out of a render, by exact frame index."""
    out_dir.mkdir(parents=True, exist_ok=True)
    frames: Dict[int, str] = {}
    for index in SAMPLE_FRAMES:
        target = out_dir / f"{tag}_f{index:04d}.png"
        result = C.run(
            [
                C.FFMPEG,
                "-y",
                "-hide_banner",
                "-i",
                str(source),
                "-vf",
                f"select=eq(n\\,{index})",
                "-vsync",
                "0",
                "-frames:v",
                "1",
                str(target),
            ],
            timeout=300,
        )
        if result.ok and target.exists():
            frames[index] = str(target)
    return frames


def _render_all_presets(service, log: C.Log, clip_mp4: Path, work: Path) -> List[Dict[str, Any]]:
    wires = {
        entry["presetId"]: entry["wire"]
        for entry in C.read_json(work / "preset-wire.json")["presets"]
    }
    renders: List[Dict[str, Any]] = []
    for position, (preset_id, wire) in enumerate(wires.items(), start=1):
        request = _build_request(preset_id, wire)
        out_path = work / "renders" / f"{preset_id}.mp4"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        log(f"[{position:2d}/{len(wires)}] rendering {preset_id} ({wire['space']}) ...")
        record: Dict[str, Any] = {"presetId": preset_id, "space": wire["space"]}
        try:
            outcome = service._compose_videos_filtergraph(
                request,
                [str(clip_mp4)],
                out_path,
                C.FFMPEG,
                {"width": C.CANVAS_WIDTH, "height": C.CANVAS_HEIGHT},
            )
            record["composited"] = bool(outcome.composited)
            record["warnings"] = list(outcome.warnings)
            record["error"] = None
        except Exception as exc:  # recorded as a data point, never aborts the sweep
            record["composited"] = False
            record["warnings"] = []
            record["error"] = f"{type(exc).__name__}: {exc}"

        if out_path.exists():
            probe = C.ffprobe_json(out_path)
            stream = (probe.get("streams") or [{}])[0]
            fmt = probe.get("format") or {}
            record["output"] = {
                "path": str(out_path),
                "bytes": out_path.stat().st_size,
                "width": stream.get("width"),
                "height": stream.get("height"),
                "frames": int(stream.get("nb_frames") or 0),
                "pix_fmt": stream.get("pix_fmt"),
                "duration": float(fmt.get("duration") or 0.0),
            }
            record["frames"] = _extract_frames(out_path, work / "frames" / "export", preset_id)
        else:
            record["output"] = None
            record["frames"] = {}

        expected_frames = int(C.CLIP_DURATION * C.FPS)
        output = record.get("output") or {}
        record["pass"] = bool(
            record["composited"]
            and record["error"] is None
            and output.get("frames") == expected_frames
            and output.get("width") == C.CANVAS_WIDTH
            and output.get("height") == C.CANVAS_HEIGHT
            and len(record["frames"]) == len(SAMPLE_FRAMES)
        )
        log(
            f"      composited={record['composited']} frames={output.get('frames')} "
            f"warnings={len(record['warnings'])} -> {'PASS' if record['pass'] else 'FAIL'}"
        )
        renders.append(record)
    return renders


def _graph_sizes(work: Path, log: C.Log) -> Dict[str, Any]:
    """L7 — how large the real graphs get, against the inline/script threshold."""
    from app.services.composition.filtergraph_builder import FiltergraphOptions, build_filtergraph
    from app.services.video_composition_service import FILTER_COMPLEX_INLINE_LIMIT

    wires = {
        entry["presetId"]: entry["wire"]
        for entry in C.read_json(work / "preset-wire.json")["presets"]
    }
    sizes = {}
    for preset_id, wire in wires.items():
        request = _build_request(preset_id, wire)
        plan = build_filtergraph(
            list(request.video_items),
            C.CANVAS_WIDTH,
            C.CANVAS_HEIGHT,
            FiltergraphOptions(pre_trimmed=True, fps=C.FPS),
        )
        sizes[preset_id] = len(plan.filter_complex)
    largest = max(sizes, key=sizes.get)
    log(
        f"Largest graph: {largest} at {sizes[largest]} chars "
        f"(inline limit {FILTER_COMPLEX_INLINE_LIMIT}, Windows argv ceiling ~32767)"
    )
    return {
        "inlineLimit": FILTER_COMPLEX_INLINE_LIMIT,
        "perPresetChars": sizes,
        "largestPreset": largest,
        "largestChars": sizes[largest],
        "exceedsInlineLimit": [k for k, v in sizes.items() if v > FILTER_COMPLEX_INLINE_LIMIT],
    }


def _guardrails(service, log: C.Log, clip_mp4: Path, work: Path) -> List[Dict[str, Any]]:
    """The four ways this feature could ship a silently effect-free video."""
    from app.services.composition.camera_motion import CameraMotionUnsupportedError
    from app.services.composition.filtergraph_builder import FiltergraphOptions, build_filtergraph

    wires = {
        entry["presetId"]: entry["wire"]
        for entry in C.read_json(work / "preset-wire.json")["presets"]
    }
    zoom = wires["zoom-in"]
    results: List[Dict[str, Any]] = []

    # --- L1: the concat shortcut must be unreachable with a motion present ----
    with_motion = _build_request("zoom-in", zoom)
    without_motion = _build_request("none", zoom)
    without_motion.video_items[0].camera_motion = None
    options = FiltergraphOptions(pre_trimmed=True, fps=C.FPS)
    motion_plan = build_filtergraph(
        list(with_motion.video_items), C.CANVAS_WIDTH, C.CANVAS_HEIGHT, options
    )
    plain_plan = build_filtergraph(
        list(without_motion.video_items), C.CANVAS_WIDTH, C.CANVAS_HEIGHT, options
    )
    results.append(
        {
            "id": "L1",
            "title": "can_use_concat is False whenever a clip carries a camera motion",
            "observed": {
                "withMotion_canUseConcat": motion_plan.can_use_concat,
                "withoutMotion_canUseConcat": plain_plan.can_use_concat,
            },
            "pass": motion_plan.can_use_concat is False and plain_plan.can_use_concat is True,
        }
    )

    # --- L11: a filtergraph failure with a motion must not become a concat ----
    # The first attempt is forced to fail; production is expected to retry once
    # with a static framing and, when that also fails, RAISE.
    real_run = service._run_filtergraph
    calls: List[str] = []

    class _Failed:
        returncode = 1
        stdout = ""
        stderr = "forced failure (harness)"

    def always_fail(plan, input_paths, output_path, ffmpeg_path):
        calls.append("run")
        return _Failed()

    concat_calls: List[str] = []
    real_concat = service._concat_videos
    service._concat_videos = lambda *a, **k: concat_calls.append("concat")
    service._run_filtergraph = always_fail
    raised: Optional[str] = None
    try:
        service._compose_videos_filtergraph(
            with_motion,
            [str(clip_mp4)],
            work / "renders" / "l11.mp4",
            C.FFMPEG,
            {"width": C.CANVAS_WIDTH, "height": C.CANVAS_HEIGHT},
        )
    except Exception as exc:
        raised = f"{type(exc).__name__}: {exc}"
    finally:
        service._run_filtergraph = real_run
        service._concat_videos = real_concat
    results.append(
        {
            "id": "L11",
            "title": "with a motion, an FFmpeg failure retries once then raises — never concat",
            "observed": {
                "filtergraphAttempts": len(calls),
                "concatCalls": len(concat_calls),
                "raised": raised,
            },
            "pass": raised is not None and len(calls) == 2 and not concat_calls,
        }
    )

    # --- tier-2: no eval=frame -> one frozen framing, plus a loud warning -----
    class _NoEvalFrame:
        has_perspective = True
        perspective_supports_eval_frame = False
        supports_filter_complex_script = True

    static_plan = build_filtergraph(
        list(with_motion.video_items),
        C.CANVAS_WIDTH,
        C.CANVAS_HEIGHT,
        replace(options, caps=_NoEvalFrame()),
    )
    static_out = work / "renders" / "tier2-static.mp4"
    static_run = service._run_filtergraph(static_plan, [str(clip_mp4)], static_out, C.FFMPEG)
    results.append(
        {
            "id": "tier-2",
            "title": "FFmpeg without eval=frame degrades to a static framing and warns",
            "observed": {
                "warnings": list(static_plan.warnings),
                "ffmpegExit": static_run.returncode,
                "renderedBytes": static_out.stat().st_size if static_out.exists() else 0,
            },
            "pass": bool(static_plan.warnings)
            and any("camera_motion_static" in w for w in static_plan.warnings)
            and static_run.returncode == 0,
        }
    )

    # --- tier-3: no perspective filter at all -> refuse, with a fixable message
    class _NoPerspective:
        has_perspective = False
        perspective_supports_eval_frame = False
        supports_filter_complex_script = True

    tier3_error = None
    try:
        build_filtergraph(
            list(with_motion.video_items),
            C.CANVAS_WIDTH,
            C.CANVAS_HEIGHT,
            replace(options, caps=_NoPerspective()),
        )
    except CameraMotionUnsupportedError as exc:
        tier3_error = str(exc)
    results.append(
        {
            "id": "tier-3",
            "title": "FFmpeg without `perspective` fails the export with an actionable message",
            "observed": {"error": tier3_error},
            "pass": bool(tier3_error) and "perspective" in (tier3_error or ""),
        }
    )

    for record in results:
        log(f"  guardrail {record['id']}: {'PASS' if record['pass'] else 'FAIL'} — {record['title']}")
    return results


def main() -> int:
    log = C.Log("m4-export")
    C.add_backend_to_path()
    C.install_cv2_stub_if_broken()
    work = C.work_dir()

    if not (work / "preset-wire.json").exists():
        dump = C.run(
            ["node", str(C.EXPERIMENTS_DIR / "dump-preset-wire.mjs"), str(work / "preset-wire.json")],
            cwd=C.REPO_ROOT,
        )
        if not dump.ok:
            log(f"cannot dump preset wire: {dump.stderr[-500:]}")
            return 1

    log("Building the fixture clip (still pattern, canvas-sized, CFR)...")
    png, clip_mp4 = fixture_media.ensure_fixture()
    log(f"  {clip_mp4.name} sha256={fixture_media.sha256(clip_mp4)[:16]}...")

    from app.services.video_composition_service import VideoCompositionService

    service = VideoCompositionService()
    log("Rendering every shipped preset through the production composition path...")
    renders = _render_all_presets(service, log, clip_mp4, work)

    log("Checking the anti-silent-failure guardrails...")
    guardrails = _guardrails(service, log, clip_mp4, work)

    log("Measuring filtergraph sizes (L7)...")
    graph = _graph_sizes(work, log)

    succeeded = [r for r in renders if r["pass"]]
    verdict = len(succeeded) == len(renders) and all(g["pass"] for g in guardrails)
    payload = {
        "metric": "M4",
        "title": "Export robustness across every shipped preset, plus the anti-silent-failure guardrails",
        "fixture": {
            "pattern": str(png),
            "patternSha256": fixture_media.sha256(png),
            "clip": str(clip_mp4),
            "clipSha256": fixture_media.sha256(clip_mp4),
            "durationSeconds": C.CLIP_DURATION,
            "fps": C.FPS,
        },
        "sampleFrames": SAMPLE_FRAMES,
        "renders": renders,
        "successRate": f"{len(succeeded)}/{len(renders)}",
        "guardrails": guardrails,
        "filtergraphSize": graph,
        "pass": verdict,
    }
    path = C.write_json("m4-export.json", payload)
    log(f"M4 {'PASS' if verdict else 'FAIL'} — {len(succeeded)}/{len(renders)} presets exported -> {path.name}")
    log.close()
    return 0 if verdict else 1


if __name__ == "__main__":
    raise SystemExit(main())
