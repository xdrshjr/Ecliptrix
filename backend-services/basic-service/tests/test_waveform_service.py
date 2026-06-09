"""Tests for the local audio waveform service (spec 04 — 本地音频波形).

运行测试：
    pytest tests/test_waveform_service.py -v

These tests exercise the FFmpeg-backed peaks extraction, normalization,
fixed-length downsampling, on-disk JSON persistence, idempotency, and the
``list_material_files`` / ``delete_by_material`` hooks consumed by spec 06.

A short, synthetically generated sine-wave WAV (created via ffmpeg) is the
fixture. The whole module is skipped when ffmpeg/ffprobe are not on PATH so a
box without the desktop bundle does not produce spurious failures — the code
under test is still exercised on any CI / desktop machine that ships ffmpeg.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from app.services.waveform_service import WaveformService


_FFMPEG_AVAILABLE = shutil.which("ffmpeg") is not None
_FFPROBE_AVAILABLE = shutil.which("ffprobe") is not None

pytestmark = pytest.mark.skipif(
    not (_FFMPEG_AVAILABLE and _FFPROBE_AVAILABLE),
    reason="ffmpeg/ffprobe not on PATH; waveform extraction requires them",
)


@pytest.fixture
def waveform_svc(storage_root):
    """Create a WaveformService bound to a temporary storage root."""
    with patch("app.services.waveform_service.settings") as mock_settings:
        mock_settings.storage = MagicMock()
        mock_settings.storage.root = str(storage_root)
        mock_settings.waveform = MagicMock()
        mock_settings.waveform.peaks_per_second = 50
        mock_settings.waveform.max_concurrent = 2
        mock_settings.waveform.timeout_seconds = 60
        svc = WaveformService()
    return svc


@pytest.fixture
def sample_audio(tmp_path) -> Path:
    """Generate a deterministic 2-second mono sine-wave WAV via ffmpeg."""
    out = tmp_path / "sample.wav"
    cmd = [
        "ffmpeg", "-f", "lavfi",
        "-i", "sine=frequency=440:duration=2",
        "-ac", "1", "-ar", "44100",
        "-y", str(out),
    ]
    result = subprocess.run(cmd, capture_output=True, timeout=30)
    assert result.returncode == 0, result.stderr.decode(errors="replace")[:500]
    assert out.exists()
    return out


# ---------------------------------------------------------------------------
# peaks extraction + normalization + fixed-length downsampling
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_generate_returns_ready_with_normalized_peaks(
    waveform_svc, sample_audio
):
    """A short sample yields a ready status + normalized peaks array."""
    result = await waveform_svc.generate("mat-1", str(sample_audio))

    assert result["status"] == "ready"
    peaks = result["peaks"]
    assert isinstance(peaks, list)
    assert len(peaks) > 0
    # All peaks must be in the normalized 0..1 range.
    assert all(0.0 <= p <= 1.0 for p in peaks)
    # A non-silent sine wave must register real amplitude. (ffmpeg's `sine`
    # lavfi emits a ~0.125 full-scale tone, so this stays well above noise
    # without over-fitting the generator's amplitude.)
    assert max(peaks) > 0.1


@pytest.mark.asyncio
async def test_peaks_length_proportional_to_duration(waveform_svc, sample_audio):
    """peaks length ≈ durationSec * peaksPerSecond (within rounding tolerance)."""
    result = await waveform_svc.generate("mat-len", str(sample_audio))

    duration = result["duration_sec"]
    pps = result["peaks_per_second"]
    expected = duration * pps
    # Allow ±1 column of rounding slack at the tail.
    assert abs(len(result["peaks"]) - round(expected)) <= 1


# ---------------------------------------------------------------------------
# on-disk JSON persistence (camelCase schema) + GET
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_persists_camelcase_json_to_waveforms_dir(
    waveform_svc, sample_audio, storage_root
):
    """Peaks are persisted to static/audio/waveforms/{materialId}.json camelCase."""
    await waveform_svc.generate("mat-json", str(sample_audio))

    on_disk = (
        Path(storage_root)
        / "static" / "audio" / "waveforms" / "mat-json.json"
    )
    assert on_disk.exists()

    payload = json.loads(on_disk.read_text(encoding="utf-8"))
    # On-disk schema is camelCase, version 1, frontend-direct-consumable.
    assert payload["version"] == 1
    assert payload["materialId"] == "mat-json"
    assert "durationSec" in payload
    assert "peaksPerSecond" in payload
    assert isinstance(payload["peaks"], list)
    assert len(payload["peaks"]) > 0


@pytest.mark.asyncio
async def test_get_returns_snake_case_rest_payload(waveform_svc, sample_audio):
    """get_waveform returns ready + snake_case REST fields once generated."""
    await waveform_svc.generate("mat-get", str(sample_audio))

    fetched = await waveform_svc.get_waveform("mat-get")
    assert fetched["status"] == "ready"
    assert "duration_sec" in fetched
    assert "peaks_per_second" in fetched
    assert isinstance(fetched["peaks"], list)
    assert len(fetched["peaks"]) > 0


@pytest.mark.asyncio
async def test_get_missing_material_returns_missing(waveform_svc):
    """get_waveform for an unknown material reports a non-ready status."""
    fetched = await waveform_svc.get_waveform("does-not-exist")
    assert fetched["status"] in {"missing", "pending", "failed"}
    assert fetched.get("peaks") is None


# ---------------------------------------------------------------------------
# idempotency
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_generate_is_idempotent(waveform_svc, sample_audio):
    """A second generate for an existing material does not re-extract."""
    first = await waveform_svc.generate("mat-idem", str(sample_audio))
    assert first["status"] == "ready"

    # Spy on the extraction primitive — the idempotent path must not call it.
    with patch.object(
        waveform_svc, "_extract_peaks", wraps=waveform_svc._extract_peaks
    ) as spy:
        second = await waveform_svc.generate("mat-idem", str(sample_audio))
        assert second["status"] == "ready"
        spy.assert_not_called()


@pytest.mark.asyncio
async def test_generate_force_reextracts(waveform_svc, sample_audio):
    """force=True bypasses the idempotency short-circuit."""
    await waveform_svc.generate("mat-force", str(sample_audio))
    with patch.object(
        waveform_svc, "_extract_peaks", wraps=waveform_svc._extract_peaks
    ) as spy:
        await waveform_svc.generate("mat-force", str(sample_audio), force=True)
        spy.assert_called_once()


# ---------------------------------------------------------------------------
# list / delete by material (spec 06 hooks)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_material_files_returns_relative_path(
    waveform_svc, sample_audio
):
    """list_material_files yields the relative on-disk path for a material."""
    await waveform_svc.generate("mat-list", str(sample_audio))

    files = waveform_svc.list_material_files("mat-list")
    assert len(files) == 1
    assert files[0].replace("\\", "/").endswith(
        "static/audio/waveforms/mat-list.json"
    )


@pytest.mark.asyncio
async def test_list_material_files_empty_for_unknown(waveform_svc):
    """Unknown materials list to nothing rather than raising."""
    assert waveform_svc.list_material_files("nobody") == []


@pytest.mark.asyncio
async def test_delete_by_material_removes_json(
    waveform_svc, sample_audio, storage_root
):
    """delete_by_material removes the persisted JSON and reports the count."""
    await waveform_svc.generate("mat-del", str(sample_audio))
    on_disk = (
        Path(storage_root)
        / "static" / "audio" / "waveforms" / "mat-del.json"
    )
    assert on_disk.exists()

    removed = waveform_svc.delete_by_material("mat-del")
    assert removed == 1
    assert not on_disk.exists()


@pytest.mark.asyncio
async def test_delete_by_material_noop_when_absent(waveform_svc):
    """Deleting a non-existent material removes nothing and does not raise."""
    assert waveform_svc.delete_by_material("ghost") == 0


# ---------------------------------------------------------------------------
# materialId sanitization — traversal-safe filename derivation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_material_id_with_traversal_is_rejected(waveform_svc, sample_audio):
    """A materialId containing path separators / traversal is refused."""
    with pytest.raises(ValueError):
        await waveform_svc.generate("../escape", str(sample_audio))
