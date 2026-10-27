"""
Voice Clone service for Volcano Engine voice cloning API.
Supports V3 voice clone training, status query, and TTS with cloned voice.
"""

import uuid
import base64
import json
import os
import asyncio
from typing import Optional

import aiofiles
import httpx
from app.config import settings
from app.logger import get_logger

logger = get_logger(__name__)

VOICE_CLONE_BASE_URL = "https://openspeech.bytedance.com/api/v3/tts"
VOICE_CLONE_TRAIN_PATH = "/voice_clone"
VOICE_CLONE_STATUS_PATH = "/get_voice"
VOICE_CLONE_TTS_PATH = "/unidirectional"

ERROR_CODE_MAP = {
    45001001: "请求参数有误，请检查输入",
    45001101: "音频上传失败，请重试",
    45001102: "ASR转写失败，请更换音频或重试",
    45001104: "声纹检测未通过，请更换参考音频",
    45001105: "获取音频数据失败",
    45001107: "SpeakerID未找到",
    45001108: "音频转码失败，请更换音频格式",
    45001109: "WER检测错误，请确保音频与文本匹配",
    45001114: "音频质量较差，请更换更清晰的音频",
    45001122: "未检测到人声，请选择含清晰人声的音频",
    45001123: "已达训练次数上限",
    45001124: "ASR文本审核拒绝",
    45001127: "音频审核拒绝，请更换音频",
    55001301: "数据库查询失败，请重试",
    55001307: "音色克隆失败，请重试",
}


