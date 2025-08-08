"""
Pytest configuration and fixtures for the Basic Service tests.
"""

import pytest
from fastapi.testclient import TestClient
from app.main import app


@pytest.fixture
def client():
    """
    Create a test client for the FastAPI application.
    
    Returns:
        TestClient: FastAPI test client
    """
    return TestClient(app)


@pytest.fixture
def sample_api_response():
    """
    Sample API response data for testing.
    
    Returns:
        dict: Sample response data
    """
    return {
        "success": True,
        "message": "Test response",
        "data": {"test": "data"}
    }


@pytest.fixture
def sample_error_response():
    """
    Sample error response data for testing.
    
    Returns:
        dict: Sample error response data
    """
    return {
        "success": False,
        "message": "Test error",
        "error_code": "TEST_ERROR",
        "error_details": {"detail": "Test error details"}
    } 