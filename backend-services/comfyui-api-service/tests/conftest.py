"""
Pytest configuration and shared fixtures for ComfyUI API Service tests.
"""

import pytest
import os
import sys
import tempfile
import shutil
from unittest.mock import Mock, patch
from fastapi.testclient import TestClient
from pathlib import Path

# Add the parent directory to sys.path to import the app
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.main import app
from app.config import settings
from app.models import ImageGenerationRequest, ImageInfo, GenerationStatus


@pytest.fixture(scope="session")
def test_client():
    """Create a test client for the FastAPI application."""
    client = TestClient(app)
    yield client


@pytest.fixture(scope="session") 
def temp_static_dir():
    """Create a temporary directory for static files during testing."""
    temp_dir = tempfile.mkdtemp()
    generated_dir = os.path.join(temp_dir, "generated")
    os.makedirs(generated_dir, exist_ok=True)
    
    # Patch the settings to use the temporary directory
    original_static_dir = settings.storage.static_dir
    original_generated_dir = settings.storage.generated_images_dir
    settings.storage.static_dir = temp_dir
    settings.storage.generated_images_dir = generated_dir
    
    yield temp_dir
    
    # Cleanup
    settings.storage.static_dir = original_static_dir
    settings.storage.generated_images_dir = original_generated_dir
    shutil.rmtree(temp_dir, ignore_errors=True)


@pytest.fixture
def sample_image_request():
    """Create a sample image generation request."""
    return ImageGenerationRequest(
        positive_prompt="A beautiful landscape with mountains and rivers",
        negative_prompt="low quality, blurry",
        width=512,
        height=512,
        steps=10,
        seed=42,
        cfg=1.0,
        guidance=3.5,
        checkpoint="flux1-dev-fp8.safetensors"
    )


@pytest.fixture
def sample_image_info():
    """Create a sample image info object."""
    return ImageInfo(
        filename="test_image.png",
        subfolder="",
        type="output",
        url="/static/generated/test_image.png",
        size_bytes=1024
    )


@pytest.fixture
def mock_comfyui_service():
    """Mock ComfyUI service for testing without external dependencies."""
    with patch('app.routers.comfyui_router.comfyui_service') as mock_service:
        # Configure default mock behaviors
        import asyncio
        mock_service.health_check.return_value = asyncio.Future()
        mock_service.health_check.return_value.set_result({
            "status": "healthy",
            "base_url": "http://localhost:8188",
            "response_time_ms": 100
        })
        mock_service.submit_workflow.return_value = asyncio.Future()
        mock_service.submit_workflow.return_value.set_result("test-prompt-id-123")
        mock_service.check_status.return_value = asyncio.Future()
        mock_service.check_status.return_value.set_result(True)
        mock_service.get_generated_images.return_value = asyncio.Future()
        mock_service.get_generated_images.return_value.set_result([
            ImageInfo(
                filename="test_image.png",
                subfolder="",
                type="output",
                url="/static/generated/test_image.png",
                size_bytes=1024
            )
        ])
        mock_service.download_image.return_value = asyncio.Future()
        mock_service.download_image.return_value.set_result("/path/to/test_image.png")
        mock_service.wait_for_completion.return_value = asyncio.Future()
        mock_service.wait_for_completion.return_value.set_result(GenerationStatus.COMPLETED)
        
        yield mock_service


@pytest.fixture
def mock_comfyui_service_unhealthy():
    """Mock ComfyUI service that reports unhealthy status."""
    with patch('app.routers.comfyui_router.comfyui_service') as mock_service:
        import asyncio
        mock_service.health_check.return_value = asyncio.Future()
        mock_service.health_check.return_value.set_result({
            "status": "unhealthy",
            "base_url": "http://localhost:8188",
            "error": "Connection refused"
        })
        yield mock_service


@pytest.fixture
def mock_comfyui_service_failure():
    """Mock ComfyUI service that simulates failures."""
    with patch('app.routers.comfyui_router.comfyui_service') as mock_service:
        import asyncio
        mock_service.health_check.side_effect = Exception("ComfyUI connection failed")
        mock_service.submit_workflow.return_value = asyncio.Future()
        mock_service.submit_workflow.return_value.set_result(None)
        mock_service.check_status.return_value = asyncio.Future()
        mock_service.check_status.return_value.set_result(False)
        mock_service.get_generated_images.return_value = asyncio.Future()
        mock_service.get_generated_images.return_value.set_result([])
        mock_service.download_image.return_value = asyncio.Future()
        mock_service.download_image.return_value.set_result(None)
        mock_service.wait_for_completion.return_value = asyncio.Future()
        mock_service.wait_for_completion.return_value.set_result(GenerationStatus.FAILED)
        
        yield mock_service


@pytest.fixture
def create_test_image_file(temp_static_dir):
    """Create a test image file in the temporary directory."""
    def _create_image(prompt_id: str = "test-prompt-123", filename: str = None):
        if filename is None:
            filename = f"{prompt_id}_test.png"
        
        file_path = os.path.join(temp_static_dir, "generated", filename)
        
        # Create a simple test file (not a real image, just for testing)
        with open(file_path, 'wb') as f:
            f.write(b"fake_image_data" * 100)  # Create some test data
        
        return file_path
    
    return _create_image


@pytest.fixture(autouse=True)
def clear_active_tasks():
    """Clear active tasks before each test."""
    from app.routers.comfyui_router import active_tasks
    active_tasks.clear()
    yield
    active_tasks.clear()


@pytest.fixture
def mock_requests():
    """Mock requests for external HTTP calls."""
    with patch('requests.Session') as mock_session:
        mock_response = Mock()
        mock_response.raise_for_status.return_value = None
        mock_response.json.return_value = {"status": "healthy"}
        mock_response.content = b"fake_image_data"
        mock_response.elapsed.total_seconds.return_value = 0.1
        
        mock_session.return_value.get.return_value = mock_response
        mock_session.return_value.post.return_value = mock_response
        
        yield mock_session


class TestLogger:
    """Test logger for capturing log messages during tests."""
    
    def __init__(self):
        self.messages = []
    
    def info(self, message):
        self.messages.append(("INFO", message))
    
    def debug(self, message):
        self.messages.append(("DEBUG", message))
    
    def warning(self, message):
        self.messages.append(("WARNING", message))
    
    def error(self, message):
        self.messages.append(("ERROR", message))
    
    def clear(self):
        self.messages.clear()
    
    def get_messages(self, level=None):
        if level:
            return [msg for lvl, msg in self.messages if lvl == level]
        return self.messages


@pytest.fixture
def test_logger():
    """Provide a test logger for capturing log messages."""
    return TestLogger()


@pytest.fixture
def mock_logger(test_logger):
    """Mock the application logger with test logger."""
    with patch('app.routers.comfyui_router.logger', test_logger):
        with patch('app.services.comfyui_service.logger', test_logger):
            yield test_logger 