class VoiceCloneService:
    def __init__(self):
        self.app_key = settings.volcano_voice_clone_app_key
        self.access_key = settings.volcano_voice_clone_access_key
        self.speaker_id_prefix = settings.volcano_voice_clone_speaker_id_prefix

    def _build_headers(self) -> dict:
        return {
            "Content-Type": "application/json",
            "X-Api-App-Key": self.app_key,
            "X-Api-Access-Key": self.access_key,
            "X-Api-Request-Id": str(uuid.uuid4()),
        }

    def _map_error(self, code: int, message: str) -> str:
        return ERROR_CODE_MAP.get(code, message or f"未知错误 (code={code})")

    def _generate_speaker_id(self) -> str:
        return f"{self.speaker_id_prefix}{uuid.uuid4().hex[:12]}"

    async def _audio_file_to_base64(self, audio_path: str) -> tuple[str, str]:
        if audio_path.startswith(("http://", "https://")):
            return await self._download_audio_to_base64(audio_path)

        if not os.path.isabs(audio_path):
            storage_root = settings.storage.root
            audio_path = os.path.join(storage_root, audio_path)

        if not os.path.exists(audio_path):
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        audio_format = self._detect_format(audio_path)
        async with aiofiles.open(audio_path, "rb") as f:
            content = await f.read()
        audio_data = base64.b64encode(content).decode("utf-8")
        return audio_data, audio_format

    async def _download_audio_to_base64(self, url: str) -> tuple[str, str]:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            audio_data = base64.b64encode(resp.content).decode("utf-8")

        from urllib.parse import urlparse

        path = urlparse(url).path
        ext = os.path.splitext(path)[1].lstrip(".")
        if not ext:
            ext = "wav"
        return audio_data, ext

    def _detect_format(self, path: str) -> str:
        ext = os.path.splitext(path)[1].lstrip(".").lower()
        if ext in ("wav", "mp3", "ogg", "m4a", "aac", "pcm"):
            return ext
        return "wav"

    async def train_voice(
        self,
        speaker_id: Optional[str],
        audio_url: str,
        audio_format: Optional[str],
        language: int = 0,
        enable_audio_denoise: bool = True,
    ) -> dict:
        if not self.app_key or not self.access_key:
            raise ValueError(
                "Voice Clone API keys not configured. Please set VOLCANO_VOICE_CLONE_APP_KEY and VOLCANO_VOICE_CLONE_ACCESS_KEY."
            )

        if not speaker_id:
            raise ValueError(
                "speaker_id is required. Voice clone speaker IDs must be purchased/allocated "
                "in the Volcano console (声音复刻下单) — they cannot be generated client-side. "
                "See https://www.volcengine.com/docs/6561/1167802"
            )

        try:
            audio_data, detected_format = await self._audio_file_to_base64(audio_url)
        except Exception as e:
            logger.error(f"Failed to read audio file: {e}")
            raise ValueError(f"Failed to read audio file: {str(e)}")

        fmt = audio_format or detected_format

        request_body = {
            "speaker_id": speaker_id,
            "audio": {
                "data": audio_data,
                "format": fmt,
            },
            "language": language,
            "extra_params": {
                "voice_clone_denoise_model_id": "" if enable_audio_denoise else "none",
            },
        }

        headers = self._build_headers()
        url = f"{VOICE_CLONE_BASE_URL}{VOICE_CLONE_TRAIN_PATH}"

        logger.info(f"Starting voice clone training for speaker_id={speaker_id}")

        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(url, json=request_body, headers=headers)

        if resp.status_code != 200:
            error_body = (
                resp.json()
                if resp.headers.get("content-type", "").startswith("application/json")
                else {}
            )
            code = error_body.get("code", resp.status_code)
            message = error_body.get("message", resp.text)
            error_msg = self._map_error(code, message)
            logger.error(f"Voice clone train failed: code={code}, message={error_msg}")
            raise Exception(error_msg)

        result = resp.json()
        result["speaker_id"] = speaker_id
        logger.info(
            f"Voice clone training initiated: speaker_id={speaker_id}, status={result.get('status')}"
        )
        return result

    async def get_voice_status(self, speaker_id: str) -> dict:
        if not self.app_key or not self.access_key:
            raise ValueError("Voice Clone API keys not configured.")

        headers = self._build_headers()
        url = f"{VOICE_CLONE_BASE_URL}{VOICE_CLONE_STATUS_PATH}"
        request_body = {"speaker_id": speaker_id}

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, json=request_body, headers=headers)

        if resp.status_code != 200:
            error_body = (
                resp.json()
                if resp.headers.get("content-type", "").startswith("application/json")
                else {}
            )
            code = error_body.get("code", resp.status_code)
            message = error_body.get("message", resp.text)
            error_msg = self._map_error(code, message)
            logger.error(
                f"Voice clone status query failed: code={code}, message={error_msg}"
            )
            raise Exception(error_msg)

        return resp.json()

    async def wait_for_training(
        self, speaker_id: str, max_wait: int = 120, poll_interval: int = 3
    ) -> dict:
        elapsed = 0
        while elapsed < max_wait:
            result = await self.get_voice_status(speaker_id)
            status = result.get("status")

            if status == 2 or status == 4:
                logger.info(f"Voice clone training completed: speaker_id={speaker_id}")
                return result
            elif status == 3:
                raise Exception("Voice clone training failed (status=Failed)")
            elif status == 0:
                raise Exception(f"Speaker ID not found: {speaker_id}")

            await asyncio.sleep(poll_interval)
            elapsed += poll_interval

        raise TimeoutError(
            f"Voice clone training timed out after {max_wait}s for speaker_id={speaker_id}"
        )

    async def synthesize_with_cloned_voice(
        self, speaker_id: str, text: str, language: int = 0
    ) -> bytes:
        if not self.app_key or not self.access_key:
            raise ValueError("Voice Clone API keys not configured.")

        headers = self._build_headers()
        headers["X-Api-Resource-Id"] = settings.volcano_voice_clone_tts_resource_id or "seed-icl-1.0"

        url = f"{VOICE_CLONE_BASE_URL}{VOICE_CLONE_TTS_PATH}"

        request_body = {
            "speaker": speaker_id,
            "text": text,
            "audio_config": {
                "format": "mp3",
            },
        }

        logger.info(
            f"Synthesizing audio with cloned voice: speaker_id={speaker_id}, text_length={len(text)}"
        )

        audio_chunks = []
        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream(
                "POST", url, json=request_body, headers=headers
            ) as resp:
                if resp.status_code != 200:
                    body = await resp.aread()
                    try:
                        error_body = json.loads(body)
                        code = error_body.get("code", resp.status_code)
                        message = error_body.get("message", "")
                        error_msg = self._map_error(code, message)
                    except Exception:
                        error_msg = f"TTS synthesis failed (HTTP {resp.status_code})"
                    raise Exception(error_msg)

                async for chunk in resp.aiter_bytes():
                    audio_chunks.append(chunk)

        audio_data = b"".join(audio_chunks)
        if not audio_data:
            raise Exception("TTS synthesis returned empty audio data")

        logger.info(f"Synthesized audio with cloned voice: {len(audio_data)} bytes")
        return audio_data


voice_clone_service = VoiceCloneService()
