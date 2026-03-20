"""
ARK API Direct Mode Testing — Validates video generation across 4 input scenarios.

This script bypasses the business layer and calls the ARK Seedance API directly
to verify correct request/response structure for:
  1. Pure text-to-video (baseline)
  2. First frame image + text prompt
  3. First frame + last frame + text prompt
  4. Last frame only (no first frame) — verify if API allows this

Usage:
    python tests/test_ark_api_modes.py

Environment:
    Reads ARK_API_KEY from backend-services/basic-service/.env
"""

import asyncio
import json
import os
import sys
import time
import traceback
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ARK_API_BASE = "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks"
ARK_MODEL = "doubao-seedance-1-5-pro-251215"

POLL_INTERVAL_SEC = 5
MAX_POLL_DURATION_SEC = 180

# Test images: Generated locally as base64 data URIs via _generate_test_image_base64().
# The ARK API server (cn-beijing) cannot reach Pexels/Unsplash/Picsum hosts,
# but accepts data:image/jpeg;base64,... URIs directly (confirmed 2026-03-21).


def _generate_test_image_base64(color_rgb: tuple, width: int = 320, height: int = 240) -> str:
    """
    Generate a small JPEG test image as a base64 data URI using Pillow.
    Creates a gradient image (not just solid color) for more realistic testing.
    Resulting base64 is typically 5-15 KB — well within API limits.
    """
    import base64
    import io
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (width, height), color_rgb)
    draw = ImageDraw.Draw(img)

    # Add a simple gradient/pattern so the image is more interesting for video generation
    r, g, b = color_rgb
    for y in range(height):
        factor = y / height
        row_color = (
            int(r * (1 - factor * 0.5)),
            int(g * (1 - factor * 0.3)),
            int(b * (1 - factor * 0.7)),
        )
        draw.line([(0, y), (width, y)], fill=row_color)

    # Draw a simple shape for visual distinctiveness
    cx, cy = width // 2, height // 2
    draw.ellipse([cx - 40, cy - 40, cx + 40, cy + 40], fill=(255, 255, 255), outline=(0, 0, 0))

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=75)
    b64 = base64.b64encode(buf.getvalue()).decode('ascii')
    return f"data:image/jpeg;base64,{b64}"


# Populated at runtime by resolve_test_images() before scenarios execute.
TEST_IMAGE_FIRST_FRAME = ""
TEST_IMAGE_LAST_FRAME = ""


async def resolve_test_images() -> tuple:
    """
    Generate test images as base64 data URIs for use in API scenarios.

    Returns (first_frame_data_uri, last_frame_data_uri).
    """
    # Generate distinct JPEG images as base64 data URIs.
    # First run (2026-03-21) confirmed ARK API accepts base64 data URIs.
    # Warm colors for first frame, cool colors for last frame — visually distinct.
    # ARK API requires minimum height of 300px
    first = _generate_test_image_base64((200, 120, 60), 640, 480)   # warm orange
    last = _generate_test_image_base64((60, 120, 200), 640, 480)    # cool blue

    print(f"  Generated base64 JPEG images (first: {len(first)} chars, last: {len(last)} chars)")
    print("  Using base64 data URIs (verified working with ARK API)")
    return first, last


# ---------------------------------------------------------------------------
# Result tracking
# ---------------------------------------------------------------------------

class ScenarioStatus(Enum):
    PASSED = "PASSED"
    FAILED = "FAILED"
    ERROR = "ERROR"
    SKIPPED = "SKIPPED"


