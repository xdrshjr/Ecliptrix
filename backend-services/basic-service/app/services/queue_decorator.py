"""
Queue decorator for applying queuing mechanism to API endpoints.
"""

import asyncio
import functools
from typing import Callable, Optional, Dict, Any

from app.logger import get_logger
from app.services.queue_manager import queue_manager

logger = get_logger(__name__)


def with_queue(
    queue_name: str,
    max_concurrent: int = 2,
    task_id_field: Optional[str] = None,
    metadata_fields: Optional[list] = None
):
    """
    Decorator to apply queuing mechanism to a function.
    
    Args:
        queue_name (str): Name of the queue
        max_concurrent (int): Maximum concurrent tasks (default: 2)
        task_id_field (str, optional): Field name in request to use as task ID
        metadata_fields (list, optional): Fields to include in task metadata
    
    Usage:
        @with_queue("image_to_video", max_concurrent=2, task_id_field="task_id")
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
            
            # Extract metadata
            metadata = {}
            if metadata_fields and request:
                for field in metadata_fields:
                    if hasattr(request, field):
                        metadata[field] = getattr(request, field)
            
            # Ensure queue exists
            await queue_manager.create_queue(queue_name, max_concurrent)
            
            logger.info(f"Queueing task for function '{func.__name__}' in queue '{queue_name}'")
            
            # Create wrapper function for the actual work
            async def task_function():
                return await func(*args, **kwargs)
            
            # Enqueue the task
            generated_task_id = await queue_manager.enqueue_task(
                queue_name=queue_name,
                task_func=task_function,
                task_id=task_id,
                metadata=metadata
            )
            
            # Wait for task completion and return result
            return await _wait_for_task_completion(generated_task_id)
        
        return wrapper
    return decorator


async def _wait_for_task_completion(task_id: str, poll_interval: float = 0.5):
    """
    Wait for a task to complete and return its result.
    
    Args:
        task_id (str): Task ID to wait for
        poll_interval (float): Polling interval in seconds
        
    Returns:
        The result of the task function
    """
    while True:
        task = await queue_manager.get_task_status(task_id)
        
        if not task:
            raise RuntimeError(f"Task {task_id} not found")
        
        if task.status.value == "completed":
            logger.info(f"Task {task_id} completed successfully")
            # This is a simplified version - the advanced decorator should be used for actual result handling
            raise RuntimeError("This decorator does not properly handle results. Use with_queue_advanced instead.")
        elif task.status.value == "failed":
            error_msg = task.error_message or "Task failed with unknown error"
            logger.error(f"Task {task_id} failed: {error_msg}")
            raise RuntimeError(f"Task failed: {error_msg}")
        elif task.status.value == "cancelled":
            logger.info(f"Task {task_id} was cancelled")
            raise RuntimeError("Task was cancelled")
        
        # Task is still queued or processing, wait and check again
        await asyncio.sleep(poll_interval)


class QueuedTaskResult:
    """
    Container for queued task results.
    This is a more advanced approach where we store actual results.
    """
    _results: Dict[str, Any] = {}
    _errors: Dict[str, Exception] = {}
    _lock = asyncio.Lock()
    
    @classmethod
    async def store_result(cls, task_id: str, result: Any):
        """Store task result."""
        async with cls._lock:
            cls._results[task_id] = result
            logger.debug(f"Stored result for task {task_id}")
    
    @classmethod
    async def store_error(cls, task_id: str, error: Exception):
        """Store task error."""
        async with cls._lock:
            cls._errors[task_id] = error
            logger.debug(f"Stored error for task {task_id}: {str(error)}")
    
    @classmethod
    async def get_result(cls, task_id: str) -> Any:
        """Get task result."""
        async with cls._lock:
            if task_id in cls._errors:
                error = cls._errors[task_id]
                logger.debug(f"Retrieved error for task {task_id}: {str(error)}")
                raise error
            result = cls._results.get(task_id)
            logger.debug(f"Retrieved result for task {task_id}: {type(result)}")
            return result
    
    @classmethod
    async def cleanup(cls, task_id: str):
        """Clean up stored result/error."""
        async with cls._lock:
            cls._results.pop(task_id, None)
            cls._errors.pop(task_id, None)
            logger.debug(f"Cleaned up results for task {task_id}")


def with_queue_advanced(
    queue_name: str,
    max_concurrent: int = 2,
    task_id_field: Optional[str] = None,
    metadata_fields: Optional[list] = None
):
    """
    Advanced decorator that properly handles task results.
    
    This version stores actual function results and returns them properly.
    """
    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            # Extract request object
            request = args[0] if args else None
            
            # Generate task ID
            task_id = None
            if task_id_field and request and hasattr(request, task_id_field):
                task_id = getattr(request, task_id_field)
            
            # Extract metadata
            metadata = {}
            if metadata_fields and request:
                for field in metadata_fields:
                    if hasattr(request, field):
                        metadata[field] = getattr(request, field)
            
            # Ensure queue exists
            await queue_manager.create_queue(queue_name, max_concurrent)
            
            logger.info(f"Queueing task for function '{func.__name__}' in queue '{queue_name}'")
            
            # Generate task ID first if not provided
            if task_id is None:
                import uuid
                generated_task_id = f"{queue_name}_{uuid.uuid4().hex[:8]}"
            else:
                generated_task_id = task_id
            
            # Create wrapper function that stores results
            async def task_function():
                try:
                    result = await func(*args, **kwargs)
                    await QueuedTaskResult.store_result(generated_task_id, result)
                    return result
                except Exception as e:
                    await QueuedTaskResult.store_error(generated_task_id, e)
                    raise
            
            # Enqueue the task
            actual_task_id = await queue_manager.enqueue_task(
                queue_name=queue_name,
                task_func=task_function,
                task_id=generated_task_id,
                metadata=metadata
            )
            
            # Wait for task completion and return result
            try:
                await _wait_for_task_completion_advanced(actual_task_id)
                result = await QueuedTaskResult.get_result(actual_task_id)
                return result
            finally:
                # Clean up stored result
                await QueuedTaskResult.cleanup(actual_task_id)
        
        return wrapper
    return decorator


async def _wait_for_task_completion_advanced(task_id: str, poll_interval: float = 0.5):
    """Advanced task completion waiter that handles results properly."""
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
            # The actual exception will be retrieved from QueuedTaskResult
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