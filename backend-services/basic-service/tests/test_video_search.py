"""
Tests for video search functionality.
"""

import pytest
from unittest.mock import Mock, patch, MagicMock
from fastapi.testclient import TestClient
from app.main import app
from app.services.video_search_service import VideoSearchService
from app.models.video_models import VideoSearchRequest, VideoSearchResponse, VideoInfo


@pytest.fixture
def client():
    """Test client fixture."""
    return TestClient(app)


@pytest.fixture
def mock_pexels_response():
    """Mock PEXELS API response."""
    return {
        "videos": [
            {
                "id": 12345,
                "user": {"name": "Test User"},
                "duration": 30,
                "video_files": [
                    {
                        "id": 1,
                        "quality": "hd",
                        "file_type": "video/mp4",
                        "width": 1280,
                        "height": 720,
                        "link": "https://example.com/video.mp4"
                    }
                ],
                "video_pictures": [
                    {
                        "id": 1,
                        "picture": "https://example.com/thumbnail.jpg"
                    }
                ]
            }
        ]
    }


class TestVideoSearchService:
    """Test cases for VideoSearchService."""
    
    def test_init_with_api_keys(self):
        """Test service initialization with API keys."""
        with patch('app.services.video_search_service.settings') as mock_settings:
            mock_settings.pexels_api_keys = ["key1", "key2"]
            service = VideoSearchService()
            assert service.api_keys == ["key1", "key2"]
    
    def test_init_without_api_keys(self):
        """Test service initialization without API keys."""
        with patch('app.services.video_search_service.settings') as mock_settings:
            mock_settings.pexels_api_keys = []
            service = VideoSearchService()
            assert service.api_keys == []
    
    def test_get_random_api_key_success(self):
        """Test successful API key selection."""
        with patch('app.services.video_search_service.settings') as mock_settings:
            mock_settings.pexels_api_keys = ["key1", "key2", "key3"]
            service = VideoSearchService()
            api_key = service._get_random_api_key()
            assert api_key in ["key1", "key2", "key3"]
    
    def test_get_random_api_key_no_keys(self):
        """Test API key selection with no keys available."""
        with patch('app.services.video_search_service.settings') as mock_settings:
            mock_settings.pexels_api_keys = []
            service = VideoSearchService()
            api_key = service._get_random_api_key()
            assert api_key is None
    
    def test_is_landscape_video(self):
        """Test landscape video detection."""
        with patch('app.services.video_search_service.settings') as mock_settings:
            mock_settings.pexels_api_keys = ["key1"]
            service = VideoSearchService()
            
            assert service._is_landscape_video(1920, 1080) is True
            assert service._is_landscape_video(1080, 1920) is False
            assert service._is_landscape_video(1080, 1080) is False
    
    def test_select_video_file_hd_preferred(self):
        """Test video file selection prefers HD quality."""
        with patch('app.services.video_search_service.settings') as mock_settings:
            mock_settings.pexels_api_keys = ["key1"]
            service = VideoSearchService()
            
            video_files = [
                {"width": 640, "height": 360, "quality": "sd"},
                {"width": 1280, "height": 720, "quality": "hd"},
                {"width": 1920, "height": 1080, "quality": "full_hd"}
            ]
            
            selected = service._select_video_file(video_files)
            assert selected["quality"] == "hd"
            assert selected["width"] == 1280
    
    def test_select_video_file_sd_fallback(self):
        """Test video file selection falls back to SD quality."""
        with patch('app.services.video_search_service.settings') as mock_settings:
            mock_settings.pexels_api_keys = ["key1"]
            service = VideoSearchService()
            
            video_files = [
                {"width": 640, "height": 360, "quality": "sd"},
                {"width": 1920, "height": 1080, "quality": "full_hd"}
            ]
            
            selected = service._select_video_file(video_files)
            assert selected["quality"] == "sd"
            assert selected["width"] == 640
    
    def test_select_video_file_empty_list(self):
        """Test video file selection with empty list."""
        with patch('app.services.video_search_service.settings') as mock_settings:
            mock_settings.pexels_api_keys = ["key1"]
            service = VideoSearchService()
            
            selected = service._select_video_file([])
            assert selected is None
    
    def test_filter_by_orientation_mixed(self):
        """Test orientation filtering with mixed setting."""
        with patch('app.services.video_search_service.settings') as mock_settings:
            mock_settings.pexels_api_keys = ["key1"]
            service = VideoSearchService()
            
            videos = [{"id": 1}, {"id": 2}]
            filtered = service._filter_by_orientation(videos, "mixed")
            assert len(filtered) == 2
    
    @patch('requests.get')
    def test_make_api_request_success(self, mock_get, mock_pexels_response):
        """Test successful API request."""
        with patch('app.services.video_search_service.settings') as mock_settings:
            mock_settings.pexels_api_keys = ["test_key"]
            service = VideoSearchService()
            
            mock_response = Mock()
            mock_response.status_code = 200
            mock_response.json.return_value = mock_pexels_response
            mock_response.raise_for_status.return_value = None
            mock_get.return_value = mock_response
            
            result = service._make_api_request("test query", 10)
            assert result == mock_pexels_response
    
    @patch('requests.get')
    def test_make_api_request_retry_success(self, mock_get, mock_pexels_response):
        """Test API request with successful retry."""
        with patch('app.services.video_search_service.settings') as mock_settings:
            mock_settings.pexels_api_keys = ["key1", "key2"]
            service = VideoSearchService()
            
            # First request fails, second succeeds
            mock_response_fail = Mock()
            mock_response_fail.status_code = 429
            
            mock_response_success = Mock()
            mock_response_success.status_code = 200
            mock_response_success.json.return_value = mock_pexels_response
            mock_response_success.raise_for_status.return_value = None
            
            mock_get.side_effect = [mock_response_fail, mock_response_success]
            
            result = service._make_api_request("test query", 10)
            assert result == mock_pexels_response
    
    @patch('requests.get')
    def test_make_api_request_failure(self, mock_get):
        """Test API request failure."""
        with patch('app.services.video_search_service.settings') as mock_settings:
            mock_settings.pexels_api_keys = ["test_key"]
            service = VideoSearchService()
            
            mock_get.side_effect = Exception("Network error")
            
            result = service._make_api_request("test query", 10)
            assert result is None
    
    @patch('app.services.video_search_service.VideoSearchService._make_api_request')
    def test_search_videos_success(self, mock_api_request, mock_pexels_response):
        """Test successful video search."""
        with patch('app.services.video_search_service.settings') as mock_settings:
            mock_settings.pexels_api_keys = ["test_key"]
            service = VideoSearchService()
            
            mock_api_request.return_value = mock_pexels_response
            
            result = service.search_videos("nature", 10, "mixed")
            
            assert result.success is True
            assert len(result.videos) == 1
            assert result.videos[0].id == 12345
            assert result.videos[0].author == "Test User"
            assert result.total_found == 1
    
    def test_search_videos_no_api_keys(self):
        """Test video search without API keys."""
        with patch('app.services.video_search_service.settings') as mock_settings:
            mock_settings.pexels_api_keys = []
            service = VideoSearchService()
            
            result = service.search_videos("nature", 10, "mixed")
            
            assert result.success is False
            assert "API keys not configured" in result.message
            assert len(result.videos) == 0
    
    @patch('app.services.video_search_service.VideoSearchService._make_api_request')
    def test_search_videos_api_failure(self, mock_api_request):
        """Test video search with API failure."""
        with patch('app.services.video_search_service.settings') as mock_settings:
            mock_settings.pexels_api_keys = ["test_key"]
            service = VideoSearchService()
            
            mock_api_request.return_value = None
            
            result = service.search_videos("nature", 10, "mixed")
            
            assert result.success is False
            assert "Failed to fetch data" in result.message
            assert len(result.videos) == 0
    
    @patch('app.services.video_search_service.VideoSearchService._make_api_request')
    def test_search_videos_no_results(self, mock_api_request):
        """Test video search with no results."""
        with patch('app.services.video_search_service.settings') as mock_settings:
            mock_settings.pexels_api_keys = ["test_key"]
            service = VideoSearchService()
            
            mock_api_request.return_value = {"videos": []}
            
            result = service.search_videos("nonexistent", 10, "mixed")
            
            assert result.success is True
            assert "No videos found" in result.message
            assert len(result.videos) == 0


