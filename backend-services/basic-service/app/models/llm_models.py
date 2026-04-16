"""
LLM configuration models for Chat LLM node configuration.
"""

from typing import List, Optional
from pydantic import BaseModel, Field


class LLMModelInfo(BaseModel):
    """LLM model information."""
    id: str = Field(..., description="Model identifier (e.g., 'agent_llm_01')")
    name: str = Field(..., description="Model name (e.g., 'deepseek-v3')")
    api_url: str = Field(..., description="API base URL")
    api_key: str = Field(..., description="API key (masked for security)")
    display_name: str = Field(..., description="User-friendly display name")
    description: Optional[str] = Field(None, description="Model description")
    api_type: str = Field(
        default="openai",
        description="API protocol: 'openai' (default) or 'anthropic'",
    )


class LLMModelsResponse(BaseModel):
    """Response model for LLM models list."""
    success: bool = Field(True, description="Whether the request was successful")
    message: str = Field(..., description="Response message")
    models: List[LLMModelInfo] = Field(..., description="List of available LLM models")
    total_count: int = Field(..., description="Total number of models")

