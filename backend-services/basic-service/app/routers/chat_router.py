"""
Chat router for video editing AI assistant.
"""

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse
from app.models import VideoChatRequest, VideoChatErrorResponse
from app.services import ChatService
from app.logger import get_logger

# Initialize router and logger
router = APIRouter()
logger = get_logger(__name__)


@router.post("/video-editing-chat")
async def video_editing_chat(request: VideoChatRequest):
    """
    Video editing AI assistant chat endpoint with streaming response.
    
    Args:
        request: Chat request containing message, current content, and task ID
        
    Returns:
        StreamingResponse: Server-sent events stream with AI responses
        
    Raises:
        HTTPException: If request validation fails or service error occurs
    """
    try:
        # Validate request parameters
        if not request.message.strip():
            logger.error(f"Invalid request: empty message for task {request.taskId}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=VideoChatErrorResponse(
                    error="Message string is required",
                    details="message cannot be empty",
                    taskId=request.taskId
                ).model_dump()
            )
        
        if not request.taskId.strip():
            logger.error("Invalid request: taskId is required")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=VideoChatErrorResponse(
                    error="Task ID is required",
                    details="taskId cannot be empty"
                ).model_dump()
            )
        
        logger.info(f"Processing video editing chat request for task: {request.taskId}")
        
        # Initialize chat service
        try:
            chat_service = ChatService()
        except ValueError as e:
            logger.error(f"Chat service initialization failed: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=VideoChatErrorResponse(
                    error="AI service configuration error",
                    details="LLM API not properly configured",
                    taskId=request.taskId
                ).model_dump()
            )
        
        # Create streaming response
        async def generate_stream():
            try:
                async for chunk in chat_service.stream_chat_response(
                    message=request.message,
                    current_content=request.currentContent,
                    task_id=request.taskId
                ):
                    yield chunk
            except Exception as e:
                logger.error(
                    f"Error in chat stream generation for task {request.taskId}: {str(e)}",
                    exc_info=True
                )
                # Send error as SSE event
                error_response = VideoChatErrorResponse(
                    error="AI service temporarily unavailable",
                    details=str(e),
                    taskId=request.taskId
                )
                yield f"data: {error_response.model_dump_json()}\n\n"
                yield "data: [DONE]\n\n"
        
        return StreamingResponse(
            generate_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no"  # Disable nginx buffering
            }
        )
        
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        logger.error(
            f"Unexpected error in video editing chat for task {getattr(request, 'taskId', 'unknown')}: {str(e)}",
            exc_info=True
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=VideoChatErrorResponse(
                error="Internal server error",
                details="An unexpected error occurred",
                taskId=getattr(request, 'taskId', None)
            ).model_dump()
        )