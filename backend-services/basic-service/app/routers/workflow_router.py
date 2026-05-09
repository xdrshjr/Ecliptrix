"""
Workflow management API routes for creative workflow operations.
"""

from typing import List
from fastapi import APIRouter, HTTPException, status, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db_session
from app.models.workflow_models import (
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
from app.services.agent_workflow_service import agent_workflow_service
from app.services.tavily_search_service import tavily_search_service
from app.logger import get_logger

# Initialize router and logger
router = APIRouter(prefix="/workflow", tags=["workflow"])
logger = get_logger(__name__)


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
            detail="Failed to save workflow"
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
            detail="Failed to load workflows"
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
            detail="Failed to delete workflow"
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