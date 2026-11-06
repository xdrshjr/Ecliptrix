"""视频能力目录、单次提交及安全状态读取。"""
from fastapi import APIRouter

from app.models.ark_video_models import ArkVideoGenerateRequest, ArkVideoGenerateResponse, ArkVideoStatusResponse
from app.services import ark_video_service
from app.services.ark_video_config import video_models_response
from app.services.credential_errors import generation_error_response, VideoError

router = APIRouter(prefix="/ark-video", tags=["Ark Video"])
CAPABILITY = "ark_video:contents/generations/tasks"


@router.get("/models")
async def get_video_models() -> dict:
    return {"success": True, "data": video_models_response()}


@router.post("/generate", response_model=ArkVideoGenerateResponse)
async def generate_video(request: ArkVideoGenerateRequest) -> ArkVideoGenerateResponse:
    try:
        submission = await ark_video_service.create_task(request)
        return ArkVideoGenerateResponse(
            success=True, message="视频生成任务已受理", ark_task_id=submission.task_id,
            model=submission.model_id, config_revision=submission.config_revision,
        )
    except Exception as error:
        from app.services.credential_errors import CredentialNotConfigured
        if isinstance(error, CredentialNotConfigured):
            raise
        return generation_error_response(error, CAPABILITY)


@router.get("/status/{ark_task_id}", response_model=ArkVideoStatusResponse)
async def get_video_status(ark_task_id: str, retry_artifact: bool = False) -> ArkVideoStatusResponse:
    from app.services.ark_video_task_context import validate_task_id
    try:
        validate_task_id(ark_task_id)
        if ark_task_id.startswith("sbv-"):
            from app.services.storyboard_video_queue import storyboard_video_queue
            job = await storyboard_video_queue.get_job(ark_task_id)
            if job is None:
                raise VideoError("storyboard_job_not_found", status_code=404, operation="status", retryable=False)
            if retry_artifact and job.ark_task_id:
                return await storyboard_video_queue.retry_artifact(job)
            mapped = {"queued": "queued", "generating": "running", "success": "succeeded", "failed": "failed", "timeout": "timeout"}.get(job.status, "failed")
            return ArkVideoStatusResponse(
                success=mapped not in ("failed", "timeout"), message=job.error or mapped,
                status=mapped, phase=job.phase, model=job.model, ark_task_id=job.ark_task_id,
                video_url=job.video_url, thumbnail_url=job.thumbnail_url, duration=job.duration,
                width=job.width, height=job.height, error=job.error, error_code=job.error_code,
                position_in_queue=await storyboard_video_queue.position_in_queue(ark_task_id) if mapped == "queued" else None,
            )
        return await ark_video_service.get_status(ark_task_id, retry_artifact=retry_artifact)
    except Exception as error:
        from app.services.credential_errors import CredentialNotConfigured
        if isinstance(error, CredentialNotConfigured):
            raise
        if not isinstance(error, VideoError):
            from app.services.integration_credentials_service import IntegrationLoadFailed
            from app.services.ark_video_profiles import InvalidModelConfiguration
            if not isinstance(error, (IntegrationLoadFailed, InvalidModelConfiguration)):
                error = VideoError("video_status_unavailable", status_code=502, operation="status", retryable=True)
        return generation_error_response(error, CAPABILITY)
