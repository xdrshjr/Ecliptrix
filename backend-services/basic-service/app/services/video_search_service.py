"""
Video search service for PEXELS API integration.
"""

import requests
import random
from typing import List, Dict, Any, Optional
from app.config import settings
from app.logger import get_logger
from app.models.video_models import VideoInfo, VideoSearchResponse

logger = get_logger(__name__)


class VideoSearchService:
    """Service for searching videos using PEXELS API."""
    
    def __init__(self):
        """Initialize the video search service."""
        self.api_keys = settings.pexels_api_keys
        self.base_url = "https://api.pexels.com/videos/search"
        
        if not self.api_keys:
            logger.warning("No PEXELS API keys configured. Video search will not work.")
        else:
            logger.info(f"VideoSearchService initialized with {len(self.api_keys)} API keys")
    
    def _get_random_api_key(self) -> Optional[str]:
        """
        Get a random API key from the configured keys.
        
        Returns:
            Optional[str]: Random API key or None if no keys available
        """
        if not self.api_keys:
            logger.error("No PEXELS API keys available")
            return None
        
        api_key = random.choice(self.api_keys)
        logger.debug(f"Selected API key: {api_key[:10]}...{api_key[-5:]}")
        return api_key
    
    def _is_landscape_video(self, width: int, height: int) -> bool:
        """
        Check if video is landscape orientation.
        
        Args:
            width: Video width in pixels
            height: Video height in pixels
            
        Returns:
            bool: True if landscape, False if portrait
        """
        return width > height
    
    def _select_video_file(self, video_files: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """
        Select the best quality video file from available options.
        
        Args:
            video_files: List of video file options
            
        Returns:
            Optional[Dict[str, Any]]: Selected video file or None
        """
        if not video_files:
            return None
        
        # Prefer HD (1280x720) quality
        hd_files = [f for f in video_files if f.get("width") == 1280 and f.get("height") == 720]
        if hd_files:
            logger.debug("Selected HD quality video file")
            return hd_files[0]
        
        # Fallback to SD (640x360) quality
        sd_files = [f for f in video_files if f.get("width") == 640 and f.get("height") == 360]
        if sd_files:
            logger.debug("Selected SD quality video file")
            return sd_files[0]
        
        # Select medium quality file
        video_files.sort(key=lambda x: x.get("width", 0) * x.get("height", 0))
        mid_index = len(video_files) // 2
        logger.debug("Selected medium quality video file")
        return video_files[mid_index]
    
    def _filter_by_orientation(self, videos: List[Dict[str, Any]], orientation: str) -> List[Dict[str, Any]]:
        """
        Filter videos by orientation.
        
        Args:
            videos: List of video data
            orientation: Orientation filter ('landscape', 'portrait', 'mixed')
            
        Returns:
            List[Dict[str, Any]]: Filtered videos
        """
        if orientation == 'mixed':
            return videos
        
        filtered_videos = []
        for video in videos:
            video_files = video.get("video_files", [])
            if not video_files:
                continue
            
            video_file = self._select_video_file(video_files)
            if not video_file:
                continue
            
            width = video_file.get("width", 0)
            height = video_file.get("height", 0)
            
            is_landscape = self._is_landscape_video(width, height)
            
            if orientation == 'landscape' and is_landscape:
                filtered_videos.append(video)
            elif orientation == 'portrait' and not is_landscape:
                filtered_videos.append(video)
        
        logger.debug(f"Filtered {len(videos)} videos to {len(filtered_videos)} by orientation: {orientation}")
        return filtered_videos
    
    def _make_api_request(self, query: str, max_videos: int) -> Optional[Dict[str, Any]]:
        """
        Make API request to PEXELS with retry logic.
        
        Args:
            query: Search query
            max_videos: Maximum number of videos
            
        Returns:
            Optional[Dict[str, Any]]: API response data or None
        """
        api_key = ***REMOVED***()
        if not api_key:
            return None
        
        headers = {"Authorization": api_key}
        params = {
            "query": query,
            "per_page": max_videos * 2  # Get more videos for filtering
        }
        
        logger.info(f"Making PEXELS API request for query: '{query}', max_videos: {max_videos}")
        
        try:
            response = requests.get(self.base_url, headers=headers, params=params, timeout=30)
            logger.debug(f"API response status: {response.status_code}")
            
            # Retry with different API key if request failed
            if response.status_code != 200 and len(self.api_keys) > 1:
                logger.warning(f"API request failed with status {response.status_code}, trying another key")
                
                # Try up to 3 different API keys
                for attempt in range(min(3, len(self.api_keys) - 1)):
                    # Select a different API key
                    remaining_keys = [key for key in self.api_keys if key != api_key]
                    api_key = random.choice(remaining_keys)
                    headers = {"Authorization": api_key}
                    
                    logger.debug(f"Retry attempt {attempt + 1} with different API key")
                    response = requests.get(self.base_url, headers=headers, params=params, timeout=30)
                    logger.debug(f"Retry response status: {response.status_code}")
                    
                    if response.status_code == 200:
                        logger.info("API request succeeded with alternate key")
                        break
            
            response.raise_for_status()
            return response.json()
            
        except requests.exceptions.RequestException as e:
            logger.error(f"PEXELS API request failed: {str(e)}")
            return None
    
    def search_videos(self, query: str, max_videos: int = 20, orientation: str = "mixed") -> VideoSearchResponse:
        """
        Search for videos using PEXELS API.
        
        Args:
            query: Search query string
            max_videos: Maximum number of videos to return
            orientation: Video orientation filter
            
        Returns:
            VideoSearchResponse: Search results
        """
        logger.info(f"Starting video search - Query: '{query}', Max: {max_videos}, Orientation: {orientation}")
        
        if not self.api_keys:
            error_message = "PEXELS API keys not configured"
            logger.error(error_message)
            return VideoSearchResponse(
                success=False,
                message=error_message,
                videos=[],
                total_found=0,
                query=query
            )
        
        # Make API request
        api_data = self._make_api_request(query, max_videos)
        if not api_data:
            error_message = "Failed to fetch data from PEXELS API"
            logger.error(error_message)
            return VideoSearchResponse(
                success=False,
                message=error_message,
                videos=[],
                total_found=0,
                query=query
            )
        
        videos = api_data.get("videos", [])
        logger.info(f"Retrieved {len(videos)} videos from API")
        
        if not videos:
            message = f"No videos found for query: '{query}'"
            logger.info(message)
            return VideoSearchResponse(
                success=True,
                message=message,
                videos=[],
                total_found=0,
                query=query
            )
        
        # Filter by orientation
        filtered_videos = self._filter_by_orientation(videos, orientation)
        
        # Process videos and create VideoInfo objects
        video_results = []
        for index, video in enumerate(filtered_videos):
            if len(video_results) >= max_videos:
                break
            
            try:
                video_id = video.get("id")
                logger.debug(f"Processing video {index + 1}/{len(filtered_videos)}, ID: {video_id}")
                
                user = video.get("user", {}).get("name", "Unknown")
                duration = video.get("duration")
                
                # Select best video file
                video_files = video.get("video_files", [])
                video_file = self._select_video_file(video_files)
                
                if not video_file:
                    logger.warning(f"No suitable video file found for video {video_id}")
                    continue
                
                video_url = video_file.get("link")
                if not video_url:
                    logger.warning(f"No video URL found for video {video_id}")
                    continue
                
                width = video_file.get("width", 0)
                height = video_file.get("height", 0)
                
                # Get thumbnail
                pictures = video.get("video_pictures", [])
                thumbnail = pictures[0].get("picture") if pictures else ""
                
                video_info = VideoInfo(
                    id=video_id,
                    title=f"Video by {user}",
                    author=user,
                    duration=duration,
                    video_url=video_url,
                    thumbnail=thumbnail,
                    width=width,
                    height=height
                )
                
                video_results.append(video_info)
                logger.debug(f"Successfully processed video {video_id}")
                
            except Exception as e:
                logger.error(f"Error processing video {video.get('id', 'unknown')}: {str(e)}")
                continue
        
        success_message = f"Found {len(video_results)} videos"
        logger.info(f"Video search completed - {success_message}")
        
        return VideoSearchResponse(
            success=True,
            message=success_message,
            videos=video_results,
            total_found=len(video_results),
            query=query
        ) 