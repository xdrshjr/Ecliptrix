"""
LLM configuration API routes for Chat LLM node configuration.
"""

from fastapi import APIRouter, HTTPException, status
from app.models.llm_models import LLMModelsResponse, LLMModelInfo
from app.services.llm_service import llm_service
from app.logger import get_logger

# Initialize router and logger
router = APIRouter(prefix="/llm", tags=["LLM"])
logger = get_logger(__name__)


@router.get("/models", response_model=LLMModelsResponse)
async def get_llm_models() -> LLMModelsResponse:
    """
    Get all available LLM models from environment configuration.
    
    Returns:
        LLMModelsResponse: List of available LLM models with configuration
        
    Raises:
        HTTPException: If there's an error retrieving models
    """
    try:
        logger.info("API request: Get available LLM models")
        
        models = llm_service.get_available_models()
        
        logger.info(f"Successfully retrieved {len(models)} LLM models")
        
        return LLMModelsResponse(
            success=True,
            message=f"Successfully retrieved {len(models)} available LLM models",
            models=models,
            total_count=len(models)
        )
        
    except Exception as e:
        logger.error(f"Error retrieving LLM models: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve LLM models: {str(e)}"
        )


@router.get("/models/{model_id}", response_model=LLMModelInfo)
async def get_llm_model_by_id(model_id: str) -> LLMModelInfo:
    """
    Get a specific LLM model by its ID.
    
    Args:
        model_id: The model ID to retrieve (e.g., 'agent_llm_01')
        
    Returns:
        LLMModelInfo: The model information
        
    Raises:
        HTTPException: If model is not found or there's an error
    """
    try:
        logger.info(f"API request: Get LLM model by ID: {model_id}")
        
        model = llm_service.get_model_by_id(model_id)
        
        if not model:
            logger.warning(f"LLM model not found: {model_id}")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"LLM model not found: {model_id}"
            )
        
        logger.info(f"Successfully retrieved LLM model: {model.display_name}")
        
        return model
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving LLM model {model_id}: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve LLM model: {str(e)}"
        )

