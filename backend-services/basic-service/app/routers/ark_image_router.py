"""
Router for Ark Seedream image generation endpoints.
"""

from fastapi import APIRouter, HTTPException

from app.logger import get_logger
from app.models.ark_image_models import (
    ArkImageGenerateRequest,
    ArkImageGenerateResponse,
)
from app.services import ark_image_service

logger = get_logger(__name__)

router = APIRouter(prefix="/ark-image", tags=["Ark Image"])


@router.post("/generate", response_model=ArkImageGenerateResponse)
async def generate_images(request: ArkImageGenerateRequest) -> ArkImageGenerateResponse:
    """
    Generate images using the Ark Seedream API.

    Returns a list of generated image URLs.
    """
    try:
        images = await ark_image_service.generate_images(request)
        return ArkImageGenerateResponse(
            success=True,
            message=f"Generated {len(images)} image(s)",
            images=images,
        )
    except Exception as e:
        logger.error(f"Failed to generate Ark images: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate images: {str(e)}")
