"""
Chat service for video editing AI assistant.
Handles LLM API calls with streaming support.
"""

import json
import httpx
from typing import AsyncGenerator, Dict, Any, List
from app.config import settings
from app.logger import get_logger

logger = get_logger(__name__)


class ChatService:
    """Service for handling video editing chat with LLM."""
    
    def __init__(self):
        """Initialize the chat service."""
        self.api_key = settings.llm_api_key
        self.api_url = settings.llm_api_url
        self.model = settings.llm_model
        
        if not self.api_key or not self.api_url:
            raise ValueError("LLM API key and URL must be configured")
    
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
    
    def _log_request(self, message: str, current_content: str, task_id: str) -> None:
        """
        Log the incoming request details.
        
        Args:
            message: User message
            current_content: Current project content
            task_id: Task identifier
        """
        logger.info(
            f"Video editing chat request - Task ID: {task_id}",
            extra={
                "task_id": task_id,
                "model": self.model,
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
        self._log_request(message, current_content, task_id)
        
        # Prepare request data
        request_data = {
            "model": self.model,
            "messages": self._format_messages(message, current_content),
            "stream": True,
            "temperature": 0.7,
            "max_tokens": 2000
        }
        
        logger.info(f"Calling LLM API: {self.api_url}/chat/completions for task: {task_id}")
        
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                async with client.stream(
                    "POST",
                    f"{self.api_url}/chat/completions",
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {self.api_key}"
                    },
                    json=request_data
                ) as response:
                    
                    if response.status_code != 200:
                        error_text = await response.aread()
                        error_msg = f"LLM API error: {response.status_code} - {error_text.decode()}"
                        logger.error(error_msg, extra={"task_id": task_id, "status_code": response.status_code})
                        self._log_response(False, task_id, error_msg)
                        raise Exception(error_msg)
                    
                    # Process streaming response
                    async for line in response.aiter_lines():
                        if line.strip():
                            if line.startswith("data: "):
                                data = line[6:]  # Remove "data: " prefix
                                
                                if data.strip() == "[DONE]":
                                    logger.debug(f"Stream completed for task: {task_id}")
                                    break
                                
                                try:
                                    json_data = json.loads(data)
                                    if "choices" in json_data and json_data["choices"]:
                                        delta = json_data["choices"][0].get("delta", {})
                                        if "content" in delta:
                                            content = delta["content"]
                                            yield f"data: {json.dumps({'content': content})}\n\n"
                                except json.JSONDecodeError:
                                    logger.warning(f"Invalid JSON in stream for task: {task_id}: {data}")
                                    continue
                    
                    # Send final done signal
                    yield "data: [DONE]\n\n"
                    self._log_response(True, task_id)
                    
        except Exception as e:
            error_msg = f"Chat service error: {str(e)}"
            logger.error(error_msg, extra={"task_id": task_id}, exc_info=True)
            self._log_response(False, task_id, error_msg)
            raise