class TestVideoSearchAPI:
    """Test cases for Video Search API endpoints."""
    
    def test_search_videos_valid_request(self, client):
        """Test video search endpoint with valid request."""
        with patch('app.routers.video_router.video_search_service') as mock_service:
            mock_response = VideoSearchResponse(
                success=True,
                message="Found 1 video",
                videos=[
                    VideoInfo(
                        id=12345,
                        title="Test Video",
                        author="Test User",
                        duration=30,
                        video_url="https://example.com/video.mp4",
                        thumbnail="https://example.com/thumb.jpg",
                        width=1280,
                        height=720
                    )
                ],
                total_found=1,
                query="nature"
            )
            mock_service.search_videos.return_value = mock_response
            
            response = client.post("/video/search", json={
                "query": "nature",
                "max_videos": 10,
                "orientation": "mixed"
            })
            
            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert len(data["videos"]) == 1
            assert data["videos"][0]["id"] == 12345
    
    def test_search_videos_empty_query(self, client):
        """Test video search endpoint with empty query."""
        response = client.post("/video/search", json={
            "query": "",
            "max_videos": 10,
            "orientation": "mixed"
        })
        
        assert response.status_code == 400
        assert "Search query cannot be empty" in response.json()["detail"]
    
    def test_search_videos_invalid_orientation(self, client):
        """Test video search endpoint with invalid orientation."""
        response = client.post("/video/search", json={
            "query": "nature",
            "max_videos": 10,
            "orientation": "invalid"
        })
        
        assert response.status_code == 400
        assert "Orientation must be one of" in response.json()["detail"]
    
    def test_search_videos_service_error(self, client):
        """Test video search endpoint with service error."""
        with patch('app.routers.video_router.video_search_service') as mock_service:
            mock_service.search_videos.side_effect = Exception("Service error")
            
            response = client.post("/video/search", json={
                "query": "nature",
                "max_videos": 10,
                "orientation": "mixed"
            })
            
            assert response.status_code == 500
            assert "Internal server error" in response.json()["detail"]
    
    def test_video_search_health_healthy(self, client):
        """Test video search health endpoint when service is healthy."""
        with patch('app.routers.video_router.video_search_service') as mock_service:
            mock_service.api_keys = ["key1", "key2"]
            
            response = client.get("/video/search/health")
            
            assert response.status_code == 200
            data = response.json()
            assert data["service"] == "video_search"
            assert data["status"] == "healthy"
            assert data["api_keys_configured"] is True
            assert data["api_keys_count"] == 2
    
    def test_video_search_health_degraded(self, client):
        """Test video search health endpoint when service is degraded."""
        with patch('app.routers.video_router.video_search_service') as mock_service:
            mock_service.api_keys = []
            
            response = client.get("/video/search/health")
            
            assert response.status_code == 200
            data = response.json()
            assert data["service"] == "video_search"
            assert data["status"] == "degraded"
            assert data["api_keys_configured"] is False
            assert data["api_keys_count"] == 0


