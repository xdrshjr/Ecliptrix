"""Offline acceptance measurements; run with the packaged Python and Pillow."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
import wave
from pathlib import Path
from typing import Any
import unicodedata


def compare_images(options: argparse.Namespace) -> dict[str, Any]:
    """Compare decoded pixels using the fixed, eroded flat-region mask."""
    from PIL import Image, ImageChops, ImageFilter, ImageStat

    reference = Image.open(options.reference).convert("RGBA")
    repeated = Image.open(options.repeated).convert("RGBA")
    candidate = Image.open(options.candidate).convert("RGB")
    if candidate.size != reference.size:
        if not options.allow_resize:
            raise ValueError("Image dimensions do not match")
        candidate = candidate.resize(reference.size, Image.Resampling.LANCZOS)
    rgb = reference.convert("RGB")
    edge = Image.new("L", rgb.size)
    for offset in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        difference = ImageChops.difference(
            rgb, ImageChops.offset(rgb, *offset)
        )
        red, green, blue = difference.split()
        edge = ImageChops.lighter(
            edge, ImageChops.lighter(ImageChops.lighter(red, green), blue)
        )
    edge = edge.point(lambda value: 255 if value > 8 else 0)
    mask = ImageChops.invert(edge.filter(ImageFilter.MaxFilter(3)))
    histogram = mask.histogram()
    flat_pixels = histogram[255]
    if flat_pixels == 0:
        raise ValueError("No fixed flat-region pixels exist")
    difference = ImageChops.difference(rgb, candidate)
    channels = ImageStat.Stat(difference, mask).mean
    if options.verify_mask:
        saved_mask = Image.open(options.mask).convert("L")
        if saved_mask.size != mask.size or saved_mask.tobytes() != mask.tobytes():
            raise ValueError("Fixed mask attachment does not match the PNG")
    else:
        mask.save(options.mask)
    return {
        "png_equal": Path(options.reference).read_bytes()
        == Path(options.repeated).read_bytes(),
        "rgba_equal": reference.size == repeated.size
        and reference.tobytes() == repeated.tobytes(),
        "flat_pixels": flat_pixels,
        "channel_mae": channels,
        "flat_mae": max(channels),
        "mask_sha256": hashlib.sha256(
            Path(options.mask).read_bytes()
        ).hexdigest(),
    }


def measure_audio(options: argparse.Namespace) -> dict[str, Any]:
    """Measure fixed 10ms windows without renormalizing the observed waveform."""
    with wave.open(options.audio, "rb") as recording:
        if recording.getnchannels() != 1 or recording.getsampwidth() != 2:
            raise ValueError("Expected mono signed 16-bit PCM")
        sample_rate = recording.getframerate()
        if sample_rate != 48000:
            raise ValueError("Expected a 48kHz fixture")
        samples = struct.unpack(
            "<" + "h" * recording.getnframes(),
            recording.readframes(recording.getnframes()),
        )
    gain = options.gain
    threshold = 0.5 * gain
    window_size = sample_rate // 100
    peaks: list[dict[str, float]] = []
    for start in range(0, len(samples), window_size):
        window = samples[start : start + window_size]
        if not window:
            continue
        peak = max(abs(value) for value in window) / 32768
        rms = math.sqrt(sum(value * value for value in window) / len(window))
        rms /= 32768
        if (gain > 0 and peak >= threshold and rms >= threshold / 4):
            seconds = start / sample_rate - options.start_time
            if peaks and seconds - peaks[-1]["time"] <= 0.011:
                peaks[-1]["peak"] = max(peaks[-1]["peak"], peak)
            else:
                peaks.append({"time": seconds, "peak": peak})
    absolute_peak = max((abs(value) for value in samples), default=0) / 32768
    if gain == 0:
        if absolute_peak > 0.001:
            raise ValueError("Muted fixture contains audio")
        return {"muted": True, "absolute_peak": absolute_peak, "peaks": []}
    expected = json.loads(options.expected)
    if len(expected) != len(peaks):
        raise ValueError("Missing or duplicated audio pulses")
    offsets = [abs(peak["time"] - when) for peak, when in zip(peaks, expected)]
    return {"peaks": peaks, "threshold": threshold, "gain": gain,
            "max_av_error_seconds": max(offsets, default=0),
            "absolute_peak": absolute_peak}


def check_glyphs(options: argparse.Namespace) -> dict[str, Any]:
    """Reject glyphs absent from every declared offline fallback font."""
    from PIL import ImageFont

    fonts = [ImageFont.truetype(filename, 48) for filename in options.font]
    missing = []
    for character in set(options.text):
        if character.isspace() or ord(character) in (0x200D, 0xFE0E, 0xFE0F):
            continue
        supported = False
        for font in fonts:
            mask = font.getmask(character)
            tofu = font.getmask(chr(0x10FFFF))
            if mask.size != tofu.size or bytes(mask) != bytes(tofu):
                supported = True
                break
        if not supported:
            missing.append(f"U+{ord(character):04X}")
    return {"missing": sorted(missing), "offline_glyphs_complete": not missing}


def main() -> None:
    """Emit machine-readable measurements or a failing process exit."""
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="mode", required=True)
    compare = subparsers.add_parser("compare")
    for name in ("reference", "repeated", "candidate", "mask"):
        compare.add_argument("--" + name, required=True)
    compare.add_argument("--allow-resize", action="store_true")
    compare.add_argument("--verify-mask", action="store_true")
    audio = subparsers.add_parser("audio")
    audio.add_argument("--audio", required=True)
    audio.add_argument("--gain", type=float, required=True)
    audio.add_argument("--start-time", type=float, default=0)
    audio.add_argument("--expected", required=True)
    glyphs = subparsers.add_parser("glyphs")
    glyphs.add_argument("--font", action="append", required=True)
    glyphs.add_argument("--text", required=True)
    options = parser.parse_args()
    functions = {"compare": compare_images, "audio": measure_audio,
                 "glyphs": check_glyphs}
    measurements = functions[options.mode](options)
    print(json.dumps(measurements, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
