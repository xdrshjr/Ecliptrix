"""
RunningHub API service for FLUX text-to-image generation and general workflow execution.
"""

import json
import yaml
import uuid
import asyncio
import aiohttp
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime

from app.logger import get_logger
from app.config import settings
from app.models.runninghub_models import (
    FluxGenerationRequest,
    FluxGenerationResponse,
    FluxGenerationStatusResponse,
    FluxGenerationResultResponse,
    FluxGenerationErrorResponse,
    RunningHubCreateTaskRequest,
    RunningHubCreateTaskResponse,
    RunningHubStatusRequest,
    RunningHubStatusResponse,
    RunningHubResultsRequest,
    RunningHubResultsResponse,
    NodeInfo,
    TaskStatus
)

logger = get_logger(__name__)


class RunningHubService:
    """Service for interacting with RunningHub API for FLUX generation."""
    
    def __init__(self):
        """Initialize RunningHub service."""
        self.api_key = getattr(settings, 'running_hub_api_key', None)
        if not self.api_key:
            logger.error("RUNNING_HUB_API_KEY not found in environment variables")
            raise ValueError("RUNNING_HUB_API_KEY is required")
        
        # Load configuration
        self.config = self._load_config()
        self.base_url = self.config['flux_generation']['base_url']
        self.workflow_id = self.config['flux_generation']['workflow_id']
        self.endpoints = self.config['flux_generation']['endpoints']
        
        # Load node info template
        self.node_template = self._load_node_template()
        
        logger.info(f"RunningHub service initialized with workflow ID: {self.workflow_id}")
    
    def _load_config(self) -> Dict[str, Any]:
        """Load FLUX configuration from YAML file."""
        config_path = Path("workflow/flux_config.yaml")
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                config = yaml.safe_load(f)
            logger.info(f"Loaded FLUX configuration from {config_path}")
            return config
        except FileNotFoundError:
            logger.error(f"Configuration file not found: {config_path}")
            raise
        except yaml.YAMLError as e:
            logger.error(f"Error parsing YAML configuration: {e}")
            raise
    
    def _load_node_template(self) -> List[Dict[str, Any]]:
        """Load node info template from JSON file."""
        template_path = Path("workflow/flux_nodeinfo_template.json")
        try:
            with open(template_path, 'r', encoding='utf-8') as f:
                template = json.load(f)
            logger.info(f"Loaded node template from {template_path}")
            return template
        except FileNotFoundError:
            logger.error(f"Node template file not found: {template_path}")
            raise
        except json.JSONError as e:
            logger.error(f"Error parsing JSON template: {e}")
            raise
    
    def _create_node_info_list(self, request: FluxGenerationRequest) -> List[NodeInfo]:
        """Create node info list from request parameters."""
        node_info_list = []
        
        for node_template in self.node_template:
            node_info = NodeInfo(
                nodeId=node_template['nodeId'],
                fieldName=node_template['fieldName'],
                fieldValue=node_template['fieldValue'].format(
                    positive_prompt=request.positive_prompt,
                    aspect_ratio=request.aspect_ratio
                ),
                description=node_template['description']
            )
            node_info_list.append(node_info)
        
        logger.info(f"Created node info list with {len(node_info_list)} nodes")
        return node_info_list
    
    async def create_generation_task(self, request: FluxGenerationRequest) -> FluxGenerationResponse:
        """
        Create a new FLUX generation task.
        
        Args:
            request: FLUX generation request
            
        Returns:
            FluxGenerationResponse with task information
        """
        task_id = request.task_id or f"flux_{uuid.uuid4().hex[:8]}"
        
        try:
            logger.info(f"Creating FLUX generation task {task_id}", extra={
                'task_id': task_id,
                'prompt_length': len(request.positive_prompt),
                'aspect_ratio': request.aspect_ratio
            })
            
            # Create node info list
            node_info_list = self._create_node_info_list(request)
            
            # Prepare RunningHub request
            runninghub_request = RunningHubCreateTaskRequest(
                workflowId=self.workflow_id,
                apiKey=self.api_key,
                nodeInfoList=node_info_list
            )
            
            # Make API call
            url = f"{self.base_url}{self.endpoints['create_task']}"
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    url,
                    json=runninghub_request.model_dump(),
                    headers={'Content-Type': 'application/json'}
                ) as response:
                    if response.status != 200:
                        error_text = await response.text()
                        logger.error(f"RunningHub API error: {response.status} - {error_text}")
                        return FluxGenerationErrorResponse(
                            error=f"API request failed with status {response.status}",
                            error_code="API_ERROR",
                            task_id=task_id
                        )
                    
                    response_data = await response.json()
                    runninghub_response = RunningHubCreateTaskResponse(**response_data)
            
            # Check response
            if runninghub_response.code != 0:
                logger.error(f"RunningHub returned error: {runninghub_response.msg}")
                return FluxGenerationErrorResponse(
                    error=runninghub_response.msg,
                    error_code="RUNNINGHUB_ERROR",
                    task_id=task_id
                )
            
            # Extract task information
            runninghub_task_id = runninghub_response.data.get('taskId')
            task_status = runninghub_response.data.get('taskStatus', 'PENDING')
            
            logger.info(f"FLUX generation task created successfully", extra={
                'task_id': task_id,
                'runninghub_task_id': runninghub_task_id,
                'status': task_status
            })
            
            return FluxGenerationResponse(
                success=True,
                task_id=task_id,
                runninghub_task_id=runninghub_task_id,
                status=TaskStatus(task_status),
                message="FLUX generation task created successfully"
            )
            
        except Exception as e:
            logger.error(f"Error creating FLUX generation task: {str(e)}", extra={
                'task_id': task_id,
                'error': str(e)
            })
            return FluxGenerationErrorResponse(
                error=f"Internal error: {str(e)}",
                error_code="INTERNAL_ERROR",
                task_id=task_id
            )
    
    async def check_task_status(self, task_id: str, runninghub_task_id: str) -> FluxGenerationStatusResponse:
        """
        Check the status of a FLUX generation task.
        
        Args:
            task_id: Internal task ID
            runninghub_task_id: RunningHub task ID
            
        Returns:
            FluxGenerationStatusResponse with current status
        """
        try:
            logger.debug(f"Checking status for task {task_id} (RunningHub: {runninghub_task_id})")
            
            # Prepare status request
            status_request = RunningHubStatusRequest(
                apiKey=self.api_key,
                taskId=runninghub_task_id
            )
            
            # Make API call
            url = f"{self.base_url}{self.endpoints['check_status']}"
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    url,
                    json=status_request.model_dump(),
                    headers={'Content-Type': 'application/json'}
                ) as response:
                    if response.status != 200:
                        error_text = await response.text()
                        logger.error(f"Status check API error: {response.status} - {error_text}")
                        return FluxGenerationStatusResponse(
                            success=False,
                            task_id=task_id,
                            runninghub_task_id=runninghub_task_id,
                            status=TaskStatus.FAILED,
                            message=f"Status check failed: {error_text}"
                        )
                    
                    response_data = await response.json()
                    status_response = RunningHubStatusResponse(**response_data)
            
            # Check response
            if status_response.code != 0:
                logger.error(f"Status check returned error: {status_response.msg}")
                return FluxGenerationStatusResponse(
                    success=False,
                    task_id=task_id,
                    runninghub_task_id=runninghub_task_id,
                    status=TaskStatus.FAILED,
                    message=status_response.msg
                )
            
            # Map status
            status_mapping = self.config['flux_generation']['status_mapping']
            mapped_status = status_mapping.get(status_response.data, status_response.data)
            
            logger.debug(f"Task {task_id} status: {status_response.data} -> {mapped_status}")
            
            return FluxGenerationStatusResponse(
                success=True,
                task_id=task_id,
                runninghub_task_id=runninghub_task_id,
                status=TaskStatus(mapped_status),
                message=f"Task status: {status_response.data}"
            )
            
        except Exception as e:
            logger.error(f"Error checking task status: {str(e)}", extra={
                'task_id': task_id,
                'runninghub_task_id': runninghub_task_id,
                'error': str(e)
            })
            return FluxGenerationStatusResponse(
                success=False,
                task_id=task_id,
                runninghub_task_id=runninghub_task_id,
                status=TaskStatus.FAILED,
                message=f"Status check error: {str(e)}"
            )
    
    async def get_task_results(self, task_id: str, runninghub_task_id: str) -> FluxGenerationResultResponse:
        """
        Get the results of a completed FLUX generation task.
        
        Args:
            task_id: Internal task ID
            runninghub_task_id: RunningHub task ID
            
        Returns:
            FluxGenerationResultResponse with generated images
        """
        try:
            logger.info(f"Getting results for task {task_id} (RunningHub: {runninghub_task_id})")
            
            # Prepare results request
            results_request = RunningHubResultsRequest(
                apiKey=self.api_key,
                taskId=runninghub_task_id
            )
            
            # Make API call
            url = f"{self.base_url}{self.endpoints['get_results']}"
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    url,
                    json=results_request.model_dump(),
                    headers={'Content-Type': 'application/json'}
                ) as response:
                    if response.status != 200:
                        error_text = await response.text()
                        logger.error(f"Results API error: {response.status} - {error_text}")
                        return FluxGenerationResultResponse(
                            success=False,
                            task_id=task_id,
                            runninghub_task_id=runninghub_task_id,
                            status=TaskStatus.FAILED,
                            results=[],
                            message=f"Results retrieval failed: {error_text}"
                        )
                    
                    response_data = await response.json()
                    results_response = RunningHubResultsResponse(**response_data)
            
            # Check response
            if results_response.code != 0:
                logger.error(f"Results retrieval returned error: {results_response.msg}")
                return FluxGenerationResultResponse(
                    success=False,
                    task_id=task_id,
                    runninghub_task_id=runninghub_task_id,
                    status=TaskStatus.FAILED,
                    results=[],
                    message=results_response.msg
                )
            
            logger.info(f"Retrieved {len(results_response.data)} results for task {task_id}")
            
            return FluxGenerationResultResponse(
                success=True,
                task_id=task_id,
                runninghub_task_id=runninghub_task_id,
                status=TaskStatus.COMPLETED,
                results=results_response.data,
                message=f"Retrieved {len(results_response.data)} generated images"
            )
            
        except Exception as e:
            logger.error(f"Error getting task results: {str(e)}", extra={
                'task_id': task_id,
                'runninghub_task_id': runninghub_task_id,
                'error': str(e)
            })
            return FluxGenerationResultResponse(
                success=False,
                task_id=task_id,
                runninghub_task_id=runninghub_task_id,
                status=TaskStatus.FAILED,
                results=[],
                message=f"Results retrieval error: {str(e)}"
            )


