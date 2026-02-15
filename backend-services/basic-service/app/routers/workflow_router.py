"""
Workflow management API routes for creative workflow operations.
"""

import json
from typing import List
from datetime import datetime
from fastapi import APIRouter, HTTPException, status, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db_session
from app.models.workflow_models import (
    WorkflowListResponse, 
    WorkflowInfo, 
    WorkflowExecutionRequest, 
    WorkflowExecutionResponse,
    SaveAgentWorkflowRequest,
    SaveAgentWorkflowResponse,
    LoadAgentWorkflowsResponse
)
from app.models import BaseResponse
from app.models.tavily_models import (
    TavilySearchRequest,
    TavilySearchResponse,
    NodeTestRequest,
    NodeTestResponse
)
from app.services.workflow_service import workflow_service
from app.services.runninghub_service import GeneralWorkflowService
from app.services.agent_workflow_service import agent_workflow_service
from app.services.tavily_search_service import tavily_search_service
from app.logger import get_logger

# Initialize router and logger
router = APIRouter(prefix="/workflow", tags=["workflow"])
logger = get_logger(__name__)

# Initialize RunningHub service
general_workflow_service = GeneralWorkflowService()


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
        
        # Execute workflow using RunningHub API
        logger.info(f"Executing workflow via RunningHub: {workflow.workflow_name}")
        
        # Log instance type if specified
        if workflow.instance_type:
            logger.info(f"Using instance type '{workflow.instance_type}' for workflow {workflow.workflow_name}")
        
        # Convert parameters to RunningHub format
        node_info_list = []
        for param in request.parameters:
            node_info_list.append({
                "nodeId": param.node_id,
                "fieldName": param.field_name,
                "fieldValue": param.field_value,
                "description": f"Parameter for node {param.node_id}"
            })
        
        # Debug: Log workflow execution details
        logger.debug(f"Workflow execution details:")
        logger.debug(f"  - Workflow ID: {request.workflow_id}")
        logger.debug(f"  - Workflow Name: {workflow.workflow_name}")
        logger.debug(f"  - Instance Type: {workflow.instance_type}")
        logger.debug(f"  - Task ID: {request.task_id}")
        logger.debug(f"  - Node Info List: {json.dumps(node_info_list, indent=2, ensure_ascii=False)}")
        
        # Create workflow task
        result = await general_workflow_service.create_workflow_task(
            workflow_id=request.workflow_id,
            node_info_list=node_info_list,
            task_id=request.task_id,
            instance_type=workflow.instance_type
        )
        
        if not result.get('success'):
            logger.error(f"Workflow execution failed: {result.get('error')}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Workflow execution failed: {result.get('error')}"
            )
        
        execution_result = {
            "workflow_id": request.workflow_id,
            "workflow_name": workflow.workflow_name,
            "status": result.get('status', 'RUNNING'),
            "message": result.get('message', 'Workflow execution started successfully'),
            "task_id": result.get('task_id'),
            "runninghub_task_id": result.get('runninghub_task_id'),
            "parameters": parameter_dict,
            "timestamp": datetime.now().isoformat(),
            "net_wss_url": result.get('net_wss_url'),
            "client_id": result.get('client_id')
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


@router.get("/status/{runninghub_task_id}", response_model=BaseResponse)
async def check_workflow_task_status(runninghub_task_id: str) -> BaseResponse:
    """
    Check the status of a workflow task by RunningHub task ID.
    
    Args:
        runninghub_task_id: The RunningHub task ID to check
        
    Returns:
        BaseResponse: Task status information
        
    Raises:
        HTTPException: If there's an error checking status
    """
    try:
        logger.info(f"API request: Check workflow task status: {runninghub_task_id}")
        
        result = await general_workflow_service.check_workflow_status(runninghub_task_id)
        
        if not result.get('success'):
            logger.error(f"Status check failed: {result.get('message')}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Status check failed: {result.get('message')}"
            )
        
        logger.info(f"Task status retrieved: {result.get('status')}")
        
        return BaseResponse(
            success=True,
            message=result.get('message', 'Status retrieved successfully'),
            data={
                'runninghub_task_id': runninghub_task_id,
                'status': result.get('status'),
                'task_id': result.get('task_id')
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error checking workflow task status {runninghub_task_id}: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to check task status: {str(e)}"
        )


@router.get("/results/{runninghub_task_id}", response_model=BaseResponse)
async def get_workflow_task_results(runninghub_task_id: str) -> BaseResponse:
    """
    Get the results of a completed workflow task by RunningHub task ID.
    
    Args:
        runninghub_task_id: The RunningHub task ID to get results for
        
    Returns:
        BaseResponse: Task results
        
    Raises:
        HTTPException: If there's an error retrieving results
    """
    try:
        logger.info(f"API request: Get workflow task results: {runninghub_task_id}")
        
        result = await general_workflow_service.get_workflow_results(runninghub_task_id)
        
        if not result.get('success'):
            logger.error(f"Results retrieval failed: {result.get('message')}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Results retrieval failed: {result.get('message')}"
            )
        
        logger.info(f"Task results retrieved: {len(result.get('results', []))} items")
        
        return BaseResponse(
            success=True,
            message=result.get('message', 'Results retrieved successfully'),
            data={
                'runninghub_task_id': runninghub_task_id,
                'status': result.get('status'),
                'results': result.get('results', []),
                'task_id': result.get('task_id')
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting workflow task results {runninghub_task_id}: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get task results: {str(e)}"
        )


# Agent Workflow Persistence Endpoints

@router.post("/agent/save", response_model=SaveAgentWorkflowResponse)
async def save_agent_workflow(
    request: SaveAgentWorkflowRequest,
    db: AsyncSession = Depends(get_db_session)
) -> SaveAgentWorkflowResponse:
    """
    Save an agent workflow to the database.
    
    Args:
        request: SaveAgentWorkflowRequest containing workflow data
        
    Returns:
        SaveAgentWorkflowResponse: Saved workflow data
        
    Raises:
        HTTPException: If there's an error saving the workflow
    """
    try:
        logger.info(f"API request: Save agent workflow", {
            "user_id": request.user_id,
            "workflow_id": request.workflow_id,
            "workflow_name": request.workflow_name,
            "nodes_count": len(request.nodes),
            "connections_count": len(request.connections)
        })
        
        # Save workflow using the service
        result = await agent_workflow_service.save_workflow(db=db, request=request)
        
        if not result.get('success'):
            logger.error(f"Failed to save workflow: {result.get('message')}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=result.get('message', 'Failed to save workflow')
            )
        
        logger.info(f"Agent workflow saved successfully", {
            "workflow_id": request.workflow_id,
            "workflow_name": request.workflow_name
        })
        
        return SaveAgentWorkflowResponse(
            success=True,
            message=result.get('message', 'Workflow saved successfully'),
            data=result['data']
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error saving agent workflow: {str(e)}", {
            "error_type": type(e).__name__,
            "workflow_id": request.workflow_id
        })
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save workflow: {str(e)}"
        )


@router.get("/agent/load/{user_id}", response_model=LoadAgentWorkflowsResponse)
async def load_agent_workflows(
    user_id: str,
    db: AsyncSession = Depends(get_db_session)
) -> LoadAgentWorkflowsResponse:
    """
    Load all agent workflows for a user.
    
    Args:
        user_id: User ID to load workflows for
        
    Returns:
        LoadAgentWorkflowsResponse: List of workflows
        
    Raises:
        HTTPException: If there's an error loading workflows
    """
    try:
        logger.info(f"API request: Load agent workflows for user: {user_id}")
        
        # Load workflows using the service
        result = await agent_workflow_service.load_workflows(db=db, user_id=user_id)
        
        if not result.get('success'):
            logger.error(f"Failed to load workflows: {result.get('message')}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=result.get('message', 'Failed to load workflows')
            )
        
        workflows_count = len(result.get('data', []))
        logger.info(f"Agent workflows loaded successfully", {
            "user_id": user_id,
            "workflows_count": workflows_count
        })
        
        return LoadAgentWorkflowsResponse(
            success=True,
            message=result.get('message', f'Successfully loaded {workflows_count} workflows'),
            data=result['data']
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error loading agent workflows: {str(e)}", {
            "error_type": type(e).__name__,
            "user_id": user_id
        })
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to load workflows: {str(e)}"
        )


