"""
Voice Clone API routes.
"""

import os
import uuid
from typing import Union
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
import aiofiles

from app.models.voice_clone_models import (
    VoiceCloneTrainRequest,
    VoiceCloneTrainResponse,
    VoiceCloneStatusResponse,
    AIAudioSynthesizeRequest,
)
from app.models.tts_models import TTSResponse, TTSErrorResponse
from app.services.voice_clone_service import voice_clone_service
from app.config import settings
from app.logger import get_logger

router = APIRouter(prefix="/voice-clone", tags=["Voice Clone"])
logger = get_logger(__name__)


@router.post(
    "/train",
    response_model=None,
    summary="Start voice clone training",
    description="Upload reference audio and start voice clone training",
)
async def train_voice_clone(request: VoiceCloneTrainRequest):
    try:
        result = await voice_clone_service.train_voice(
            speaker_id=request.speaker_id,
            audio_url=request.audio_url,
            audio_format=request.audio_format,
            language=request.language,
            enable_audio_denoise=request.enable_audio_denoise,
        )

        speaker_id = result.get("speaker_id", request.speaker_id)

        try:
            status_result = await voice_clone_service.wait_for_training(
                speaker_id=speaker_id,
                max_wait=120,
                poll_interval=3,
            )
            training_status = status_result.get("status")
        except (TimeoutError, Exception) as e:
            logger.warning(f"Training status poll issue: {e}")
            training_status = result.get("status", 1)

        if training_status in (2, 4):
            try:
                audio_data = await voice_clone_service.synthesize_with_cloned_voice(
                    speaker_id=speaker_id,
                    text=request.text,
                    language=request.language,
                )

                storage_root = settings.storage.root
                audio_dir = os.path.join(storage_root, "audio", "generated")
                os.makedirs(audio_dir, exist_ok=True)

                file_name = f"voice_clone_{speaker_id}_{uuid.uuid4().hex[:8]}.mp3"
                file_path = os.path.join(audio_dir, file_name)

                async with aiofiles.open(file_path, "wb") as f:
                    await f.write(audio_data)

                audio_url = f"/api/audio/generated/{file_name}"
                file_size = len(audio_data)

                return VoiceCloneTrainResponse(
                    success=True,
                    message="Voice clone training and synthesis completed successfully",
                    data={
                        "speaker_id": speaker_id,
                        "audio_url": audio_url,
                        "file_name": file_name,
                        "file_size": file_size,
                        "text": request.text,
                        "status": training_status,
                    },
                )
            except Exception as synth_err:
                logger.error(f"TTS synthesis after cloning failed: {synth_err}")
                return VoiceCloneTrainResponse(
                    success=True,
                    message="Voice clone training succeeded, but synthesis failed",
                    data={
                        "speaker_id": speaker_id,
                        "status": training_status,
                        "synthesis_error": str(synth_err),
                    },
                )
        else:
            return VoiceCloneTrainResponse(
                success=True,
                message="Voice clone training initiated",
                data={
                    "speaker_id": speaker_id,
                    "status": training_status,
                },
            )

    except ValueError as e:
        return JSONResponse(
            status_code=400,
            content={"success": False, "message": str(e), "data": None},
        )
    except Exception as e:
        logger.error(f"Voice clone training error: {e}")
        return JSONResponse(
            status_code=500,
            content={"success": False, "message": str(e), "data": None},
        )


@router.post(
    "/status/{speaker_id}",
    response_model=VoiceCloneStatusResponse,
    summary="Query voice clone training status",
    description="Check the training status of a cloned voice",
)
async def get_voice_clone_status(speaker_id: str):
    try:
        result = await voice_clone_service.get_voice_status(speaker_id)
        return VoiceCloneStatusResponse(
            success=True,
            message="Status retrieved successfully",
            data=result,
        )
    except Exception as e:
        logger.error(f"Voice clone status query error: {e}")
        return VoiceCloneStatusResponse(
            success=False,
            message=str(e),
            data=None,
        )


@router.post(
    "/synthesize",
    response_model=Union[TTSResponse, TTSErrorResponse],
    summary="Synthesize audio with cloned voice",
    description="Use a trained cloned voice to synthesize audio from text",
)
async def synthesize_with_cloned_voice(request: AIAudioSynthesizeRequest):
    try:
        speaker_id = request.voice_type
        text = request.text

        if not speaker_id or not text:
            return TTSErrorResponse(
                success=False,
                message="speaker_id and text are required",
            )

        audio_data = await voice_clone_service.synthesize_with_cloned_voice(
            speaker_id=speaker_id,
            text=text,
        )

        storage_root = settings.storage.root
        audio_dir = os.path.join(storage_root, "audio", "generated")
        os.makedirs(audio_dir, exist_ok=True)

        file_name = f"clone_tts_{speaker_id}_{uuid.uuid4().hex[:8]}.mp3"
        file_path = os.path.join(audio_dir, file_name)

        async with aiofiles.open(file_path, "wb") as f:
            await f.write(audio_data)

        audio_url = f"/api/audio/generated/{file_name}"
        file_size = len(audio_data)

        duration = file_size / 16000

        return TTSResponse(
            success=True,
            message="Synthesis completed successfully",
            data={
                "audio_url": audio_url,
                "duration": round(duration, 2),
                "file_size": file_size,
                "voice_type": speaker_id,
                "text_length": len(request.text),
                "request_id": str(uuid.uuid4()),
                "file_name": file_name,
                "file_path": file_path,
            },
        )

    except Exception as e:
        logger.error(f"Cloned voice synthesis error: {e}")
        return TTSErrorResponse(
            success=False,
            message=str(e),
        )