class TestVideoSearchModels:
    """Test cases for video search data models."""
    
    def test_video_search_request_valid(self):
        """Test valid video search request model."""
        request = VideoSearchRequest(
            query="nature landscape",
            max_videos=20,
            orientation="mixed"
        )
        
        assert request.query == "nature landscape"
        assert request.max_videos == 20
        assert request.orientation == "mixed"
    
    def test_video_search_request_defaults(self):
        """Test video search request model with defaults."""
        request = VideoSearchRequest(query="nature")
        
        assert request.query == "nature"
        assert request.max_videos == 20
        assert request.orientation == "mixed"
    
    def test_video_info_model(self):
        """Test video info model."""
        video = VideoInfo(
            id=12345,
            title="Test Video",
            author="Test User",
            duration=30,
            video_url="https://example.com/video.mp4",
            thumbnail="https://example.com/thumb.jpg",
            width=1280,
            height=720
        )
        
        assert video.id == 12345
        assert video.title == "Test Video"
        assert video.author == "Test User"
        assert video.duration == 30
        assert video.width == 1280
        assert video.height == 720
    
    def test_video_search_response_model(self):
        """Test video search response model."""
        video = VideoInfo(
            id=12345,
            title="Test Video",
            author="Test User",
            video_url="https://example.com/video.mp4",
            thumbnail="https://example.com/thumb.jpg",
            width=1280,
            height=720
        )
        
        response = VideoSearchResponse(
            success=True,
            message="Found 1 video",
            videos=[video],
            total_found=1,
            query="nature"
        )
        
        assert response.success is True
        assert response.message == "Found 1 video"
        assert len(response.videos) == 1
        assert response.total_found == 1
        assert response.query == "nature" 