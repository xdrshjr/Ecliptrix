"""
Video analysis service for extracting frames and analyzing them with VL LLM.
"""

import os
import cv2
import base64
import time
import asyncio
import tempfile
import requests
import logging
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional
from uuid import uuid4
from urllib.parse import urlparse

from openai import OpenAI
from PIL import Image

from app.config import settings
from app.logger import get_logger
from app.models.video_analysis import FrameAnalysis, VideoAnalysisResponse

# Set up logger
logger = get_logger(__name__)

# Disable OpenAI client debug logging to prevent BASE64 content from being logged
openai_logger = logging.getLogger("openai")
openai_logger.setLevel(logging.WARNING)

# Also disable httpx and httpcore debug logging which OpenAI uses internally
httpx_logger = logging.getLogger("httpx")
httpx_logger.setLevel(logging.WARNING)
httpcore_logger = logging.getLogger("httpcore")
httpcore_logger.setLevel(logging.WARNING)


class VideoAnalysisService:
    """Service for video frame extraction and VL LLM analysis."""
    
    def __init__(self):
        """Initialize the video analysis service."""
        if not settings.vl_llm_api_key or not settings.vl_llm_api_url:
            logger.warning("VL LLM configuration not found, video analysis may not work properly")
            self.client = None
        else:
            # Configure OpenAI client with minimal logging
            self.client = OpenAI(
                api_key=settings.vl_llm_api_key,
                base_url=settings.vl_llm_api_url,
            )
            
            logger.info("VideoAnalysisService initialized with VL_LLM configuration")
    
    def _suppress_openai_logging(self):
        """Context manager to temporarily suppress OpenAI client logging."""
        class LoggingSuppressor:
            def __init__(self):
                self.loggers = ["openai", "httpx", "httpcore", "urllib3"]
                self.original_levels = {}
            
            def __enter__(self):
                for logger_name in self.loggers:
                    logger_obj = logging.getLogger(logger_name)
                    self.original_levels[logger_name] = logger_obj.level
                    logger_obj.setLevel(logging.ERROR)
                return self
            
            def __exit__(self, exc_type, exc_val, exc_tb):
                for logger_name in self.loggers:
                    logging.getLogger(logger_name).setLevel(self.original_levels[logger_name])
        
        return LoggingSuppressor()
    
    async def download_video_if_needed(self, video_url: str) -> str:
        """
        Download video from URL if needed, return local path.
        
        Args:
            video_url: URL or local path to the video
            
        Returns:
            Local path to the video file
        """
        # Check if it's already a local file
        if os.path.exists(video_url):
            logger.info(f"Video is already local: {video_url}")
            return video_url
        
        # Check if it's a URL
        parsed = urlparse(video_url)
        if not parsed.scheme:
            raise ValueError(f"Invalid video URL or path: {video_url}")
        
        logger.info(f"Downloading video from URL: {video_url}")
        
        # Create temp directory for downloaded videos
        temp_dir = os.path.join(tempfile.gettempdir(), "video_analysis")
        os.makedirs(temp_dir, exist_ok=True)
        
        # Generate unique filename
        video_id = uuid4().hex[:8]
        filename = f"video_{video_id}.mp4"
        local_path = os.path.join(temp_dir, filename)
        
        try:
            # Download video
            response = requests.get(video_url, stream=True, timeout=60)
            response.raise_for_status()
            
            with open(local_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            
            logger.info(f"Video downloaded successfully to: {local_path}")
            return local_path
            
        except Exception as e:
            logger.error(f"Failed to download video from {video_url}: {str(e)}")
            if os.path.exists(local_path):
                os.remove(local_path)
            raise
    
    def extract_frames(self, video_path: str, frame_interval: int = 5) -> tuple[List[Dict[str, Any]], float]:
        """
        Extract frames from video at specified intervals.
        
        Args:
            video_path: Path to the video file
            frame_interval: Interval in seconds between frames to extract
            
        Returns:
            Tuple of (frames_info_list, video_duration)
        """
        logger.info(f"Starting frame extraction from video: {video_path}")
        logger.info(f"Frame extraction interval: {frame_interval} seconds")
        
        if not os.path.exists(video_path):
            logger.error(f"Video file not found: {video_path}")
            raise FileNotFoundError(f"Video file not found: {video_path}")
        
        # Open video file
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            logger.error(f"Failed to open video file: {video_path}")
            raise ValueError(f"Failed to open video file: {video_path}")
        
        # Get video properties
        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration = total_frames / fps if fps > 0 else 0
        
        logger.info(f"Video properties - FPS: {fps}, Total frames: {total_frames}, Duration: {duration:.2f}s")
        
        # Calculate frame interval in frame numbers
        frame_step = int(fps * frame_interval) if fps > 0 else 1
        
        # Create output directory for frames
        video_name = Path(video_path).stem
        frames_dir = os.path.join(tempfile.gettempdir(), f"frames_{video_name}_{uuid4().hex[:8]}")
        os.makedirs(frames_dir, exist_ok=True)
        logger.info(f"Created frames directory: {frames_dir}")
        
        frames_info = []
        frame_count = 0
        extracted_count = 0
        
        while True:
            ret, frame = cap.read()
            if not ret:
                break
                
            # Extract frame at specified intervals
            if frame_count % frame_step == 0:
                timestamp = frame_count / fps if fps > 0 else extracted_count * frame_interval
                frame_filename = f"frame_{extracted_count:04d}_{timestamp:.2f}s.jpg"
                frame_path = os.path.join(frames_dir, frame_filename)
                
                # Save frame
                cv2.imwrite(frame_path, frame)
                
                frames_info.append({
                    "frame_number": extracted_count,
                    "timestamp": timestamp,
                    "frame_path": frame_path,
                    "original_frame_number": frame_count
                })
                
                extracted_count += 1
                logger.debug(f"Extracted frame {extracted_count} at {timestamp:.2f}s")
            
            frame_count += 1
        
        cap.release()
        
        logger.info(f"Frame extraction completed. Extracted {extracted_count} frames from {duration:.2f}s video")
        return frames_info, duration
    
    def encode_image_to_base64(self, image_path: str) -> str:
        """
        Encode image to base64 string.
        
        Args:
            image_path: Path to the image file
            
        Returns:
            Base64 encoded image string
        """
        try:
            with open(image_path, "rb") as image_file:
                image_data = image_file.read()
                encoded_string = base64.b64encode(image_data).decode('utf-8')
                
                # Log encoding info without the actual BASE64 content
                logger.debug(f"Image encoded to base64", extra={
                    "image_path": image_path,
                    "original_size_bytes": len(image_data),
                    "base64_size_bytes": len(encoded_string)
                })
                
                return f"data:image/jpeg;base64,{encoded_string}"
        except Exception as e:
            logger.error(f"Failed to encode image {image_path}: {str(e)}", extra={
                "image_path": image_path,
                "error_type": type(e).__name__
            })
            raise
    
    async def analyze_frame_with_llm(self, frame_path: str, custom_prompt: Optional[str] = None) -> str:
        """
        Analyze a single frame using VL LLM.
        
        Args:
            frame_path: Path to the frame image
            custom_prompt: Custom prompt for analysis
            
        Returns:
            Analysis description from LLM
        """
        if not self.client:
            return "VL LLM not configured"
        
        logger.debug(f"Analyzing frame: {frame_path}")
        
        try:
            # Encode image to base64
            image_base64 = self.encode_image_to_base64(frame_path)
            
            # Prepare prompt
            prompt = custom_prompt or "请详细描述这张图片中的内容，包括场景、人物、物体、动作等。"
            
            # Log request info without BASE64 content
            logger.debug(f"Calling VL LLM API for frame analysis", extra={
                "frame_path": frame_path,
                "model": settings.vl_llm_model,
                "prompt_length": len(prompt),
                "image_base64_length": len(image_base64),
                "has_custom_prompt": bool(custom_prompt)
            })
            
            # Call VL LLM API with suppressed logging to prevent BASE64 content leakage
            with self._suppress_openai_logging():
                completion = self.client.chat.completions.create(
                    model=settings.vl_llm_model,
                    messages=[{
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {"url": image_base64}
                            },
                            {
                                "type": "text", 
                                "text": prompt
                            }
                        ]
                    }]
                )
            
            analysis = completion.choices[0].message.content
            logger.debug(f"VL LLM analysis completed for frame: {frame_path}", extra={
                "analysis_length": len(analysis) if analysis else 0,
                "frame_path": frame_path
            })
            return analysis
            
        except Exception as e:
            # Log error without potentially sensitive data
            logger.error(f"Failed to analyze frame {frame_path}: {str(e)}", extra={
                "frame_path": frame_path,
                "error_type": type(e).__name__,
                "model": settings.vl_llm_model
            })
            return f"分析失败: {str(e)}"
    
    async def analyze_video(
        self, 
        video_url: str, 
        frame_interval: int = 5,
        custom_prompt: Optional[str] = None
    ) -> VideoAnalysisResponse:
        """
        Analyze video by extracting frames and analyzing them with VL LLM.
        
        Args:
            video_url: URL or path to the video file
            frame_interval: Interval in seconds between frames to extract
            custom_prompt: Custom prompt for LLM analysis
            
        Returns:
            VideoAnalysisResponse with analysis results
        """
        start_time = time.time()
        logger.info(f"Starting video analysis for: {video_url}")
        
        video_path = None
        frames_dir = None
        
        try:
            # Download video if needed
            video_path = await self.download_video_if_needed(video_url)
            
            # Extract frames
            frames_info, video_duration = self.extract_frames(video_path, frame_interval)
            
            if frames_info:
                frames_dir = os.path.dirname(frames_info[0]["frame_path"])
            
            # Analyze each frame with VL LLM
            frame_analyses = []
            for i, frame_info in enumerate(frames_info):
                logger.info(f"Analyzing frame {i+1}/{len(frames_info)}: {frame_info['timestamp']:.2f}s", extra={
                    "frame_index": i + 1,
                    "total_frames": len(frames_info),
                    "timestamp": frame_info['timestamp'],
                    "frame_number": frame_info["frame_number"]
                })
                
                analysis = await self.analyze_frame_with_llm(
                    frame_info["frame_path"], 
                    custom_prompt
                )
                
                frame_analysis = FrameAnalysis(
                    frame_number=frame_info["frame_number"],
                    timestamp=frame_info["timestamp"],
                    analysis=analysis,
                    frame_path=frame_info["frame_path"]
                )
                frame_analyses.append(frame_analysis)
                
                logger.info(f"Completed analysis for frame {frame_info['frame_number']} at {frame_info['timestamp']:.2f}s", extra={
                    "frame_number": frame_info["frame_number"],
                    "timestamp": frame_info["timestamp"],
                    "analysis_length": len(analysis) if analysis else 0
                })
            
            processing_time = time.time() - start_time
            
            response = VideoAnalysisResponse(
                success=True,
                video_url=video_url,
                total_frames_extracted=len(frames_info),
                video_duration=video_duration,
                frame_analyses=frame_analyses,
                processing_time=processing_time,
                message=f"Successfully analyzed {len(frames_info)} frames from video"
            )
            
            logger.info(f"Video analysis completed in {processing_time:.2f}s", extra={
                "video_url": video_url,
                "processing_time": processing_time,
                "frames_extracted": len(frames_info),
                "video_duration": video_duration,
                "total_analysis_length": sum(len(frame.analysis) for frame in frame_analyses)
            })
            return response
            
        except Exception as e:
            processing_time = time.time() - start_time
            logger.error(f"Video analysis failed: {str(e)}", extra={
                "video_url": video_url,
                "processing_time": processing_time,
                "error_type": type(e).__name__
            })
            
            return VideoAnalysisResponse(
                success=False,
                video_url=video_url,
                total_frames_extracted=0,
                video_duration=0.0,
                frame_analyses=[],
                processing_time=processing_time,
                message=f"Analysis failed: {str(e)}"
            )
        
        finally:
            # Cleanup
            try:
                # Clean up frames directory
                if frames_dir and os.path.exists(frames_dir):
                    import shutil
                    shutil.rmtree(frames_dir)
                    logger.info(f"Cleaned up frames directory: {frames_dir}")
                
                # Clean up downloaded video if it was downloaded
                if video_path and video_path != video_url and os.path.exists(video_path):
                    os.remove(video_path)
                    logger.info(f"Cleaned up downloaded video: {video_path}")
                    
            except Exception as cleanup_error:
                logger.warning(f"Failed to cleanup temporary files: {str(cleanup_error)}")


# Global service instance
video_analysis_service = VideoAnalysisService() 