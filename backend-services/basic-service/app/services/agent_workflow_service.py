"""
Agent Workflow Persistence Service for managing workflow storage.
"""

from typing import Optional, List, Dict, Any
from datetime import datetime
import json
import time

try:
    from supabase import create_client, Client
    SUPABASE_AVAILABLE = True
except ImportError:
    SUPABASE_AVAILABLE = False

from app.config import settings
from app.logger import get_logger
from app.models.workflow_models import (
    SaveAgentWorkflowRequest,
    AgentWorkflowRecord,
    WorkflowNode,
    WorkflowConnection
)

logger = get_logger(__name__)


class AgentWorkflowService:
    """Service for handling agent workflow persistence operations."""
    
    def __init__(self):
        """Initialize agent workflow service."""
        if not SUPABASE_AVAILABLE:
            logger.warning("Supabase client not available for agent workflow service")
            self.client = None
            return
            
        try:
            # Validate environment variables
            if not settings.supabase.url:
                raise ValueError("SUPABASE_URL environment variable is not set or empty")
            if not settings.supabase.anon_key:
                raise ValueError("SUPABASE_ANON_KEY environment variable is not set or empty")
            
            logger.info(f"Initializing Agent Workflow Service with Supabase URL: {settings.supabase.url[:50]}...")
            
            # Create Supabase client for database operations
            self.client: Optional[Client] = create_client(
                settings.supabase.url,
                settings.supabase.anon_key
            )
            
            logger.info("Agent Workflow Service initialized successfully")
            
        except Exception as e:
            logger.error(f"Agent Workflow Service initialization failed: {str(e)}")
            logger.error(f"Error type: {type(e).__name__}")
            self.client = None
    
    def _validate_client(self) -> bool:
        """Validate if Supabase client is available."""
        if not self.client:
            logger.error("Supabase client not available for agent workflow operations")
            return False
        return True
    
    def check_health(self) -> bool:
        """Check if the agent workflow service is healthy."""
        return self._validate_client()
    
    async def save_workflow(self, request: SaveAgentWorkflowRequest, max_retries: int = 3) -> Dict[str, Any]:
        """
        Save or update an agent workflow.
        
        Args:
            request: SaveAgentWorkflowRequest containing workflow data
            max_retries: Maximum number of retry attempts (default: 3)
            
        Returns:
            Dict containing saved workflow data or error
        """
        if not self._validate_client():
            logger.error("Agent workflow service not available for save operation")
            return {
                "success": False,
                "message": "Agent workflow service not available",
                "error_code": "SERVICE_UNAVAILABLE"
            }
        
        last_error = None
        
        for attempt in range(max_retries):
            try:
                logger.info(f"Saving agent workflow (attempt {attempt + 1}/{max_retries})", {
                    "user_id": request.user_id,
                    "workflow_id": request.workflow_id,
                    "workflow_name": request.workflow_name,
                    "nodes_count": len(request.nodes),
                    "connections_count": len(request.connections),
                    "timestamp": datetime.now().isoformat()
                })
                
                # Convert nodes and connections to JSON-serializable format
                nodes_json = [node.dict() for node in request.nodes]
                connections_json = [conn.dict() for conn in request.connections]
                
                logger.debug(f"Workflow data prepared for save: nodes={len(nodes_json)}, connections={len(connections_json)}")
                
                # Check if workflow already exists for this user
                existing_response = self.client.table('agent_workflows')\
                    .select('*')\
                    .eq('user_id', request.user_id)\
                    .eq('workflow_id', request.workflow_id)\
                    .eq('is_active', True)\
                    .execute()
                
                # Prepare workflow data - use direct arrays instead of JSON strings for JSONB columns
                workflow_data = {
                    'user_id': request.user_id,
                    'workflow_id': request.workflow_id,
                    'workflow_name': request.workflow_name,
                    'workflow_description': request.workflow_description,
                    'nodes': nodes_json,  # Pass as array, not JSON string
                    'connections': connections_json,  # Pass as array, not JSON string
                    'is_active': True,
                    'updated_at': datetime.now().isoformat()
                }
                
                if existing_response.data and len(existing_response.data) > 0:
                    # Update existing workflow
                    existing_workflow = existing_response.data[0]
                    logger.info(f"Updating existing workflow record", {
                        "record_id": existing_workflow['id'],
                        "workflow_id": request.workflow_id
                    })
                    
                    # Increment version
                    workflow_data['version'] = existing_workflow.get('version', 1) + 1
                    
                    response = self.client.table('agent_workflows')\
                        .update(workflow_data)\
                        .eq('id', existing_workflow['id'])\
                        .execute()
                    
                    logger.info(f"Workflow updated successfully", {
                        "workflow_id": request.workflow_id,
                        "version": workflow_data['version']
                    })
                else:
                    # Insert new workflow
                    logger.info(f"Creating new workflow record", {
                        "workflow_id": request.workflow_id
                    })
                    
                    workflow_data['created_at'] = datetime.now().isoformat()
                    workflow_data['version'] = 1
                    
                    response = self.client.table('agent_workflows')\
                        .insert(workflow_data)\
                        .execute()
                    
                    logger.info(f"Workflow created successfully", {
                        "workflow_id": request.workflow_id
                    })
                
                if not response.data:
                    logger.error(f"Failed to save workflow: no data returned from database")
                    return {
                        "success": False,
                        "message": "Failed to save workflow: no data returned",
                        "error_code": "SAVE_FAILED"
                    }
                
                # Parse the saved record
                saved_record = response.data[0]
                
                # Get nodes and connections (they're already arrays from JSONB)
                nodes_data = saved_record['nodes']
                connections_data = saved_record['connections']
                
                workflow_record = AgentWorkflowRecord(
                    id=saved_record['id'],
                    user_id=saved_record['user_id'],
                    workflow_id=saved_record['workflow_id'],
                    workflow_name=saved_record['workflow_name'],
                    workflow_description=saved_record.get('workflow_description'),
                    nodes=[WorkflowNode(**node) for node in nodes_data],
                    connections=[WorkflowConnection(**conn) for conn in connections_data],
                    is_active=saved_record['is_active'],
                    is_template=saved_record.get('is_template', False),
                    version=saved_record['version'],
                    created_at=saved_record['created_at'],
                    updated_at=saved_record['updated_at'],
                    last_executed_at=saved_record.get('last_executed_at')
                )
                
                logger.info(f"Workflow save operation completed successfully", {
                    "workflow_id": request.workflow_id,
                    "record_id": saved_record['id']
                })
                
                return {
                    "success": True,
                    "message": "Workflow saved successfully",
                    "data": workflow_record
                }
                
            except Exception as e:
                last_error = e
                error_msg = str(e)
                
                # Check if it's a connection error that we should retry
                if "10054" in error_msg or "connection" in error_msg.lower() or "timeout" in error_msg.lower():
                    logger.warning(f"Connection error on attempt {attempt + 1}/{max_retries}: {error_msg}")
                    
                    if attempt < max_retries - 1:
                        # Wait a bit before retrying (exponential backoff)
                        wait_time = 0.5 * (2 ** attempt)  # 0.5s, 1s, 2s
                        logger.info(f"Retrying in {wait_time}s...")
                        time.sleep(wait_time)
                        continue
                    else:
                        logger.error(f"All retry attempts failed for saving workflow")
                        return {
                            "success": False,
                            "message": f"Failed to save workflow after {max_retries} attempts: {error_msg}",
                            "error_code": "CONNECTION_ERROR",
                            "error": error_msg
                        }
                else:
                    # Non-connection error, log and return immediately
                    logger.error(f"Error saving agent workflow", {
                        "error": error_msg,
                        "error_type": type(e).__name__,
                        "workflow_id": request.workflow_id,
                        "user_id": request.user_id
                    })
                    return {
                        "success": False,
                        "message": f"Failed to save workflow: {error_msg}",
                        "error_code": "SAVE_ERROR",
                        "error": error_msg
                    }
    
    async def load_workflows(self, user_id: str, max_retries: int = 3) -> Dict[str, Any]:
        """
        Load all active workflows for a user.
        
        Args:
            user_id: User ID to load workflows for
            max_retries: Maximum number of retry attempts (default: 3)
            
        Returns:
            Dict containing list of workflows or error
        """
        if not self._validate_client():
            logger.error("Agent workflow service not available for load operation")
            return {
                "success": False,
                "message": "Agent workflow service not available",
                "error_code": "SERVICE_UNAVAILABLE"
            }
        
        last_error = None
        
        # Retry mechanism for network issues
        for attempt in range(max_retries):
            try:
                logger.info(f"Loading agent workflows for user (attempt {attempt + 1}/{max_retries})", {
                    "user_id": user_id,
                    "timestamp": datetime.now().isoformat()
                })
                
                # Query all active workflows for the user
                response = self.client.table('agent_workflows')\
                    .select('*')\
                    .eq('user_id', user_id)\
                    .eq('is_active', True)\
                    .order('updated_at', desc=True)\
                    .execute()
                
                # If we get here, the query succeeded
                break
                
            except Exception as e:
                last_error = e
                error_msg = str(e)
                
                # Check if it's a connection error that we should retry
                if "10054" in error_msg or "connection" in error_msg.lower() or "timeout" in error_msg.lower():
                    logger.warning(f"Connection error on attempt {attempt + 1}/{max_retries}: {error_msg}")
                    
                    if attempt < max_retries - 1:
                        # Wait a bit before retrying (exponential backoff)
                        wait_time = 0.5 * (2 ** attempt)  # 0.5s, 1s, 2s
                        logger.info(f"Retrying in {wait_time}s...")
                        time.sleep(wait_time)
                        continue
                    else:
                        logger.error(f"All retry attempts failed for loading workflows")
                        return {
                            "success": False,
                            "message": f"Failed to load workflows after {max_retries} attempts: {error_msg}",
                            "error_code": "CONNECTION_ERROR",
                            "error": error_msg
                        }
                else:
                    # Non-connection error, don't retry
                    raise
        
        try:
            
            if not response.data:
                logger.info(f"No workflows found for user", {
                    "user_id": user_id
                })
                return {
                    "success": True,
                    "message": "No workflows found",
                    "data": []
                }
            
            logger.info(f"Found {len(response.data)} workflows for user", {
                "user_id": user_id,
                "count": len(response.data)
            })
            
            # Parse workflow records
            workflows = []
            for record in response.data:
                try:
                    # Get nodes and connections (they're already arrays from JSONB)
                    nodes_data = record['nodes']
                    connections_data = record['connections']
                    
                    workflow_record = AgentWorkflowRecord(
                        id=record['id'],
                        user_id=record['user_id'],
                        workflow_id=record['workflow_id'],
                        workflow_name=record['workflow_name'],
                        workflow_description=record.get('workflow_description'),
                        nodes=[WorkflowNode(**node) for node in nodes_data],
                        connections=[WorkflowConnection(**conn) for conn in connections_data],
                        is_active=record['is_active'],
                        is_template=record.get('is_template', False),
                        version=record['version'],
                        created_at=record['created_at'],
                        updated_at=record['updated_at'],
                        last_executed_at=record.get('last_executed_at')
                    )
                    
                    workflows.append(workflow_record)
                    
                    logger.debug(f"Parsed workflow record", {
                        "workflow_id": record['workflow_id'],
                        "nodes_count": len(nodes_data),
                        "connections_count": len(connections_data)
                    })
                    
                except Exception as parse_error:
                    logger.error(f"Error parsing workflow record", {
                        "record_id": record.get('id'),
                        "error": str(parse_error)
                    })
                    # Continue with other records
                    continue
            
            logger.info(f"Successfully loaded {len(workflows)} workflows for user", {
                "user_id": user_id,
                "count": len(workflows)
            })
            
            return {
                "success": True,
                "message": f"Successfully loaded {len(workflows)} workflows",
                "data": workflows
            }
            
        except Exception as e:
            logger.error(f"Error loading agent workflows", {
                "error": str(e),
                "error_type": type(e).__name__,
                "user_id": user_id
            })
            return {
                "success": False,
                "message": f"Failed to load workflows: {str(e)}",
                "error_code": "LOAD_ERROR",
                "error": str(e)
            }
    
    async def delete_workflow(self, user_id: str, workflow_id: str) -> Dict[str, Any]:
        """
        Delete (soft delete) a workflow.
        
        Args:
            user_id: User ID who owns the workflow
            workflow_id: Workflow ID to delete
            
        Returns:
            Dict containing operation result
        """
        if not self._validate_client():
            logger.error("Agent workflow service not available for delete operation")
            return {
                "success": False,
                "message": "Agent workflow service not available",
                "error_code": "SERVICE_UNAVAILABLE"
            }
        
        try:
            logger.info(f"Deleting agent workflow", {
                "user_id": user_id,
                "workflow_id": workflow_id,
                "timestamp": datetime.now().isoformat()
            })
            
            # Soft delete by setting is_active to False
            response = self.client.table('agent_workflows')\
                .update({'is_active': False, 'updated_at': datetime.now().isoformat()})\
                .eq('user_id', user_id)\
                .eq('workflow_id', workflow_id)\
                .execute()
            
            if not response.data:
                logger.warning(f"Workflow not found for deletion", {
                    "user_id": user_id,
                    "workflow_id": workflow_id
                })
                return {
                    "success": False,
                    "message": "Workflow not found",
                    "error_code": "NOT_FOUND"
                }
            
            logger.info(f"Workflow deleted successfully", {
                "workflow_id": workflow_id,
                "user_id": user_id
            })
            
            return {
                "success": True,
                "message": "Workflow deleted successfully"
            }
            
        except Exception as e:
            logger.error(f"Error deleting agent workflow", {
                "error": str(e),
                "error_type": type(e).__name__,
                "workflow_id": workflow_id,
                "user_id": user_id
            })
            return {
                "success": False,
                "message": f"Failed to delete workflow: {str(e)}",
                "error_code": "DELETE_ERROR",
                "error": str(e)
            }


# Global service instance
agent_workflow_service = AgentWorkflowService()

