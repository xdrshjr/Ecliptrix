"""
Simplified queue decorator for applying queuing mechanism to API endpoints.
"""

import asyncio
import functools
import uuid
from typing import Callable, Optional, Dict, Any

from app.logger import get_logger
from app.services.queue_manager import queue_manager

logger = get_logger(__name__)


def with_simple_queue(
    queue_name: str,
    max_concurrent: int = 2,
    task_id_field: Optional[str] = None,
    metadata_fields: Optional[list] = None
):
    """
    Simple decorator to apply queuing mechanism to a function.
    
    This version directly executes the function within the queue context
    and returns the result without additional complexity.
    
    Args:
        queue_name (str): Name of the queue
        max_concurrent (int): Maximum concurrent tasks (default: 2)
        task_id_field (str, optional): Field name in request to use as task ID
        metadata_fields (list, optional): Fields to include in task metadata
    
    Usage:
        @with_simple_queue("image_to_video", max_concurrent=2, task_id_field="task_id")
        async def convert_image_to_video(request: ImageToVideoRequest):
            # Your function implementation
            pass
    """
    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            # Extract request object (assume first argument is request)
            request = args[0] if args else None
            
            # Generate task ID
            task_id = None
            if task_id_field and request and hasattr(request, task_id_field):
                task_id = getattr(request, task_id_field)
            
            if task_id is None:
                task_id = f"{queue_name}_{uuid.uuid4().hex[:8]}"
            
            # Extract metadata
            metadata = {}
            if metadata_fields and request:
                for field in metadata_fields:
                    if hasattr(request, field):
                        metadata[field] = getattr(request, field)
            
            # Ensure queue exists
            await queue_manager.create_queue(queue_name, max_concurrent)
            
            logger.info(f"Queueing task '{task_id}' for function '{func.__name__}' in queue '{queue_name}'")
            
            # Create a simple task function
            async def task_function():
                return await func(*args, **kwargs)
            
            # Enqueue the task
            actual_task_id = await queue_manager.enqueue_task(
                queue_name=queue_name,
                task_func=task_function,
                task_id=task_id,
                metadata=metadata
            )
            
            try:
                # Wait for task completion
                await _wait_for_simple_task_completion(actual_task_id)
                
                # Get the result from queue manager
                result = await queue_manager.get_task_result(actual_task_id)
                return result
                
            finally:
                # Clean up task data
                await queue_manager.cleanup_task_data(actual_task_id)
        
        return wrapper
    return decorator


async def _wait_for_simple_task_completion(task_id: str, poll_interval: float = 0.5):
    """
    Wait for a task to complete.
    
    Args:
        task_id (str): Task ID to wait for
        poll_interval (float): Polling interval in seconds
    """
    while True:
        task = await queue_manager.get_task_status(task_id)
        
        if not task:
            raise RuntimeError(f"Task {task_id} not found")
        
        if task.status.value == "completed":
            logger.info(f"Task {task_id} completed successfully in {task.processing_time:.2f}s")
            return
        elif task.status.value == "failed":
            error_msg = task.error_message or "Task failed with unknown error"
            logger.error(f"Task {task_id} failed: {error_msg}")
            # The error will be re-raised by the wrapper
            return
        elif task.status.value == "cancelled":
            logger.info(f"Task {task_id} was cancelled")
            raise RuntimeError("Task was cancelled")
        
        # Task is still queued or processing
        if task.status.value == "queued":
            logger.debug(f"Task {task_id} is queued (position: {task.position_in_queue}, estimated wait: {task.estimated_wait_time}s)")
        elif task.status.value == "processing":
            logger.debug(f"Task {task_id} is currently being processed")
        
        await asyncio.sleep(poll_interval) 