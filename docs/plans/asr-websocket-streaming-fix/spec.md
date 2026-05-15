# ASR WebSocket Streaming Fix — Design Spec (v2)

**Feature:** `asr-websocket-streaming-fix`
**Author:** solution-architect agent (v1) · design-reviewer agent (v2)
**Date:** 2026-05-15
**Status:** Reviewed — approved with conditions (Subtask #1 output)
**Scope:** Restore the production "Subtitles" button (`POST /api/audio/batch-transcribe`)
by re-grounding the Volcano ASR integration on the WebSocket streaming bigmodel
endpoint that the available credentials actually authorise.

---

## 评审记录

下表逐条记录本次评审发现的问题，严重度按 P0（阻断发布）/ P1（落地前必须修复）/ P2（建议改进，不阻断）划分。
P0 与 P1 已在本版 v2 文档正文中直接修订；P2 列为后续改进建议。

| # | 严重度 | 范围 | 问题 | v2 处理 |
|---|---|---|---|---|
| RV-01 | P0 | §3 / `audio_router.py` | 现有 `audio_router.py` 注册了**两个**`@router.get("/health")`（第 302 行 `health_check` 与第 535 行 `audio_health_check`），FastAPI 只会保留最后一个；§6.2 smoke 验证依赖的 `appid_configured=true` 字段从来不会被返回。即便服务端修复了 ASR，也无法用文档约定的健康检查命令观察。 | §3 文件清单显式拆分两个 health 端点：保留 `/audio/health` 给 ASR 转录，将 audio_search 健康检查重命名为 `/audio/search/health`；§6.2 的 smoke 项与新的端点 URL 对齐。|
| RV-02 | P0 | §2.3 二进制协议 | 旧版表格把 **Full client request** 的 message-type-specific-flags 写成 `0001` 并在 body 中再前置 `[seq=1]`。但 Volcano 官方 demo（旧版控制台示例与开源 Python sample）的 full client request 通常以 flag `0001` + 4 字节 `seq=1` 发送；与之相对，**audio-only** 包的 flag/seq 与 last-packet flag 也有更精确的定义。原表把 full client request 描述为「flag=0001, body=[seq][size][gzip(json)]」**但同时**又在 §2.4 b/c 步骤中将其描述为「handshake ack 之后才开始 streaming」，并未明确 server 第一帧到来时 sequence 起点；如果实现按字面直接发送会与服务端约定不一致，可能直接导致 `45000001 请求参数无效`。需补一条「客户端 seq 由 1 起递增，正包 flag=0b0001、最后一包 flag=0b0011 且 seq 取负」、并显式列出每帧字节模板（含 seq 字段是否出现）。 | §2.3 重写二进制协议章节：新增「字段含义 vs 字节布局」对照表，列出每种帧的精确字节模板，明确所有客户端帧均启用 sequence number（flag `0b0001` / `0b0011`），并以伪代码示范一次完整的发包顺序。 |
| RV-03 | P1 | §2.5 / §4.2 异步集成 | `audio_router` 现有处理函数为 `async def`，而 §4.2 写「All accept synchronous callers; internally await the WS coroutine via asyncio.run」。在 FastAPI 已运行的事件循环内调用 `asyncio.run` 会抛 `RuntimeError: asyncio.run() cannot be called from a running event loop`。§3 提到「behind a thin `await asyncio.to_thread(...)` shim」，但接口签名与异常承诺不一致，落地会踩坑。 | §4.2 改写：`process_audio_file` / `transcribe_audio_urls` 既保留同步外壳（向后兼容旧 in-process 调用方），也额外提供 `async def aprocess_audio_file` / `atranscribe_audio_urls` 原生协程接口；router 直接 `await aprocess_audio_file(...)`，不再 `asyncio.run`，也不再走 `to_thread` shim。同步外壳内部通过 `asyncio.new_event_loop()`/`asyncio.run`，仅供脚本/测试使用。 |
| RV-04 | P1 | §2.5 R2 / §4.2 | 风险 R2 提到「Cap per-clip duration with a clear error」，但未给出阈值、未指明守卫所在层、未约定向 UI 透出的 `error_code`。落地会变成「实现者任选」，而 nostream 实际上限是 ~300 s 上传窗口，超长片段会得到 `45000081 等包超时` 这种含糊错误。 | §2.5 新增「时长上限」表格行：`audio_duration > 300 s` 直接在 `aprocess_audio_file` 起始处返回 `error_code=ASR_CLIP_TOO_LONG`，前端可据此提示用户切片。同时把 `ASR_MAX_CLIP_SECONDS` 列入 §10 的可调环境变量。 |
| RV-05 | P1 | §3 / 服务单例 | §2.5 写到「constructor switches from raise to lazy validation」，但同一个文件末尾仍然保留 `audio_transcription_service = AudioTranscriptionService()` 的 module-scope 单例。新版 `__init__` 必须明确「仅做属性赋值与 warn 级日志，绝不抛出」，否则未来再加一行 `raise` 会重蹈 V3 file-submit 的覆辙。 | §4.2 / §6.3 增加显式约束：单例构造函数禁止 `raise`，凡 credential 缺失走 `warning` 日志；新增单元测试 `test_init_with_empty_creds_does_not_raise`。 |
| RV-06 | P2 | §2.2 / §4.1 | 旧版控制台头部需要 `X-Api-Resource-Id`，spec 把默认值改为 `volc.bigasr.sauc.duration`（小时版）。但当 Volcano 后台仅给账户开了「并发版」时（`...sauc.concurrent`）会被拒。建议在 `.env` 注释和 `env.template` 中显式列出两种选项，避免一线运维误配。 | §3 `env.template` 行新增「`# choose duration | concurrent variant`」注释；§6.2 smoke 步骤补充「资源 ID 与控制台开通的版本匹配」检查项。 |
| RV-07 | P2 | §2.4 e | 「200-ms chunk size」基于双向流式的最佳实践，但本方案选定 **`bigmodel_nostream`**，nostream 对单包大小不敏感（只要 ≤ 100 ms ~ 200 ms 区间内即可，主要影响是发包频率与等包超时）。建议明确「nostream 模式下选 200 ms 单纯为了对齐双向流式实现，减少未来切换成本」。 | §2.4 末尾补一句澄清；不改变实现。 |
| RV-08 | P2 | §6.1 测试 | 单元测试只覆盖 service 层。建议新增一个非常薄的 router 集成测试（用 `httpx.AsyncClient` + `respx`/`pytest-asyncio`，patch 掉 `aprocess_audio_file`），以 catch §RV-01 那种「路由被覆盖」类问题。 | §6.1 新增条目 `tests/test_audio_router_health.py`，单测 `/audio/health` 与 `/audio/search/health` 各自返回正确字段。 |
| RV-09 | P2 | §7 R5 | `requirements.txt` 实测已有 `websockets==15.0.1`，远高于 §3「pin `websockets>=12.0`」要求。R5 风险等级可降为「已缓解」。 | §3 / §7 R5 注释更新为「已固定为 `websockets==15.0.1`，无需变更」。 |
| RV-10 | P2 | §3 / `.env` | 任务凭据里 `VOLCANO_ASR_SECRET_KEY` 仍存在；§2.2 说明 ASR 不用该字段，但代码层 voice-clone 依旧消费。spec 应明确「`SECRET_KEY` 字段保留、由 voice-clone 链路使用，不影响 ASR」，避免后续清理 PR 误删。 | §2.2 增加一句备注；§3 `.env` 行注释保留 `VOLCANO_ASR_SECRET_KEY`。 |

---

## 1. Overview

The production endpoint `https://www.ecliptrix.com/api/audio/batch-transcribe`
currently returns:

```json
{ "success": false, "message": "Backend unreachable: fetch failed",
  "error_code": "BACKEND_UNREACHABLE", "error_details": { "cause": "fetch failed" } }
```

This error is emitted by the Next.js passthrough proxy in
`src/app/api/audio/batch-transcribe/route.ts` whenever it cannot reach the
FastAPI backend at `BACKEND_URL`. It is *not* the backend's own response. Tracing
the import chain shows the FastAPI process is failing at **startup**, not at
request time:

* `app/main.py` registers `audio_router` → `audio_router.py` does
  `from app.services.audio_transcription_service import audio_transcription_service`.
* The service module ends with `audio_transcription_service = AudioTranscriptionService()`
  (a module-scope singleton).
* `AudioTranscriptionService.__init__` raises `ValueError` when either
  `volcano_asr_api_key` (a new-console UUID) **or** `public_base_url` is empty
  — and in production neither is set in `.env`. The credentials shipped with
  the task (`VOLCANO_ASR_APPID=***REMOVED***` etc.) are *legacy V1 console* keys.
  They are accepted by the WebSocket streaming bigmodel API, but they are **not**
  the UUID API Key the file-submit endpoint demands.
* The raise propagates → import fails → uvicorn boot aborts → the proxy
  cannot reach port 8000 → frontend sees `BACKEND_UNREACHABLE`.

Even if the server *had* started, the file-submit V3 endpoint would still need
Volcano to fetch the audio over the public Internet via `PUBLIC_BASE_URL`,
which is also unset, so this code path was never going to pass smoke testing
on production with the credentials we have.

This design migrates the ASR layer to **Volcano 大模型流式语音识别 (双向流式 /
流式输入)** over WebSocket, keyed by the legacy-console
`X-Api-App-Key` + `X-Api-Access-Key` headers we already possess. The new
implementation streams audio bytes over the WebSocket frame, which removes the
requirement for any publicly fetchable URL. We also harden the service
constructor so a missing or invalid credential degrades the *Subtitles* feature
gracefully instead of taking the whole API process down. The frontend contract
(`POST /api/audio/batch-transcribe` with the existing request/response shape) is
preserved end-to-end so no UI work is required.

## 2. Technical design

### 2.1 Endpoint selection

Volcano exposes three streaming bigmodel WebSocket endpoints (per the task
prompt's docs):

| Endpoint | Mode | Notes |
|---|---|---|
| `/api/v3/sauc/bigmodel` | 双向流式 (low latency) | Returns per-packet partials. |
| `/api/v3/sauc/bigmodel_async` | 双向流式优化版 | Returns only on result delta; lower RTF. |
| `/api/v3/sauc/bigmodel_nostream` | 流式输入 | Returns once at end (≥15 s audio or final neg packet). Highest accuracy, supports `language` arg. |

Our use case is **batch transcription of recorded audio clips on the timeline**.
There is no UI surface for live partials. We therefore pick **`bigmodel_nostream`**
as the primary endpoint — it is the only one whose protocol mirrors how the
existing `process_audio_file` consumer is structured (one submit + one final
result), and it is the only one that supports the `language` parameter we
already pass through from the frontend. The other two endpoints stay
documented as future hooks but are not implemented in this slice.

### 2.2 Authentication

Per the API doc 旧版控制台 section, the WebSocket handshake must carry these
HTTP headers:

| Header | Source |
|---|---|
| `X-Api-App-Key` | `settings.volcano_asr_appid` (e.g. `***REMOVED***`) |
| `X-Api-Access-Key` | `***REMOVED***` |
| `X-Api-Resource-Id` | `settings.volcano_asr_resource_id` (default `volc.bigasr.sauc.duration`; switch to `...sauc.concurrent` if the console only enabled the concurrency-billed tier) |
| `X-Api-Request-Id` | random UUID per request (also used as task id for tracing) |
| `X-Api-Sequence` | constant `-1` |
| `X-Api-Connect-Id` | random UUID per connection |

Server returns `X-Tt-Logid` on the upgrade response — we log it on every
request for Volcano-side debugging. In the Python `websockets` library, after
`async with websockets.connect(...) as ws:`, the upgrade headers are exposed
via `ws.response.headers` (v12+) / `ws.response_headers` (v10 compat) — the
helper reads both for safety.

`secret_key` is **not** used by the streaming bigmodel handshake (it is only
required by the legacy `/api/v1/vc/{submit,query}` chain). We keep the env
field around because voice-clone code paths still consume it. The new ASR
service ignores `VOLCANO_ASR_SECRET_KEY` entirely; future cleanup PRs MUST
leave the env / config field in place until voice-clone is also migrated.

### 2.3 Binary protocol

WebSocket frames carry the proprietary binary protocol described in the task
prompt. The header is fixed at 4 bytes:

```
byte 0: protocol_version (4b)=0b0001 | header_size (4b)=0b0001
byte 1: msg_type (4b)                | msg_type_specific_flags (4b)
byte 2: serialization (4b)           | compression (4b)
byte 3: reserved (8b)=0x00
```

We will use:

* **Serialization:** `0b0001` = JSON for the full client request payload, `0b0000` for audio packets (raw bytes).
* **Compression:** `0b0001` = Gzip — applied to the JSON payload **and** every audio chunk.
* **Sequence numbering:** every client-sent frame in this protocol carries an explicit `int32` sequence (flag `0b0001` for positive seq, `0b0011` for the final packet whose seq is negated). The 4 sequence bytes immediately follow the 4-byte header, *before* the 4-byte `payload_size`.

#### 2.3.1 Frame byte layout (authoritative)

All multibyte fields are **big-endian**. Each row in the "wire bytes" column is one packet pushed onto the WebSocket.

| Frame type | `msg_type` | flags | Serialization | Compression | Wire bytes (concatenated) |
|---|---|---|---|---|---|
| Full client request (seq=1) | `0b0001` | `0b0001` | `0b0001` (JSON) | `0b0001` (gzip) | `header[4] ‖ seq=+1 (int32) ‖ size (uint32) ‖ gzip(json_payload)` |
| Audio packet (mid, seq=N) | `0b0010` | `0b0001` | `0b0000` (raw) | `0b0001` (gzip) | `header[4] ‖ seq=+N (int32) ‖ size (uint32) ‖ gzip(audio_chunk)` |
| Audio packet (last, seq=-N) | `0b0010` | `0b0011` | `0b0000` (raw) | `0b0001` (gzip) | `header[4] ‖ seq=-N (int32) ‖ size (uint32) ‖ gzip(audio_chunk)` |

Server responses we parse:

| Type | `msg_type` | flags | Wire bytes |
|---|---|---|---|
| Full server response | `0b1001` | `0b0001` | `header[4] ‖ seq (int32) ‖ size (uint32) ‖ gzip(json)` |
| Error response | `0b1111` | `0b0000` | `header[4] ‖ error_code (uint32) ‖ size (uint32) ‖ utf8_message` |

#### 2.3.2 Send order pseudocode

```python
async def stream_one_file(ws, payload_json: dict, audio_bytes: bytes,
                          *, chunk_ms: int = 200, sample_rate: int = 16000):
    # 1) Full client request — seq=1
    await ws.send(build_full_client_request(payload_json, seq=1))
    ack = parse_response(await ws.recv())   # expect msg_type=0b1001, seq=1
    assert not ack.is_error, ack.error_text

    # 2) Audio packets — seq starts at 2, last packet negates seq
    chunk_size = sample_rate * 2 * chunk_ms // 1000   # 16-bit mono PCM
    chunks = [audio_bytes[i:i + chunk_size]
              for i in range(0, len(audio_bytes), chunk_size)]
    last_idx = len(chunks) - 1
    for i, chunk in enumerate(chunks):
        seq = (i + 2)
        is_last = (i == last_idx)
        await ws.send(build_audio_packet(seq=-seq if is_last else seq,
                                         audio=chunk, last=is_last))
        # bigmodel_nostream returns one full response per packet; drain it.
        msg = parse_response(await ws.recv())
        if msg.is_error:
            raise VolcanoAsrError(msg.error_code, msg.error_text)
        if is_last:
            return msg.payload                      # final result JSON
```

A reusable `volcano_ws_protocol.py` helper module owns the byte-level
serialise/parse logic (header packing, gzip framing, seq stamping, error-frame
parsing) so the service file stays focused on orchestration.

### 2.4 Sequence of operations (single audio file)

```
1. Caller passes a local file path (e.g. static/audio/generated/foo.mp3).
2. AudioTranscriptionService.process_audio_file:
     a. Validate file exists, probe sample-rate via ffprobe (must be 16 kHz).
        If not 16 kHz / 16-bit / mono PCM, transcode to a temp WAV with ffmpeg.
     b. Open WebSocket to wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream
        with the auth headers above.
     c. Send full client request with audio.format=wav (or mp3/ogg as detected),
        request.model_name=bigmodel, request.show_utterances=true, plus
        request.language / enable_itn / enable_punc passed by the caller.
     d. Receive first full server response (handshake ack).
     e. Stream the audio file in 200-ms chunks (~6400 bytes for 16 kHz/16-bit
        mono PCM, or by file-byte slicing for compressed formats), gzip each
        chunk, send as audio-only request with positive sequence numbers
        starting at 2.
     f. On the last chunk, set the negative-sequence flag and send the negated
        sequence number.
     g. Receive the final full server response and any intermediate results;
        unwrap the result.utterances list.
3. process_audio_file returns the same dict shape as today
   ({ "success": True, "subtitles": [SubtitleItem, ...], "srt_content": str, ... })
   so transcribe_audio_urls and the router are unchanged.
```

A single 30 s clip should complete inside ~3 s end-to-end (300-400 ms for the
final packet ack per Volcano's published numbers + audio upload time). The
overall request stays bounded by `request_timeout=30` seconds enforced by the
WebSocket client; longer clips walk through the timeout via per-chunk
deadlines.

Although the 200-ms chunk size is published as the optimum for the **双向流式**
endpoint, we keep the same value on `bigmodel_nostream` (which is much less
sensitive to chunk granularity) purely to align the helper implementation —
the same protocol module will serve a future bigmodel_async migration without
changes.

### 2.5 Error handling

| Scenario | Behaviour |
|---|---|
| WebSocket handshake 401 / 403 | Return failure with `error_code=ASR_AUTH_FAILED`, surface `X-Tt-Logid`. |
| Server error frame (`msg_type=1111`) | Map Volcano error code (`45000001` etc.) to a stable internal error and bubble up. |
| Network drop mid-stream | One full retry (fresh connection, fresh `X-Api-Request-Id`); surface failure on second attempt. |
| Silent-audio result | Return success with empty `subtitles` array (matches V1 behaviour). |
| Unsupported audio format / sample-rate beyond ffmpeg recovery | Return failure with `error_code=ASR_UNSUPPORTED_AUDIO`. |
| Per-clip audio duration > `ASR_MAX_CLIP_SECONDS` (default **300 s**) | Reject **before** opening the WebSocket with `error_code=ASR_CLIP_TOO_LONG`, `error_details={ "duration_s": <ffprobed value>, "limit_s": 300 }`. The UI surface should advise the user to split the clip. Threshold tunable via env. |

Service constructor switches from "raise" to **lazy validation**:

* `AudioTranscriptionService.__init__` **must not** raise. It only assigns
  attributes and emits `logger.warning(...)` on each missing credential
  (`volcano_asr_appid`, `volcano_asr_access_token`, or `volcano_asr_resource_id`).
* `aprocess_audio_file` re-checks credentials on entry; if any required field
  is still empty it returns the standard structured failure
  (`{"success": False, "error_code": "ASR_NOT_CONFIGURED", "error": "..."}`)
  rather than raising.

This contract keeps the FastAPI process healthy even when ASR is
misconfigured — only the *Subtitles* button surfaces an error.

### 2.6 Concurrency

Existing `transcribe_audio_urls` iterates audio items serially. Streaming a
single clip over a WS is bounded by I/O so we keep the serial loop for v1, but
encapsulate the per-clip work in an `async` helper using
`websockets.connect()` so a follow-up change can wrap a `asyncio.gather` with
a small semaphore (default 3, tunable via env). This is captured in §10 as a
non-blocking improvement, not part of this slice.

## 3. File / module change plan

| File | Status | Intent |
|---|---|---|
| `backend-services/basic-service/app/services/volcano_ws_protocol.py` | **new** | Pure encode/decode of the 4-byte header, gzip framing, sequence flagging, and response parsing. No I/O. |
| `backend-services/basic-service/app/services/audio_transcription_service.py` | **rewrite** | Replace V3 file-submit code with a WebSocket streaming `bigmodel_nostream` client. Lazy credential validation (no `raise` in `__init__`). Expose **both** native-async (`aprocess_audio_file`, `atranscribe_audio_urls`) and sync (`process_audio_file`, `transcribe_audio_urls`) facades; the sync facade exists for legacy callers and tests only and uses `asyncio.new_event_loop().run_until_complete(...)`. Keep `convert_to_srt`, `ms_to_srt_time`, `save_srt_file`. |
| `backend-services/basic-service/app/routers/audio_router.py` | **modify** | (1) Rename the second duplicate `@router.get("/health")` (currently shadowing the transcription health) to **`@router.get("/search/health")`** so `/audio/health` once again maps to the ASR-transcription handler; (2) rewrite `health_check` to read the new attribute names (`appid`, `access_token`, `resource_id`) and drop `secret_key` / `base_url`; (3) switch all router handlers to `await audio_transcription_service.aprocess_audio_file(...)` / `await audio_transcription_service.atranscribe_audio_urls(...)`. **No** `asyncio.run` / `asyncio.to_thread` shim — the router is async and the service exposes a native coroutine. |
| `backend-services/basic-service/app/config.py` | **modify** | Drop the hard requirement on `volcano_asr_api_key` & `public_base_url`. Add `volcano_asr_resource_id` default `volc.bigasr.sauc.duration` (overriding the previous `volc.bigasr.auc`). Keep all envs backward-compatible. Document the `volc.bigasr.sauc.concurrent` alternative for accounts on the concurrency-billed tier. |
| `backend-services/basic-service/.env` | **modify** | Set `VOLCANO_ASR_RESOURCE_ID=volc.bigasr.sauc.duration` (or `.concurrent`). Document but do not require `VOLCANO_ASR_API_KEY` / `PUBLIC_BASE_URL`. **Keep `VOLCANO_ASR_SECRET_KEY` in place** — it's used by voice-clone, not ASR. No secret rotation required — `VOLCANO_ASR_APPID` / `***REMOVED***` are already provisioned. |
| `backend-services/basic-service/env.template` | **modify** | Mirror the `.env` doc-comment updates: the comment on `VOLCANO_ASR_RESOURCE_ID` lists both `duration` and `concurrent` variants. Make clear `VOLCANO_ASR_API_KEY` / `PUBLIC_BASE_URL` are no longer required. |
| `backend-services/basic-service/requirements.txt` | **verify only — no change** | Already pins `websockets==15.0.1`; spec's `>=12.0` requirement is satisfied. |
| `backend-services/basic-service/tests/test_volcano_ws_protocol.py` | **new** | Header encode round-trip; gzip framing; positive-seq & negative-seq audio packets; full-client-request frame matches the §2.3 byte layout; error-frame parsing surfaces `error_code` + UTF-8 message. |
| `backend-services/basic-service/tests/test_audio_transcription_service.py` | **new** | Patch `websockets.connect` with an `AsyncMock` returning a queue of pre-built frames; assert `aprocess_audio_file` happy path, silent-audio path, server-error path, missing-credentials path (`ASR_NOT_CONFIGURED`), and `audio_duration > 300 s` rejection (`ASR_CLIP_TOO_LONG`). Includes a `test_init_with_empty_creds_does_not_raise` to lock in §2.5 lazy validation. |
| `backend-services/basic-service/tests/test_audio_router_health.py` | **new** | `httpx.AsyncClient`-based test verifying `/audio/health` returns the ASR config keys and `/audio/search/health` returns the Freesound `api_key_configured` key — catches future regressions in the duplicate-route bug RV-01. |
| `docs/plans/asr-websocket-streaming-fix/spec.md` | **this file** | Design doc (v2 — reviewed). |

No frontend file changes are required — the network contract is preserved.

## 4. Interface design

### 4.1 External HTTP API (unchanged)

* `POST /api/audio/batch-transcribe` (Next.js proxy → FastAPI `audio_router`)
* Request body: `BatchAudioTranscriptionRequest` — same shape as today
  (`audio_items[]`, `language`, `use_itn`, `use_punc`, `max_lines`,
  `words_per_line`, `generate_srt_file`).
* Response body: `BatchAudioTranscriptionResponse` — unchanged
  (`transcriptions[]` with adjusted timestamps).

### 4.2 Internal Python API (`AudioTranscriptionService`)

The router runs inside an event loop, so the **canonical** call surface is
`async`. Sync facades are retained for legacy in-process callers and tests.

```python
class AudioTranscriptionService:
    def __init__(self) -> None:
        """MUST NOT raise — only assigns attributes and logs warnings.
        Lazy validation lives in aprocess_audio_file."""
        ...

    # Native coroutines — preferred entry points. The audio_router awaits these.
    async def aprocess_audio_file(self, audio_path: str, language: str = "zh-CN",
                                  *, use_itn: bool = True, use_punc: bool = False,
                                  generate_srt_file: bool = True) -> dict: ...
    async def atranscribe_audio_urls(self, audio_items: list[dict], *,
                                     language: str = "zh-CN", use_itn: bool = True,
                                     use_punc: bool = False, max_lines: int = 2,
                                     words_per_line: int = 15) -> list[dict]: ...

    # Synchronous facades — thin wrappers using asyncio.new_event_loop() /
    # run_until_complete(). Only safe from non-async contexts (scripts, tests,
    # legacy in-process callers). Must never be invoked from a running loop.
    def process_audio_file(self, *args, **kwargs) -> dict: ...
    def transcribe_audio_urls(self, *args, **kwargs) -> list[dict]: ...

    # Pure helpers — unchanged.
    def convert_to_srt(self, subtitle_data: dict) -> str | None: ...
    def ms_to_srt_time(self, milliseconds: int) -> str: ...
```

Removed: `submit_audio`, `query_result`, `_local_path_to_public_url`
(WebSocket streams raw bytes, no URL-mapping needed).
`_resolve_local_path` is preserved because the batch handler still receives
`/api/...`-style URLs from the frontend (audio items stored in the timeline
hold the proxy URL, not the filesystem path).

Lazy validation contract (locked in by `test_init_with_empty_creds_does_not_raise`):

* `__init__` does not touch the network.
* `__init__` does not raise.
* When `volcano_asr_appid` / `volcano_asr_access_token` / `volcano_asr_resource_id`
  is empty, `aprocess_audio_file` returns
  `{"success": False, "error_code": "ASR_NOT_CONFIGURED", "error_message": "..."}`
  *before* any network I/O.
* When `audio_duration > ASR_MAX_CLIP_SECONDS` (default 300), `aprocess_audio_file`
  returns `{"success": False, "error_code": "ASR_CLIP_TOO_LONG", ...}` *before*
  opening the WebSocket.

### 4.3 WebSocket envelope (`volcano_ws_protocol.py`)

```python
def build_header(*, msg_type: int, flags: int,
                 serialization: int = 0b0001,
                 compression: int = 0b0001) -> bytes: ...

def build_full_client_request(payload: dict) -> bytes: ...
def build_audio_packet(seq: int, audio: bytes, *, last: bool) -> bytes: ...
def parse_response(frame: bytes) -> ServerMessage: ...

@dataclass
class ServerMessage:
    is_error: bool
    sequence: int | None
    payload: dict | None         # parsed JSON when not error
    error_code: int | None
    error_text: str | None
```

## 5. Data model

No DB schema changes. In-memory shapes:

```python
SubtitleItem(start_time: int, end_time: int, text: str)  # times in ms
TranscriptionResult = {
    "audio_item_id": str, "audio_item_name": str, "track_id": str,
    "start_time": float, "duration": float,
    "success": bool,
    "subtitles": list[SubtitleItem],          # times in *timeline* ms
    "srt_content": str | None,
    "processing_time": float,
    "audio_duration": float | None,
    "error_message": str | None,
}
```

Volcano response (after gzip-decompress + JSON-decode), per the doc:

```python
{
  "audio_info": {"duration": 3696},
  "result": {
      "text": "...",
      "utterances": [
         {"definite": true, "start_time": 0, "end_time": 1705, "text": "...",
          "words": [{"start_time": 740, "end_time": 860, "text": "这"}, ...]}
      ]
  }
}
```

We flatten this into the existing internal shape
(`{"utterances": [...], "text": "...", "audio_info": {...}}`) so downstream
SRT generation does not need to learn the new schema.

## 6. Testing & acceptance criteria

### 6.1 Unit tests

* `tests/test_volcano_ws_protocol.py` — header encode/decode, gzip framing,
  positive vs. negative sequence, full-client-request byte layout, error-frame
  parser. Pure-bytes tests, no network.
* `tests/test_audio_transcription_service.py` — patch
  `websockets.connect` with an `AsyncMock` returning a queue of pre-built
  server frames built via the protocol helper. Assert:
  - happy path: 1 utterance → returns subtitle list with correct timings.
  - silent audio: empty utterances → returns `success=True, subtitles=[]`.
  - server error frame `45000001` → returns `success=False`, error message
    contains the Volcano code and logid.
  - missing credentials: returns structured failure (`error_code=ASR_NOT_CONFIGURED`),
    no exception, no process exit.
  - `audio_duration > 300 s`: returns `error_code=ASR_CLIP_TOO_LONG`,
    confirms the WebSocket is **not** opened (`websockets.connect` is not called).
  - `test_init_with_empty_creds_does_not_raise`: constructing the singleton
    with `VOLCANO_ASR_*` all empty must succeed and only emit warning logs.
* `tests/test_audio_router_health.py` — `httpx.AsyncClient` against the
  FastAPI test app; assert:
  - `GET /audio/health` returns `appid_configured`, `access_token_configured`,
    `resource_id_configured` (the ASR transcription health payload).
  - `GET /audio/search/health` returns `api_key_configured`, `service: "audio_search"`.
  - Locks in the fix for RV-01 (duplicate route).

### 6.2 Integration smoke (manual, post-deploy)

1. Backend boots cleanly: `curl https://www.ecliptrix.com/api/audio/health`
   returns `200` with `appid_configured=true` & `access_token_configured=true`
   (NOT the Freesound payload — that now lives at `/audio/search/health`).
2. `X-Api-Resource-Id` in the .env matches the billing tier enabled on the
   Volcano console (`duration` vs `concurrent`); a mismatch surfaces as
   handshake 401/403 with `error_code=ASR_AUTH_FAILED`.
3. `POST /api/audio/batch-transcribe` with one short MP3 from the timeline
   returns `success=true` and at least one entry in `transcriptions[*].subtitles`.
4. Click "Subtitles" in the timeline UI → subtitle items appear on the
   subtitle track, matching the spoken content.
5. Backend log records each request's `X-Tt-Logid` for traceability.

### 6.3 Definition of done

* `audio_transcription_service.py` no longer references the file-submit
  endpoints (`/api/v3/auc/bigmodel/{submit,query}`).
* `AudioTranscriptionService.__init__` does not raise under any combination of
  missing `VOLCANO_ASR_*` env vars — backend startup always succeeds.
* The `audio_router` has exactly one handler bound to `/audio/health` (the
  transcription one); the Freesound health probe lives at `/audio/search/health`.
* `audio_router` handlers `await` the native async service methods directly
  (no `asyncio.run` / `asyncio.to_thread`).
* No new lint warnings (`ruff` baseline preserved).
* All new and existing tests pass under `pytest tests/ -v`.
* Production smoke (§6.2) succeeds.

## 7. Risks & mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Volcano enforces 16 kHz / 16-bit / mono PCM strictly; uploaded clips often differ. | High | Subtitles fail with `45000151` (audio format incorrect). | Pre-transcode every clip via `ffmpeg -ar 16000 -ac 1 -sample_fmt s16` into a temp file before opening the WS; cache the transcoded path per request. |
| R2 | Long clips (>5 min) exceed the 300 s upload budget on `bigmodel_nostream`. | Medium | Last-packet timeout, transcription fails. | Hard cap at `ASR_MAX_CLIP_SECONDS` (default **300 s**) — `aprocess_audio_file` rejects with `error_code=ASR_CLIP_TOO_LONG` *before* opening the WS. Frontend surfaces a "split this clip" hint. Future: chunk into ≤4 min sub-clips internally and concatenate utterances. |
| R3 | Network egress from production host to `openspeech.bytedance.com:443` blocked. | Low | All transcription requests fail at WS handshake. | Smoke test from the production server with `python -c "import websockets,asyncio; ..."`; provide a fallback flag `ASR_DISABLED=true` so the UI surfaces a friendly message instead of a 500. |
| R4 | The legacy console keys later get rotated / disabled. | Medium | Auth 401 on every request. | Health endpoint surfaces the failing logid; on-call doc points to "rotate VOLCANO_ASR_APPID/ACCESS_TOKEN in .env". |
| R5 | `websockets` lib version mismatch on production venv. | Mitigated | ImportError during request. | `requirements.txt` already pins `websockets==15.0.1`, which satisfies the helper's API contract (`async with connect(...) as ws`, `ws.response.headers`). No change required. |
| R6 | `audio_router.health_check` reads removed attributes (`secret_key`, `base_url`). | Already broken | 500 on /health. | Update health_check in same PR (covered in §3). |
| R7 | Module-scope singleton might still race when first imported under uvicorn workers. | Low | Cold-start latency spike. | The constructor now does no network work — only attribute assignment + log lines — so cold-start cost is negligible. |
| R8 | The WS final-packet ack might arrive before the audio queue fully flushes on slow links. | Medium | Truncated transcripts. | Drain/await each `send` future before sending the next packet; use 200-ms chunk size as the doc recommends. |

## 8. Out of scope

* Real-time partial-result UX (`bigmodel_async`) — would need timeline streaming
  UI work; tracked as a follow-up.
* Hotword tables / domain corpus uploads — not currently surfaced in the UI.
* Speaker diarisation (`enable_speaker_info`) — leave default `false`.
* OSS-uploaded audio shortcut (audio already on the public web) — not needed
  because WS streams bytes directly; can be re-introduced once OSS-hosted
  materials become the default.

## 9. Rollout & verification plan

1. Land changes on a feature branch; run unit tests locally on Windows + Linux.
2. Restart the production backend (`bash kill.sh && bash start.sh 8000`) on a
   single canary host; tail `backend-services/basic-service/logs/app.log` for
   the new "音频转字幕服务初始化完成 (WS streaming)" log line and the absence of
   `ValueError`.
3. From a logged-in browser session, open the timeline editor, drop a 10 s
   audio clip, click *Subtitles*. Confirm subtitle items appear and contain the
   expected text. Capture the `X-Tt-Logid` from server logs.
4. Run the smoke `curl` in §6.2 against `https://www.ecliptrix.com`.
5. Roll forward to remaining hosts (we currently deploy to a single VM, so this
   reduces to "done").

## 10. Future improvements (not in this slice)

* Switch to `bigmodel_async` for live partials once the timeline has a partial
  subtitle UI affordance.
* Concurrency: convert `transcribe_audio_urls` to `asyncio.gather` with a
  semaphore (default 3, env `ASR_MAX_CONCURRENT`).
* Cache transcoded WAVs by content hash to avoid re-transcoding identical
  clips across re-runs.
* Surface Volcano `X-Tt-Logid` in the UI debug panel for self-serve support.
* Migrate to the new-console UUID API key when an account-wide rotation
  happens, by keeping the WS protocol but swapping `X-Api-App-Key` /
  `X-Api-Access-Key` for the single `X-Api-Key` header (the protocol body is
  identical).
* Expose `ASR_MAX_CLIP_SECONDS` as a tunable env var (default 300) so users
  on larger Volcano quotas can lift the per-clip cap without code changes.

---

## 评审结论

**有条件通过**（approved with conditions）。

本评审已在 v2 文档中直接修订 P0（RV-01 健康检查路由覆盖、RV-02 二进制协议字节布局歧义）与 P1（RV-03 异步集成、RV-04 时长上限缺省、RV-05 单例 lazy validation 约束）问题，并把 P2（RV-06 ~ RV-10）作为非阻断改进项记录在案。**接受本设计前，落地实现必须满足以下条件：**

1. `audio_router.py` 中两个 `@router.get("/health")` 必须在同一个 PR 内拆分为 `/audio/health`（ASR 转录）与 `/audio/search/health`（Freesound）；§6.2 smoke 步骤依赖这一拆分才能验证。
2. `AudioTranscriptionService.__init__` 严禁出现任何 `raise`；新增 `test_init_with_empty_creds_does_not_raise` 单测作为回归护栏。
3. `audio_router` 的处理函数直接 `await aprocess_audio_file / atranscribe_audio_urls`，不再保留 `asyncio.run`、不再走 `to_thread` shim。
4. `aprocess_audio_file` 在打开 WebSocket 之前完成两道前置守卫：(a) credential 缺失 → `ASR_NOT_CONFIGURED`，(b) `audio_duration > ASR_MAX_CLIP_SECONDS`（默认 300 s）→ `ASR_CLIP_TOO_LONG`。
5. `volcano_ws_protocol.py` 的 full-client-request 与 audio-only 帧严格按 §2.3.1 的字节模板生成；该模板需在 `tests/test_volcano_ws_protocol.py` 中以「黄金字节比对」用例锁住（避免后续重构破坏与 Volcano 服务端的隐式约定）。
6. `.env` 与 `env.template` 中 `VOLCANO_ASR_RESOURCE_ID` 的注释需同时列出 `volc.bigasr.sauc.duration` 与 `volc.bigasr.sauc.concurrent` 两个选项；`VOLCANO_ASR_SECRET_KEY` 仍保留（voice-clone 链路消费）。

满足上述 6 项条件后，本方案可进入实施阶段。

