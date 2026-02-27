"""
Test script for Doubao Seedance image-to-video API (Ark platform).
Usage: ARK_API_KEY=your_key python test_seedance.py
"""

import os
import time
import requests

API_BASE = "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks"
ARK_API_KEY = os.environ.get("ARK_API_KEY", "")

if not ARK_API_KEY:
    raise ValueError("ARK_API_KEY environment variable is not set")

HEADERS = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {ARK_API_KEY}",
}

PAYLOAD = {
    "model": "doubao-seedance-1-5-pro-251215",
    "content": [
        {
            "type": "text",
            "text": "无人机以极快速度穿越复杂障碍或自然奇观，带来沉浸式飞行体验  --duration 5 --camerafixed false --watermark true",
        },
        {
            "type": "image_url",
            "image_url": {
                "url": "https://ark-project.tos-cn-beijing.volces.com/doc_image/seepro_i2v.png"
            },
        },
    ],
}


def create_task() -> str:
    print("Creating video generation task...")
    resp = requests.post(API_BASE, json=PAYLOAD, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    print(f"Response: {data}")
    task_id = data.get("id")
    if not task_id:
        raise ValueError(f"No task ID in response: {data}")
    print(f"Task created: {task_id}")
    return task_id


def poll_task(task_id: str, interval: int = 10, max_wait: int = 600) -> dict:
    url = f"{API_BASE}/{task_id}"
    elapsed = 0
    while elapsed < max_wait:
        print(f"Polling task {task_id} (elapsed: {elapsed}s)...")
        resp = requests.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        status = data.get("status", "unknown")
        print(f"Status: {status}")
        if status == "succeeded":
            return data
        if status == "failed":
            raise RuntimeError(f"Task failed: {data}")
        time.sleep(interval)
        elapsed += interval
    raise TimeoutError(f"Task did not complete within {max_wait}s")


def main():
    task_id = create_task()
    result = poll_task(task_id)
    print("\n=== Task completed ===")
    content = result.get("content", {})
    video_url = content.get("video_url") if isinstance(content, dict) else None
    if video_url:
        print(f"Video URL: {video_url}")
    print(f"Resolution: {result.get('resolution')}, Duration: {result.get('duration')}s, FPS: {result.get('framespersecond')}")
    print(f"Full result: {result}")


if __name__ == "__main__":
    main()