@router.delete("/agent/delete/{user_id}/{workflow_id}", response_model=BaseResponse)
async def delete_agent_workflow(
    user_id: str,
    workflow_id: str,
    db: AsyncSession = Depends(get_db_session)
) -> BaseResponse:
    """
    Delete an agent workflow.
    
    Args:
        user_id: User ID who owns the workflow
        workflow_id: Workflow ID to delete
        
    Returns:
        BaseResponse: Deletion result
        
    Raises:
        HTTPException: If there's an error deleting the workflow
    """
    try:
        logger.info(f"API request: Delete agent workflow", {
            "user_id": user_id,
            "workflow_id": workflow_id
        })
        
        # Delete workflow using the service
        result = await agent_workflow_service.delete_workflow(db=db, user_id=user_id, workflow_id=workflow_id)
        
        if not result.get('success'):
            logger.error(f"Failed to delete workflow: {result.get('message')}")
            
            # Return 404 if workflow not found
            if result.get('error_code') == 'NOT_FOUND':
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=result.get('message', 'Workflow not found')
                )
            
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=result.get('message', 'Failed to delete workflow')
            )
        
        logger.info(f"Agent workflow deleted successfully", {
            "user_id": user_id,
            "workflow_id": workflow_id
        })
        
        return BaseResponse(
            success=True,
            message=result.get('message', 'Workflow deleted successfully'),
            data={'workflow_id': workflow_id}
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting agent workflow: {str(e)}", {
            "error_type": type(e).__name__,
            "user_id": user_id,
            "workflow_id": workflow_id
        })
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete workflow: {str(e)}"
        )


