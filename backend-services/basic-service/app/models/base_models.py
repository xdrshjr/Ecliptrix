"""
Base data models for the Basic Service application.
"""

from typing import Any, Optional, Dict
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict, field_serializer


class BaseResponse(BaseModel):
    """Base response model for all API responses."""
    
    success: bool = Field(description="Whether the request was successful")
    message: str = Field(description="Response message")
    timestamp: datetime = Field(default_factory=datetime.now, description="Response timestamp")
    data: Optional[Any] = Field(default=None, description="Response data")
    
    @field_serializer('timestamp')
    def serialize_timestamp(self, value: datetime) -> str:
        """Serialize datetime to ISO format string."""
        return value.isoformat()


class HealthCheckResponse(BaseResponse):
    """Health check response model."""
    
    service_name: str = Field(description="Service name")
    version: str = Field(description="Service version")
    status: str = Field(description="Service status")
    uptime: Optional[str] = Field(default=None, description="Service uptime")


class ErrorResponse(BaseResponse):
    """Error response model."""
    
    error_code: Optional[str] = Field(default=None, description="Error code")
    error_details: Optional[Dict[str, Any]] = Field(default=None, description="Error details")
    
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "success": False,
                "message": "An error occurred",
                "timestamp": "2023-12-01T12:00:00",
                "error_code": "INTERNAL_ERROR",
                "error_details": {
                    "detail": "Internal server error occurred"
                }
            }
        }
    ) 