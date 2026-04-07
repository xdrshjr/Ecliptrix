"""
One-shot verification: which ARK Doubao Seedream image-to-image payload shape is
the one the API actually honours?

Run from backend-services/basic-service/ with venv activated:

    ARK_API_KEY=sk-... python scripts/verify_ark_seedream_image_param.py path/to/ref.jpg

The script tries three payload shapes against
https://ark.cn-beijing.volces.com/api/v3/images/generations using model
doubao-seedream-5-0-260128 and prints, for each variant, the HTTP status, error
body (if any), and the URL of the generated image. Open all three URLs in a
browser and pick the one that visually looks like the reference image — that
shape is the winner.

Variants:
  A. {"image":  "<base64 data URI>"}            (singular, base64)
  B. {"image": ["<base64 data URI>"]}            (singular-as-list, base64)
  C. {"image_urls": ["<base64 data URI>"]}       (the current buggy shape — kept as control)
  D. {"image":  "<https URL>"}                   (only if you also pass an http_url argument)

Usage:
    python scripts/verify_ark_seedream_image_param.py ref.jpg
    python scripts/verify_ark_seedream_image_param.py ref.jpg --http-url https://...
"""
import argparse
import base64
import json
import os
import sys
from pathlib import Path

import httpx

ARK_URL = "https://ark.cn-beijing.volces.com/api/v3/images/generations"
ARK_MODEL = "doubao-seedream-5-0-260128"

PROMPT = (
    "A 2x2 grid storyboard. Each cell shows the SAME subject as the reference "
    "image, in four different camera angles. Thin white separators between cells."
)


def to_data_uri(path: Path) -> str:
    mime = "image/jpeg" if path.suffix.lower() in (".jpg", ".jpeg") else "image/png"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"


def call(label: str, payload: dict, headers: dict) -> None:
    print(f"\n=== {label} ===")
    print("payload keys:", list(payload.keys()))
    try:
        resp = httpx.post(ARK_URL, json=payload, headers=headers, timeout=120.0)
    except Exception as exc:
        print("REQUEST FAILED:", exc)
        return
    print("HTTP", resp.status_code)
    body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else resp.text
    if isinstance(body, dict) and body.get("data"):
        print("image url:", body["data"][0].get("url"))
    else:
        print("body:", json.dumps(body, ensure_ascii=False)[:600])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("reference", type=Path)
    parser.add_argument("--http-url", default=None)
    args = parser.parse_args()

    api_key = os.environ.get("ARK_API_KEY")
    if not api_key:
        print("ARK_API_KEY env var is required", file=sys.stderr)
        return 2
    if not args.reference.exists():
        print(f"reference image not found: {args.reference}", file=sys.stderr)
        return 2

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    base = {
        "model": ARK_MODEL,
        "prompt": PROMPT,
        "size": "2048x2048",
        "n": 1,
        "response_format": "url",
        "watermark": False,
    }
    data_uri = to_data_uri(args.reference)

    call("A: image=string(base64)",      {**base, "image": data_uri},        headers)
    call("B: image=[base64]",            {**base, "image": [data_uri]},      headers)
    call("C: image_urls=[base64] (BUG)", {**base, "image_urls": [data_uri]}, headers)
    if args.http_url:
        call("D: image=httpurl",         {**base, "image": args.http_url},   headers)
    return 0


if __name__ == "__main__":
    sys.exit(main())
