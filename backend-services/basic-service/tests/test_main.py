"""
Tests for the main API endpoints of the Basic Service.
"""

import pytest
from fastapi.testclient import TestClient
from app.main import app


class TestMainEndpoints:
    """Test class for main API endpoints."""
    
    def test_root_endpoint(self, client: TestClient):
        """
        Test the root endpoint.
        
        Args:
            client: FastAPI test client
        """
        response = client.get("/")
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["success"] is True
        assert "message" in data
        assert "data" in data
        assert "name" in data["data"]
        assert "version" in data["data"]
        assert "endpoints" in data["data"]
    
    def test_health_check_endpoint(self, client: TestClient):
        """
        Test the health check endpoint.
        
        Args:
            client: FastAPI test client
        """
        response = client.get("/health")
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["success"] is True
        assert data["service_name"] == "Basic Service API"
        assert data["version"] == "1.0.0"
        assert data["status"] == "healthy"
        assert "uptime" in data
        assert "timestamp" in data
    
    def test_config_endpoint(self, client: TestClient):
        """
        Test the configuration endpoint.
        
        Args:
            client: FastAPI test client
        """
        response = client.get("/config")
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["success"] is True
        assert "data" in data
        
        config_data = data["data"]
        assert "app_name" in config_data
        assert "app_version" in config_data
        assert "log_level" in config_data
        assert "debug" in config_data
        
        # Ensure sensitive data is not exposed
        assert "llm_api_key" not in config_data
    
    def test_nonexistent_endpoint(self, client: TestClient):
        """
        Test accessing a non-existent endpoint.
        
        Args:
            client: FastAPI test client
        """
        response = client.get("/nonexistent")
        
        assert response.status_code == 404
        data = response.json()
        
        assert data["success"] is False
        assert "error_code" in data
    
    def test_response_headers(self, client: TestClient):
        """
        Test that response headers are properly set.
        
        Args:
            client: FastAPI test client
        """
        response = client.get("/")
        
        # Check for process time header
        assert "X-Process-Time" in response.headers
        
        # Ensure process time is a valid float
        process_time = float(response.headers["X-Process-Time"])
        assert process_time >= 0
    
    def test_cors_headers(self, client: TestClient):
        """
        Test CORS headers are properly set.
        
        Args:
            client: FastAPI test client
        """
        # Test preflight request
        response = client.options("/", headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET"
        })
        
        assert response.status_code == 200
        assert "access-control-allow-origin" in response.headers
    
    def test_api_documentation_endpoints(self, client: TestClient):
        """
        Test that API documentation endpoints are accessible.
        
        Args:
            client: FastAPI test client
        """
        # Test OpenAPI JSON
        response = client.get("/openapi.json")
        assert response.status_code == 200
        
        # Test Swagger UI
        response = client.get("/docs")
        assert response.status_code == 200
        
        # Test ReDoc
        response = client.get("/redoc")
        assert response.status_code == 200


class TestErrorHandling:
    """Test class for error handling."""
    
    def test_method_not_allowed(self, client: TestClient):
        """
        Test method not allowed error handling.
        
        Args:
            client: FastAPI test client
        """
        response = client.post("/")  # Root endpoint only accepts GET
        
        assert response.status_code == 405
        data = response.json()
        
        assert data["success"] is False
        assert "HTTP_405" in data["error_code"]


class TestResponseModels:
    """Test class for response model validation."""
    
    def test_base_response_structure(self, client: TestClient):
        """
        Test that all responses follow the BaseResponse structure.
        
        Args:
            client: FastAPI test client
        """
        response = client.get("/")
        data = response.json()
        
        # Check required BaseResponse fields
        required_fields = ["success", "message", "timestamp"]
        for field in required_fields:
            assert field in data
        
        # Check timestamp format
        from datetime import datetime
        timestamp = data["timestamp"]
        # Should be able to parse the timestamp
        datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    
    def test_health_response_structure(self, client: TestClient):
        """
        Test that health check response follows the HealthCheckResponse structure.
        
        Args:
            client: FastAPI test client
        """
        response = client.get("/health")
        data = response.json()
        
        # Check required HealthCheckResponse fields
        required_fields = ["service_name", "version", "status", "uptime"]
        for field in required_fields:
            assert field in data 