@dataclass
class ScenarioResult:
    """Tracks the outcome of a single test scenario."""
    scenario_id: int
    name: str
    status: ScenarioStatus = ScenarioStatus.SKIPPED
    task_id: Optional[str] = None
    video_url: Optional[str] = None
    error_message: Optional[str] = None
    elapsed_seconds: float = 0.0
    request_payload: Optional[Dict[str, Any]] = None
    create_response: Optional[Dict[str, Any]] = None
    final_response: Optional[Dict[str, Any]] = None
    notes: List[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Core API helpers
# ---------------------------------------------------------------------------

def load_api_key() -> str:
    """Load ARK_API_KEY from the .env file in the backend service directory."""
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.exists():
        raise FileNotFoundError(
            f".env file not found at {env_path}. "
            "Please create it with ARK_API_KEY=<your key>."
        )
    load_dotenv(dotenv_path=str(env_path), override=True)
    api_key = os.getenv("ARK_API_KEY", "").strip()
    if not api_key:
        raise ValueError("ARK_API_KEY is empty or missing in .env file.")
    return api_key


def _make_headers(api_key: str) -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


def _sanitize_payload_for_logging(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Return a copy of the payload with base64 data URIs truncated for readable logging.
    """
    import copy
    sanitized = copy.deepcopy(payload)
    for item in sanitized.get("content", []):
        if isinstance(item, dict) and "image_url" in item:
            url = item["image_url"].get("url", "")
            if url.startswith("data:"):
                # Truncate base64 to show format only
                prefix_end = url.find(",")
                if prefix_end > 0:
                    item["image_url"]["url"] = url[:prefix_end + 1] + f"<{len(url) - prefix_end - 1} chars>"
    return sanitized


async def submit_task(
    client: httpx.AsyncClient,
    api_key: str,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    """
    POST a video generation task to ARK API.
    Returns the full JSON response body.
    Raises on HTTP errors.
    """
    headers = _make_headers(api_key)
    response = await client.post(ARK_API_BASE, json=payload, headers=headers)

    # Always try to parse body for diagnostics
    try:
        body = response.json()
    except Exception:
        body = {"_raw_text": response.text}

    if response.status_code != 200:
        raise httpx.HTTPStatusError(
            f"ARK API returned {response.status_code}: {json.dumps(body, ensure_ascii=False)}",
            request=response.request,
            response=response,
        )

    return body


async def poll_task(
    client: httpx.AsyncClient,
    api_key: str,
    task_id: str,
    max_duration: int = MAX_POLL_DURATION_SEC,
    interval: int = POLL_INTERVAL_SEC,
) -> Dict[str, Any]:
    """
    GET task status, polling every `interval` seconds until terminal state
    or `max_duration` is exceeded.
    Returns the final JSON response body.
    """
    headers = _make_headers(api_key)
    url = f"{ARK_API_BASE}/{task_id}"
    start = time.monotonic()

    consecutive_errors = 0
    max_consecutive_errors = 3

    while True:
        elapsed = time.monotonic() - start
        if elapsed > max_duration:
            raise TimeoutError(
                f"Polling timed out after {max_duration}s for task {task_id}. "
                "Task may still be running on the server."
            )

        try:
            response = await client.get(url, headers=headers)
            try:
                body = response.json()
            except Exception:
                body = {"_raw_text": response.text}

            if response.status_code != 200:
                raise httpx.HTTPStatusError(
                    f"Polling returned {response.status_code}: {json.dumps(body, ensure_ascii=False)}",
                    request=response.request,
                    response=response,
                )

            consecutive_errors = 0  # Reset on success
        except (httpx.HTTPStatusError,):
            raise  # Re-raise HTTP errors immediately
        except Exception as net_err:
            consecutive_errors += 1
            print(f"    [poll] {elapsed:.0f}s — network error ({consecutive_errors}/{max_consecutive_errors}): {type(net_err).__name__}: {net_err}")
            if consecutive_errors >= max_consecutive_errors:
                raise
            await asyncio.sleep(interval)
            continue

        status = body.get("status", "").lower()
        print(f"    [poll] {elapsed:.0f}s — status={status}")

        if status == "succeeded":
            return body
        elif status in ("failed", "cancelled", "canceled", "error", "timeout"):
            return body

        await asyncio.sleep(interval)


# ---------------------------------------------------------------------------
# Scenario implementations
# ---------------------------------------------------------------------------

async def scenario_1_text_only(client: httpx.AsyncClient, api_key: str) -> ScenarioResult:
    """Scenario 1 (baseline): Pure text-to-video — prompt only, no images."""
    result = ScenarioResult(scenario_id=1, name="Pure text-to-video (baseline)")
    start = time.monotonic()

    payload = {
        "model": ARK_MODEL,
        "content": [
            {"type": "text", "text": "一只猫在草地上奔跑，阳光明媚"},
        ],
        "duration": 5,
        "ratio": "16:9",
        "resolution": "720p",
    }
    result.request_payload = payload

    try:
        print("\n  [submit] Sending task...")
        print(f"  [payload] {json.dumps(_sanitize_payload_for_logging(payload), ensure_ascii=False, indent=2)}")
        create_resp = await submit_task(client, api_key, payload)
        result.create_response = create_resp
        print(f"  [response] {json.dumps(create_resp, ensure_ascii=False, indent=2)}")

        task_id = create_resp.get("id")
        if not task_id:
            result.status = ScenarioStatus.FAILED
            result.error_message = f"No task ID in response: {create_resp}"
            return result
        result.task_id = task_id
        print(f"  [task_id] {task_id}")

        print("  [poll] Polling for completion...")
        final = await poll_task(client, api_key, task_id)
        result.final_response = final
        print(f"  [final] {json.dumps(final, ensure_ascii=False, indent=2)}")

        final_status = final.get("status", "").lower()
        if final_status == "succeeded":
            content = final.get("content", {})
            video_url = content.get("video_url") if isinstance(content, dict) else None
            if video_url:
                result.video_url = video_url
                result.status = ScenarioStatus.PASSED
                result.notes.append(f"Video URL obtained: {video_url[:80]}...")
            else:
                result.status = ScenarioStatus.FAILED
                result.error_message = "Succeeded but no video_url in content"
                result.notes.append(f"Content structure: {type(content).__name__}, keys: {list(content.keys()) if isinstance(content, dict) else 'N/A'}")
        else:
            result.status = ScenarioStatus.FAILED
            error_info = final.get("error", {})
            result.error_message = (
                error_info.get("message", "") if isinstance(error_info, dict)
                else str(error_info)
            ) or f"Task ended with status: {final_status}"

    except TimeoutError as e:
        result.status = ScenarioStatus.ERROR
        result.error_message = str(e)
    except httpx.HTTPStatusError as e:
        result.status = ScenarioStatus.ERROR
        result.error_message = str(e)
    except Exception as e:
        result.status = ScenarioStatus.ERROR
        result.error_message = f"{type(e).__name__}: {e}"
        traceback.print_exc()
    finally:
        result.elapsed_seconds = time.monotonic() - start

    return result


async def scenario_2_first_frame(client: httpx.AsyncClient, api_key: str) -> ScenarioResult:
    """Scenario 2: First frame image + text prompt."""
    result = ScenarioResult(scenario_id=2, name="First frame image + text prompt")
    start = time.monotonic()

    payload = {
        "model": ARK_MODEL,
        "content": [
            {"type": "text", "text": "镜头缓慢推进，花朵在阳光下绽放"},
            {
                "type": "image_url",
                "image_url": {"url": TEST_IMAGE_FIRST_FRAME},
                "role": "first_frame",
            },
        ],
        "duration": 5,
        "ratio": "adaptive",
        "resolution": "720p",
    }
    result.request_payload = payload

    try:
        print("\n  [submit] Sending task...")
        print(f"  [payload] {json.dumps(_sanitize_payload_for_logging(payload), ensure_ascii=False, indent=2)}")
        create_resp = await submit_task(client, api_key, payload)
        result.create_response = create_resp
        print(f"  [response] {json.dumps(create_resp, ensure_ascii=False, indent=2)}")

        task_id = create_resp.get("id")
        if not task_id:
            result.status = ScenarioStatus.FAILED
            result.error_message = f"No task ID in response: {create_resp}"
            return result
        result.task_id = task_id
        print(f"  [task_id] {task_id}")

        print("  [poll] Polling for completion...")
        final = await poll_task(client, api_key, task_id)
        result.final_response = final
        print(f"  [final] {json.dumps(final, ensure_ascii=False, indent=2)}")

        final_status = final.get("status", "").lower()
        if final_status == "succeeded":
            content = final.get("content", {})
            video_url = content.get("video_url") if isinstance(content, dict) else None
            if video_url:
                result.video_url = video_url
                result.status = ScenarioStatus.PASSED
                result.notes.append(f"Video URL obtained: {video_url[:80]}...")
                result.notes.append("First frame image accepted with role='first_frame'")
                # Check if ratio was returned
                if "ratio" in final:
                    result.notes.append(f"Returned ratio: {final['ratio']}")
            else:
                result.status = ScenarioStatus.FAILED
                result.error_message = "Succeeded but no video_url in content"
        else:
            result.status = ScenarioStatus.FAILED
            error_info = final.get("error", {})
            result.error_message = (
                error_info.get("message", "") if isinstance(error_info, dict)
                else str(error_info)
            ) or f"Task ended with status: {final_status}"

    except TimeoutError as e:
        result.status = ScenarioStatus.ERROR
        result.error_message = str(e)
    except httpx.HTTPStatusError as e:
        result.status = ScenarioStatus.ERROR
        result.error_message = str(e)
    except Exception as e:
        result.status = ScenarioStatus.ERROR
        result.error_message = f"{type(e).__name__}: {e}"
        traceback.print_exc()
    finally:
        result.elapsed_seconds = time.monotonic() - start

    return result


async def scenario_3_first_and_last_frame(client: httpx.AsyncClient, api_key: str) -> ScenarioResult:
    """Scenario 3: First frame + last frame + text prompt."""
    result = ScenarioResult(scenario_id=3, name="First frame + last frame + text prompt")
    start = time.monotonic()

    payload = {
        "model": ARK_MODEL,
        "content": [
            {"type": "text", "text": "从白天过渡到黑夜的延时效果，画面流畅转变"},
            {
                "type": "image_url",
                "image_url": {"url": TEST_IMAGE_FIRST_FRAME},
                "role": "first_frame",
            },
            {
                "type": "image_url",
                "image_url": {"url": TEST_IMAGE_LAST_FRAME},
                "role": "last_frame",
            },
        ],
        "duration": 5,
        "ratio": "adaptive",
        "resolution": "720p",
    }
    result.request_payload = payload

    try:
        print("\n  [submit] Sending task...")
        print(f"  [payload] {json.dumps(_sanitize_payload_for_logging(payload), ensure_ascii=False, indent=2)}")
        create_resp = await submit_task(client, api_key, payload)
        result.create_response = create_resp
        print(f"  [response] {json.dumps(create_resp, ensure_ascii=False, indent=2)}")

        task_id = create_resp.get("id")
        if not task_id:
            result.status = ScenarioStatus.FAILED
            result.error_message = f"No task ID in response: {create_resp}"
            return result
        result.task_id = task_id
        print(f"  [task_id] {task_id}")

        print("  [poll] Polling for completion...")
        final = await poll_task(client, api_key, task_id)
        result.final_response = final
        print(f"  [final] {json.dumps(final, ensure_ascii=False, indent=2)}")

        final_status = final.get("status", "").lower()
        if final_status == "succeeded":
            content = final.get("content", {})
            video_url = content.get("video_url") if isinstance(content, dict) else None
            if video_url:
                result.video_url = video_url
                result.status = ScenarioStatus.PASSED
                result.notes.append(f"Video URL obtained: {video_url[:80]}...")
                result.notes.append("Both first_frame and last_frame accepted")
            else:
                result.status = ScenarioStatus.FAILED
                result.error_message = "Succeeded but no video_url in content"
        else:
            result.status = ScenarioStatus.FAILED
            error_info = final.get("error", {})
            result.error_message = (
                error_info.get("message", "") if isinstance(error_info, dict)
                else str(error_info)
            ) or f"Task ended with status: {final_status}"

    except TimeoutError as e:
        result.status = ScenarioStatus.ERROR
        result.error_message = str(e)
    except httpx.HTTPStatusError as e:
        result.status = ScenarioStatus.ERROR
        result.error_message = str(e)
    except Exception as e:
        result.status = ScenarioStatus.ERROR
        result.error_message = f"{type(e).__name__}: {e}"
        traceback.print_exc()
    finally:
        result.elapsed_seconds = time.monotonic() - start

    return result


async def scenario_4_last_frame_only(client: httpx.AsyncClient, api_key: str) -> ScenarioResult:
    """Scenario 4: Last frame only (no first frame) — verify if API allows this."""
    result = ScenarioResult(scenario_id=4, name="Last frame only (no first frame)")
    start = time.monotonic()

    payload = {
        "model": ARK_MODEL,
        "content": [
            {"type": "text", "text": "一段旅程的终点，夕阳下的湖泊"},
            {
                "type": "image_url",
                "image_url": {"url": TEST_IMAGE_LAST_FRAME},
                "role": "last_frame",
            },
        ],
        "duration": 5,
        "ratio": "adaptive",
        "resolution": "720p",
    }
    result.request_payload = payload

    try:
        print("\n  [submit] Sending task...")
        print(f"  [payload] {json.dumps(_sanitize_payload_for_logging(payload), ensure_ascii=False, indent=2)}")
        create_resp = await submit_task(client, api_key, payload)
        result.create_response = create_resp
        print(f"  [response] {json.dumps(create_resp, ensure_ascii=False, indent=2)}")

        task_id = create_resp.get("id")
        if not task_id:
            # If the API rejects last-frame-only at submission time, that's useful info
            result.status = ScenarioStatus.FAILED
            result.error_message = f"No task ID in response: {create_resp}"
            result.notes.append("API may not support last_frame without first_frame at submission level")
            return result
        result.task_id = task_id
        print(f"  [task_id] {task_id}")

        print("  [poll] Polling for completion...")
        final = await poll_task(client, api_key, task_id)
        result.final_response = final
        print(f"  [final] {json.dumps(final, ensure_ascii=False, indent=2)}")

        final_status = final.get("status", "").lower()
        if final_status == "succeeded":
            content = final.get("content", {})
            video_url = content.get("video_url") if isinstance(content, dict) else None
            if video_url:
                result.video_url = video_url
                result.status = ScenarioStatus.PASSED
                result.notes.append(f"Video URL obtained: {video_url[:80]}...")
                result.notes.append("IMPORTANT: API accepts last_frame without first_frame")
            else:
                result.status = ScenarioStatus.FAILED
                result.error_message = "Succeeded but no video_url in content"
        else:
            result.status = ScenarioStatus.FAILED
            error_info = final.get("error", {})
            error_msg = (
                error_info.get("message", "") if isinstance(error_info, dict)
                else str(error_info)
            ) or f"Task ended with status: {final_status}"
            result.error_message = error_msg
            result.notes.append(
                "API does NOT allow last_frame without first_frame — "
                "frontend/backend should enforce first_frame as required when using keyframe mode"
            )

    except httpx.HTTPStatusError as e:
        result.status = ScenarioStatus.FAILED
        result.error_message = str(e)
        result.notes.append(
            "API rejected last_frame-only at HTTP level — "
            "this confirms first_frame is required when using image roles"
        )
    except TimeoutError as e:
        result.status = ScenarioStatus.ERROR
        result.error_message = str(e)
    except Exception as e:
        result.status = ScenarioStatus.ERROR
        result.error_message = f"{type(e).__name__}: {e}"
        traceback.print_exc()
    finally:
        result.elapsed_seconds = time.monotonic() - start

    return result


# ---------------------------------------------------------------------------
# Summary printer
# ---------------------------------------------------------------------------

def print_summary(results: List[ScenarioResult]) -> None:
    """Print a formatted summary table of all scenario results."""
    print("\n" + "=" * 80)
    print("SUMMARY — ARK API Mode Testing Results")
    print("=" * 80)

    passed = 0
    failed = 0
    errors = 0

    for r in results:
        icon = {
            ScenarioStatus.PASSED: "PASS",
            ScenarioStatus.FAILED: "FAIL",
            ScenarioStatus.ERROR: "ERR ",
            ScenarioStatus.SKIPPED: "SKIP",
        }[r.status]

        status_str = f"[{icon}]"
        print(f"\n  {status_str} Scenario {r.scenario_id}: {r.name}")
        print(f"         Elapsed: {r.elapsed_seconds:.1f}s")
        if r.task_id:
            print(f"         Task ID: {r.task_id}")
        if r.video_url:
            print(f"         Video:   {r.video_url[:100]}...")
        if r.error_message:
            print(f"         Error:   {r.error_message[:200]}")
        for note in r.notes:
            print(f"         Note:    {note}")

        if r.status == ScenarioStatus.PASSED:
            passed += 1
        elif r.status == ScenarioStatus.FAILED:
            failed += 1
        else:
            errors += 1

    print(f"\n{'=' * 80}")
    print(f"  Total: {len(results)}  |  Passed: {passed}  |  Failed: {failed}  |  Errors: {errors}")
    print(f"{'=' * 80}\n")

    # Print any API behavior differences worth noting
    api_notes: List[str] = []
    for r in results:
        for note in r.notes:
            if "IMPORTANT" in note or "API does NOT" in note or "API rejected" in note:
                api_notes.append(f"  - Scenario {r.scenario_id}: {note}")

    if api_notes:
        print("API BEHAVIOR NOTES (differences from expected):")
        for note in api_notes:
            print(note)
        print()


# ---------------------------------------------------------------------------
# Main runner
# ---------------------------------------------------------------------------

async def run_all_scenarios() -> List[ScenarioResult]:
    """Execute all 4 scenarios sequentially and return results."""
    global TEST_IMAGE_FIRST_FRAME, TEST_IMAGE_LAST_FRAME

    api_key = load_api_key()
    masked_key = api_key[:8] + "..." + api_key[-4:]
    print(f"ARK API Key loaded: {masked_key}")
    print(f"ARK API Base: {ARK_API_BASE}")
    print(f"ARK Model: {ARK_MODEL}")
    print(f"Poll interval: {POLL_INTERVAL_SEC}s, Max wait: {MAX_POLL_DURATION_SEC}s")

    results: List[ScenarioResult] = []

    # Use a shared client with generous timeout for all scenarios
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=30.0)) as client:

        # Resolve test image URLs by probing the ARK API directly
        print("\n  Resolving test image URLs...")
        TEST_IMAGE_FIRST_FRAME, TEST_IMAGE_LAST_FRAME = await resolve_test_images()
        print(f"  First frame: {TEST_IMAGE_FIRST_FRAME[:100]}{'...' if len(TEST_IMAGE_FIRST_FRAME) > 100 else ''}")
        print(f"  Last frame:  {TEST_IMAGE_LAST_FRAME[:100]}{'...' if len(TEST_IMAGE_LAST_FRAME) > 100 else ''}")

        # Scenario 1: Pure text-to-video
        print(f"\n{'=' * 60}")
        print("SCENARIO 1: Pure text-to-video (baseline)")
        print("=" * 60)
        r1 = await scenario_1_text_only(client, api_key)
        results.append(r1)

        # Scenario 2: First frame + text
        print(f"\n{'=' * 60}")
        print("SCENARIO 2: First frame image + text prompt")
        print("=" * 60)
        r2 = await scenario_2_first_frame(client, api_key)
        results.append(r2)

        # Scenario 3: First frame + last frame + text
        print(f"\n{'=' * 60}")
        print("SCENARIO 3: First frame + last frame + text prompt")
        print("=" * 60)
        r3 = await scenario_3_first_and_last_frame(client, api_key)
        results.append(r3)

        # Scenario 4: Last frame only
        print(f"\n{'=' * 60}")
        print("SCENARIO 4: Last frame only (no first frame)")
        print("=" * 60)
        r4 = await scenario_4_last_frame_only(client, api_key)
        results.append(r4)

    return results


def main() -> int:
    """Entry point. Returns 0 if all critical scenarios pass, 1 otherwise."""
    print("=" * 80)
    print("ARK Seedance API — Multi-Mode Direct Testing")
    print(f"Time: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 80)

    results = asyncio.run(run_all_scenarios())
    print_summary(results)

    # Scenarios 1-3 are critical; scenario 4 is exploratory
    critical = [r for r in results if r.scenario_id <= 3]
    all_critical_passed = all(r.status == ScenarioStatus.PASSED for r in critical)

    if all_critical_passed:
        print("All critical scenarios (1-3) PASSED.")
        return 0
    else:
        failed_ids = [r.scenario_id for r in critical if r.status != ScenarioStatus.PASSED]
        print(f"Critical scenario(s) {failed_ids} did NOT pass. Review output above.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
