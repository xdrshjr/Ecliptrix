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
import yaml
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
        
        # Load configuration
        self.config = self._load_config()
        logger.info(f"VideoAnalysisService initialized with config: concurrent_threads={self.config['vlm_processing']['concurrent_threads']}, default_frame_interval={self.config['frame_extraction']['default_frame_interval_seconds']}s")
    
    def _load_config(self) -> Dict[str, Any]:
        """Load configuration from YAML file."""
        config_path = Path(__file__).parent.parent.parent / "config" / "video-analysis-config.yaml"
        
        # Default configuration
        default_config = {
            "vlm_processing": {
                "concurrent_threads": 5,
                "api_timeout": 30,
                "max_retries": 2
            },
            "frame_extraction": {
                "default_frame_interval_seconds": 5,
                "max_frames_per_video": 100,
                "supported_formats": ["mp4", "avi", "mov", "mkv", "webm", "flv"]
            },
            "performance": {
                "enable_performance_logging": True,
                "log_concurrent_stats": True,
                "max_video_duration_seconds": 3600
            },
            "temp_files": {
                "video_download_dir": "video_analysis",
                "frames_dir_prefix": "frames_",
                "auto_cleanup": True,
                "cleanup_timeout": 300
            },
            "logging": {
                "log_level": "INFO",
                "log_analysis_content": False,
                "log_base64_content": False,
                "log_frame_processing_time": True
            }
        }
        
        try:
            if config_path.exists():
                with open(config_path, 'r', encoding='utf-8') as f:
                    loaded_config = yaml.safe_load(f)
                    if loaded_config:
                        # Merge with default config
                        for key, value in loaded_config.items():
                            if key in default_config and isinstance(value, dict):
                                default_config[key].update(value)
                            else:
                                default_config[key] = value
                        logger.info(f"Configuration loaded from {config_path}")
                    else:
                        logger.warning(f"Configuration file is empty, using defaults")
            else:
                logger.warning(f"Configuration file not found at {config_path}, using defaults")
        except Exception as e:
            logger.error(f"Failed to load configuration: {str(e)}, using defaults")
        
        return default_config
    
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
        temp_dir = os.path.join(tempfile.gettempdir(), self.config['temp_files']['video_download_dir'])
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
    
    def extract_frames(self, video_path: str, frame_interval: int = None) -> tuple[List[Dict[str, Any]], float]:
        """
        Extract frames from video at specified intervals.
        
        Args:
            video_path: Path to the video file
            frame_interval: Interval in seconds between frames to extract (uses config default if None)
            
        Returns:
            Tuple of (frames_info_list, video_duration)
        """
        # Use config default if not specified
        if frame_interval is None:
            frame_interval = self.config['frame_extraction']['default_frame_interval_seconds']
        
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
        
        # Check video duration limit
        max_duration = self.config['performance']['max_video_duration_seconds']
        if duration > max_duration:
            logger.warning(f"Video duration ({duration:.2f}s) exceeds maximum allowed ({max_duration}s)")
            raise ValueError(f"Video duration ({duration:.2f}s) exceeds maximum allowed ({max_duration}s)")
        
        # Calculate frame interval in frame numbers
        frame_step = int(fps * frame_interval) if fps > 0 else 1
        
        # Create output directory for frames
        video_name = Path(video_path).stem
        frames_dir_prefix = self.config['temp_files']['frames_dir_prefix']
        frames_dir = os.path.join(tempfile.gettempdir(), f"{frames_dir_prefix}{video_name}_{uuid4().hex[:8]}")
        os.makedirs(frames_dir, exist_ok=True)
        logger.info(f"Created frames directory: {frames_dir}")
        
        frames_info = []
        frame_count = 0
        extracted_count = 0
        max_frames = self.config['frame_extraction']['max_frames_per_video']
        
        while True:
            ret, frame = cap.read()
            if not ret:
                break
                
            # Extract frame at specified intervals
            if frame_count % frame_step == 0:
                if extracted_count >= max_frames:
                    logger.warning(f"Reached maximum frames limit ({max_frames}), stopping extraction")
                    break
                    
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
    
    async def analyze_frame_with_llm(self, frame_path: str, custom_prompt: Optional[str] = None, semaphore: Optional[asyncio.Semaphore] = None) -> str:
        """
        Analyze a single frame using VL LLM with optional concurrency control.
        
        Args:
            frame_path: Path to the frame image
            custom_prompt: Custom prompt for analysis
            semaphore: Semaphore for controlling concurrent access
            
        Returns:
            Analysis description from LLM
        """
        if not self.client:
            return "VL LLM not configured"
        
        # Use semaphore if provided for concurrency control
        if semaphore:
            async with semaphore:
                return await self._analyze_frame_internal(frame_path, custom_prompt)
        else:
            return await self._analyze_frame_internal(frame_path, custom_prompt)
    
    async def _analyze_frame_internal(self, frame_path: str, custom_prompt: Optional[str] = None) -> str:
        """Internal method for frame analysis."""
        frame_start_time = time.time()
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
                    }],
                    timeout=self.config['vlm_processing']['api_timeout']
                )
            
            analysis = completion.choices[0].message.content
            
            # Log processing time if enabled
            if self.config['logging']['log_frame_processing_time']:
                processing_time = time.time() - frame_start_time
                logger.debug(f"VL LLM analysis completed for frame: {frame_path} in {processing_time:.2f}s", extra={
                    "analysis_length": len(analysis) if analysis else 0,
                    "frame_path": frame_path,
                    "processing_time": processing_time
                })
            else:
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
        frame_interval: int = None,
        custom_prompt: Optional[str] = None
    ) -> VideoAnalysisResponse:
        """
        Analyze video by extracting frames and analyzing them with VL LLM using concurrent processing.
        
        Args:
            video_url: URL or path to the video file
            frame_interval: Interval in seconds between frames to extract (uses config default if None)
            custom_prompt: Custom prompt for LLM analysis
            
        Returns:
            VideoAnalysisResponse with analysis results
        """
        start_time = time.time()
        logger.info(f"Starting video analysis for: {video_url}")
        
        # Use config default if not specified
        if frame_interval is None:
            frame_interval = self.config['frame_extraction']['default_frame_interval_seconds']
        
        concurrent_threads = self.config['vlm_processing']['concurrent_threads']
        logger.info(f"Using concurrent processing with {concurrent_threads} threads, frame interval: {frame_interval}s")
        
        video_path = None
        frames_dir = None
        
        try:
            # Download video if needed
            video_path = await self.download_video_if_needed(video_url)
            
            # Extract frames
            frames_info, video_duration = self.extract_frames(video_path, frame_interval)
            
            if frames_info:
                frames_dir = os.path.dirname(frames_info[0]["frame_path"])
            
            # Create semaphore for controlling concurrent VLM calls
            semaphore = asyncio.Semaphore(concurrent_threads)
            
            # Log concurrent processing start
            if self.config['performance']['log_concurrent_stats']:
                logger.info(f"Starting concurrent VLM analysis - Total frames: {len(frames_info)}, Concurrent threads: {concurrent_threads}")
            
            # Create tasks for concurrent frame analysis
            analysis_tasks = []
            for i, frame_info in enumerate(frames_info):
                logger.debug(f"Queuing frame {i+1}/{len(frames_info)} for analysis: {frame_info['timestamp']:.2f}s", extra={
                    "frame_index": i + 1,
                    "total_frames": len(frames_info),
                    "timestamp": frame_info['timestamp'],
                    "frame_number": frame_info["frame_number"]
                })
                
                task = self.analyze_frame_with_llm(
                    frame_info["frame_path"], 
                    custom_prompt,
                    semaphore
                )
                analysis_tasks.append((frame_info, task))
            
            # Execute all analysis tasks concurrently
            concurrent_start_time = time.time()
            logger.info(f"Executing {len(analysis_tasks)} VLM analysis tasks concurrently")
            
            # Wait for all tasks to complete
            results = await asyncio.gather(*[task for _, task in analysis_tasks], return_exceptions=True)
            
            concurrent_processing_time = time.time() - concurrent_start_time
            
            # Log concurrent processing completion
            if self.config['performance']['log_concurrent_stats']:
                successful_analyses = sum(1 for result in results if not isinstance(result, Exception))
                failed_analyses = len(results) - successful_analyses
                logger.info(f"Concurrent VLM analysis completed in {concurrent_processing_time:.2f}s - Success: {successful_analyses}, Failed: {failed_analyses}")
            
            # Build frame analyses from results
            frame_analyses = []
            for i, ((frame_info, _), analysis_result) in enumerate(zip(analysis_tasks, results)):
                if isinstance(analysis_result, Exception):
                    logger.error(f"Frame analysis failed for frame {frame_info['frame_number']}: {str(analysis_result)}")
                    analysis = f"分析失败: {str(analysis_result)}"
                else:
                    analysis = analysis_result
                
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
                    "analysis_length": len(analysis) if analysis else 0,
                    "analysis_successful": not isinstance(analysis_result, Exception)
                })
            
            processing_time = time.time() - start_time
            
            response = VideoAnalysisResponse(
                success=True,
                video_url=video_url,
                total_frames_extracted=len(frames_info),
                video_duration=video_duration,
                frame_analyses=frame_analyses,
                processing_time=processing_time,
                message=f"Successfully analyzed {len(frames_info)} frames from video using {concurrent_threads} concurrent threads"
            )
            
            # Log performance statistics
            if self.config['performance']['enable_performance_logging']:
                total_analysis_length = sum(len(frame.analysis) for frame in frame_analyses)
                avg_frame_time = concurrent_processing_time / len(frames_info) if frames_info else 0
                speedup_factor = (len(frames_info) * 6) / concurrent_processing_time if concurrent_processing_time > 0 else 0  # Assuming ~6s per frame sequentially
                
                logger.info(f"Video analysis performance metrics", extra={
                    "video_url": video_url,
                    "total_processing_time": processing_time,
                    "concurrent_processing_time": concurrent_processing_time,
                    "frames_extracted": len(frames_info),
                    "video_duration": video_duration,
                    "concurrent_threads": concurrent_threads,
                    "avg_frame_processing_time": avg_frame_time,
                    "estimated_speedup_factor": speedup_factor,
                    "total_analysis_length": total_analysis_length
                })
            
            logger.info(f"Video analysis completed in {processing_time:.2f}s (concurrent processing: {concurrent_processing_time:.2f}s)")
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
                if self.config['temp_files']['auto_cleanup']:
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