"""
Workflow-related data models for the Basic Service application.
"""

from typing import List, Optional, Any, Dict
from pydantic import BaseModel, Field
from app.models import BaseResponse


class UIConfigOption(BaseModel):
    """
    Model for UI configuration option.
    """
    label: str = Field(..., description="Display label for the option")
    value: Any = Field(..., description="Actual value for the option")
    description: Optional[str] = Field(None, description="Optional description for the option")
    default: Optional[bool] = Field(False, description="Whether this is the default option")


class UIConfigValidation(BaseModel):
    """
    Model for UI configuration validation rules.
    """
    required: Optional[bool] = Field(None, description="Whether the field is required")
    min: Optional[float] = Field(None, description="Minimum value for numeric inputs")
    max: Optional[float] = Field(None, description="Maximum value for numeric inputs")
    step: Optional[float] = Field(None, description="Step value for numeric inputs")
    pattern: Optional[str] = Field(None, description="Regex pattern for validation")
    min_length: Optional[int] = Field(None, alias="minLength", description="Minimum length for text inputs")
    max_length: Optional[int] = Field(None, alias="maxLength", description="Maximum length for text inputs")

    class Config:
        populate_by_name = True
        allow_population_by_field_name = True


class UIConfig(BaseModel):
    """
    Model for UI configuration of workflow parameters.
    """
    input_type: Optional[str] = Field(None, alias="inputType", description="Type of input component (select, number, text, textarea, slider, toggle)")
    options: Optional[List[UIConfigOption]] = Field(None, description="Available options for select inputs")
    validation: Optional[UIConfigValidation] = Field(None, description="Validation rules for the input")
    placeholder: Optional[str] = Field(None, description="Placeholder text for the input")
    help_text: Optional[str] = Field(None, alias="helpText", description="Help text to guide users")
    default_value: Optional[Any] = Field(None, alias="defaultValue", description="Default value for the input")

    class Config:
        populate_by_name = True
        allow_population_by_field_name = True


class WorkflowNodeInfo(BaseModel):
    """
    Model for workflow node information containing parameter definitions.
    """
    node_id: str = Field(..., alias="nodeId", description="Node identifier in the workflow")
    field_name: str = Field(..., alias="fieldName", description="Field name for the parameter")
    field_value: Any = Field(..., alias="fieldValue", description="Default value for the parameter")
    description: str = Field(..., description="Human-readable description of the parameter")
    ui_config: Optional[UIConfig] = Field(None, alias="uiConfig", description="UI configuration for frontend rendering")

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
    instance_type: Optional[str] = Field(None, alias="instanceType", description="RunningHub instance type (e.g., 'plus')")
    need_upload_img: Optional[str] = Field(None, alias="needUploadImg", description="Whether image upload is required (True/False)")
    need_upload_video: Optional[str] = Field(None, alias="needUploadVideo", description="Whether video upload is required (True/False)")
    need_upload_audio: Optional[str] = Field(None, alias="needUploadAudio", description="Whether audio upload is required (True/False)")

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