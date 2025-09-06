"""
Workflow management API routes for creative workflow operations.
"""

from typing import List
from fastapi import APIRouter, HTTPException, status, Depends
from app.models.workflow_models import (
    WorkflowListResponse, 
    WorkflowInfo, 
    WorkflowExecutionRequest, 
    WorkflowExecutionResponse
)
from app.models import BaseResponse
from app.services.workflow_service import workflow_service
from app.logger import get_logger

# Initialize router and logger
router = APIRouter(prefix="/workflow", tags=["workflow"])
logger = get_logger(__name__)


@router.get("/list", response_model=WorkflowListResponse)
async def get_available_workflows() -> WorkflowListResponse:
    """
    Get all available creative workflows.
    
    Returns:
        WorkflowListResponse: List of available workflows with their configurations
        
    Raises:
        HTTPException: If there's an error loading workflows
    """
    try:
        logger.info("API request: Get available workflows")
        
        workflows = await workflow_service.get_available_workflows()
        
        logger.info(f"Successfully retrieved {len(workflows)} workflows")
        
        return WorkflowListResponse(
            success=True,
            message=f"Successfully retrieved {len(workflows)} available workflows",
            data=workflows
        )
        
    except FileNotFoundError as e:
        logger.error(f"Workflow configuration file not found: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow configuration file not found"
        )
    except Exception as e:
        logger.error(f"Error retrieving workflows: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve workflows: {str(e)}"
        )


@router.get("/{workflow_id}", response_model=BaseResponse)
async def get_workflow_by_id(workflow_id: str) -> BaseResponse:
    """
    Get a specific workflow by its ID.
    
    Args:
        workflow_id: The workflow ID to retrieve
        
    Returns:
        BaseResponse: The workflow information
        
    Raises:
        HTTPException: If workflow is not found or there's an error
    """
    try:
        logger.info(f"API request: Get workflow by ID: {workflow_id}")
        
        workflow = await workflow_service.get_workflow_by_id(workflow_id)
        
        if not workflow:
            logger.warning(f"Workflow not found: {workflow_id}")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Workflow not found: {workflow_id}"
            )
        
        logger.info(f"Successfully retrieved workflow: {workflow.workflow_name}")
        
        return BaseResponse(
            success=True,
            message=f"Successfully retrieved workflow: {workflow.workflow_name}",
            data=workflow.dict()
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving workflow {workflow_id}: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve workflow: {str(e)}"
        )


@router.post("/execute", response_model=WorkflowExecutionResponse)
async def execute_workflow(request: WorkflowExecutionRequest) -> WorkflowExecutionResponse:
    """
    Execute a creative workflow with provided parameters.
    
    Args:
        request: Workflow execution request containing workflow ID and parameters
        
    Returns:
        WorkflowExecutionResponse: Execution result
        
    Raises:
        HTTPException: If workflow is not found or execution fails
    """
    try:
        logger.info(f"API request: Execute workflow {request.workflow_id} with {len(request.parameters)} parameters")
        
        # Validate workflow exists
        workflow = await workflow_service.get_workflow_by_id(request.workflow_id)
        if not workflow:
            logger.error(f"Workflow not found for execution: {request.workflow_id}")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Workflow not found: {request.workflow_id}"
            )
        
        # Validate parameters
        parameter_dict = {param.node_id: param.field_value for param in request.parameters}
        is_valid = await workflow_service.validate_workflow_parameters(
            request.workflow_id, 
            parameter_dict
        )
        
        if not is_valid:
            logger.error(f"Invalid parameters for workflow: {request.workflow_id}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid parameters for workflow execution"
            )
        
        # TODO: Implement actual workflow execution logic
        # For now, return a placeholder response
        logger.info(f"Workflow execution request validated for: {workflow.workflow_name}")
        logger.warning("Workflow execution logic not yet implemented - returning placeholder response")
        
        execution_result = {
            "workflow_id": request.workflow_id,
            "workflow_name": workflow.workflow_name,
            "status": "queued",
            "message": "Workflow execution has been queued (implementation pending)",
            "task_id": request.task_id,
            "parameters": parameter_dict,
            "timestamp": "2024-01-01T00:00:00Z"
        }
        
        return WorkflowExecutionResponse(
            success=True,
            message=f"Workflow {workflow.workflow_name} execution queued successfully",
            data=execution_result
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error executing workflow {request.workflow_id}: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to execute workflow: {str(e)}"
        )


@router.get("/health", response_model=BaseResponse)
async def workflow_health_check() -> BaseResponse:
    """
    Health check endpoint for workflow service.
    
    Returns:
        BaseResponse: Health status of workflow service
    """
    try:
        logger.info("API request: Workflow service health check")
        
        # Test loading workflows to verify service health
        workflows = await workflow_service.get_available_workflows()
        
        health_data = {
            "service": "workflow_service",
            "status": "healthy",
            "available_workflows": len(workflows),
            "config_path": str(workflow_service.config_path),
            "config_exists": workflow_service.config_path.exists()
        }
        
        logger.info(f"Workflow service health check passed: {len(workflows)} workflows available")
        
        return BaseResponse(
            success=True,
            message="Workflow service is healthy",
            data=health_data
        )
        
    except Exception as e:
        logger.error(f"Workflow service health check failed: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Workflow service is unhealthy: {str(e)}"
        )