"""
Workflow-related data models for the Basic Service application.
"""

from typing import List, Optional, Any, Dict
from pydantic import BaseModel, Field
from app.models import BaseResponse


# Agent Workflow Persistence Models

class WorkflowNodePosition(BaseModel):
    """
    Model for workflow node position.
    """
    x: float = Field(..., description="X coordinate of the node")
    y: float = Field(..., description="Y coordinate of the node")


class WorkflowNodeData(BaseModel):
    """
    Model for workflow node data.
    """
    label: str = Field(..., description="Node label")
    type: str = Field(..., description="Node type")
    inputs: Optional[Dict[str, Any]] = Field(None, description="Node inputs")
    outputs: Optional[Dict[str, Any]] = Field(None, description="Node outputs")
    config: Optional[Dict[str, Any]] = Field(None, description="Node configuration")


class WorkflowNode(BaseModel):
    """
    Model for a workflow node.
    """
    id: str = Field(..., description="Node ID")
    type: str = Field(..., description="Node type (start, end, chat-llm, text-input, etc.)")
    position: WorkflowNodePosition = Field(..., description="Node position on canvas")
    data: WorkflowNodeData = Field(..., description="Node data")


class WorkflowConnection(BaseModel):
    """
    Model for a workflow connection between nodes.
    """
    id: str = Field(..., description="Connection ID")
    source: str = Field(..., description="Source node ID")
    target: str = Field(..., description="Target node ID")
    sourceHandle: Optional[str] = Field(None, description="Source port handle")
    targetHandle: Optional[str] = Field(None, description="Target port handle")


class AgentWorkflowData(BaseModel):
    """
    Model for agent workflow complete data.
    """
    name: str = Field(..., description="Workflow name")
    description: Optional[str] = Field(None, description="Workflow description")
    nodes: List[WorkflowNode] = Field(default_factory=list, description="List of workflow nodes")
    connections: List[WorkflowConnection] = Field(default_factory=list, description="List of workflow connections")


class SaveAgentWorkflowRequest(BaseModel):
    """
    Request model for saving an agent workflow.
    """
    user_id: str = Field(..., description="User ID who owns this workflow")
    workflow_id: str = Field(..., description="Workflow ID (unique identifier)")
    workflow_name: str = Field(..., description="Workflow name")
    workflow_description: Optional[str] = Field(None, description="Workflow description")
    nodes: List[WorkflowNode] = Field(..., description="List of workflow nodes")
    connections: List[WorkflowConnection] = Field(..., description="List of workflow connections")


class AgentWorkflowRecord(BaseModel):
    """
    Model for agent workflow record from database.
    """
    id: str = Field(..., description="Database record ID")
    user_id: str = Field(..., description="User ID")
    workflow_id: str = Field(..., description="Workflow ID")
    workflow_name: str = Field(..., description="Workflow name")
    workflow_description: Optional[str] = Field(None, description="Workflow description")
    nodes: List[WorkflowNode] = Field(..., description="List of workflow nodes")
    connections: List[WorkflowConnection] = Field(..., description="List of workflow connections")
    is_active: bool = Field(True, description="Whether workflow is active")
    is_template: bool = Field(False, description="Whether workflow is a template")
    version: int = Field(1, description="Workflow version")
    created_at: str = Field(..., description="Creation timestamp")
    updated_at: str = Field(..., description="Last update timestamp")
    last_executed_at: Optional[str] = Field(None, description="Last execution timestamp")


class LoadAgentWorkflowsResponse(BaseResponse):
    """
    Response model for loading agent workflows.
    """
    data: List[AgentWorkflowRecord] = Field(..., description="List of agent workflows")


class SaveAgentWorkflowResponse(BaseResponse):
    """
    Response model for saving agent workflow.
    """
    data: AgentWorkflowRecord = Field(..., description="Saved workflow data")