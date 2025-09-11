"""
Video Analysis Storage Service for persisting and retrieving video analysis results.
This service provides a simple in-memory cache for video analysis data.
"""

import json
from datetime import datetime
from typing import Dict, Optional
from app.logger import get_logger
from app.models.video_analysis import VideoAnalysisResponse
from app.models.ai_mixed_editing_models import VideoAnalysisMetadata, VideoFrameAnalysis

logger = get_logger(__name__)


class VideoAnalysisStorageService:
    """Service for storing and retrieving video analysis results."""
    
    def __init__(self):
        """Initialize the video analysis storage service with in-memory cache."""
        self._analysis_cache: Dict[str, VideoAnalysisMetadata] = {}
        logger.info("VideoAnalysisStorageService initialized with in-memory cache")
    
    def _generate_cache_key(self, video_url: str) -> str:
        """
        Generate a cache key for the video URL.
        
        Args:
            video_url: Video URL to generate key for
            
        Returns:
            str: Cache key
        """
        # Simple cache key based on URL - in production, might want to use hash
        return video_url.strip()
    
    def store_analysis_result(self, analysis_result: VideoAnalysisResponse) -> bool:
        """
        Store video analysis result in cache.
        
        Args:
            analysis_result: Video analysis response from analysis service
            
        Returns:
            bool: True if stored successfully, False otherwise
        """
        try:
            cache_key = self._generate_cache_key(analysis_result.video_url)
            
            # Convert VideoAnalysisResponse to VideoAnalysisMetadata
            frame_analyses = []
            for frame_analysis in analysis_result.frame_analyses:
                frame_analyses.append(VideoFrameAnalysis(
                    frame_number=frame_analysis.frame_number,
                    timestamp=frame_analysis.timestamp,
                    analysis=frame_analysis.analysis
                ))
            
            analysis_metadata = VideoAnalysisMetadata(
                video_url=analysis_result.video_url,
                total_frames_extracted=analysis_result.total_frames_extracted,
                video_duration=analysis_result.video_duration,
                frame_analyses=frame_analyses,
                processing_time=analysis_result.processing_time,
                analysis_timestamp=analysis_result.timestamp.isoformat()
            )
            
            self._analysis_cache[cache_key] = analysis_metadata
            
            logger.info(f"Stored video analysis result for URL: {analysis_result.video_url}", extra={
                "video_url": analysis_result.video_url,
                "total_frames": analysis_result.total_frames_extracted,
                "video_duration": analysis_result.video_duration,
                "cache_size": len(self._analysis_cache)
            })
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to store video analysis result: {str(e)}", extra={
                "video_url": analysis_result.video_url if analysis_result else "unknown"
            }, exc_info=True)
            return False
    
    def get_analysis_result(self, video_url: str) -> Optional[VideoAnalysisMetadata]:
        """
        Retrieve video analysis result from cache.
        
        Args:
            video_url: Video URL to retrieve analysis for
            
        Returns:
            VideoAnalysisMetadata: Analysis data if available, None otherwise
        """
        try:
            cache_key = self._generate_cache_key(video_url)
            analysis_data = self._analysis_cache.get(cache_key)
            
            if analysis_data:
                logger.debug(f"Retrieved video analysis result for URL: {video_url}", extra={
                    "video_url": video_url,
                    "total_frames": analysis_data.total_frames_extracted
                })
            else:
                logger.debug(f"No video analysis result found for URL: {video_url}", extra={
                    "video_url": video_url
                })
            
            return analysis_data
            
        except Exception as e:
            logger.error(f"Failed to retrieve video analysis result: {str(e)}", extra={
                "video_url": video_url
            }, exc_info=True)
            return None
    
    def has_analysis_result(self, video_url: str) -> bool:
        """
        Check if video analysis result exists for the given URL.
        
        Args:
            video_url: Video URL to check
            
        Returns:
            bool: True if analysis exists, False otherwise
        """
        cache_key = self._generate_cache_key(video_url)
        return cache_key in self._analysis_cache
    
    def remove_analysis_result(self, video_url: str) -> bool:
        """
        Remove video analysis result from cache.
        
        Args:
            video_url: Video URL to remove analysis for
            
        Returns:
            bool: True if removed successfully, False if not found
        """
        try:
            cache_key = self._generate_cache_key(video_url)
            
            if cache_key in self._analysis_cache:
                del self._analysis_cache[cache_key]
                logger.info(f"Removed video analysis result for URL: {video_url}", extra={
                    "video_url": video_url,
                    "cache_size": len(self._analysis_cache)
                })
                return True
            else:
                logger.debug(f"No video analysis result to remove for URL: {video_url}", extra={
                    "video_url": video_url
                })
                return False
                
        except Exception as e:
            logger.error(f"Failed to remove video analysis result: {str(e)}", extra={
                "video_url": video_url
            }, exc_info=True)
            return False
    
    def clear_all_analysis_results(self) -> int:
        """
        Clear all video analysis results from cache.
        
        Returns:
            int: Number of entries cleared
        """
        try:
            count = len(self._analysis_cache)
            self._analysis_cache.clear()
            
            logger.info(f"Cleared all video analysis results from cache", extra={
                "cleared_count": count
            })
            
            return count
            
        except Exception as e:
            logger.error(f"Failed to clear video analysis cache: {str(e)}", exc_info=True)
            return 0
    
    def get_cache_stats(self) -> Dict[str, int]:
        """
        Get cache statistics.
        
        Returns:
            Dict[str, int]: Cache statistics
        """
        return {
            "total_entries": len(self._analysis_cache),
            "total_frames": sum(len(analysis.frame_analyses) for analysis in self._analysis_cache.values())
        }


# Global instance for use across the application
video_analysis_storage = VideoAnalysisStorageService()