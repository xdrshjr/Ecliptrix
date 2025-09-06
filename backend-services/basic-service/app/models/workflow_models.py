"""
Workflow-related data models for the Basic Service application.
"""

from typing import List, Optional, Any, Dict
from pydantic import BaseModel, Field
from app.models import BaseResponse


class WorkflowNodeInfo(BaseModel):
    """
    Model for workflow node information containing parameter definitions.
    """
    node_id: str = Field(..., alias="nodeId", description="Node identifier in the workflow")
    field_name: str = Field(..., alias="fieldName", description="Field name for the parameter")
    field_value: Any = Field(..., alias="fieldValue", description="Default value for the parameter")
    description: str = Field(..., description="Human-readable description of the parameter")

    class Config:
        populate_by_name = True
        allow_population_by_field_name = True


class WorkflowInfo(BaseModel):
    """
    Model for workflow information.
    """
    workflow_name: str = Field(..., alias="workflowName", description="Internal workflow name")
    workflow_type: str = Field(..., alias="workflowType", description="Type of workflow (e.g., TEXT-2-VIDEO)")
    show_name_ch: str = Field(..., alias="showNameCh", description="Chinese display name")
    show_name_en: str = Field(..., alias="showNameEn", description="English display name")
    workflow_id: str = Field(..., alias="workflowId", description="Unique workflow identifier")
    description: str = Field(..., description="Workflow description")
    icon: str = Field(..., description="URL to workflow icon/thumbnail")
    node_info_list: List[WorkflowNodeInfo] = Field(..., alias="nodeInfoList", description="List of workflow parameters")

    class Config:
        populate_by_name = True
        allow_population_by_field_name = True


class WorkflowListResponse(BaseResponse):
    """
    Response model for workflow list endpoint.
    """
    data: List[WorkflowInfo] = Field(..., description="List of available workflows")


class WorkflowParameter(BaseModel):
    """
    Model for workflow parameter input.
    """
    node_id: str = Field(..., description="Node identifier")
    field_name: str = Field(..., description="Field name")
    field_value: Any = Field(..., description="Parameter value")


class WorkflowExecutionRequest(BaseModel):
    """
    Request model for workflow execution.
    """
    workflow_id: str = Field(..., description="Workflow identifier to execute")
    parameters: List[WorkflowParameter] = Field(..., description="List of parameters for the workflow")
    task_id: Optional[str] = Field(None, description="Optional task identifier for tracking")


class WorkflowExecutionResponse(BaseResponse):
    """
    Response model for workflow execution.
    """
    data: Dict[str, Any] = Field(..., description="Execution result data")