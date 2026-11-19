"""
Chat service for video editing AI assistant.
Handles LLM API calls with streaming support.
"""

import json
from typing import AsyncGenerator, Dict, List
from app.logger import get_logger
from app.models.model_settings_models import ModelFunctionType
from app.services.llm_call_config import resolve_llm_call_config
from app.services.llm_client import LLMCallConfig, stream_chat

logger = get_logger(__name__)


class ChatService:
    """Service for handling video editing chat with LLM."""
    
    async def resolve_config(self) -> LLMCallConfig:
        """Resolve the chat model at call time (assignment, env fallback, router).

        Raises:
            LLMNotConfiguredError: no endpoint/key is configured (a ``ValueError``).
        """
        return await resolve_llm_call_config(ModelFunctionType.CHAT)


    def _format_messages(self, message: str, current_content: str) -> List[Dict[str, str]]:
        """
        Format messages for LLM API call.
        
        Args:
            message: User message
            current_content: Current project content
            
        Returns:
            List of formatted messages
        """
        system_prompt = (
            "You are an AI assistant specialized in video editing and content creation. "
            "You help users with their video editing projects by providing suggestions, "
            "improvements, and content generation.\n\n"
        )
        
        if current_content:
            system_prompt += (
                f"Current project context:\n"
                f"The user is currently working on a video editing project with the following content:\n\n"
                f"{current_content}\n\n"
            )
        else:
            system_prompt += "Current project context:\nThe user is starting a new video editing project.\n\n"
        
        system_prompt += (
            "Please provide helpful, practical advice and suggestions related to video editing, "
            "content creation, project planning, and workflow optimization. When appropriate, "
            "you can suggest additions or improvements to their project documentation."
        )
        
        return [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": message}
        ]
    
    def _log_request(
        self, message: str, current_content: str, task_id: str, model: str,
    ) -> None:
        """
        Log the incoming request details.
        
        Args:
            message: User message
            current_content: Current project content
            task_id: Task identifier
            model: Resolved model name
        """
        logger.info(
            f"Video editing chat request - Task ID: {task_id}",
            extra={
                "task_id": task_id,
                "model": model,
                "message_length": len(message),
                "message_preview": message[:100] + "..." if len(message) > 100 else message,
                "content_length": len(current_content),
                "content_preview": current_content[:100] + "..." if len(current_content) > 100 else current_content
            }
        )
    
    def _log_response(self, success: bool, task_id: str, error: str = None) -> None:
        """
        Log the response status.
        
        Args:
            success: Whether the response was successful
            task_id: Task identifier
            error: Error message if failed
        """
        if success:
            logger.info(f"Video editing chat response completed successfully - Task ID: {task_id}")
        else:
            logger.error(
                f"Video editing chat response failed - Task ID: {task_id}",
                extra={"task_id": task_id, "error": error}
            )
    
    async def stream_chat_response(
        self, 
        message: str, 
        current_content: str, 
        task_id: str
    ) -> AsyncGenerator[str, None]:
        """
        Stream chat response from LLM API.
        
        Args:
            message: User message
            current_content: Current project content
            task_id: Task identifier
            
        Yields:
            str: Streaming response chunks
            
        Raises:
            Exception: If API call fails
        """
        config = await self.resolve_config()
        self._log_request(message, current_content, task_id, config.model)

        messages = self._format_messages(message, current_content)

        logger.info(
            f"Calling LLM API (api_type={config.api_type}) base={config.api_url} "
            f"for task: {task_id}"
        )

        try:
            async for piece in stream_chat(
                messages,
                config=config,
                temperature=0.7,
                max_tokens=2000,
                timeout=60.0,
            ):
                # Preserve the public browser SSE contract: data: {"content": "..."}\n\n
                yield f"data: {json.dumps({'content': piece})}\n\n"

            yield "data: [DONE]\n\n"
            self._log_response(True, task_id)

        except Exception as e:
            error_msg = f"Chat service error: {str(e)}"
            logger.error(error_msg, extra={"task_id": task_id}, exc_info=True)
            self._log_response(False, task_id, error_msg)
            raise