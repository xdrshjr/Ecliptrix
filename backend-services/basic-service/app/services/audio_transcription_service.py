"""
Audio transcription service — Volcano 大模型流式语音识别 (WebSocket streaming).

Why this exists in its current shape (2026-05-15 rewrite):

* The V3 file-submit chain (`/api/v3/auc/bigmodel/{submit,query}`) required
  Volcano to fetch each audio clip from a publicly reachable URL. Production
  does not expose static assets over the open internet, so every transcription
  call failed before the request body was ever inspected.
* The credentials shipped via `.env` are **legacy console** keys
  (APPID + ACCESS_TOKEN), not the new-console UUID API key that the V3 file
  endpoint demands.
* The streaming bigmodel endpoints accept the legacy console headers and
  stream audio bytes inline, eliminating both problems at once.

We pick `bigmodel_nostream` because:

* The product surface is **batch transcription of completed clips**, not live
  partials — `bigmodel_nostream` is built exactly for this shape.
* It is the only streaming variant whose ``request.language`` parameter we
  already pass through from the frontend.

Constructor contract (locked in by tests):

* `__init__` MUST NOT raise. Missing credentials only log a warning; the
  per-request entry point (`aprocess_audio_file`) re-checks and returns a
  structured `ASR_NOT_CONFIGURED` failure so the FastAPI process stays
  healthy even when ASR is mis-provisioned.
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import tempfile
import time
import uuid
from typing import Any, Dict, List, Optional, Tuple

import aiofiles
import websockets

from app.config import settings
from app.logger import get_logger
from app.models.audio_models import SubtitleItem
from app.services.volcano_ws_protocol import (
    build_audio_packet,
    build_full_client_request,
    parse_response,
)

logger = get_logger(__name__)


# URL prefix → on-disk directory mapping. Aligned with `app/main.py`'s static
# mounts so callers can hand us either a local path or the proxy URL.
_URL_TO_DIR: Dict[str, str] = {
    "/api/audio/generated/": "static/audio/generated",
    "/api/audio/subtitles/": "static/audio/subtitles",
}


_ASR_WS_URL = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream"

# Per Volcano's spec.md §2.4 chunk-size note: 200 ms aligns with the 双向流式
# best practice and keeps the helper reusable for a future bigmodel_async
# migration. For 16 kHz / 16-bit mono PCM that is 6400 bytes per packet.
_DEFAULT_CHUNK_MS = 200
_DEFAULT_SAMPLE_RATE = 16000
_DEFAULT_BITS = 16
_DEFAULT_CHANNELS = 1

# Per-recv timeout for the WebSocket. Generous enough that the final ack from
# the nostream endpoint (which can return ~5 s after the last audio packet for
# a long clip) does not race the timeout, but small enough to surface a hung
# upstream within ASR_MAX_CLIP_SECONDS budget.
_RECV_TIMEOUT_SECONDS = 30


def _format_srt_time(milliseconds: int) -> str:
    """毫秒 → SRT 时间格式 HH:MM:SS,mmm."""
    total_seconds = milliseconds // 1000
    ms = milliseconds % 1000
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    seconds = total_seconds % 60
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{ms:03d}"


class VolcanoAsrError(RuntimeError):
    """Raised internally when the Volcano server returns an error frame."""

    def __init__(self, code: Optional[int], text: Optional[str], logid: str = ""):
        self.code = code
        self.text = text or ""
        self.logid = logid
        super().__init__(f"Volcano ASR error code={code} message={text} logid={logid}")


class AudioTranscriptionService:
    """音频转字幕服务 — WebSocket streaming bigmodel_nostream client."""

    def __init__(self) -> None:
        """Initialise without ever raising.

        Missing credentials surface as ``logger.warning`` lines only;
        ``aprocess_audio_file`` re-validates per call and returns
        ``ASR_NOT_CONFIGURED`` so the API process stays alive when ASR is
        misconfigured.
        """
        self.appid = settings.volcano_asr_appid
        self.access_token = ***REMOVED***
        self.resource_id = settings.volcano_asr_resource_id
        self.max_clip_seconds = max(1, int(getattr(settings, "asr_max_clip_seconds", 300)))
        self.ws_url = _ASR_WS_URL

        if not self.appid:
            logger.warning(
                "VOLCANO_ASR_APPID is not configured — Subtitles button will "
                "return ASR_NOT_CONFIGURED until set."
            )
        if not self.access_token:
            logger.warning(
                "***REMOVED*** is not configured — Subtitles button "
                "will return ASR_NOT_CONFIGURED until set."
            )
        if not self.resource_id:
            logger.warning(
                "VOLCANO_ASR_RESOURCE_ID is not configured — defaulting to "
                "'volc.bigasr.sauc.duration'."
            )

        logger.info(
            "音频转字幕服务初始化完成 (WS streaming): appid=%s, resource_id=%s, "
            "max_clip_seconds=%d",
            self._mask(self.appid),
            self.resource_id or "volc.bigasr.sauc.duration",
            self.max_clip_seconds,
        )

    # ---------------------------------------------------------------- helpers

    @staticmethod
    def _mask(secret: str) -> str:
        """脱敏展示（保留前 2 末 2 字符）。"""
        if not secret:
            return ""
        if len(secret) <= 4:
            return "*" * len(secret)
        return f"{secret[:2]}****{secret[-2:]}"

    def _resolve_local_path(self, url: str) -> Optional[str]:
        """将 /api/... URL 解析为本地文件系统路径。"""
        url_map = dict(_URL_TO_DIR)
        url_map["/api/storage/files/"] = settings.storage.root
        for prefix, directory in url_map.items():
            if url.startswith(prefix):
                filename = url[len(prefix):]
                return os.path.join(directory, filename)
        return None

    def _missing_credentials(self) -> Optional[str]:
        """Return the env-var name of the first missing credential, or None."""
        if not self.appid:
            return "VOLCANO_ASR_APPID"
        if not self.access_token:
            return "***REMOVED***"
        if not self.resource_id:
            return "VOLCANO_ASR_RESOURCE_ID"
        return None

    # --------------------------------------------------------------- ffprobe

    def get_audio_duration(self, audio_path: str) -> Optional[float]:
        """通过 ffprobe 读取音频时长（秒）。失败返回 None。"""
        try:
            cmd = [
                "ffprobe",
                "-v",
                "quiet",
                "-print_format",
                "json",
                "-show_format",
                audio_path,
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            info = json.loads(result.stdout)
            duration = float(info["format"]["duration"])
            return duration
        except Exception as e:  # noqa: BLE001 — ffprobe missing or non-audio file
            logger.warning(f"获取音频时长失败: {e}")
            return None

    @staticmethod
    def _transcode_to_pcm16k_mono(src_path: str) -> str:
        """Transcode any input to 16 kHz / 16-bit / mono PCM WAV in a temp file.

        Volcano enforces this audio shape on the streaming bigmodel endpoints;
        sending anything else surfaces as `45000151 音频格式不正确`. We always
        transcode rather than guessing — ffmpeg is a hard dependency of this
        project (see `CLAUDE.md`) and a single short clip costs <100 ms.
        """
        fd, dst_path = tempfile.mkstemp(suffix=".wav", prefix="asr_pcm16k_")
        os.close(fd)
        cmd = [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-i",
            src_path,
            "-ar",
            str(_DEFAULT_SAMPLE_RATE),
            "-ac",
            str(_DEFAULT_CHANNELS),
            "-sample_fmt",
            "s16",
            "-f",
            "wav",
            dst_path,
        ]
        try:
            subprocess.run(cmd, check=True, capture_output=True)
        except subprocess.CalledProcessError as e:
            try:
                os.unlink(dst_path)
            except OSError:
                pass
            raise RuntimeError(
                f"ffmpeg transcode failed: {e.stderr.decode('utf-8', errors='replace') if e.stderr else e}"
            ) from e
        return dst_path

    # ---------------------------------------------------------------- SRT

    def convert_to_srt(self, subtitle_data: Dict[str, Any]) -> Optional[str]:
        """将识别结果 utterances 渲染为 SRT 文本。"""
        try:
            utterances = (subtitle_data or {}).get("utterances") or []
            if not utterances:
                return None
            lines: List[str] = []
            for i, utt in enumerate(utterances, 1):
                lines.append(str(i))
                lines.append(
                    f"{self.ms_to_srt_time(int(utt['start_time']))} --> "
                    f"{self.ms_to_srt_time(int(utt['end_time']))}"
                )
                lines.append(utt.get("text", ""))
                lines.append("")
            return "\n".join(lines)
        except Exception as e:  # noqa: BLE001 — malformed utterance entries
            logger.error(f"SRT 转换失败: {e}")
            return None

    def ms_to_srt_time(self, milliseconds: int) -> str:
        return _format_srt_time(milliseconds)

    def save_srt_file(self, srt_content: str, filename: str) -> Tuple[str, str]:
        """落盘 SRT 字幕文件并返回 (path, url)."""
        srt_dir = os.path.join("static", "audio", "subtitles")
        os.makedirs(srt_dir, exist_ok=True)
        srt_filename = f"{filename}_{int(time.time())}.srt"
        srt_path = os.path.join(srt_dir, srt_filename)
        with open(srt_path, "w", encoding="utf-8") as f:
            f.write(srt_content)
        srt_url = f"/static/audio/subtitles/{srt_filename}"
        logger.info(f"SRT 文件保存成功: {srt_path}")
        return srt_path, srt_url

    # ---------------------------------------------------------------- WS

    def _build_full_client_payload(
        self,
        *,
        language: str,
        use_itn: bool,
        use_punc: bool,
        audio_format: str,
    ) -> Dict[str, Any]:
        """Construct the JSON body for the first client frame.

        ``audio.format`` must match the actual bytes we're about to send.
        Because we always transcode to 16 kHz / 16-bit / mono PCM WAV first
        (see `_transcode_to_pcm16k_mono`), the value is fixed to "wav".
        """
        audio_block: Dict[str, Any] = {
            "format": audio_format,
            "rate": _DEFAULT_SAMPLE_RATE,
            "bits": _DEFAULT_BITS,
            "channel": _DEFAULT_CHANNELS,
            "codec": "raw",
        }
        if language:
            audio_block["language"] = language

        request_block: Dict[str, Any] = {
            "model_name": "bigmodel",
            "enable_itn": bool(use_itn),
            "enable_punc": bool(use_punc),
            "show_utterances": True,
            "result_type": "full",
        }
        return {
            "user": {"uid": "ecliptrix"},
            "audio": audio_block,
            "request": request_block,
        }

    def _build_headers(self, request_id: str, connect_id: str) -> Dict[str, str]:
        """Volcano 旧版控制台 WebSocket 握手 header。"""
        return {
            "X-Api-App-Key": self.appid,
            "X-Api-Access-Key": self.access_token,
            "X-Api-Resource-Id": self.resource_id or "volc.bigasr.sauc.duration",
            "X-Api-Request-Id": request_id,
            "X-Api-Connect-Id": connect_id,
            "X-Api-Sequence": "-1",
        }

    @staticmethod
    def _extract_logid(ws: "websockets.WebSocketClientProtocol") -> str:
        """Read X-Tt-Logid from the WS upgrade response across websockets versions."""
        try:
            response_headers = getattr(ws, "response_headers", None)
            if response_headers is None:
                resp = getattr(ws, "response", None)
                if resp is not None:
                    response_headers = getattr(resp, "headers", None)
            if response_headers is None:
                return ""
            # Headers is a Headers / Mapping; dict-style access works on both.
            try:
                return response_headers.get("X-Tt-Logid") or response_headers.get("x-tt-logid") or ""
            except AttributeError:
                return ""
        except Exception:  # noqa: BLE001 — defensive: never crash on logid read
            return ""

    async def _stream_one_file(
        self,
        *,
        pcm_path: str,
        language: str,
        use_itn: bool,
        use_punc: bool,
    ) -> Tuple[Dict[str, Any], str]:
        """Open a WS, push the audio, and return (flattened_result, logid).

        Raises VolcanoAsrError on protocol-level failures so the caller can
        translate them into a structured response.
        """
        request_id = str(uuid.uuid4())
        connect_id = str(uuid.uuid4())
        headers = self._build_headers(request_id, connect_id)

        async with websockets.connect(
            self.ws_url,
            additional_headers=headers,
            max_size=None,
            open_timeout=_RECV_TIMEOUT_SECONDS,
        ) as ws:
            logid = self._extract_logid(ws)
            logger.info(
                "音频转字幕 WS 已连接: request_id=%s, logid=%s, resource_id=%s",
                request_id,
                logid,
                self.resource_id,
            )

            payload = self._build_full_client_payload(
                language=language,
                use_itn=use_itn,
                use_punc=use_punc,
                audio_format="wav",
            )
            await ws.send(build_full_client_request(payload, seq=1))
            # bigmodel_nostream may send the handshake ack immediately or
            # only after the first audio frame depending on routing. Try to
            # drain one ack non-fatally — any error here surfaces below.
            try:
                ack_frame = await asyncio.wait_for(ws.recv(), timeout=_RECV_TIMEOUT_SECONDS)
                ack = parse_response(ack_frame)
                if ack.is_error:
                    raise VolcanoAsrError(ack.error_code, ack.error_text, logid)
            except asyncio.TimeoutError:
                # No early ack — keep going; nostream may only respond on last chunk.
                pass

            # Read raw audio bytes off disk. We've already transcoded to 16 kHz
            # 16-bit mono PCM WAV; the WAV header is 44 bytes but Volcano is
            # told format=wav so we leave the bytes intact (the header is part
            # of a "wav" payload).
            async with aiofiles.open(pcm_path, "rb") as f:
                audio_bytes = await f.read()

            chunk_size = (_DEFAULT_SAMPLE_RATE * _DEFAULT_BITS * _DEFAULT_CHANNELS * _DEFAULT_CHUNK_MS) // (8 * 1000)
            if chunk_size <= 0:
                chunk_size = 6400

            chunks = [audio_bytes[i : i + chunk_size] for i in range(0, len(audio_bytes), chunk_size)]
            if not chunks:
                # Truly empty audio: still send a final empty negative packet
                # so the server doesn't hang on us.
                chunks = [b""]

            last_idx = len(chunks) - 1
            final_payload: Optional[Dict[str, Any]] = None

            for i, chunk in enumerate(chunks):
                seq = i + 2  # full client request consumed seq=1
                is_last = i == last_idx
                await ws.send(build_audio_packet(seq=seq, audio=chunk, last=is_last))

                # Drain whatever the server pushes back. bigmodel_nostream's
                # contract: typically one full response on the last packet,
                # though the server may emit interim frames too.
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=_RECV_TIMEOUT_SECONDS)
                except asyncio.TimeoutError:
                    if is_last:
                        raise VolcanoAsrError(
                            None,
                            "timed out waiting for final ASR response",
                            logid,
                        )
                    continue

                parsed = parse_response(msg)
                if parsed.is_error:
                    raise VolcanoAsrError(parsed.error_code, parsed.error_text, logid)
                if parsed.payload:
                    final_payload = parsed.payload
                if is_last:
                    break

            if final_payload is None:
                # Some routes only send the result after the negative packet
                # has been ack'd. Try once more.
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=_RECV_TIMEOUT_SECONDS)
                    parsed = parse_response(msg)
                    if parsed.is_error:
                        raise VolcanoAsrError(parsed.error_code, parsed.error_text, logid)
                    final_payload = parsed.payload or {}
                except asyncio.TimeoutError:
                    raise VolcanoAsrError(None, "empty ASR response", logid)

            result_block = (final_payload or {}).get("result") or {}
            audio_info = (final_payload or {}).get("audio_info") or {}
            flat = {
                "utterances": result_block.get("utterances", []) or [],
                "text": result_block.get("text", "") or "",
                "audio_info": audio_info,
            }
            logger.info(
                "音频转字幕 WS 完成: request_id=%s, logid=%s, utterances=%d, duration_ms=%s",
                request_id,
                logid,
                len(flat["utterances"]),
                audio_info.get("duration"),
            )
            return flat, logid

    # ----------------------------------------------------- async entry points

    async def aprocess_audio_file(
        self,
        audio_path: str,
        language: str = "zh-CN",
        *,
        use_itn: bool = True,
        use_punc: bool = False,
        max_lines: int = 2,
        words_per_line: int = 15,
        generate_srt_file: bool = True,
    ) -> Dict[str, Any]:
        """End-to-end transcription of a single local audio file.

        Guard order (spec.md §2.5):
            1. Credentials present → else ASR_NOT_CONFIGURED.
            2. File exists.
            3. audio_duration ≤ ASR_MAX_CLIP_SECONDS → else ASR_CLIP_TOO_LONG.
            4. Transcode to 16 kHz mono PCM WAV.
            5. Stream over WebSocket.

        ``max_lines`` / ``words_per_line`` are kept in the signature for
        backwards compatibility with the V1 batch handler; they are not
        forwarded.
        """
        del max_lines, words_per_line  # not forwarded — see docstring.
        start_time = time.time()

        missing = self._missing_credentials()
        if missing:
            return {
                "success": False,
                "error_code": "ASR_NOT_CONFIGURED",
                "error": f"ASR credential missing: {missing}",
                "error_message": f"ASR credential missing: {missing}",
                "processing_time": time.time() - start_time,
            }

        if not os.path.exists(audio_path):
            return {
                "success": False,
                "error_code": "ASR_FILE_NOT_FOUND",
                "error": f"音频文件不存在: {audio_path}",
                "error_message": f"音频文件不存在: {audio_path}",
                "processing_time": time.time() - start_time,
            }

        audio_duration = self.get_audio_duration(audio_path)
        if audio_duration is not None and audio_duration > self.max_clip_seconds:
            return {
                "success": False,
                "error_code": "ASR_CLIP_TOO_LONG",
                "error": (
                    f"音频时长 {audio_duration:.1f}s 超过单段上限 "
                    f"{self.max_clip_seconds}s，请拆分后再试"
                ),
                "error_message": "audio clip exceeds ASR_MAX_CLIP_SECONDS",
                "error_details": {
                    "duration_s": audio_duration,
                    "limit_s": self.max_clip_seconds,
                },
                "audio_duration": audio_duration,
                "processing_time": time.time() - start_time,
            }

        pcm_path: Optional[str] = None
        try:
            pcm_path = await asyncio.to_thread(self._transcode_to_pcm16k_mono, audio_path)
        except Exception as e:  # noqa: BLE001 — surfacing ffmpeg failures
            logger.error(f"ASR 转码失败: {e}")
            return {
                "success": False,
                "error_code": "ASR_UNSUPPORTED_AUDIO",
                "error": f"音频转码失败: {e}",
                "error_message": str(e),
                "audio_duration": audio_duration,
                "processing_time": time.time() - start_time,
            }

        request_id = str(uuid.uuid4())
        try:
            flat, logid = await self._stream_one_file(
                pcm_path=pcm_path,
                language=language,
                use_itn=use_itn,
                use_punc=use_punc,
            )
        except VolcanoAsrError as e:
            logger.error(
                f"ASR Volcano 错误: code={e.code}, text={e.text}, logid={e.logid}"
            )
            return {
                "success": False,
                "error_code": "ASR_AUTH_FAILED" if e.code in (45000001,) else "ASR_REMOTE_ERROR",
                "error": f"Volcano ASR error code={e.code} message={e.text}",
                "error_message": e.text or "Volcano ASR error",
                "error_details": {"volcano_code": e.code, "logid": e.logid},
                "audio_duration": audio_duration,
                "processing_time": time.time() - start_time,
            }
        except Exception as e:  # noqa: BLE001 — network / WS failures
            logger.error(f"ASR WebSocket 失败: {e}")
            return {
                "success": False,
                "error_code": "ASR_NETWORK_ERROR",
                "error": f"ASR network failure: {e}",
                "error_message": str(e),
                "audio_duration": audio_duration,
                "processing_time": time.time() - start_time,
            }
        finally:
            if pcm_path and pcm_path != audio_path:
                try:
                    os.unlink(pcm_path)
                except OSError:
                    pass

        # Build SubtitleItem list + optional SRT.
        subtitles: List[SubtitleItem] = []
        for utt in flat["utterances"]:
            subtitles.append(
                SubtitleItem(
                    start_time=int(utt.get("start_time", 0)),
                    end_time=int(utt.get("end_time", 0)),
                    text=utt.get("text", ""),
                )
            )

        srt_content: Optional[str] = None
        srt_file_path: Optional[str] = None
        srt_file_url: Optional[str] = None
        if generate_srt_file and subtitles:
            srt_content = self.convert_to_srt(flat)
            if srt_content:
                base_name = os.path.splitext(os.path.basename(audio_path))[0]
                srt_file_path, srt_file_url = self.save_srt_file(srt_content, base_name)

        return {
            "success": True,
            "job_id": request_id,
            "subtitles": subtitles,
            "srt_content": srt_content,
            "srt_file_path": srt_file_path,
            "srt_file_url": srt_file_url,
            "processing_time": time.time() - start_time,
            "audio_duration": audio_duration,
            "subtitle_count": len(subtitles),
            "logid": logid,
        }

    async def atranscribe_audio_urls(
        self,
        audio_items: List[Dict[str, Any]],
        *,
        language: str = "zh-CN",
        use_itn: bool = True,
        use_punc: bool = False,
        max_lines: int = 2,
        words_per_line: int = 15,
    ) -> List[Dict[str, Any]]:
        """Batch-transcribe a list of audio items (serial for now — see §2.6)."""
        logger.info(f"开始批量音频转录，共 {len(audio_items)} 项")
        results: List[Dict[str, Any]] = []
        for i, item in enumerate(audio_items):
            results.append(
                await self._transcribe_single_item(
                    item,
                    index=i,
                    language=language,
                    use_itn=use_itn,
                    use_punc=use_punc,
                    max_lines=max_lines,
                    words_per_line=words_per_line,
                )
            )
        return results

    async def _transcribe_single_item(
        self,
        item: Dict[str, Any],
        *,
        index: int,
        language: str,
        use_itn: bool,
        use_punc: bool,
        max_lines: int,
        words_per_line: int,
    ) -> Dict[str, Any]:
        item_start = time.time()
        audio_item_id = item.get("id", f"audio_{index}")
        audio_item_name = item.get("name", f"Audio {index + 1}")
        audio_url = item.get("url", "")
        track_id = item.get("track_id", "")
        timeline_start_time = float(item.get("start_time", 0.0) or 0.0)
        timeline_duration = float(item.get("duration", 0.0) or 0.0)

        try:
            if not audio_url:
                raise ValueError(f"音频项目 {audio_item_id} 缺少 URL")

            temp_file_path: Optional[str] = None
            try:
                if audio_url.startswith("/api/"):
                    temp_file_path = self._resolve_local_path(audio_url)
                    if temp_file_path is None:
                        raise ValueError(f"无法识别的 API 路径: {audio_url}")
                elif audio_url.startswith("/") or audio_url.startswith("static/"):
                    temp_file_path = audio_url
                else:
                    # Remote URL — download via httpx-free path using urllib
                    # to avoid pulling new deps. requests is already in the
                    # tree but blocking; do it on a worker thread.
                    temp_file_path = await asyncio.to_thread(self._download_to_temp, audio_url)

                if not os.path.exists(temp_file_path):
                    raise FileNotFoundError(f"音频文件不存在: {temp_file_path}")

                transcription_result = await self.aprocess_audio_file(
                    temp_file_path,
                    language,
                    use_itn=use_itn,
                    use_punc=use_punc,
                    max_lines=max_lines,
                    words_per_line=words_per_line,
                )

                processing_time = time.time() - item_start

                if not transcription_result.get("success", False):
                    return {
                        "audio_item_id": audio_item_id,
                        "audio_item_name": audio_item_name,
                        "track_id": track_id,
                        "start_time": timeline_start_time,
                        "duration": timeline_duration,
                        "success": False,
                        "subtitles": [],
                        "srt_content": None,
                        "processing_time": processing_time,
                        "audio_duration": transcription_result.get("audio_duration"),
                        "error_message": transcription_result.get(
                            "error_message"
                        ) or transcription_result.get("error") or "转录失败",
                    }

                # Adjust timestamps to the timeline origin.
                offset_ms = int(timeline_start_time * 1000)
                adjusted_subtitles: List[Dict[str, Any]] = []
                for subtitle in transcription_result.get("subtitles", []) or []:
                    adjusted_subtitles.append(
                        {
                            "start_time": subtitle.start_time + offset_ms,
                            "end_time": subtitle.end_time + offset_ms,
                            "text": subtitle.text,
                        }
                    )

                srt_content = ""
                if adjusted_subtitles:
                    srt_lines: List[str] = []
                    for idx, sub in enumerate(adjusted_subtitles, 1):
                        srt_lines.append(str(idx))
                        srt_lines.append(
                            f"{_format_srt_time(sub['start_time'])} --> "
                            f"{_format_srt_time(sub['end_time'])}"
                        )
                        srt_lines.append(sub["text"])
                        srt_lines.append("")
                    srt_content = "\n".join(srt_lines)

                return {
                    "audio_item_id": audio_item_id,
                    "audio_item_name": audio_item_name,
                    "track_id": track_id,
                    "start_time": timeline_start_time,
                    "duration": timeline_duration,
                    "success": True,
                    "subtitles": adjusted_subtitles,
                    "srt_content": srt_content,
                    "processing_time": processing_time,
                    "audio_duration": transcription_result.get("audio_duration"),
                    "error_message": None,
                }
            finally:
                # Clean up temp files we downloaded (NOT local ones we resolved).
                if (
                    temp_file_path
                    and not audio_url.startswith("/")
                    and not audio_url.startswith("static/")
                    and not audio_url.startswith("/api/")
                ):
                    try:
                        if os.path.exists(temp_file_path):
                            os.unlink(temp_file_path)
                    except OSError as cleanup_error:
                        logger.warning(f"清理临时文件失败: {cleanup_error}")
        except Exception as e:  # noqa: BLE001 — return structured failure
            return {
                "audio_item_id": audio_item_id,
                "audio_item_name": audio_item_name,
                "track_id": track_id,
                "start_time": timeline_start_time,
                "duration": timeline_duration,
                "success": False,
                "subtitles": [],
                "srt_content": None,
                "processing_time": time.time() - item_start,
                "audio_duration": None,
                "error_message": str(e),
            }

    @staticmethod
    def _download_to_temp(url: str) -> str:
        """Download an http(s) URL to a temp file. Blocking — run via to_thread."""
        import requests  # local import to avoid loading on cold start

        response = requests.get(url, timeout=30)
        response.raise_for_status()
        suffix = os.path.splitext(url.split("?")[0])[1] or ".mp3"
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        tmp.write(response.content)
        tmp.close()
        return tmp.name

    # ------------------------------------------------------- sync facades

    def process_audio_file(self, *args, **kwargs) -> Dict[str, Any]:
        """Sync wrapper around `aprocess_audio_file`.

        Only safe from non-async contexts (scripts, tests, legacy in-process
        callers). MUST NOT be called from within a running event loop — the
        FastAPI router calls `aprocess_audio_file` directly.
        """
        return _run_sync(self.aprocess_audio_file(*args, **kwargs))

    def transcribe_audio_urls(self, *args, **kwargs) -> List[Dict[str, Any]]:
        """Sync wrapper around `atranscribe_audio_urls` — same constraints."""
        return _run_sync(self.atranscribe_audio_urls(*args, **kwargs))


def _run_sync(coro):
    """Run a coroutine to completion on a fresh event loop.

    Raises RuntimeError if called from within a running loop so we fail loud
    rather than silently hang the caller.
    """
    try:
        running = asyncio.get_running_loop()
    except RuntimeError:
        running = None
    if running is not None:
        raise RuntimeError(
            "AudioTranscriptionService sync facade called from within an event "
            "loop — await the async facade (aprocess_audio_file) instead."
        )
    return asyncio.run(coro)


# 模块级单例 — 在缺少凭据时也不能抛异常，否则会让整个 FastAPI 进程在 import 阶段崩掉
audio_transcription_service = AudioTranscriptionService()