class GeneralWorkflowService:
    """Service for general RunningHub workflow execution."""
    
    def __init__(self):
        """Initialize General Workflow service."""
        self.api_key = getattr(settings, 'running_hub_api_key', None)
        if not self.api_key:
            logger.error("RUNNING_HUB_API_KEY not found in environment variables")
            raise ValueError("RUNNING_HUB_API_KEY is required")
        
        # RunningHub API endpoints
        self.base_url = "https://www.runninghub.cn"
        self.endpoints = {
            'create_task': '/task/openapi/create',
            'check_status': '/task/openapi/status',
            'get_results': '/task/openapi/outputs'
        }
        
        logger.info("General RunningHub workflow service initialized")
    
    async def create_workflow_task(
        self, 
        workflow_id: str, 
        node_info_list: List[Dict[str, Any]], 
        task_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Create a new workflow task using RunningHub API.
        
        Args:
            workflow_id: The RunningHub workflow ID
            node_info_list: List of node parameters
            task_id: Optional internal task ID for tracking
            
        Returns:
            Dict containing task creation response
        """
        internal_task_id = task_id or f"workflow_{uuid.uuid4().hex[:8]}"
        
        try:
            logger.info(f"Creating workflow task {internal_task_id}", extra={
                'task_id': internal_task_id,
                'workflow_id': workflow_id,
                'node_count': len(node_info_list)
            })
            
            # Prepare RunningHub request
            request_data = {
                "workflowId": workflow_id,
                "apiKey": self.api_key,
                "nodeInfoList": node_info_list
            }
            
            # Make API call
            url = f"{self.base_url}{self.endpoints['create_task']}"
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    url,
                    json=request_data,
                    headers={'Content-Type': 'application/json'}
                ) as response:
                    if response.status != 200:
                        error_text = await response.text()
                        logger.error(f"RunningHub API error: {response.status} - {error_text}")
                        return {
                            'success': False,
                            'error': f"API request failed with status {response.status}",
                            'error_code': 'API_ERROR',
                            'task_id': internal_task_id
                        }
                    
                    response_data = await response.json()
            
            # Check response
            if response_data.get('code') != 0:
                logger.error(f"RunningHub returned error: {response_data.get('msg')}")
                return {
                    'success': False,
                    'error': response_data.get('msg', 'Unknown error'),
                    'error_code': 'RUNNINGHUB_ERROR',
                    'task_id': internal_task_id
                }
            
            # Extract task information
            data = response_data.get('data', {})
            runninghub_task_id = data.get('taskId')
            task_status = data.get('taskStatus', 'PENDING')
            
            logger.info(f"Workflow task created successfully", extra={
                'task_id': internal_task_id,
                'workflow_id': workflow_id,
                'runninghub_task_id': runninghub_task_id,
                'status': task_status
            })
            
            return {
                'success': True,
                'task_id': internal_task_id,
                'runninghub_task_id': runninghub_task_id,
                'status': task_status,
                'message': 'Workflow task created successfully',
                'workflow_id': workflow_id,
                'net_wss_url': data.get('netWssUrl'),
                'client_id': data.get('clientId'),
                'prompt_tips': data.get('promptTips')
            }
            
        except Exception as e:
            logger.error(f"Error creating workflow task: {str(e)}", extra={
                'task_id': internal_task_id,
                'workflow_id': workflow_id,
                'error': str(e)
            })
            return {
                'success': False,
                'error': f"Internal error: {str(e)}",
                'error_code': 'INTERNAL_ERROR',
                'task_id': internal_task_id
            }
    
    async def check_workflow_status(self, runninghub_task_id: str, task_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Check the status of a workflow task.
        
        Args:
            runninghub_task_id: RunningHub task ID
            task_id: Optional internal task ID for tracking
            
        Returns:
            Dict containing task status
        """
        try:
            logger.debug(f"Checking status for RunningHub task {runninghub_task_id}")
            
            # Prepare status request
            request_data = {
                "apiKey": self.api_key,
                "taskId": runninghub_task_id
            }
            
            # Make API call
            url = f"{self.base_url}{self.endpoints['check_status']}"
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    url,
                    json=request_data,
                    headers={'Content-Type': 'application/json'}
                ) as response:
                    if response.status != 200:
                        error_text = await response.text()
                        logger.error(f"Status check API error: {response.status} - {error_text}")
                        return {
                            'success': False,
                            'status': 'FAILED',
                            'message': f"Status check failed: {error_text}",
                            'task_id': task_id,
                            'runninghub_task_id': runninghub_task_id
                        }
                    
                    response_data = await response.json()
            
            # Check response
            if response_data.get('code') != 0:
                logger.error(f"Status check returned error: {response_data.get('msg')}")
                return {
                    'success': False,
                    'status': 'FAILED',
                    'message': response_data.get('msg', 'Unknown error'),
                    'task_id': task_id,
                    'runninghub_task_id': runninghub_task_id
                }
            
            status = response_data.get('data', 'UNKNOWN')
            
            logger.debug(f"Task {runninghub_task_id} status: {status}")
            
            return {
                'success': True,
                'status': status,
                'message': f"Task status: {status}",
                'task_id': task_id,
                'runninghub_task_id': runninghub_task_id
            }
            
        except Exception as e:
            logger.error(f"Error checking task status: {str(e)}", extra={
                'task_id': task_id,
                'runninghub_task_id': runninghub_task_id,
                'error': str(e)
            })
            return {
                'success': False,
                'status': 'FAILED',
                'message': f"Status check error: {str(e)}",
                'task_id': task_id,
                'runninghub_task_id': runninghub_task_id
            }
    
    async def get_workflow_results(self, runninghub_task_id: str, task_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Get the results of a completed workflow task.
        
        Args:
            runninghub_task_id: RunningHub task ID
            task_id: Optional internal task ID for tracking
            
        Returns:
            Dict containing task results
        """
        try:
            logger.info(f"Getting results for RunningHub task {runninghub_task_id}")
            
            # Prepare results request
            request_data = {
                "apiKey": self.api_key,
                "taskId": runninghub_task_id
            }
            
            # Make API call
            url = f"{self.base_url}{self.endpoints['get_results']}"
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    url,
                    json=request_data,
                    headers={'Content-Type': 'application/json'}
                ) as response:
                    if response.status != 200:
                        error_text = await response.text()
                        logger.error(f"Results API error: {response.status} - {error_text}")
                        return {
                            'success': False,
                            'status': 'FAILED',
                            'results': [],
                            'message': f"Results retrieval failed: {error_text}",
                            'task_id': task_id,
                            'runninghub_task_id': runninghub_task_id
                        }
                    
                    response_data = await response.json()
            
            # Check response
            if response_data.get('code') != 0:
                logger.error(f"Results retrieval returned error: {response_data.get('msg')}")
                return {
                    'success': False,
                    'status': 'FAILED',
                    'results': [],
                    'message': response_data.get('msg', 'Unknown error'),
                    'task_id': task_id,
                    'runninghub_task_id': runninghub_task_id
                }
            
            results = response_data.get('data', [])
            
            logger.info(f"Retrieved {len(results)} results for task {runninghub_task_id}")
            
            return {
                'success': True,
                'status': 'COMPLETED',
                'results': results,
                'message': f"Retrieved {len(results)} results",
                'task_id': task_id,
                'runninghub_task_id': runninghub_task_id
            }
            
        except Exception as e:
            logger.error(f"Error getting task results: {str(e)}", extra={
                'task_id': task_id,
                'runninghub_task_id': runninghub_task_id,
                'error': str(e)
            })
            return {
                'success': False,
                'status': 'FAILED',
                'results': [],
                'message': f"Results retrieval error: {str(e)}",
                'task_id': task_id,
                'runninghub_task_id': runninghub_task_id
            }