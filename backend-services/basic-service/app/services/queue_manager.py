"""
Universal queue manager for handling concurrent request limitations.
"""

import asyncio
import uuid
from datetime import datetime
from typing import Dict, Optional, Callable, Any
from collections import deque

from app.logger import get_logger
from app.models.queue_models import (
    QueueTask,
    QueueInfo,
    TaskStatus,
    QueueStatusResponse
)

logger = get_logger(__name__)


class QueueManager:
    """
    Universal queue manager that handles concurrent request limitations.
    
    Features:
    - Configurable maximum concurrent tasks per queue
    - Task queuing when limits are reached
    - Task status tracking and statistics
    - Estimated wait time calculation
    - Comprehensive logging
    """
    
    def __init__(self):
        """Initialize the queue manager."""
        self._queues: Dict[str, Dict] = {}
        self._tasks: Dict[str, QueueTask] = {}
        self._task_results: Dict[str, Any] = {}
        self._task_errors: Dict[str, Exception] = {}
        self._lock = asyncio.Lock()
        
        logger.info("QueueManager initialized")
    
    async def create_queue(self, queue_name: str, max_concurrent: int = 2) -> None:
        """
        Create a new queue with specified concurrent limit.
        
        Args:
            queue_name (str): Name of the queue
            max_concurrent (int): Maximum concurrent tasks allowed
        """
        async with self._lock:
            if queue_name not in self._queues:
                self._queues[queue_name] = {
                    'semaphore': asyncio.Semaphore(max_concurrent),
                    'max_concurrent': max_concurrent,
                    'waiting_queue': deque(),
                    'processing_tasks': set(),
                    'completed_tasks': [],
                    'total_processed': 0,
                    'processing_times': deque(maxlen=100)  # Keep last 100 processing times for average
                }
                logger.info(f"Created queue '{queue_name}' with max_concurrent={max_concurrent}")
            else:
                logger.warning(f"Queue '{queue_name}' already exists")
    
    async def enqueue_task(
        self, 
        queue_name: str, 
        task_func: Callable,
        task_args: tuple = (),
        task_kwargs: dict = None,
        task_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Enqueue a task for processing.
        
        Args:
            queue_name (str): Queue name
            task_func (Callable): Function to execute
            task_args (tuple): Function arguments
            task_kwargs (dict): Function keyword arguments
            task_id (str, optional): Custom task ID
            metadata (dict, optional): Additional task metadata
            
        Returns:
            str: Task ID
        """
        if task_kwargs is None:
            task_kwargs = {}
            
        # Generate task ID if not provided
        if task_id is None:
            task_id = f"{queue_name}_{uuid.uuid4().hex[:8]}"
        
        # Ensure queue exists
        if queue_name not in self._queues:
            await self.create_queue(queue_name)
        
        # Create task object
        task = QueueTask(
            task_id=task_id,
            queue_name=queue_name,
            status=TaskStatus.QUEUED,
            metadata=metadata or {}
        )
        
        # Store task
        self._tasks[task_id] = task
        
        # Add to waiting queue
        queue_info = self._queues[queue_name]
        queue_info['waiting_queue'].append({
            'task_id': task_id,
            'task_func': task_func,
            'task_args': task_args,
            'task_kwargs': task_kwargs
        })
        
        # Update position in queue
        await self._update_queue_positions(queue_name)
        
        logger.info(f"Task '{task_id}' enqueued in '{queue_name}' (position: {task.position_in_queue})")
        
        # Start processing if possible
        asyncio.create_task(self._process_queue(queue_name))
        
        return task_id
    
    async def _process_queue(self, queue_name: str) -> None:
        """Process tasks in the queue."""
        queue_info = self._queues[queue_name]
        semaphore = queue_info['semaphore']
        
        while queue_info['waiting_queue']:
            # Try to acquire semaphore (non-blocking)
            if semaphore.locked() and len(queue_info['processing_tasks']) >= queue_info['max_concurrent']:
                break
            
            try:
                await semaphore.acquire()
                
                # Get next task from queue
                if not queue_info['waiting_queue']:
                    semaphore.release()
                    break
                
                task_info = queue_info['waiting_queue'].popleft()
                task_id = task_info['task_id']
                
                # Update task status
                task = self._tasks[task_id]
                task.status = TaskStatus.PROCESSING
                task.started_at = datetime.now()
                queue_info['processing_tasks'].add(task_id)
                
                # Update queue positions for remaining tasks
                await self._update_queue_positions(queue_name)
                
                logger.info(f"Started processing task '{task_id}' in queue '{queue_name}'")
                
                # Process task in background
                asyncio.create_task(self._execute_task(queue_name, task_info))
                
            except Exception as e:
                logger.error(f"Error processing queue '{queue_name}': {str(e)}")
                semaphore.release()
                break
    
    async def _execute_task(self, queue_name: str, task_info: Dict) -> None:
        """Execute a single task."""
        task_id = task_info['task_id']
        task = self._tasks[task_id]
        queue_info = self._queues[queue_name]
        semaphore = queue_info['semaphore']
        
        try:
            # Execute the task function
            result = await task_info['task_func'](*task_info['task_args'], **task_info['task_kwargs'])
            
            # Store the result
            self._task_results[task_id] = result
            
            # Update task status
            task.status = TaskStatus.COMPLETED
            task.completed_at = datetime.now()
            task.processing_time = (task.completed_at - task.started_at).total_seconds()
            
            # Update statistics
            queue_info['total_processed'] += 1
            queue_info['processing_times'].append(task.processing_time)
            queue_info['completed_tasks'].append(task_id)
            
            # Keep only last 50 completed tasks
            if len(queue_info['completed_tasks']) > 50:
                queue_info['completed_tasks'] = queue_info['completed_tasks'][-50:]
            
            logger.info(f"Task '{task_id}' completed successfully in {task.processing_time:.2f}s")
            
        except Exception as e:
            # Store the error
            self._task_errors[task_id] = e
            
            # Handle task failure
            task.status = TaskStatus.FAILED
            task.completed_at = datetime.now()
            task.error_message = str(e)
            
            logger.error(f"Task '{task_id}' failed: {str(e)}")
            
        finally:
            # Clean up
            queue_info['processing_tasks'].discard(task_id)
            semaphore.release()
            
            # Continue processing queue
            if queue_info['waiting_queue']:
                asyncio.create_task(self._process_queue(queue_name))
    
    async def _update_queue_positions(self, queue_name: str) -> None:
        """Update position in queue for waiting tasks."""
        queue_info = self._queues[queue_name]
        waiting_queue = queue_info['waiting_queue']
        
        for position, task_info in enumerate(waiting_queue):
            task_id = task_info['task_id']
            task = self._tasks[task_id]
            task.position_in_queue = position + 1
            
            # Calculate estimated wait time
            if queue_info['processing_times']:
                avg_processing_time = sum(queue_info['processing_times']) / len(queue_info['processing_times'])
                current_processing = len(queue_info['processing_tasks'])
                max_concurrent = queue_info['max_concurrent']
                
                if current_processing >= max_concurrent:
                    # All slots occupied, need to wait for current tasks to complete
                    tasks_ahead = position
                    estimated_wait = (tasks_ahead // max_concurrent + 1) * avg_processing_time
                else:
                    # Some slots available
                    estimated_wait = (position // max_concurrent) * avg_processing_time
                
                task.estimated_wait_time = max(0, estimated_wait)
    
    async def get_task_status(self, task_id: str) -> Optional[QueueTask]:
        """Get task status by ID."""
        return self._tasks.get(task_id)
    
    async def get_task_result(self, task_id: str) -> Any:
        """Get task result by ID."""
        if task_id in self._task_errors:
            raise self._task_errors[task_id]
        return self._task_results.get(task_id)
    
    async def cleanup_task_data(self, task_id: str) -> None:
        """Clean up task result/error data."""
        self._task_results.pop(task_id, None)
        self._task_errors.pop(task_id, None)
    
    async def get_queue_status(self, queue_name: str, include_tasks: bool = False) -> Optional[QueueStatusResponse]:
        """
        Get queue status information.
        
        Args:
            queue_name (str): Queue name
            include_tasks (bool): Whether to include recent tasks
            
        Returns:
            QueueStatusResponse: Queue status information
        """
        if queue_name not in self._queues:
            return None
        
        queue_info = self._queues[queue_name]
        
        # Calculate average processing time
        avg_processing_time = None
        if queue_info['processing_times']:
            avg_processing_time = sum(queue_info['processing_times']) / len(queue_info['processing_times'])
        
        # Create queue info
        info = QueueInfo(
            queue_name=queue_name,
            max_concurrent=queue_info['max_concurrent'],
            current_processing=len(queue_info['processing_tasks']),
            queued_count=len(queue_info['waiting_queue']),
            total_processed=queue_info['total_processed'],
            average_processing_time=avg_processing_time
        )
        
        # Include recent tasks if requested
        tasks = None
        if include_tasks:
            recent_task_ids = list(queue_info['processing_tasks']) + \
                            [t['task_id'] for t in list(queue_info['waiting_queue'])[:10]] + \
                            queue_info['completed_tasks'][-10:]
            
            tasks = [self._tasks[tid] for tid in recent_task_ids if tid in self._tasks]
        
        return QueueStatusResponse(
            queue_info=info,
            tasks=tasks
        )
    
    async def cancel_task(self, task_id: str) -> bool:
        """
        Cancel a queued task (only works for tasks not yet processing).
        
        Args:
            task_id (str): Task ID to cancel
            
        Returns:
            bool: True if cancelled successfully
        """
        if task_id not in self._tasks:
            return False
        
        task = self._tasks[task_id]
        
        if task.status != TaskStatus.QUEUED:
            return False
        
        # Remove from waiting queue
        queue_info = self._queues[task.queue_name]
        for i, task_info in enumerate(queue_info['waiting_queue']):
            if task_info['task_id'] == task_id:
                del queue_info['waiting_queue'][i]
                break
        
        # Update task status
        task.status = TaskStatus.CANCELLED
        task.completed_at = datetime.now()
        
        # Update queue positions
        await self._update_queue_positions(task.queue_name)
        
        logger.info(f"Task '{task_id}' cancelled")
        return True


# Global queue manager instance
queue_manager = QueueManager() 