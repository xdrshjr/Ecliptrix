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
from app.models.video_analysis import (
    FrameAnalysis, 
    VideoAnalysisResponse,
    VideoAnalysisItem,
    BatchVideoAnalysisResult,
    BatchVideoAnalysisResponse
)

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
    
    async def download_thumbnail(self, thumbnail_url: str) -> str:
        """
        Download thumbnail from URL or decode from base64 data URL and return local path.
        
        Args:
            thumbnail_url: URL of the thumbnail image, base64 data URL, or local file path
            
        Returns:
            Local path to the downloaded thumbnail
        """
        try:
            # Check if thumbnail_url is a base64 data URL
            if thumbnail_url.startswith('data:'):
                # Extract mime type from data URL
                mime_type = thumbnail_url.split(';')[0].split(':')[1] if ';' in thumbnail_url else 'unknown'
                logger.info(f"Decoding base64 thumbnail data (type: {mime_type}, total length: {len(thumbnail_url)} chars)")
                
                # Create temp directory for thumbnails
                thumbnails_dir = os.path.join(
                    tempfile.gettempdir(),
                    self.config['temp_files']['video_download_dir'],
                    "thumbnails"
                )
                os.makedirs(thumbnails_dir, exist_ok=True)
                
                # Generate unique filename
                thumbnail_filename = f"thumbnail_{uuid4()}.jpg"
                thumbnail_path = os.path.join(thumbnails_dir, thumbnail_filename)
                
                # Extract base64 data from data URL
                # Format: data:image/jpeg;base64,/9j/4AAQSkZJRg...
                try:
                    import base64
                    header, encoded = thumbnail_url.split(',', 1)
                    image_data = base64.b64decode(encoded)
                    
                    # Save decoded image
                    with open(thumbnail_path, "wb") as f:
                        f.write(image_data)
                    
                    logger.info(f"Base64 thumbnail decoded and saved successfully: {thumbnail_path} (decoded size: {len(image_data)} bytes)")
                    return thumbnail_path
                    
                except Exception as decode_error:
                    logger.error(f"Failed to decode base64 thumbnail: {str(decode_error)}")
                    raise
            
            # Check if thumbnail_url is an HTTP/HTTPS URL
            elif thumbnail_url.startswith('http://') or thumbnail_url.startswith('https://'):
                logger.info(f"Downloading thumbnail from URL: {thumbnail_url}")
                
                # Create temp directory for thumbnails
                thumbnails_dir = os.path.join(
                    tempfile.gettempdir(),
                    self.config['temp_files']['video_download_dir'],
                    "thumbnails"
                )
                os.makedirs(thumbnails_dir, exist_ok=True)
                
                # Generate unique filename
                thumbnail_filename = f"thumbnail_{uuid4()}.jpg"
                thumbnail_path = os.path.join(thumbnails_dir, thumbnail_filename)
                
                response = requests.get(thumbnail_url, timeout=30)
                response.raise_for_status()
                
                # Save thumbnail
                with open(thumbnail_path, "wb") as f:
                    f.write(response.content)
                
                logger.info(f"Thumbnail downloaded successfully: {thumbnail_path}")
                return thumbnail_path
            
            # Otherwise, treat it as a local file path
            else:
                # Check if file exists
                if os.path.exists(thumbnail_url):
                    logger.info(f"Thumbnail is already a local file: {thumbnail_url}")
                    return thumbnail_url
                else:
                    error_msg = f"Local thumbnail file does not exist: {thumbnail_url}"
                    logger.error(error_msg)
                    raise FileNotFoundError(error_msg)
            
        except Exception as e:
            # 截断URL以避免日志过长（特别是base64数据）
            url_preview = thumbnail_url[:100] + '...' if len(thumbnail_url) > 100 else thumbnail_url
            logger.error(f"Failed to process thumbnail from {url_preview}: {str(e)}")
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
            # Default prompt now requests concise descriptions suitable for script generation
            prompt = custom_prompt or "请用一小段话（不超过50字）简要描述这个画面中的主要内容、场景和关键元素。"
            
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
        custom_prompt: Optional[str] = None,
        thumbnail_url: Optional[str] = None,
        use_thumbnail: bool = False
    ) -> VideoAnalysisResponse:
        """
        Analyze video by extracting frames and analyzing them with VL LLM using concurrent processing.
        
        Args:
            video_url: URL or path to the video file
            frame_interval: Interval in seconds between frames to extract (uses config default if None)
            custom_prompt: Custom prompt for LLM analysis
            thumbnail_url: Thumbnail URL for quick mode analysis (skips video download/frame extraction)
            use_thumbnail: If True, use thumbnail instead of downloading video (quick mode)
            
        Returns:
            VideoAnalysisResponse with analysis results
        """
        start_time = time.time()
        logger.info(f"Starting video analysis for: {video_url}")
        logger.info(f"Analysis mode: {'thumbnail-only (quick mode)' if use_thumbnail else 'multi-frame extraction (professional mode)'}")
        
        # Use config default if not specified
        if frame_interval is None:
            frame_interval = self.config['frame_extraction']['default_frame_interval_seconds']
        
        concurrent_threads = self.config['vlm_processing']['concurrent_threads']
        
        video_path = None
        frames_dir = None
        thumbnail_path = None
        
        try:
            # Quick Mode: Use thumbnail instead of downloading video
            if use_thumbnail and thumbnail_url:
                logger.info(f"Quick mode: Using thumbnail for analysis")
                # 不打印base64预览，避免日志过长
                if thumbnail_url.startswith('data:'):
                    mime_type = thumbnail_url.split(';')[0].split(':')[1] if ';' in thumbnail_url else 'unknown'
                    logger.info(f"  Thumbnail: base64 encoded (type: {mime_type}, size: {len(thumbnail_url)} chars)")
                else:
                    thumbnail_preview = thumbnail_url[:100] + '...' if len(thumbnail_url) > 100 else thumbnail_url
                    logger.info(f"  Thumbnail: url (preview: {thumbnail_preview})")
                
                thumbnail_path = await self.download_thumbnail(thumbnail_url)
                
                # Create a single "frame" entry using the thumbnail
                frames_info = [{
                    "frame_number": 1,
                    "timestamp": 0.0,
                    "frame_path": thumbnail_path,
                    "original_frame_number": 0,
                    "is_thumbnail": True
                }]
                video_duration = 0.0  # Unknown duration for thumbnail mode
                
                logger.info(f"  Successfully downloaded thumbnail for quick analysis")
                logger.info(f"  Using thumbnail as single frame for VLM analysis")
                
            else:
                # Professional Mode: Download video and extract frames
                logger.info(f"Professional mode: Extracting multiple frames from video")
                logger.info(f"  Frame interval: {frame_interval}s, Concurrent threads: {concurrent_threads}")
                
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
                    
                    # Clean up downloaded thumbnail if it was downloaded
                    if thumbnail_path and os.path.exists(thumbnail_path):
                        os.remove(thumbnail_path)
                        logger.info(f"Cleaned up downloaded thumbnail: {thumbnail_path}")
                        
            except Exception as cleanup_error:
                logger.warning(f"Failed to cleanup temporary files: {str(cleanup_error)}")
    
    async def batch_analyze_videos(
        self,
        videos: List[VideoAnalysisItem],
        custom_prompt: Optional[str] = None,
        use_thumbnails: bool = False
    ) -> BatchVideoAnalysisResponse:
        """
        Analyze multiple videos with sequential frame extraction and concurrent VLM analysis.
        
        This method implements a two-phase approach:
        1. Sequential Frame Extraction: Extract frames from each video one by one (or use thumbnails in quick mode)
        2. Concurrent VLM Analysis: Analyze all extracted frames in parallel using configured thread count
        
        Args:
            videos: List of video items to analyze
            custom_prompt: Custom prompt for LLM analysis (applies to all videos)
            use_thumbnails: If True, use thumbnails instead of downloading videos (quick mode)
            
        Returns:
            BatchVideoAnalysisResponse with results for all videos
        """
        start_time = time.time()
        concurrent_threads = self.config['vlm_processing']['concurrent_threads']
        
        logger.info(f"Starting batch video analysis for {len(videos)} videos")
        logger.info(f"Configuration - Concurrent threads: {concurrent_threads}, Custom prompt: {bool(custom_prompt)}, Use thumbnails: {use_thumbnails}")
        logger.info("")
        logger.info("╔" + "═" * 78 + "╗")
        logger.info("║" + " BATCH VIDEO ANALYSIS - TWO-PHASE PROCESSING".center(78) + "║")
        logger.info("╠" + "═" * 78 + "╣")
        logger.info("║ Phase 1: Sequential Frame Extraction (one-by-one)".ljust(79) + "║")
        logger.info("║ Phase 2: Concurrent VLM Analysis (multi-threaded)".ljust(79) + "║")
        logger.info("╚" + "═" * 78 + "╝")
        logger.info("")
        
        # Phase 1: Sequential Frame Extraction (or Thumbnail Download for Quick Mode)
        phase1_description = "Thumbnail Download" if use_thumbnails else "Sequential Frame Extraction"
        logger.info("╔" + "═" * 78 + "╗")
        logger.info("║" + f" PHASE 1: {phase1_description}".ljust(78) + "║")
        logger.info("╠" + "═" * 78 + "╣")
        logger.info("║" + f" Processing {len(videos)} videos sequentially (one by one)".ljust(78) + "║")
        logger.info("║" + " This ensures no resource contention during frame extraction".ljust(78) + "║")
        logger.info("╚" + "═" * 78 + "╝")
        
        extraction_start_time = time.time()
        
        # Store all extracted frames info with associated video metadata
        all_frames_data = []  # List of (video_url, frame_info, video_duration)
        video_extraction_results = {}  # Store extraction results per video
        
        for idx, video_item in enumerate(videos, 1):
            video_url = video_item.video_url
            thumbnail_url = video_item.thumbnail_url
            frame_interval = video_item.frame_interval if video_item.frame_interval and video_item.frame_interval > 0 else None
            
            if frame_interval is None:
                frame_interval = self.config['frame_extraction']['default_frame_interval_seconds']
            
            video_path = None
            frames_dir = None
            thumbnail_path = None
            
            logger.info("")
            logger.info(f"┌─ Processing Video {idx}/{len(videos)} ─────────────────────────────────────")
            
            try:
                if use_thumbnails and thumbnail_url:
                    # Quick Mode: Use thumbnail instead of downloading video
                    logger.info(f"│ Video URL: {video_url}")
                    # 不打印base64预览，避免日志过长
                    if thumbnail_url.startswith('data:'):
                        mime_type = thumbnail_url.split(';')[0].split(':')[1] if ';' in thumbnail_url else 'unknown'
                        logger.info(f"│ Thumbnail: base64 encoded (type: {mime_type}, size: {len(thumbnail_url)} chars)")
                    else:
                        thumbnail_preview = thumbnail_url[:100] + '...' if len(thumbnail_url) > 100 else thumbnail_url
                        logger.info(f"│ Thumbnail: url (preview: {thumbnail_preview})")
                    logger.info(f"│ Mode: Quick (thumbnail-only)")
                    logger.info(f"│ Downloading thumbnail...")
                    
                    thumbnail_path = await self.download_thumbnail(thumbnail_url)
                    
                    # Create a single "frame" entry using the thumbnail
                    frames_info = [{
                        "frame_number": 1,
                        "timestamp": 0.0,
                        "frame_path": thumbnail_path,
                        "original_frame_number": 0,
                        "is_thumbnail": True
                    }]
                    video_duration = 0.0  # Unknown duration for thumbnail mode
                    
                    logger.info(f"│ ✓ Thumbnail downloaded successfully")
                    logger.info(f"│ Will use thumbnail as single frame for analysis")
                    logger.info(f"└─────────────────────────────────────────────────────────────────")
                    
                    # Store frame data for later VLM analysis
                    all_frames_data.append({
                        "video_url": video_url,
                        "frame_info": frames_info[0],
                        "video_duration": video_duration,
                        "is_thumbnail": True
                    })
                    
                    # Store extraction results
                    video_extraction_results[video_url] = {
                        "success": True,
                        "frames_info": frames_info,
                        "video_duration": video_duration,
                        "frames_dir": None,
                        "video_path": None,
                        "thumbnail_path": thumbnail_path,
                        "is_thumbnail": True
                    }
                    
                else:
                    # Professional Mode: Download video and extract frames
                    logger.info(f"│ Video URL: {video_url}")
                    logger.info(f"│ Mode: Professional (multi-frame extraction)")
                    logger.info(f"│ Frame interval: {frame_interval}s")
                    logger.info(f"│ Max frames: {self.config['frame_extraction']['max_frames_per_video']}")
                    logger.info(f"│")
                    logger.info(f"│ Step 1/2: Downloading video...")
                    
                    # Download video if needed
                    video_path = await self.download_video_if_needed(video_url)
                    logger.info(f"│ ✓ Video downloaded")
                    logger.info(f"│")
                    logger.info(f"│ Step 2/2: Extracting frames (this may take a while)...")
                    
                    # Extract frames sequentially
                    frame_extraction_start = time.time()
                    frames_info, video_duration = self.extract_frames(video_path, frame_interval)
                    frame_extraction_time = time.time() - frame_extraction_start
                    
                    if frames_info:
                        frames_dir = os.path.dirname(frames_info[0]["frame_path"])
                    
                    logger.info(f"│ ✓ Frame extraction completed")
                    logger.info(f"│ Extracted frames: {len(frames_info)}")
                    logger.info(f"│ Video duration: {video_duration:.2f}s")
                    logger.info(f"│ Extraction time: {frame_extraction_time:.2f}s")
                    logger.info(f"└─────────────────────────────────────────────────────────────────")
                    
                    # Store frame data for later VLM analysis
                    for frame_info in frames_info:
                        all_frames_data.append({
                            "video_url": video_url,
                            "frame_info": frame_info,
                            "video_duration": video_duration,
                            "is_thumbnail": False
                        })
                    
                    # Store extraction results
                    video_extraction_results[video_url] = {
                        "success": True,
                        "frames_info": frames_info,
                        "video_duration": video_duration,
                        "frames_dir": frames_dir,
                        "video_path": video_path,
                        "thumbnail_path": None,
                        "is_thumbnail": False
                    }
                
            except Exception as e:
                logger.error(f"│ ✗ Failed to process video {idx}/{len(videos)}")
                logger.error(f"│ Error: {str(e)}", exc_info=True)
                logger.error(f"└─────────────────────────────────────────────────────────────────")
                
                # Store extraction failure
                video_extraction_results[video_url] = {
                    "success": False,
                    "error": str(e),
                    "frames_info": [],
                    "video_duration": 0.0,
                    "frames_dir": frames_dir,
                    "video_path": video_path,
                    "thumbnail_path": thumbnail_path,
                    "is_thumbnail": use_thumbnails
                }
        
        extraction_time = time.time() - extraction_start_time
        total_frames = len(all_frames_data)
        successful_extractions = sum(1 for r in video_extraction_results.values() if r["success"])
        failed_extractions = len(video_extraction_results) - successful_extractions
        
        logger.info("")
        logger.info("╔" + "═" * 78 + "╗")
        logger.info("║" + " PHASE 1 COMPLETED: Sequential Frame Extraction".ljust(78) + "║")
        logger.info("╠" + "═" * 78 + "╣")
        logger.info("║" + f" Total videos processed: {len(videos)}".ljust(78) + "║")
        logger.info("║" + f" Successful extractions: {successful_extractions}".ljust(78) + "║")
        logger.info("║" + f" Failed extractions: {failed_extractions}".ljust(78) + "║")
        logger.info("║" + f" Total frames extracted: {total_frames}".ljust(78) + "║")
        logger.info("║" + f" Total extraction time: {extraction_time:.2f}s".ljust(78) + "║")
        logger.info("║" + f" Average time per video: {extraction_time / len(videos):.2f}s".ljust(78) + "║")
        logger.info("╚" + "═" * 78 + "╝")
        
        # Phase 2: Concurrent VLM Analysis
        logger.info("")
        logger.info("╔" + "═" * 78 + "╗")
        logger.info("║" + " PHASE 2: Concurrent VLM Analysis".ljust(78) + "║")
        logger.info("╠" + "═" * 78 + "╣")
        logger.info("║" + f" Total frames to analyze: {total_frames}".ljust(78) + "║")
        logger.info("║" + f" Concurrent threads: {concurrent_threads}".ljust(78) + "║")
        logger.info("║" + " All frames will be analyzed in parallel using multi-threading".ljust(78) + "║")
        logger.info("║" + " This significantly reduces total processing time".ljust(78) + "║")
        logger.info("╚" + "═" * 78 + "╝")
        
        vlm_start_time = time.time()
        
        # Create semaphore for controlling concurrent VLM calls
        semaphore = asyncio.Semaphore(concurrent_threads)
        
        # Create tasks for concurrent frame analysis
        analysis_tasks = []
        for frame_data in all_frames_data:
            task = self.analyze_frame_with_llm(
                frame_data["frame_info"]["frame_path"],
                custom_prompt,
                semaphore
            )
            analysis_tasks.append((frame_data, task))
        
        logger.info("")
        logger.info(f"⚡ Starting concurrent VLM analysis of {len(analysis_tasks)} frames...")
        logger.info(f"⚡ Using {concurrent_threads} parallel threads")
        
        # Wait for all tasks to complete
        results = await asyncio.gather(*[task for _, task in analysis_tasks], return_exceptions=True)
        
        vlm_time = time.time() - vlm_start_time
        
        # Log concurrent processing completion
        successful_analyses = sum(1 for result in results if not isinstance(result, Exception))
        failed_analyses = len(results) - successful_analyses
        
        logger.info("")
        logger.info("╔" + "═" * 78 + "╗")
        logger.info("║" + " PHASE 2 COMPLETED: Concurrent VLM Analysis".ljust(78) + "║")
        logger.info("╠" + "═" * 78 + "╣")
        logger.info("║" + f" Total frames analyzed: {total_frames}".ljust(78) + "║")
        logger.info("║" + f" Successful analyses: {successful_analyses}".ljust(78) + "║")
        logger.info("║" + f" Failed analyses: {failed_analyses}".ljust(78) + "║")
        logger.info("║" + f" VLM analysis time: {vlm_time:.2f}s".ljust(78) + "║")
        logger.info("║" + f" Average time per frame: {vlm_time / total_frames if total_frames > 0 else 0:.2f}s".ljust(78) + "║")
        logger.info("║" + f" Estimated sequential time: {total_frames * 6:.2f}s".ljust(78) + "║")
        logger.info("║" + f" Speedup factor: {(total_frames * 6) / vlm_time if vlm_time > 0 else 0:.2f}x".ljust(78) + "║")
        logger.info("╚" + "═" * 78 + "╝")
        
        # Build results per video
        batch_results = []
        
        for video_item in videos:
            video_url = video_item.video_url
            extraction_result = video_extraction_results[video_url]
            
            if not extraction_result["success"]:
                # Video extraction failed
                batch_results.append(BatchVideoAnalysisResult(
                    video_url=video_url,
                    success=False,
                    error_message=extraction_result["error"]
                ))
                continue
            
            # Build frame analyses for this video
            frame_analyses = []
            video_had_analysis_failure = False
            
            for frame_data, analysis_result in zip(all_frames_data, results):
                if frame_data["video_url"] != video_url:
                    continue
                
                frame_info = frame_data["frame_info"]
                
                if isinstance(analysis_result, Exception):
                    logger.error(f"Frame analysis failed for {video_url} frame {frame_info['frame_number']}: {str(analysis_result)}")
                    analysis = f"分析失败: {str(analysis_result)}"
                    video_had_analysis_failure = True
                else:
                    analysis = analysis_result
                
                frame_analysis = FrameAnalysis(
                    frame_number=frame_info["frame_number"],
                    timestamp=frame_info["timestamp"],
                    analysis=analysis,
                    frame_path=frame_info["frame_path"]
                )
                frame_analyses.append(frame_analysis)
            
            # Store analysis result
            try:
                from app.services.video_analysis_storage_service import video_analysis_storage
                
                analysis_response = VideoAnalysisResponse(
                    success=True,
                    video_url=video_url,
                    total_frames_extracted=len(frame_analyses),
                    video_duration=extraction_result["video_duration"],
                    frame_analyses=frame_analyses,
                    processing_time=0.0,  # Not tracking individual video time in batch mode
                    message=f"Analyzed as part of batch with {concurrent_threads} concurrent threads"
                )
                
                storage_success = video_analysis_storage.store_analysis_result(analysis_response)
                if storage_success:
                    logger.info(f"Video analysis result stored for: {video_url}")
                else:
                    logger.warning(f"Failed to store video analysis result for: {video_url}")
            except Exception as e:
                logger.error(f"Error storing video analysis result for {video_url}: {str(e)}", exc_info=True)
            
            batch_results.append(BatchVideoAnalysisResult(
                video_url=video_url,
                success=True,
                total_frames_extracted=len(frame_analyses),
                video_duration=extraction_result["video_duration"],
                frame_analyses=frame_analyses,
                error_message=None
            ))
        
        # Cleanup temporary files
        try:
            if self.config['temp_files']['auto_cleanup']:
                for video_url, extraction_result in video_extraction_results.items():
                    # Clean up frames directory
                    frames_dir = extraction_result.get("frames_dir")
                    if frames_dir and os.path.exists(frames_dir):
                        import shutil
                        shutil.rmtree(frames_dir)
                        logger.info(f"Cleaned up frames directory for {video_url}: {frames_dir}")
                    
                    # Clean up downloaded video if it was downloaded
                    video_path = extraction_result.get("video_path")
                    if video_path and video_path != video_url and os.path.exists(video_path):
                        os.remove(video_path)
                        logger.info(f"Cleaned up downloaded video for {video_url}: {video_path}")
                    
                    # Clean up downloaded thumbnail if used
                    thumbnail_path = extraction_result.get("thumbnail_path")
                    if thumbnail_path and os.path.exists(thumbnail_path):
                        os.remove(thumbnail_path)
                        logger.info(f"Cleaned up downloaded thumbnail for {video_url}: {thumbnail_path}")
        except Exception as cleanup_error:
            logger.warning(f"Failed to cleanup temporary files: {str(cleanup_error)}")
        
        # Calculate final statistics
        total_processing_time = time.time() - start_time
        successful_videos = sum(1 for r in batch_results if r.success)
        failed_videos = len(batch_results) - successful_videos
        
        logger.info("")
        logger.info("╔" + "═" * 78 + "╗")
        logger.info("║" + " BATCH VIDEO ANALYSIS COMPLETED".center(78) + "║")
        logger.info("╠" + "═" * 78 + "╣")
        logger.info("║" + " Overall Statistics:".ljust(78) + "║")
        logger.info("║" + f"   Total videos: {len(videos)}".ljust(78) + "║")
        logger.info("║" + f"   Successful: {successful_videos}".ljust(78) + "║")
        logger.info("║" + f"   Failed: {failed_videos}".ljust(78) + "║")
        logger.info("║" + f"   Total frames extracted: {total_frames}".ljust(78) + "║")
        logger.info("║" + "".ljust(78) + "║")
        logger.info("║" + " Performance Metrics:".ljust(78) + "║")
        logger.info("║" + f"   Total processing time: {total_processing_time:.2f}s".ljust(78) + "║")
        logger.info("║" + f"   Phase 1 (Frame extraction): {extraction_time:.2f}s ({extraction_time/total_processing_time*100:.1f}%)".ljust(78) + "║")
        logger.info("║" + f"   Phase 2 (VLM analysis): {vlm_time:.2f}s ({vlm_time/total_processing_time*100:.1f}%)".ljust(78) + "║")
        logger.info("║" + f"   Concurrent threads used: {concurrent_threads}".ljust(78) + "║")
        logger.info("╚" + "═" * 78 + "╝")
        
        return BatchVideoAnalysisResponse(
            success=failed_videos == 0,
            total_videos=len(videos),
            successful_videos=successful_videos,
            failed_videos=failed_videos,
            results=batch_results,
            total_frames_extracted=total_frames,
            total_processing_time=total_processing_time,
            frame_extraction_time=extraction_time,
            vlm_analysis_time=vlm_time,
            concurrent_threads=concurrent_threads,
            message=f"Batch analysis completed: {successful_videos}/{len(videos)} videos successful, {total_frames} frames extracted and analyzed with {concurrent_threads} concurrent threads"
        )


# Global service instance
video_analysis_service = VideoAnalysisService() 