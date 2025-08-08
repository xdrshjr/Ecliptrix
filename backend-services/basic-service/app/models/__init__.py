"""
Data models for the Basic Service application.
"""

from .base_models import (
    BaseResponse,
    HealthCheckResponse,
    ErrorResponse
)

__all__ = [
    "BaseResponse",
    "HealthCheckResponse", 
    "ErrorResponse"
] 