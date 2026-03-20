# Bug Diagnosis: YouTube Search Timeout on Server

**Date:** 2026-03-04
**Mode:** Fully automatic
**Status:** Fixed

## Problem Description

YouTube video search times out (45s) when deployed to server. The search for keyword "cat" with max 60 results triggers a 504 timeout.

## Root Cause

**File:** `backend-services/basic-service/app/services/youtube_service.py:252-260`

The `search_videos` method uses `yt-dlp` with `ytsearch{N}:{query}` which requires direct access to YouTube. The server is in China (evidenced by the default OSS endpoint `oss-cn-hangzhou.aliyuncs.com`), where YouTube is blocked by the GFW.

The codebase had **no proxy configuration** for yt-dlp at all — no `proxy` option in any yt-dlp call, no environment variable, no config field.

**Explanation:**
`yt-dlp.extract_info("ytsearch60:cat")` → attempts direct TCP connection to YouTube → connection blocked/dropped by GFW → `socket_timeout=15` expires → router `asyncio.wait_for(timeout=45)` expires → HTTP 504 returned.

## Fix Applied

**Files modified:**
- `backend-services/basic-service/app/config.py` - Added `youtube_proxy` setting reading from `YOUTUBE_PROXY` env var
- `backend-services/basic-service/app/services/youtube_service.py` - Added proxy to all yt-dlp option dicts (search, info, download)
- `backend-services/basic-service/env.template` - Documented `YOUTUBE_PROXY` env var

**Changes:**
1. New `YOUTUBE_PROXY` environment variable (supports `socks5://`, `http://`, `https://`)
2. `YouTubeService.__init__` stores the proxy
3. `_get_robust_ydl_options()` injects `proxy` into all yt-dlp configs
4. `search_videos()` also receives the proxy (it uses its own separate ydl_opts)

## Verification

**To activate on server:**
1. Add to server's `.env`: `YOUTUBE_PROXY=socks5://127.0.0.1:1080` (or your proxy address)
2. Restart the backend service

## Notes

- The proxy must be accessible from the server
- Common formats: `socks5://host:port`, `http://host:port`, `socks5h://host:port` (DNS through proxy)
- If using socks5, ensure `PySocks` package is installed: `pip install pysocks`