@router.post("/tavily-search", response_model=TavilySearchResponse)
async def tavily_search(request: TavilySearchRequest) -> TavilySearchResponse:
    """
    Perform a web search using Tavily AI-powered search API.
    
    Args:
        request: TavilySearchRequest containing search parameters
        
    Returns:
        TavilySearchResponse: Search results
        
    Raises:
        HTTPException: If there's an error performing the search
    """
    try:
        logger.info(f"API request: Tavily search", {
            "keywords": request.keywords,
            "count": request.count,
            "search_depth": request.search_depth
        })
        
        # Perform search using the service
        result = await tavily_search_service.search(
            query=request.keywords,
            max_results=request.count,
            search_depth=request.search_depth,
            include_images=request.include_images,
            include_answer=request.include_answer
        )
        
        if not result.get('success'):
            logger.error(f"Tavily search failed: {result.get('message')}")
            # Don't raise HTTPException, return the error in the response
            return TavilySearchResponse(**result)
        
        logger.info(f"Tavily search successful", {
            "query": request.keywords,
            "results_count": result.get('total_results', 0)
        })
        
        return TavilySearchResponse(**result)
        
    except Exception as e:
        logger.error(f"Error in Tavily search endpoint: {str(e)}", {
            "error_type": type(e).__name__,
            "keywords": request.keywords
        })
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to perform Tavily search: {str(e)}"
        )


@router.post("/test-node", response_model=NodeTestResponse)
async def test_node(request: NodeTestRequest) -> NodeTestResponse:
    """
    Test a single workflow node independently.
    
    Args:
        request: NodeTestRequest containing node details and input
        
    Returns:
        NodeTestResponse: Test results
        
    Raises:
        HTTPException: If there's an error testing the node
    """
    try:
        logger.info(f"API request: Test workflow node", {
            "node_id": request.node_id,
            "node_type": request.node_type,
            "node_label": request.node_label
        })
        
        # Handle different node types
        if request.node_type == 'tavily-search':
            # Extract keywords from input or config
            keywords = request.input.get('keywords') or request.input.get('text') or request.node_config.get('keywords', '')
            count = request.node_config.get('count', 5)
            
            logger.debug(f"Testing Tavily Search node with keywords: '{keywords}', count: {count}")
            
            if not keywords or not keywords.strip():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Keywords are required for Tavily Search node"
                )
            
            # Perform search
            result = await tavily_search_service.search(
                query=keywords,
                max_results=count
            )
            
            if not result.get('success'):
                return NodeTestResponse(
                    success=False,
                    message="Tavily search failed",
                    output={},
                    error=result.get('message', 'Unknown error')
                )
            
            output = {
                "results": result.get('results', []),
                "count": result.get('total_results', 0),
                "keywords": keywords
            }
            
            logger.info(f"Tavily Search node test successful", {
                "node_id": request.node_id,
                "results_count": output['count']
            })
            
            return NodeTestResponse(
                success=True,
                message=f"Found {output['count']} search results",
                output=output
            )
        
        elif request.node_type == 'pexels-video-search':
            # Handle pexels video search testing
            keywords = request.input.get('keywords') or request.input.get('text') or request.node_config.get('keywords', '')
            
            logger.info(f"Testing Pexels Video Search node (placeholder)")
            
            return NodeTestResponse(
                success=True,
                message="Pexels Video Search test completed",
                output={
                    "message": "Pexels Video Search testing not fully implemented yet",
                    "keywords": keywords
                }
            )
        
        else:
            # Generic node test (placeholder)
            logger.info(f"Testing generic node type: {request.node_type}")
            
            return NodeTestResponse(
                success=True,
                message=f"Node test completed for {request.node_type}",
                output={
                    "message": f"Generic test for {request.node_type}",
                    "input": request.input,
                    "config": request.node_config
                }
            )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error testing node: {str(e)}", {
            "error_type": type(e).__name__,
            "node_id": request.node_id,
            "node_type": request.node_type
        })
        return NodeTestResponse(
            success=False,
            message="Node test failed",
            output={},
            error=str(e)
        )