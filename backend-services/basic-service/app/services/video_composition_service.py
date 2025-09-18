"""
Video composition service for combining multiple video, audio, and subtitle tracks.
Based on the reference video_composer.py with adaptations for FastAPI service architecture.
"""

import os
import json
import uuid
import time
import shutil
import tempfile
import subprocess
import threading
import asyncio
import yaml
import random
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import cv2
from pydub import AudioSegment

from app.logger import get_logger
from app.config import settings
from app.models import (
    VideoCompositionRequest,
    VideoCompositionResponse,
    VideoCompositionItem,
    AudioCompositionItem,
    SubtitleCompositionItem,
    ImageCompositionItem,
    ImagePosition,
    AspectRatio,
    SubtitleAddRequest,
    VideoProcessingError,
    CompositionErrorDetails,
    VideoProcessingStage
)
from app.models.youtube_models import YoutubeVideoDownloadRequest
from app.services.subtitle_service import SubtitleService
from app.services.youtube_service import YouTubeService

logger = get_logger(__name__)


class VideoCompositionService:
    """
    Service for composing videos from timeline data.
    """
    
    def __init__(self):
        """Initialize the video composition service."""
        self.compositions: Dict[str, Dict[str, Any]] = {}
        self.output_dir = Path("static/video/composed")
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        # Load video download configuration
        self._load_video_download_config()
        
        # Initialize subtitle service for subtitle composition
        self.subtitle_service = SubtitleService()
        
        # Initialize YouTube service for YouTube video downloads
        self.youtube_service = YouTubeService()
        
        # Check ffmpeg availability
        self._check_ffmpeg()
        
        logger.info("VideoCompositionService initialized with subtitle and YouTube support")
    
    def _check_ffmpeg(self) -> bool:
        """Check if ffmpeg is available."""
        try:
            subprocess.run(['ffmpeg', '-version'], 
                         capture_output=True, check=True)
            logger.info("ffmpeg is available")
            return True
        except (subprocess.CalledProcessError, FileNotFoundError):
            logger.error("ffmpeg not found - video composition will not work")
            return False
    
    def _get_ffmpeg_path(self) -> Optional[str]:
        """Get ffmpeg executable path."""
        try:
            subprocess.run(['ffmpeg', '-version'], 
                         capture_output=True, check=True)
            return 'ffmpeg'
        except (subprocess.CalledProcessError, FileNotFoundError):
            logger.error("ffmpeg not available")
            return None
    
    def _ensure_even_dimensions(self, width: int, height: int) -> Tuple[int, int]:
        """Ensure dimensions are even numbers (divisible by 2) for H.264 encoding."""
        # Round up to next even number if odd
        even_width = width if width % 2 == 0 else width + 1
        even_height = height if height % 2 == 0 else height + 1
        return even_width, even_height
    
    def _load_video_download_config(self):
        """Load video download configuration from YAML file."""
        try:
            config_path = Path("config/video-download.yaml")
            if config_path.exists():
                with open(config_path, 'r', encoding='utf-8') as f:
                    self.video_download_config = yaml.safe_load(f)
                logger.info("Video download configuration loaded successfully")
            else:
                # Default configuration if file doesn't exist
                self.video_download_config = {
                    'pexels': {
                        'retry': {
                            'max_retries': 5,
                            'switch_api_key_on_retry': True,
                            'download_timeout': 120,
                            'retry_delay': 2.0
                        },
                        'download': {
                            'max_file_size_mb': 500,
                            'min_file_size_kb': 1
                        }
                    },
                    'general': {
                        'cleanup_temp_files': True,
                        'detailed_logging': True
                    }
                }
                logger.warning("Video download config file not found, using defaults")
        except Exception as e:
            logger.error(f"Failed to load video download configuration: {str(e)}")
            # Use default configuration
            self.video_download_config = {
                'pexels': {
                    'retry': {
                        'max_retries': 5,
                        'switch_api_key_on_retry': True,
                        'download_timeout': 120,
                        'retry_delay': 2.0
                    }
                }
            }
    
    def _is_youtube_url(self, url: str) -> bool:
        """Check if the URL is a YouTube URL."""
        return "youtube.com" in url or "youtu.be" in url
    
    def _is_pexels_url(self, url: str) -> bool:
        """Check if URL is a Pexels video URL."""
        return "pexels.com" in url.lower()
    
    def _get_video_properties(self, video_path: str) -> tuple:
        """Get video properties (width, height, fps)."""
        try:
            cap = cv2.VideoCapture(video_path)
            if not cap.isOpened():
                return None, None, None
            
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            fps = cap.get(cv2.CAP_PROP_FPS)
            
            cap.release()
            return width, height, fps
        except Exception as e:
            logger.error(f"Failed to get video properties: {str(e)}")
            return None, None, None
    
    def _download_video_with_retry(self, video_url: str, temp_dir: str, index: int, video_item: VideoCompositionItem, max_retries: int = 3) -> Dict[str, Any]:
        """Download a single video file with retry mechanism."""
        thread_id = threading.current_thread().ident
        video_name = f"video_{index}.mp4"
        video_path = os.path.join(temp_dir, video_name)
        
        logger.info(f"[Thread {thread_id}] Starting video download with retry: {video_url} (max_retries: {max_retries})")
        
        last_error = None
        
        for attempt in range(max_retries + 1):
            try:
                logger.info(f"[Thread {thread_id}] Download attempt {attempt + 1}/{max_retries + 1} for video {index}")
                
                # Call the existing download method
                result = self._download_video(video_url, temp_dir, index)
                
                if result.get('success'):
                    if attempt > 0:
                        logger.info(f"[Thread {thread_id}] Video download succeeded on retry attempt {attempt + 1}")
                    else:
                        logger.info(f"[Thread {thread_id}] Video download succeeded on first attempt")
                    return result
                else:
                    last_error = result.get('error', 'Unknown download error')
                    logger.warning(f"[Thread {thread_id}] Download attempt {attempt + 1} failed: {last_error}")
                    
                    if attempt >= max_retries:
                        break
                        
                    # Wait before retry with exponential backoff
                    wait_time = min(2 ** attempt, 10)  # Cap at 10 seconds
                    logger.info(f"[Thread {thread_id}] Waiting {wait_time}s before retry {attempt + 2}")
                    time.sleep(wait_time)
                    
            except Exception as e:
                last_error = str(e)
                logger.error(f"[Thread {thread_id}] Download attempt {attempt + 1} exception: {last_error}")
                
                if attempt >= max_retries:
                    break
                    
                # Wait before retry
                wait_time = min(2 ** attempt, 10)
                logger.info(f"[Thread {thread_id}] Waiting {wait_time}s before retry {attempt + 2}")
                time.sleep(wait_time)
        
        # All attempts failed
        error_details = {
            "success": False,
            "error": f"Video download failed after {max_retries + 1} attempts",
            "last_error": last_error,
            "attempts": max_retries + 1,
            "video_details": {
                "index": index,
                "id": video_item.id,
                "name": video_item.name,
                "url": video_url,
                "timeline_position": video_item.start_time,
                "duration": video_item.duration
            }
        }
        
        logger.error(f"[Thread {thread_id}] All download attempts failed for video {index}: {last_error}")
        return error_details

    def _normalize_video_with_retry(self, video_info: Dict[str, Any], max_retries: int = 3) -> Dict[str, Any]:
        """Normalize a single video with retry mechanism."""
        logger.info(f"Starting video normalization with retry: index {video_info['index']} (max_retries: {max_retries})")
        
        last_error = None
        
        for attempt in range(max_retries + 1):
            try:
                logger.info(f"Normalization attempt {attempt + 1}/{max_retries + 1} for video {video_info['index']}")
                
                # Call the existing normalization method
                result = self._normalize_video(video_info)
                
                if result.get('success'):
                    if attempt > 0:
                        logger.info(f"Video normalization succeeded on retry attempt {attempt + 1}")
                    else:
                        logger.info(f"Video normalization succeeded on first attempt")
                    return result
                else:
                    last_error = result.get('error', 'Unknown normalization error')
                    logger.warning(f"Normalization attempt {attempt + 1} failed: {last_error}")
                    
                    if attempt >= max_retries:
                        break
                        
                    # Wait before retry with exponential backoff
                    wait_time = min(2 ** attempt, 10)
                    logger.info(f"Waiting {wait_time}s before normalization retry {attempt + 2}")
                    time.sleep(wait_time)
                    
            except Exception as e:
                last_error = str(e)
                logger.error(f"Normalization attempt {attempt + 1} exception: {last_error}")
                
                if attempt >= max_retries:
                    break
                    
                # Wait before retry
                wait_time = min(2 ** attempt, 10)
                logger.info(f"Waiting {wait_time}s before normalization retry {attempt + 2}")
                time.sleep(wait_time)
        
        # All attempts failed
        error_details = {
            "success": False,
            "error": f"Video normalization failed after {max_retries + 1} attempts",
            "last_error": last_error,
            "attempts": max_retries + 1,
            "video_details": video_info
        }
        
        logger.error(f"All normalization attempts failed for video {video_info['index']}: {last_error}")
        return error_details
    
    def _download_video(self, video_url: str, temp_dir: str, index: int) -> Dict[str, Any]:
        """Download a single video file."""
        thread_id = threading.current_thread().ident
        video_name = f"video_{index}.mp4"
        video_path = os.path.join(temp_dir, video_name)
        
        logger.info(f"[Thread {thread_id}] Downloading video: {video_url}")
        
        # Check if it's a YouTube URL
        if self._is_youtube_url(video_url):
            logger.info(f"[Thread {thread_id}] Detected YouTube URL, using yt-dlp for download")
            return self._download_youtube_video(video_url, video_path, thread_id)
        # Check if it's a Pexels URL
        elif self._is_pexels_url(video_url):
            logger.info(f"[Thread {thread_id}] Detected Pexels URL, using retry logic with API key switching")
            return self._download_pexels_video_with_retry(video_url, video_path, thread_id)
        else:
            logger.info(f"[Thread {thread_id}] Using FFmpeg for direct video URL download")
            return self._download_video_with_ffmpeg(video_url, video_path, thread_id)
    
    def _download_youtube_video(self, video_url: str, target_path: str, thread_id: int) -> Dict[str, Any]:
        """Download YouTube video using YouTubeService."""
        try:
            # Create download request
            download_request = YoutubeVideoDownloadRequest(
                url=video_url,
                video_quality="720p",  # Use reasonable quality for composition
                format_type="mp4"
            )
            
            logger.info(f"[Thread {thread_id}] Starting YouTube download with yt-dlp")
            
            # Download using YouTube service
            result = self.youtube_service.download_video(download_request)
            
            if not result.success:
                error_msg = f"YouTube download failed: {result.error or result.message}"
                logger.error(f"[Thread {thread_id}] {error_msg}")
                return {"success": False, "error": error_msg}
            
            # Move downloaded file to target location
            if result.file_path and os.path.exists(result.file_path):
                try:
                    shutil.move(result.file_path, target_path)
                    file_size = os.path.getsize(target_path)
                    logger.info(f"[Thread {thread_id}] YouTube download successful: {file_size / 1024 / 1024:.2f}MB")
                    return {"success": True, "output_path": target_path}
                except Exception as e:
                    error_msg = f"Failed to move downloaded file: {str(e)}"
                    logger.error(f"[Thread {thread_id}] {error_msg}")
                    return {"success": False, "error": error_msg}
            else:
                error_msg = "Downloaded file not found"
                logger.error(f"[Thread {thread_id}] {error_msg}")
                return {"success": False, "error": error_msg}
                
        except Exception as e:
            error_msg = f"YouTube download error: {str(e)}"
            logger.error(f"[Thread {thread_id}] {error_msg}", exc_info=True)
            return {"success": False, "error": error_msg}
    
    def _download_pexels_video_with_retry(self, video_url: str, video_path: str, thread_id: int) -> Dict[str, Any]:
        """Download Pexels video with API key retry logic."""
        config = self.video_download_config.get('pexels', {})
        retry_config = config.get('retry', {})
        
        max_retries = retry_config.get('max_retries', 5)
        switch_api_key = retry_config.get('switch_api_key_on_retry', True)
        retry_delay = retry_config.get('retry_delay', 2.0)
        
        logger.info(f"[Thread {thread_id}] Starting Pexels video download with retry logic (max_retries: {max_retries})")
        
        # Get available API keys
        api_keys = getattr(settings, 'pexels_api_keys', [])
        if not api_keys:
            logger.error(f"[Thread {thread_id}] No Pexels API keys available for retry logic")
            return self._download_video_with_ffmpeg(video_url, video_path, thread_id)
        
        # Try with different API keys if configured
        used_keys = set()
        
        for attempt in range(max_retries + 1):
            try:
                # Select API key for this attempt
                if switch_api_key and len(api_keys) > 1:
                    # Get unused API keys
                    available_keys = [key for key in api_keys if key not in used_keys]
                    if not available_keys:
                        # If all keys used, reset and use all keys again
                        used_keys.clear()
                        available_keys = api_keys
                    
                    current_api_key = random.choice(available_keys)
                    used_keys.add(current_api_key)
                else:
                    current_api_key = api_keys[0] if api_keys else None
                
                if attempt > 0:
                    logger.info(f"[Thread {thread_id}] Retry attempt {attempt}/{max_retries} for Pexels download")
                    if switch_api_key:
                        logger.info(f"[Thread {thread_id}] Using API key: {current_api_key[:10]}...{current_api_key[-5:] if current_api_key else 'None'}")
                    time.sleep(retry_delay)
                
                # Attempt download with current configuration
                result = self._download_video_with_ffmpeg(video_url, video_path, thread_id)
                
                if result.get('success'):
                    if attempt > 0:
                        logger.info(f"[Thread {thread_id}] Pexels download succeeded on retry attempt {attempt}")
                    else:
                        logger.info(f"[Thread {thread_id}] Pexels download succeeded on first attempt")
                    return result
                else:
                    error_msg = result.get('error', 'Unknown error')
                    logger.warning(f"[Thread {thread_id}] Pexels download attempt {attempt + 1} failed: {error_msg}")
                    
                    # If this is the last attempt, return the error
                    if attempt >= max_retries:
                        logger.error(f"[Thread {thread_id}] All Pexels download attempts failed after {max_retries + 1} tries")
                        return result
                
            except Exception as e:
                error_msg = f"Pexels download attempt {attempt + 1} error: {str(e)}"
                logger.error(f"[Thread {thread_id}] {error_msg}")
                
                if attempt >= max_retries:
                    return {"success": False, "error": f"All retry attempts failed. Last error: {error_msg}"}
        
        # This should not be reached, but just in case
        return {"success": False, "error": "Maximum retry attempts exceeded"}
    
    def _download_video_with_ffmpeg(self, video_url: str, video_path: str, thread_id: int) -> Dict[str, Any]:
        """Download video using FFmpeg (for non-YouTube URLs)."""
        ffmpeg_path = self._get_ffmpeg_path()
        if not ffmpeg_path:
            return {"success": False, "error": "ffmpeg not available"}
        
        # Use ffmpeg to download video
        download_cmd = [
            ffmpeg_path,
            '-y',
            '-i', video_url,
            '-c', 'copy',
            video_path
        ]
        
        try:
            logger.info(f"[Thread {thread_id}] Executing FFmpeg download command")
            result = subprocess.run(download_cmd, capture_output=True, 
                                  text=True, timeout=120)
            
            if result.returncode != 0:
                error_msg = f"FFmpeg download failed: {result.stderr}"
                logger.error(f"[Thread {thread_id}] {error_msg}")
                return {"success": False, "error": error_msg}
            
            # Check file exists and has reasonable size
            if not os.path.exists(video_path):
                return {"success": False, "error": "Downloaded file not found"}
            
            file_size = os.path.getsize(video_path)
            if file_size < 1024:  # Less than 1KB
                return {"success": False, "error": "Downloaded file too small"}
            
            logger.info(f"[Thread {thread_id}] FFmpeg download successful: {file_size / 1024 / 1024:.2f}MB")
            return {"success": True, "output_path": video_path}
            
        except subprocess.TimeoutExpired:
            return {"success": False, "error": "Download timeout"}
        except Exception as e:
            return {"success": False, "error": f"Download error: {str(e)}"}
    
    def _normalize_video(self, video_info: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize a single video to target specifications with optional clipping."""
        thread_id = threading.current_thread().ident
        video_path = video_info['video_path']
        index = video_info['index']
        temp_dir = video_info['temp_dir']
        ffmpeg_path = video_info['ffmpeg_path']
        
        # 新增：剪辑参数
        clip_start = video_info.get('clip_start', 0.0)
        clip_end = video_info.get('clip_end', None)
        
        logger.info(f"[Thread {thread_id}] Normalizing video {index + 1}")
        logger.info(f"[Thread {thread_id}] Clipping parameters: start={clip_start}s, end={clip_end}s")
        
        # Get video properties
        width, height, fps = self._get_video_properties(video_path)
        if width is None:
            return {"success": False, "error": f"Cannot get video properties: {video_path}", "index": index}
        
        # Get video duration
        cap = cv2.VideoCapture(video_path)
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        original_duration = frame_count / fps if fps > 0 else 0
        cap.release()
        
        # 计算实际的剪辑参数
        actual_clip_start = max(0.0, clip_start)
        actual_clip_end = min(original_duration, clip_end) if clip_end is not None else original_duration
        clip_duration = actual_clip_end - actual_clip_start
        
        logger.info(f"[Thread {thread_id}] Video properties: {width}x{height}, {fps:.2f}fps, original={original_duration:.2f}s")
        logger.info(f"[Thread {thread_id}] Clipping: start={actual_clip_start:.2f}s, end={actual_clip_end:.2f}s, duration={clip_duration:.2f}s")
        
        # Validate clipping parameters
        if clip_duration <= 0:
            error_msg = f"Invalid clipping parameters: clip duration is {clip_duration:.2f}s"
            logger.error(f"[Thread {thread_id}] {error_msg}")
            return {"success": False, "error": error_msg, "index": index}
        
        # Normalize video with clipping
        normalized_path = os.path.join(temp_dir, f"normalized_{index}.mp4")
        
        # 获取目标视频的宽高比信息
        target_aspect_ratio = self._get_aspect_ratio_info(video_info['target_aspect_ratio'])
        target_width = target_aspect_ratio["width"]
        target_height = target_aspect_ratio["height"]
        
        # 计算缩放和填充参数
        scaling_params = self._calculate_video_scaling(width, height, target_width, target_height)
        vf_params = self._build_video_filter(scaling_params)
        
        # 构建FFmpeg命令，包含剪辑参数
        normalize_cmd = [
            ffmpeg_path,
            '-y'
        ]
        
        # 添加剪辑参数
        if actual_clip_start > 0:
            normalize_cmd.extend(['-ss', str(actual_clip_start)])
        
        normalize_cmd.extend([
            '-i', video_path
        ])
        
        # 如果需要限制时长
        if clip_duration < original_duration:
            normalize_cmd.extend(['-t', str(clip_duration)])
        
        normalize_cmd.extend([
            '-vf', vf_params,
            '-r', str(video_info['target_fps']),
            '-c:v', 'libx264',
            '-preset', 'medium',
            '-profile:v', 'high',
            '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart',
            '-avoid_negative_ts', 'make_zero',
            normalized_path
        ])
        
        try:
            logger.info(f"[Thread {thread_id}] Running FFmpeg command: {' '.join(normalize_cmd)}")
            result = subprocess.run(normalize_cmd, capture_output=True, text=True)
            
            if result.returncode != 0:
                error_msg = f"Normalization failed: {result.stderr}"
                logger.error(f"[Thread {thread_id}] {error_msg}")
                return {"success": False, "error": error_msg, "index": index}
            
            logger.info(f"[Thread {thread_id}] Video {index + 1} normalized and clipped successfully")
            return {
                "success": True,
                "normalized_path": normalized_path,
                "used_duration": clip_duration,
                "index": index
            }
            
        except Exception as e:
            error_msg = f"Normalization error: {str(e)}"
            logger.error(f"[Thread {thread_id}] {error_msg}")
            return {"success": False, "error": error_msg, "index": index}
    
    def start_video_composition(self, request: VideoCompositionRequest) -> VideoCompositionResponse:
        """
        Start video composition asynchronously and return immediately with composition_id.
        """
        composition_id = str(uuid.uuid4())
        start_time = time.time()
        
        logger.info(f"Starting async video composition {composition_id} for task {request.task_id}")
        logger.info(f"Video items: {len(request.video_items)}, Audio items: {len(request.audio_items)}, Subtitle items: {len(request.subtitle_items)}")
        logger.info(f"Total composition duration: {request.total_duration}s")
        
        # Store composition info with initial status
        self.compositions[composition_id] = {
            "id": composition_id,
            "task_id": request.task_id,
            "status": "processing",
            "progress": 0.0,
            "start_time": start_time,
            "request": request
        }
        
        # Start background processing
        threading.Thread(
            target=self._process_video_composition_async,
            args=(composition_id, request),
            daemon=True
        ).start()
        
        # Return immediately with processing status
        return VideoCompositionResponse(
            success=True,
            message="Video composition started successfully",
            composition_id=composition_id,
            status="processing",
            progress=0.0
        )
    
    def _process_video_composition_async(self, composition_id: str, request: VideoCompositionRequest):
        """
        Process video composition in background thread.
        """
        try:
            logger.info(f"Background processing started for composition {composition_id}")
            
            # Call the original synchronous composition method
            # Status updates are handled within _compose_video_sync
            result = self._compose_video_sync(composition_id, request)
            
            if result.success:
                logger.info(f"Async composition {composition_id} completed successfully")
            else:
                logger.error(f"Async composition {composition_id} failed: {result.message}")
                
        except Exception as e:
            error_msg = f"Async video composition failed: {str(e)}"
            logger.error(error_msg, exc_info=True)
            
            # Update composition status on unexpected errors
            if composition_id in self.compositions:
                self.compositions[composition_id].update({
                    "status": "failed",
                    "error_details": {"error": error_msg},
                    "failed_at": datetime.utcnow()
                })

    def _compose_video_sync(self, composition_id: str, request: VideoCompositionRequest) -> VideoCompositionResponse:
        """
        Compose video from timeline data (synchronous processing).
        """
        start_time = time.time()
        
        logger.info(f"Starting video composition {composition_id} for task {request.task_id}")
        logger.info(f"Video items: {len(request.video_items)}, Audio items: {len(request.audio_items)}, Subtitle items: {len(request.subtitle_items)}, Image items: {len(request.image_items)}")
        logger.info(f"Frontend provided total duration: {request.total_duration}s")
        
        # Calculate actual total duration from clipped video segments
        actual_total_duration = 0
        clipped_video_durations = []
        
        for i, video_item in enumerate(request.video_items):
            # Safely get clipping parameters with proper defaults
            clip_start = getattr(video_item, 'clip_start', None) or 0.0
            clip_end = getattr(video_item, 'clip_end', None) or video_item.duration
            
            # Validate clipping parameters
            if clip_start < 0:
                logger.warning(f"Video {i+1}: Invalid clip_start {clip_start}, setting to 0.0")
                clip_start = 0.0
                
            if clip_end <= clip_start:
                logger.warning(f"Video {i+1}: Invalid clip_end {clip_end} <= clip_start {clip_start}, using full duration")
                clip_end = video_item.duration
            
            clipped_duration = clip_end - clip_start
            
            # Validate calculated duration
            if clipped_duration <= 0:
                logger.error(f"Video {i+1}: Invalid clipped duration {clipped_duration}s, this will cause composition failure")
                raise ValueError(f"Video item {video_item.id} has invalid clipping parameters: start={clip_start}s, end={clip_end}s")
            
            clipped_video_durations.append(clipped_duration)
            actual_total_duration += clipped_duration
            
            logger.info(f"Video {i+1} duration calculation: "
                       f"clip_start={clip_start}s, clip_end={clip_end}s, "
                       f"clipped_duration={clipped_duration}s, "
                       f"original_duration={getattr(video_item, 'original_duration', 'N/A')}s")
        
        logger.info(f"Duration calculation summary: "
                   f"frontend_total={request.total_duration}s, "
                   f"actual_clipped_total={actual_total_duration}s, "
                   f"difference={actual_total_duration - request.total_duration}s")
        
        # Use actual_total_duration for all processing instead of request.total_duration
        # This ensures the final video and audio match the actual clipped content
        
        # 前端已确保正确的时间轴顺序，后端直接按接收到的顺序处理
        # 记录接收到的项目顺序以便调试
        logger.info("接收到的视频项目顺序（前端已排序）", extra={
            "video_items_order": [
                {
                    "index": i,
                    "id": item.id,
                    "name": item.name,
                    "start_time": item.start_time,
                    "duration": item.duration,
                    "track_id": item.track_id,
                    "clipped_duration": clipped_video_durations[i] if i < len(clipped_video_durations) else 0
                }
                for i, item in enumerate(request.video_items)
            ],
            "audio_items_order": [
                {
                    "index": i,
                    "id": item.id,
                    "name": item.name,
                    "start_time": item.start_time,
                    "duration": item.duration,
                    "track_id": item.track_id
                }
                for i, item in enumerate(request.audio_items)
            ],
            "image_items_order": [
                {
                    "index": i,
                    "id": item.id,
                    "name": item.name,
                    "start_time": item.start_time,
                    "duration": item.duration,
                    "track_id": item.track_id,
                    "position": item.position.__dict__ if hasattr(item.position, '__dict__') else item.position
                }
                for i, item in enumerate(request.image_items)
            ]
        })
        
        # Log individual video and audio items for debugging
        for i, video_item in enumerate(request.video_items):
            # 增强日志：包含裁剪信息 - 使用安全的属性访问
            clip_start = getattr(video_item, 'clip_start', None) or 0.0
            clip_end = getattr(video_item, 'clip_end', None) or video_item.duration
            is_trimmed = clip_start > 0.0 or clip_end != video_item.duration
            
            logger.info(f"Video item {i+1} (裁剪详情): "
                       f"timeline_start={video_item.start_time}s, "
                       f"timeline_duration={video_item.duration}s, "
                       f"timeline_end={video_item.start_time + video_item.duration}s, "
                       f"clip_start={clip_start}s, "
                       f"clip_end={clip_end}s, "
                       f"clip_duration={clip_end - clip_start}s, "
                       f"is_trimmed={is_trimmed}, "
                       f"url={video_item.url}")
                       
        for i, audio_item in enumerate(request.audio_items):
            # 增强日志：包含音频裁剪信息 - 使用安全的属性访问
            clip_start = getattr(audio_item, 'clip_start', None) or 0.0
            clip_end = getattr(audio_item, 'clip_end', None) or audio_item.duration
            is_trimmed = clip_start > 0.0 or clip_end != audio_item.duration
            
            logger.info(f"Audio item {i+1} (裁剪详情): "
                       f"timeline_start={audio_item.start_time}s, "
                       f"timeline_duration={audio_item.duration}s, "
                       f"timeline_end={audio_item.start_time + audio_item.duration}s, "
                       f"clip_start={clip_start}s, "
                       f"clip_end={clip_end}s, "
                       f"clip_duration={clip_end - clip_start}s, "
                       f"is_trimmed={is_trimmed}, "
                       f"url={audio_item.url}")
                       
        # Log individual image items for debugging
        for i, image_item in enumerate(request.image_items):
            logger.info(f"Image item {i+1} (叠加详情): "
                       f"timeline_start={image_item.start_time}s, "
                       f"timeline_duration={image_item.duration}s, "
                       f"timeline_end={image_item.start_time + image_item.duration}s, "
                       f"position={{x:{image_item.position.x}, y:{image_item.position.y}, w:{image_item.position.width}, h:{image_item.position.height}}}, "
                       f"opacity={image_item.opacity}, "
                       f"url={image_item.url}")
                       
        # 统计裁剪信息 - 使用安全的属性访问
        trimmed_video_count = sum(1 for item in request.video_items 
                                if (getattr(item, 'clip_start', None) and getattr(item, 'clip_start', 0.0) > 0.0) or
                                   (getattr(item, 'clip_end', None) and getattr(item, 'clip_end', item.duration) != item.duration))
        trimmed_audio_count = sum(1 for item in request.audio_items 
                                if (getattr(item, 'clip_start', None) and getattr(item, 'clip_start', 0.0) > 0.0) or
                                   (getattr(item, 'clip_end', None) and getattr(item, 'clip_end', item.duration) != item.duration))
                                   
        logger.info(f"裁剪统计: {trimmed_video_count}/{len(request.video_items)} 视频片段被裁剪, "
                   f"{trimmed_audio_count}/{len(request.audio_items)} 音频片段被裁剪, "
                   f"将使用实际裁剪总时长: {actual_total_duration}s")
        
        try:
            # Create temporary directory
            temp_dir = os.path.join(tempfile.gettempdir(), f"video_compose_{composition_id}")
            os.makedirs(temp_dir, exist_ok=True)
            
            # Output file path
            output_filename = f"composed_{composition_id}.{request.output_format}"
            output_path = self.output_dir / output_filename
            
            logger.info(f"Temp directory: {temp_dir}")
            logger.info(f"Output path: {output_path}")
            
            # Update progress
            if composition_id in self.compositions:
                self.compositions[composition_id]["progress"] = 0.1
            
            # Download videos with retry mechanism and URL deduplication
            logger.info("Starting video downloads with retry mechanism and URL deduplication...")
            
            # Analyze video URLs to find duplicates
            url_to_indices = {}  # URL -> list of indices that use this URL
            unique_urls = []     # List of unique URLs to download
            
            for i, item in enumerate(request.video_items):
                url = item.url
                if url not in url_to_indices:
                    url_to_indices[url] = []
                    unique_urls.append(url)
                url_to_indices[url].append(i)
            
            # Log URL analysis results
            total_videos = len(request.video_items)
            unique_count = len(unique_urls)
            duplicate_count = total_videos - unique_count
            
            logger.info(f"URL deduplication analysis: {total_videos} total videos, {unique_count} unique URLs, {duplicate_count} duplicates")
            for url, indices in url_to_indices.items():
                if len(indices) > 1:
                    logger.info(f"URL '{url}' used by video indices: {indices}")
            
            downloaded_videos = [None] * len(request.video_items)  # Pre-allocate with correct size
            failed_downloads = []
            url_to_downloaded_path = {}  # URL -> downloaded file path mapping
            
            # Download unique URLs only
            with ThreadPoolExecutor(max_workers=5) as executor:
                # Create futures for unique URLs only
                futures = {
                    executor.submit(self._download_video_with_retry, url, temp_dir, unique_urls.index(url), request.video_items[url_to_indices[url][0]]): url 
                    for url in unique_urls
                }
                
                # Collect download results
                for future in as_completed(futures):
                    url = futures[future]
                    result = future.result()
                    url_index = unique_urls.index(url)
                    
                    if result['success']:
                        downloaded_path = result['output_path']
                        url_to_downloaded_path[url] = downloaded_path
                        logger.info(f"Downloaded unique URL {len(url_to_downloaded_path)}/{unique_count}: {url}")
                    else:
                        # Record failure for all video items using this URL
                        for video_index in url_to_indices[url]:
                            video_item = request.video_items[video_index]
                            failed_download = VideoProcessingError(
                                video_index=video_index,
                                video_id=video_item.id,
                                video_name=video_item.name,
                                video_url=video_item.url,
                                stage=VideoProcessingStage.DOWNLOAD,
                                attempts=result.get('attempts', 1),
                                max_retries=3,
                                error_message=result.get('error', 'Unknown download error'),
                                last_error=result.get('last_error', 'Unknown error'),
                                timeline_position=video_item.start_time,
                                duration=video_item.duration
                            )
                            failed_downloads.append(failed_download)
                        logger.error(f"URL download failed permanently: {url}, affecting {len(url_to_indices[url])} videos")
            
            # Check if any downloads failed
            if failed_downloads:
                error_details = CompositionErrorDetails(
                    failed_videos=failed_downloads,
                    total_videos=len(request.video_items),
                    successful_videos=total_videos - len(failed_downloads),
                    composition_stage="video_download",
                    error_summary=f"{len(failed_downloads)} out of {len(request.video_items)} videos failed to download after 3 retry attempts",
                    recovery_suggestions=[
                        "Check if the video URLs are accessible",
                        "Verify your internet connection",
                        "Try using different video sources",
                        "Contact support if the issue persists"
                    ]
                )
                
                # Return detailed error response
                logger.error(f"Video composition failed: {len(failed_downloads)} videos failed to download")
                self.compositions[composition_id] = {
                    "status": "failed", 
                    "progress": 0.3,
                    "error": error_details.error_summary,
                    "error_details": error_details
                }
                
                return VideoCompositionResponse(
                    success=False,
                    message=error_details.error_summary,
                    composition_id=composition_id,
                    status="failed",
                    progress=0.3,
                    error_details=error_details
                )
            
            # Create file copies for videos with duplicate URLs
            logger.info("Creating file copies for duplicate URLs...")
            for url, indices in url_to_indices.items():
                if url in url_to_downloaded_path:
                    original_path = url_to_downloaded_path[url]
                    
                    for video_index in indices:
                        if video_index == indices[0]:
                            # First video uses the original downloaded file
                            downloaded_videos[video_index] = original_path
                        else:
                            # Create copy for duplicate URLs
                            copy_name = f"video_{video_index}.mp4"
                            copy_path = os.path.join(temp_dir, copy_name)
                            try:
                                shutil.copy2(original_path, copy_path)
                                downloaded_videos[video_index] = copy_path
                                logger.info(f"Created copy for video index {video_index} from URL: {url}")
                            except Exception as e:
                                logger.error(f"Failed to create copy for video index {video_index}: {str(e)}")
                                # Use original file as fallback
                                downloaded_videos[video_index] = original_path
            
            # Verify all videos are assigned
            missing_videos = [i for i, path in enumerate(downloaded_videos) if path is None]
            if missing_videos:
                logger.error(f"Missing downloaded videos for indices: {missing_videos}")
                return VideoCompositionResponse(
                    success=False,
                    message=f"Internal error: missing downloaded videos for indices {missing_videos}",
                    composition_id=composition_id,
                    status="failed",
                    progress=0.3
                )
                    
            logger.info(f"Video download completed with URL deduplication", extra={
                "total_videos": total_videos,
                "unique_downloads": unique_count,
                "duplicates_handled": duplicate_count,
                "downloaded_order": [
                    {"index": i, "path": path.split('/')[-1] if path else None} 
                    for i, path in enumerate(downloaded_videos)
                ]
            })
            
            # Update progress
            self.compositions[composition_id]["progress"] = 0.4
            
            # Get target video parameters from request
            target_fps = request.output_fps
            target_aspect_ratio = request.aspect_ratio
            
            logger.info(f"Target composition parameters: aspect_ratio={target_aspect_ratio}, fps={target_fps}")
            
            # Normalize videos
            logger.info("Starting video normalization...")
            ffmpeg_path = self._get_ffmpeg_path()
            
            video_tasks = []
            for i, video_path in enumerate(downloaded_videos):
                # 获取对应的视频项目以获取剪辑信息
                video_item = request.video_items[i] if i < len(request.video_items) else None
                
                video_info = {
                    'video_path': video_path,
                    'index': i,
                    'temp_dir': temp_dir,
                    'target_fps': target_fps,
                    'ffmpeg_path': ffmpeg_path,
                    # 新增：剪辑参数 - 使用安全的属性访问
                    'clip_start': getattr(video_item, 'clip_start', None) or 0.0 if video_item else 0.0,
                    'clip_end': getattr(video_item, 'clip_end', None) if video_item else None,
                    # 新增：目标宽高比
                    'target_aspect_ratio': target_aspect_ratio
                }
                video_tasks.append(video_info)
                
                # 记录剪辑信息
                if video_item:
                    clip_start = getattr(video_item, 'clip_start', None) or 0.0
                    clip_end = getattr(video_item, 'clip_end', None) or video_item.duration
                    logger.info(f"Video {i+1} clipping: {clip_start:.2f}s - {clip_end:.2f}s")
            
            normalized_videos = []
            failed_normalizations = []
            with ThreadPoolExecutor(max_workers=5) as executor:
                futures = {executor.submit(self._normalize_video_with_retry, task): task['index'] for task in video_tasks}
                
                # 收集结果并保持原始顺序
                norm_results = {}
                for future in as_completed(futures):
                    original_index = futures[future]
                    result = future.result()
                    if result['success']:
                        norm_results[original_index] = result['normalized_path']
                        logger.info(f"Normalized video {len(norm_results)}/{len(video_tasks)} (index: {original_index})")
                    else:
                        # Record detailed failure information
                        video_item = request.video_items[original_index]
                        failed_normalization = VideoProcessingError(
                            video_index=original_index,
                            video_id=video_item.id,
                            video_name=video_item.name,
                            video_url=video_item.url,
                            stage=VideoProcessingStage.NORMALIZATION,
                            attempts=result.get('attempts', 1),
                            max_retries=3,
                            error_message=result.get('error', 'Unknown normalization error'),
                            last_error=result.get('last_error', 'Unknown error'),
                            timeline_position=video_item.start_time,
                            duration=video_item.duration
                        )
                        failed_normalizations.append(failed_normalization)
                        logger.error(f"Video normalization failed permanently at index {original_index}: {result['error']}")
                
                # Check if any normalizations failed
                if failed_normalizations:
                    error_details = CompositionErrorDetails(
                        failed_videos=failed_normalizations,
                        total_videos=len(request.video_items),
                        successful_videos=len(norm_results),
                        composition_stage="video_normalization",
                        error_summary=f"{len(failed_normalizations)} out of {len(request.video_items)} videos failed to normalize after 3 retry attempts",
                        recovery_suggestions=[
                            "Check if the downloaded video files are corrupted",
                            "Verify that FFmpeg is properly installed and accessible",
                            "Try reducing the target resolution or frame rate",
                            "Ensure there is enough disk space for video processing"
                        ]
                    )
                    
                    # Return detailed error response
                    logger.error(f"Video composition failed: {len(failed_normalizations)} videos failed to normalize")
                    self.compositions[composition_id] = {
                        "status": "failed", 
                        "progress": 0.6,
                        "error": error_details.error_summary,
                        "error_details": error_details
                    }
                    
                    return VideoCompositionResponse(
                        success=False,
                        message=error_details.error_summary,
                        composition_id=composition_id,
                        status="failed",
                        progress=0.6,
                        error_details=error_details
                    )
                
                # 按原始顺序添加到列表
                for i in range(len(video_tasks)):
                    normalized_videos.append(norm_results[i])
                    
            logger.info(f"Video normalization completed in correct order", extra={
                "normalized_order": [
                    {"index": i, "path": path.split('/')[-1]} 
                    for i, path in enumerate(normalized_videos)
                ]
            })
            
            # Update progress
            self.compositions[composition_id]["progress"] = 0.7
            
            # Create concat file
            concat_list_path = os.path.join(temp_dir, "concat_list.txt")
            with open(concat_list_path, 'w', encoding='utf-8') as f:
                for video in normalized_videos:
                    video_path_for_concat = video.replace('\\', '/')
                    f.write(f"file '{video_path_for_concat}'\n")
            
            logger.info(f"Created concat list with {len(normalized_videos)} videos")
            
            # Combine videos
            logger.info("Combining videos...")
            concat_cmd = [
                ffmpeg_path,
                '-y',
                '-f', 'concat',
                '-safe', '0',
                '-i', concat_list_path,
                '-c', 'copy',
                str(output_path)
            ]
            
            result = subprocess.run(concat_cmd, capture_output=True, text=True)
            
            if result.returncode != 0:
                # Try with re-encoding if direct copy fails
                logger.warning("Direct copy failed, trying re-encoding...")
                concat_cmd = [
                    ffmpeg_path,
                    '-y',
                    '-f', 'concat',
                    '-safe', '0',
                    '-i', concat_list_path,
                    '-c:v', 'libx264',
                    '-preset', 'medium',
                    '-profile:v', 'high',
                    '-pix_fmt', 'yuv420p',
                    str(output_path)
                ]
                
                result = subprocess.run(concat_cmd, capture_output=True, text=True)
                
                if result.returncode != 0:
                    raise Exception(f"Video concatenation failed: {result.stderr}")
            
            # Update progress
            self.compositions[composition_id]["progress"] = 0.9
            
            # Handle audio if present
            if request.audio_items:
                logger.info("Processing audio tracks...")
                try:
                    # Create audio mix from audio items using actual video duration
                    audio_mix_path = os.path.join(temp_dir, "audio_mix.wav")
                    
                    processed_audio_path = self._process_audio_tracks(request, temp_dir, ffmpeg_path, actual_total_duration)
                    
                    if processed_audio_path:
                        logger.info("Adding mixed audio to video...")
                        video_with_audio_path = str(output_path).replace('.mp4', '_with_audio.mp4')
                        
                        audio_video_cmd = [
                            ffmpeg_path,
                            '-y',
                            '-i', str(output_path),
                            '-i', processed_audio_path,
                            '-c:v', 'copy',
                            '-c:a', 'aac',
                            '-map', '0:v:0',  # Map video from first input
                            '-map', '1:a:0',  # Map audio from second input (our processed audio)
                            # Removed '-shortest' to prevent video truncation when audio is shorter
                            # Audio is already processed to match video duration via total_duration
                            video_with_audio_path
                        ]
                        
                        logger.info(f"Running audio-video merge command: {' '.join(audio_video_cmd)}")
                        logger.info(f"Input video: {output_path} (exists: {os.path.exists(output_path)})")
                        logger.info(f"Input audio: {processed_audio_path} (exists: {os.path.exists(processed_audio_path)})")
                        logger.info(f"Output path: {video_with_audio_path}")
                        
                        result = subprocess.run(audio_video_cmd, capture_output=True, text=True)
                        
                        logger.info(f"Audio-video merge result: returncode={result.returncode}")
                        if result.stdout:
                            logger.info(f"FFmpeg stdout: {result.stdout}")
                        if result.stderr:
                            logger.info(f"FFmpeg stderr: {result.stderr}")
                        
                        if result.returncode == 0:
                            # Check if the output file was created and has content
                            if os.path.exists(video_with_audio_path):
                                output_size = os.path.getsize(video_with_audio_path)
                                logger.info(f"Audio-video merge output file created: {output_size} bytes")
                                
                                # Replace original video with audio version
                                os.replace(video_with_audio_path, str(output_path))
                                logger.info("Audio successfully added to video")
                                
                                # Verify final file
                                final_size = os.path.getsize(output_path)
                                logger.info(f"Final video file size: {final_size} bytes")
                            else:
                                logger.error("Audio-video merge output file was not created")
                        else:
                            logger.error(f"Failed to add audio to video: returncode={result.returncode}")
                            logger.error(f"FFmpeg stderr: {result.stderr}")
                            
                except Exception as e:
                    logger.warning(f"Audio processing error: {str(e)}")
            else:
                logger.info("No audio tracks to process")
            
            # 处理图片叠加 - 使用专门的图片轨道
            all_image_items = list(request.image_items)
            
            if all_image_items:
                logger.info("Processing image overlay tracks...")
                logger.info(f"Found {len(request.image_items)} image items to process")
                logger.info(f"Total image overlay items to process: {len(all_image_items)}")
                
                try:
                    # 使用与音频处理相同的方式，在原始视频目录生成临时文件
                    video_with_images_path = str(output_path).replace('.mp4', '_with_images.mp4')
                    
                    # Process image overlays and add them to the video
                    success = self._process_image_overlays(
                        all_image_items,
                        str(output_path), 
                        video_with_images_path,
                        temp_dir,
                        request.output_resolution
                    )
                    
                    if success and os.path.exists(video_with_images_path):
                        # Replace the original video with the image-processed version
                        os.replace(video_with_images_path, str(output_path))
                        logger.info("Image overlays successfully added to video")
                        
                        # Verify final file with image overlays
                        final_size = os.path.getsize(output_path)
                        logger.info(f"Final video file size with image overlays: {final_size} bytes")
                    else:
                        logger.warning("Image overlay processing did not produce output file")
                        
                except Exception as e:
                    logger.error(f"Image overlay processing error: {str(e)}", exc_info=True)

            # Handle subtitles if present  
            if request.subtitle_items:
                logger.info("Processing subtitle tracks...")
                logger.info(f"Found {len(request.subtitle_items)} subtitle items")
                
                try:
                    # Process subtitles and add them to the video
                    subtitle_processed_path = self._process_subtitle_tracks(
                        request.subtitle_items, 
                        str(output_path), 
                        temp_dir
                    )
                    
                    if subtitle_processed_path and os.path.exists(subtitle_processed_path):
                        # Replace the original video with the subtitle-processed version
                        os.replace(subtitle_processed_path, str(output_path))
                        logger.info("Subtitles successfully added to video")
                        
                        # Verify final file with subtitles
                        final_size = os.path.getsize(output_path)
                        logger.info(f"Final video file size with subtitles: {final_size} bytes")
                    else:
                        logger.warning("Subtitle processing failed - continuing without subtitles")
                        
                except Exception as e:
                    logger.error(f"Subtitle processing error: {str(e)}", exc_info=True)
                    logger.warning("Continuing video composition without subtitles")
            else:
                logger.info("No subtitle tracks to process")
            
            # Final processing
            processing_time = time.time() - start_time
            file_size = output_path.stat().st_size
            
            # Update composition info
            self.compositions[composition_id].update({
                "status": "completed",
                "progress": 1.0,
                "output_file_path": str(output_path),
                "output_file_size": file_size,
                "processing_time": processing_time,
                "completed_at": datetime.utcnow()
            })
            
            logger.info(f"Video composition completed: {output_filename}")
            logger.info(f"File size: {file_size / 1024 / 1024:.2f}MB")
            logger.info(f"Processing time: {processing_time:.2f}s")
            
            # Update composition status for successful completion
            if composition_id in self.compositions:
                self.compositions[composition_id].update({
                    "status": "completed",
                    "progress": 1.0,
                    "output_file_path": str(output_path),
                    "output_file_size": file_size,
                    "processing_time": processing_time,
                    "completed_at": datetime.utcnow()
                })
            
            # Clean up temp directory
            try:
                shutil.rmtree(temp_dir)
                logger.info(f"Cleaned up temp directory: {temp_dir}")
            except Exception as e:
                logger.warning(f"Failed to clean temp directory: {str(e)}")
            
            return VideoCompositionResponse(
                success=True,
                message="Video composition completed successfully",
                composition_id=composition_id,
                status="completed",
                progress=1.0,
                output_file_path=str(output_path),
                output_file_size=file_size,
                processing_time=processing_time
            )
            
        except Exception as e:
            error_msg = f"Video composition failed: {str(e)}"
            logger.error(error_msg, exc_info=True)
            
            # Create proper error details
            error_details = CompositionErrorDetails(
                failed_videos=[],
                total_videos=len(request.video_items),
                successful_videos=0,
                composition_stage="finalization",
                error_summary=error_msg,
                recovery_suggestions=[
                    "Check if all video files are accessible and not corrupted",
                    "Verify that FFmpeg is properly configured",
                    "Ensure there is enough disk space and memory",
                    "Try simplifying the composition or reducing video quality",
                    "Contact support if the issue persists"
                ]
            )
            
            # Update composition info
            self.compositions[composition_id].update({
                "status": "failed",
                "error": error_msg,
                "error_details": error_details,
                "failed_at": datetime.utcnow()
            })
            
            # Clean up temp directory on error
            if 'temp_dir' in locals():
                try:
                    shutil.rmtree(temp_dir)
                except Exception:
                    pass
            
            return VideoCompositionResponse(
                success=False,
                message=error_msg,
                composition_id=composition_id,
                status="failed",
                progress=0.0,
                error_details=error_details
            )
    
    def get_composition_status(self, composition_id: str) -> Optional[Dict[str, Any]]:
        """Get the status of a composition."""
        return self.compositions.get(composition_id)
    
    def get_download_info(self, composition_id: str) -> Optional[Dict[str, Any]]:
        """Get download information for a completed composition."""
        composition = self.compositions.get(composition_id)
        if not composition or composition["status"] != "completed":
            return None
        
        output_path = Path(composition["output_file_path"])
        if not output_path.exists():
            return None
        
        return {
            "file_path": str(output_path),
            "file_name": output_path.name,
            "file_size": output_path.stat().st_size,
            "composition_id": composition_id
        } 

    def _convert_url_to_local_path(self, url: str) -> str:
        """
        Convert a server URL to local file path.
        Handles both local file paths and server URLs like /api/audio/generated/filename.mp3
        """
        logger.info(f"Converting URL to local path: {url}")
        
        if url.startswith('/api/audio/generated/'):
            # Convert server URL to local file path
            filename = url.replace('/api/audio/generated/', '')
            local_path = os.path.join('static', 'audio', 'generated', filename)
            
            logger.info(f"Converted server URL to local path", {
                'original_url': url,
                'local_path': local_path,
                'exists': os.path.exists(local_path)
            })
            
            if not os.path.exists(local_path):
                logger.warning(f"Local file does not exist: {local_path}")
                raise FileNotFoundError(f"Audio file not found: {local_path}")
            
            return local_path
        elif url.startswith('http://') or url.startswith('https://'):
            # For HTTP URLs, return as-is (ffmpeg can handle them)
            logger.info(f"Using HTTP URL directly: {url}")
            return url
        else:
            # Assume it's already a local file path
            logger.info(f"Using local file path: {url}")
            if not os.path.exists(url):
                logger.warning(f"Local file does not exist: {url}")
                raise FileNotFoundError(f"Audio file not found: {url}")
            return url

    def _process_audio_tracks(self, request: VideoCompositionRequest, temp_dir: str, ffmpeg_path: str, actual_total_duration: float) -> Optional[str]:
        """
        Process multiple audio tracks and create a mixed audio file.
        Returns the path to the mixed audio file, or None if processing failed.
        """
        if not request.audio_items:
            logger.info("No audio items to process")
            return None
        
        logger.info(f"Processing {len(request.audio_items)} audio tracks", {
            'audio_items': [
                {
                    'id': item.id,
                    'name': item.name,
                    'url': item.url,
                    'start_time': item.start_time,
                    'duration': item.duration,
                    'volume': item.volume
                }
                for item in request.audio_items
            ]
        })
        
        audio_mix_path = os.path.join(temp_dir, "audio_mix.wav")
        
        try:
            if len(request.audio_items) == 1:
                # Single audio item - process it directly
                audio_item = request.audio_items[0]
                local_audio_path = self._convert_url_to_local_path(audio_item.url)
                
                logger.info(f"Processing single audio track: {audio_item.name} at {audio_item.start_time}s")
                logger.info(f"Audio item details: duration={audio_item.duration}s, volume={audio_item.volume}")
                # 安全获取音频裁剪参数
                audio_clip_start = getattr(audio_item, 'clip_start', None) or 0.0
                audio_clip_end = getattr(audio_item, 'clip_end', None) or audio_item.duration
                logger.info(f"Audio clipping: start={audio_clip_start}s, end={audio_clip_end}s")
                logger.info(f"Actual video duration: {actual_total_duration}s (was {request.total_duration}s from frontend)")
                
                # Calculate the actual duration we need
                if audio_item.start_time > 0:
                    # Audio starts later, need to pad with silence at the beginning
                    logger.info("Audio starts after video beginning, creating padded audio track")
                    
                    # First create the audio segment with clipping
                    temp_audio_path = os.path.join(temp_dir, "temp_audio.wav")
                    audio_segment_cmd = [
                        ffmpeg_path,
                        '-y'
                    ]
                    
                    # 添加音频剪辑参数
                    if audio_clip_start > 0:
                        audio_segment_cmd.extend(['-ss', str(audio_clip_start)])
                    
                    audio_segment_cmd.extend([
                        '-i', local_audio_path
                    ])
                    
                    # 计算实际的音频时长（考虑剪辑）
                    clip_duration = audio_clip_end - audio_clip_start
                    actual_duration = min(audio_item.duration, clip_duration)
                    
                    audio_segment_cmd.extend([
                        '-t', str(actual_duration),
                        '-af', f'volume={audio_item.volume}',
                        '-ar', '44100',
                        '-ac', '2',
                        temp_audio_path
                    ])
                    
                    logger.info(f"Creating audio segment: {' '.join(audio_segment_cmd)}")
                    result = subprocess.run(audio_segment_cmd, capture_output=True, text=True)
                    if result.returncode != 0:
                        logger.error(f"Audio segment creation failed: {result.stderr}")
                        return None
                    
                    # Then create silence and combine
                    silence_duration = audio_item.start_time
                    final_cmd = [
                        ffmpeg_path,
                        '-y',
                        '-f', 'lavfi',
                        '-i', f'anullsrc=r=44100:cl=stereo',
                        '-i', temp_audio_path,
                        '-filter_complex', f'[0:a]atrim=duration={silence_duration}[silence];[silence][1:a]concat=n=2:v=0:a=1[out]',
                        '-map', '[out]',
                        '-t', str(actual_total_duration),
                        audio_mix_path
                    ]
                else:
                    # Audio starts at the beginning, simpler processing with clipping
                    final_cmd = [
                        ffmpeg_path,
                        '-y'
                    ]
                    
                    # 添加音频剪辑参数
                    if audio_clip_start > 0:
                        final_cmd.extend(['-ss', str(audio_clip_start)])
                    
                    final_cmd.extend([
                        '-i', local_audio_path
                    ])
                    
                    # 计算实际的音频时长（考虑剪辑）
                    clip_duration = audio_clip_end - audio_clip_start
                    actual_duration = min(actual_total_duration, clip_duration)
                    
                    final_cmd.extend([
                        '-af', f'volume={audio_item.volume}',
                        '-ar', '44100',
                        '-ac', '2',
                        '-t', str(actual_duration),  # Use clipped duration
                        audio_mix_path
                    ])
                
                logger.info(f"Running final audio command: {' '.join(final_cmd)}")
                result = subprocess.run(final_cmd, capture_output=True, text=True)
                
                logger.info(f"Audio processing result: returncode={result.returncode}")
                if result.stdout:
                    logger.info(f"Audio FFmpeg stdout: {result.stdout}")
                if result.stderr:
                    logger.info(f"Audio FFmpeg stderr: {result.stderr}")
                
                if result.returncode != 0:
                    logger.error(f"Single audio processing failed", {
                        'command': ' '.join(final_cmd),
                        'stderr': result.stderr,
                        'stdout': result.stdout
                    })
                    return None
                else:
                    # Verify the output file
                    if os.path.exists(audio_mix_path):
                        audio_size = os.path.getsize(audio_mix_path)
                        logger.info(f"Single audio track processed successfully, output size: {audio_size} bytes")
                        return audio_mix_path
                    else:
                        logger.error("Audio processing completed but output file not found")
                        return None
                    
            else:
                # Multiple audio items - create proper parallel mix
                logger.info(f"Mixing {len(request.audio_items)} audio tracks with independent volume control")
                
                # Pre-process each audio item individually to apply volume and clipping
                processed_audio_paths = []
                for i, audio_item in enumerate(request.audio_items):
                    try:
                        local_audio_path = self._convert_url_to_local_path(audio_item.url)
                        processed_path = os.path.join(temp_dir, f"processed_audio_{i}.wav")
                        
                        # 安全获取音频裁剪参数
                        audio_clip_start = getattr(audio_item, 'clip_start', None) or 0.0
                        audio_clip_end = getattr(audio_item, 'clip_end', None) or audio_item.duration
                        
                        logger.info(f"Pre-processing audio {i+1}/{len(request.audio_items)}: {audio_item.name}", {
                            'volume': audio_item.volume,
                            'start_time': audio_item.start_time,
                            'clip_start': audio_clip_start,
                            'clip_end': audio_clip_end,
                            'track_id': audio_item.track_id
                        })
                        
                        # Calculate clipped duration for this audio item
                        clip_duration = audio_clip_end - audio_clip_start
                        
                        # Pre-process this audio item with volume and clipping
                        process_cmd = [
                            ffmpeg_path,
                            '-y'
                        ]
                        
                        # Add clipping parameters for the audio input
                        if audio_clip_start > 0:
                            process_cmd.extend(['-ss', str(audio_clip_start)])
                        
                        process_cmd.extend([
                            '-i', local_audio_path,
                            '-af', f'volume={audio_item.volume}',
                            '-t', str(clip_duration),
                            '-ar', '44100',
                            '-ac', '2',
                            processed_path
                        ])
                        
                        logger.info(f"Pre-processing audio command: {' '.join(process_cmd)}")
                        result = subprocess.run(process_cmd, capture_output=True, text=True)
                        
                        if result.returncode != 0:
                            logger.error(f"Audio pre-processing failed for item {i+1}", {
                                'command': ' '.join(process_cmd),
                                'stderr': result.stderr,
                                'audio_item': audio_item.name
                            })
                            continue
                        
                        processed_audio_paths.append({
                            'path': processed_path,
                            'start_time': audio_item.start_time,
                            'name': audio_item.name,
                            'track_id': audio_item.track_id
                        })
                        
                        logger.info(f"Successfully pre-processed audio: {audio_item.name}")
                        
                    except Exception as e:
                        logger.error(f"Failed to pre-process audio item {audio_item.name}: {str(e)}")
                        continue
                
                if not processed_audio_paths:
                    logger.error("No audio tracks were successfully pre-processed")
                    return None
                
                # Now create the final mix using all processed audio files
                logger.info(f"Creating final mix with {len(processed_audio_paths)} processed audio tracks")
                
                # Log detailed timing information for debugging
                for i, audio_info in enumerate(processed_audio_paths):
                    logger.info(f"Audio track {i+1} timing details", {
                        'name': audio_info['name'],
                        'start_time': audio_info['start_time'],
                        'track_id': audio_info['track_id'],
                        'processed_path': audio_info['path']
                    })
                
                logger.info(f"Total video duration for audio mixing: {actual_total_duration}s")
                
                # Build the complex FFmpeg command for mixing
                mix_cmd = [ffmpeg_path, '-y']
                
                # Add all processed audio inputs
                for audio_info in processed_audio_paths:
                    mix_cmd.extend(['-i', audio_info['path']])
                
                # Build the filter complex for proper mixing with timing
                filter_parts = []
                for i, audio_info in enumerate(processed_audio_paths):
                    delay_ms = int(audio_info['start_time'] * 1000)
                    if delay_ms > 0:
                        # Use adelay to position audio at correct time, and apad to ensure it doesn't get cut off
                        filter_parts.append(f'[{i}:a]adelay={delay_ms}|{delay_ms},apad=pad_dur={actual_total_duration}[delayed{i}]')
                    else:
                        # For audio starting at 0, still add padding to ensure full duration
                        filter_parts.append(f'[{i}:a]apad=pad_dur={actual_total_duration}[delayed{i}]')
                
                # Create the mix filter with longest duration to ensure all audio is preserved
                input_labels = [f'[delayed{i}]' for i in range(len(processed_audio_paths))]
                mix_filter = f"{';'.join(filter_parts)};{' '.join(input_labels)}amix=inputs={len(processed_audio_paths)}:duration=longest:dropout_transition=3,atrim=duration={actual_total_duration}[out]"
                
                mix_cmd.extend([
                    '-filter_complex', mix_filter,
                    '-map', '[out]',
                    '-t', str(actual_total_duration),
                    '-ar', '44100',
                    '-ac', '2',
                    audio_mix_path
                ])
                
                logger.info(f"Running final mix command: {' '.join(mix_cmd)}")
                logger.info(f"Filter complex: {mix_filter}")
                
                result = subprocess.run(mix_cmd, capture_output=True, text=True)
                
                logger.info(f"Audio mixing result: returncode={result.returncode}")
                if result.stdout:
                    logger.info(f"Audio mixing stdout: {result.stdout}")
                if result.stderr:
                    logger.info(f"Audio mixing stderr: {result.stderr}")
                
                # Clean up processed audio files
                for audio_info in processed_audio_paths:
                    try:
                        if os.path.exists(audio_info['path']):
                            os.remove(audio_info['path'])
                    except Exception as e:
                        logger.warning(f"Failed to clean up processed audio file {audio_info['path']}: {str(e)}")
                
                if result.returncode != 0:
                    logger.error(f"Audio mixing failed", {
                        'command': ' '.join(mix_cmd),
                        'stderr': result.stderr,
                        'stdout': result.stdout
                    })
                    return None
                else:
                    # Verify the output file
                    if os.path.exists(audio_mix_path):
                        audio_size = os.path.getsize(audio_mix_path)
                        logger.info(f"Audio mixing completed successfully, output size: {audio_size} bytes")
                        return audio_mix_path
                    else:
                        logger.error("Audio mixing completed but output file not found")
                        return None
                    
        except Exception as e:
            logger.error(f"Audio processing failed with exception: {str(e)}")
            return None 

    def _get_aspect_ratio_info(self, aspect_ratio: AspectRatio) -> Dict[str, Any]:
        """Get aspect ratio information including resolution and ratio value."""
        aspect_ratio_map = {
            AspectRatio.RATIO_16_9: {
                "width": 1920, "height": 1080, "ratio": 16/9, "name": "16:9"
            },
            AspectRatio.RATIO_9_16: {
                "width": 1080, "height": 1920, "ratio": 9/16, "name": "9:16"
            },
            AspectRatio.RATIO_4_3: {
                "width": 1440, "height": 1080, "ratio": 4/3, "name": "4:3"
            },
            AspectRatio.RATIO_1_1: {
                "width": 1080, "height": 1080, "ratio": 1/1, "name": "1:1"
            },
            AspectRatio.RATIO_21_9: {
                "width": 2560, "height": 1080, "ratio": 21/9, "name": "21:9"
            }
        }
        return aspect_ratio_map.get(aspect_ratio, aspect_ratio_map[AspectRatio.RATIO_16_9])
    
    def _calculate_video_scaling(self, 
                                source_width: int, 
                                source_height: int, 
                                target_width: int, 
                                target_height: int) -> Dict[str, Any]:
        """
        Calculate video scaling parameters to maintain aspect ratio with letterboxing/pillarboxing.
        
        Args:
            source_width: Original video width
            source_height: Original video height  
            target_width: Target output width
            target_height: Target output height
            
        Returns:
            Dict containing scaling parameters for FFmpeg
        """
        source_ratio = source_width / source_height
        target_ratio = target_width / target_height
        
        logger.info(f"Calculating scaling: source={source_width}x{source_height} (ratio={source_ratio:.3f}), "
                   f"target={target_width}x{target_height} (ratio={target_ratio:.3f})")
        
        if abs(source_ratio - target_ratio) < 0.01:  # Same aspect ratio
            # Direct scaling - ensure dimensions are even
            even_target_width, even_target_height = self._ensure_even_dimensions(target_width, target_height)
            return {
                "scale_width": even_target_width,
                "scale_height": even_target_height,
                "pad_width": even_target_width,
                "pad_height": even_target_height,
                "pad_x": 0,
                "pad_y": 0,
                "needs_padding": False
            }
        
        if source_ratio > target_ratio:
            # Source is wider - need horizontal letterboxing (black bars top/bottom)
            scale_width = target_width
            scale_height = int(target_width / source_ratio)
            pad_x = 0
            pad_y = (target_height - scale_height) // 2
        else:
            # Source is taller - need vertical pillarboxing (black bars left/right)
            scale_height = target_height
            scale_width = int(target_height * source_ratio)
            pad_x = (target_width - scale_width) // 2
            pad_y = 0
        
        # Ensure all dimensions are even for H.264 encoding
        even_scale_width, even_scale_height = self._ensure_even_dimensions(scale_width, scale_height)
        even_target_width, even_target_height = self._ensure_even_dimensions(target_width, target_height)
        
        # Recalculate padding with even dimensions
        if source_ratio > target_ratio:
            pad_x = 0
            pad_y = (even_target_height - even_scale_height) // 2
        else:
            pad_x = (even_target_width - even_scale_width) // 2
            pad_y = 0
        
        logger.info(f"Scaling result: scale={even_scale_width}x{even_scale_height}, "
                   f"pad=({pad_x},{pad_y}), final={even_target_width}x{even_target_height}")
        
        return {
            "scale_width": even_scale_width,
            "scale_height": even_scale_height,
            "pad_width": even_target_width,
            "pad_height": even_target_height,
            "pad_x": pad_x,
            "pad_y": pad_y,
            "needs_padding": True
        }
    
    def _build_video_filter(self, scaling_params: Dict[str, Any]) -> str:
        """
        Build FFmpeg video filter string for aspect ratio conversion.
        
        Args:
            scaling_params: Scaling parameters from _calculate_video_scaling
            
        Returns:
            FFmpeg video filter string
        """
        if not scaling_params["needs_padding"]:
            # Simple scaling
            return f'scale={scaling_params["scale_width"]}:{scaling_params["scale_height"]},setsar=1:1'
        
        # Scale + pad for letterboxing/pillarboxing
        scale_filter = f'scale={scaling_params["scale_width"]}:{scaling_params["scale_height"]}'
        pad_filter = (f'pad={scaling_params["pad_width"]}:{scaling_params["pad_height"]}:'
                     f'{scaling_params["pad_x"]}:{scaling_params["pad_y"]}:black')
        
        return f'{scale_filter},{pad_filter},setsar=1:1'
    
    def _process_subtitle_tracks(self, subtitle_items: List[SubtitleCompositionItem], 
                               video_path: str, temp_dir: str) -> Optional[str]:
        """
        Process subtitle tracks and add them to the video.
        
        Based on the verified test script test_subtitle_aspect_ratio.py,
        this method uses consistent parameters for proper subtitle rendering
        with aspect ratio adaptation.
        
        Args:
            subtitle_items: List of subtitle items from the timeline
            video_path: Path to the video file to add subtitles to
            temp_dir: Temporary directory for processing
            
        Returns:
            Path to the video with subtitles added, or None if failed
        """
        try:
            logger.info(f"Starting subtitle processing for {len(subtitle_items)} subtitle items")
            logger.info(f"Using enhanced subtitle parameters based on test_subtitle_aspect_ratio.py")
            
            # Log subtitle details for debugging
            for i, subtitle in enumerate(subtitle_items):
                logger.info(f"Subtitle {i+1}: '{subtitle.text}' at {subtitle.start_time}s for {subtitle.duration}s")
                logger.debug(f"  Font size: {getattr(subtitle, 'font_size', 'default')}, "
                           f"Font color: {getattr(subtitle, 'font_color', 'default')}, "
                           f"Background color: {getattr(subtitle, 'background_color', 'default')}, "
                           f"Position: {getattr(subtitle, 'position', 'default')}")
            
            # Create SRT file from subtitle items
            srt_path = self._create_srt_from_subtitle_items(subtitle_items, temp_dir)
            
            if not srt_path or not os.path.exists(srt_path):
                logger.error("Failed to create SRT file from subtitle items")
                return None
            
            logger.info(f"Created SRT file: {srt_path}")
            
            # Use the first subtitle item's properties, with proper defaults from frontend
            first_subtitle = subtitle_items[0]
            
            # Get font size from frontend (respect user settings)
            font_family = getattr(first_subtitle, 'font_family', 'default')
            font_size = getattr(first_subtitle, 'font_size', 24)  # Use frontend value or standard default
            font_color = getattr(first_subtitle, 'font_color', '#FFFFFF')
            background_color = getattr(first_subtitle, 'background_color', None)
            position = getattr(first_subtitle, 'position', 'bottom')
            
            # Log the font size to verify it's being used correctly
            logger.info(f"Using subtitle font size from frontend: {font_size}px (user setting: {hasattr(first_subtitle, 'font_size')})")
            
            # Use semi-transparent black background as default (from test script)
            if not background_color:
                background_color = "#000000@0.5"
                logger.info("Using default semi-transparent black background for subtitles")
            
            # Create subtitle addition request with parameters matching test script
            subtitle_request = SubtitleAddRequest(
                video_file_path=video_path,
                subtitle_file_path=srt_path,
                font_family=font_family,
                font_size=font_size,
                font_color=font_color,
                background_color=background_color,
                border_width=2,  # Verified in test script
                border_color="#000000",  # Verified in test script
                position=position,
                margin_vertical=50,  # Verified in test script
                margin_horizontal=50  # Verified in test script
            )
            
            logger.info(f"Subtitle request configuration (enhanced): "
                       f"font_family={subtitle_request.font_family}, "
                       f"font_size={subtitle_request.font_size}, "
                       f"font_color={subtitle_request.font_color}, "
                       f"background_color={subtitle_request.background_color}, "
                       f"position={subtitle_request.position}, "
                       f"border_width={subtitle_request.border_width}, "
                       f"border_color={subtitle_request.border_color}, "
                       f"margin_vertical={subtitle_request.margin_vertical}, "
                       f"margin_horizontal={subtitle_request.margin_horizontal}")
            
            # Add subtitles to video using SubtitleService
            # Note: SubtitleService.add_subtitles is async, but we're in a sync context
            # We need to run it in an event loop
            import asyncio
            try:
                # Try to get the current event loop
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    # If we're already in an event loop, we need to use run_in_executor
                    # But for now, let's use a simpler approach by creating a new thread
                    import concurrent.futures
                    with concurrent.futures.ThreadPoolExecutor() as executor:
                        future = executor.submit(asyncio.run, self.subtitle_service.add_subtitles(subtitle_request))
                        result = future.result()
                else:
                    # If no event loop is running, we can use asyncio.run
                    result = asyncio.run(self.subtitle_service.add_subtitles(subtitle_request))
            except RuntimeError:
                # If we can't get an event loop, create a new one
                result = asyncio.run(self.subtitle_service.add_subtitles(subtitle_request))
            
            if result.success:
                logger.info(f"Subtitle addition successful: {result.output_video_path}")
                logger.info(f"Processed {result.subtitle_count} subtitles in {result.processing_time:.2f}s")
                logger.info(f"Video dimensions: {result.video_width}x{result.video_height}")
                
                # Add aspect ratio information for better tracking
                if result.video_width and result.video_height:
                    aspect_ratio = result.video_width / result.video_height
                    video_type = "portrait" if aspect_ratio < 1.0 else "landscape"
                    logger.info(f"Video type: {video_type} (aspect ratio: {aspect_ratio:.2f})")
                
                logger.info(f"Output file size: {result.file_size} bytes")
                return result.output_video_path
            else:
                logger.error(f"Subtitle addition failed: {result.message}")
                return None
                
        except Exception as e:
            logger.error(f"Error processing subtitle tracks: {str(e)}", exc_info=True)
            return None
    
    def _create_srt_from_subtitle_items(self, subtitle_items: List[SubtitleCompositionItem], 
                                      temp_dir: str) -> Optional[str]:
        """
        Create an SRT file from subtitle items.
        
        Args:
            subtitle_items: List of subtitle items from the timeline
            temp_dir: Temporary directory to create the SRT file in
            
        Returns:
            Path to the created SRT file, or None if failed
        """
        try:
            srt_path = os.path.join(temp_dir, "subtitles.srt")
            
            # Sort subtitle items by start time to ensure proper order
            sorted_subtitles = sorted(subtitle_items, key=lambda x: x.start_time)
            
            logger.info(f"Creating SRT file with {len(sorted_subtitles)} subtitle entries")
            
            with open(srt_path, 'w', encoding='utf-8') as f:
                for i, subtitle in enumerate(sorted_subtitles, 1):
                    # Convert start_time and duration to SRT time format
                    start_time_srt = self._seconds_to_srt_time(subtitle.start_time)
                    end_time_srt = self._seconds_to_srt_time(subtitle.start_time + subtitle.duration)
                    
                    # Write SRT entry
                    f.write(f"{i}\n")
                    f.write(f"{start_time_srt} --> {end_time_srt}\n")
                    f.write(f"{subtitle.text}\n")
                    f.write("\n")
                    
                    logger.debug(f"SRT entry {i}: {start_time_srt} --> {end_time_srt} | {subtitle.text}")
            
            logger.info(f"SRT file created successfully: {srt_path}")
            logger.info(f"SRT file uses standard format (HH:MM:SS,mmm) compatible with SubtitleService")
            return srt_path
            
        except Exception as e:
            logger.error(f"Error creating SRT file: {str(e)}", exc_info=True)
            return None
    
    def _seconds_to_srt_time(self, seconds: float) -> str:
        """
        Convert seconds to standard SRT time format (HH:MM:SS,mmm).
        
        Args:
            seconds: Time in seconds
            
        Returns:
            Time in standard SRT format (HH:MM:SS,mmm)
        """
        # Convert to standard SRT format: HH:MM:SS,mmm
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        milliseconds = int((seconds % 1) * 1000)  # Convert to milliseconds
        
        return f"{hours:02d}:{minutes:02d}:{secs:02d},{milliseconds:03d}"
    
    def _process_image_overlays(self, image_items: List, video_path: str, output_path: str, temp_dir: str, output_resolution: Dict[str, int]) -> bool:
        """
        Process image overlays and add them to the video.
        
        Args:
            image_items: List of video items that are actually image overlays
            video_path: Path to the input video file
            output_path: Path for the output video with overlays
            temp_dir: Temporary directory for processing
            output_resolution: Video output resolution dict with 'width' and 'height'
            
        Returns:
            True if processing succeeded, False otherwise
        """
        try:
            logger.info(f"Starting image overlay processing for {len(image_items)} image items")
            
            # Get FFmpeg path
            ffmpeg_path = self._get_ffmpeg_path()
            
            # Build FFmpeg command for image overlays
            cmd = [ffmpeg_path, '-y', '-i', video_path]
            
            # Add each image as input
            valid_items = []
            for i, item in enumerate(image_items):
                image_url = item.url
                local_image_path = self._convert_url_to_local_path(image_url)
                
                if not os.path.exists(local_image_path):
                    # Download image if it's a remote URL
                    downloaded_image = self._download_image(image_url, temp_dir, i)
                    if downloaded_image and downloaded_image.get('success'):
                        local_image_path = downloaded_image['output_path']
                    else:
                        logger.warning(f"Failed to download image {image_url}, skipping overlay")
                        continue
                
                cmd.extend(['-i', local_image_path])
                valid_items.append(item)
            
            if len(valid_items) == 0:
                logger.warning("No valid image items to overlay")
                return False
            
            # Build filter complex for image overlays
            filter_parts = []
            base_input = "[0:v]"
            
            video_width = output_resolution['width']
            video_height = output_resolution['height']
            
            for i, item in enumerate(valid_items):
                input_idx = i + 1  # +1 because [0] is the video
                
                # Handle position from either image_position (video track items) or position (dedicated image items)
                pos = getattr(item, 'image_position', None) or getattr(item, 'position', None)
                if not pos:
                    logger.warning(f"No position information for image item {item.id}, using default position")
                    # Create default position
                    pos = type('Position', (), {
                        'x': 0.1, 'y': 0.1, 'width': 0.3, 'height': 0.3, 'z_index': 10
                    })()
                
                # Calculate actual pixel positions
                x = int(pos.x * video_width)
                y = int(pos.y * video_height)
                w = int(pos.width * video_width)
                h = int(pos.height * video_height)
                
                # Ensure dimensions are even for H.264 encoding
                even_w, even_h = self._ensure_even_dimensions(w, h)
                
                # Calculate time filters based on item timing
                start_time = item.start_time
                end_time = item.start_time + item.duration
                
                logger.info(f"Image overlay {i+1}: position=({x},{y}) size=({even_w}x{even_h}) time={start_time}s-{end_time}s")
                
                # 保持图片原始比例的缩放滤镜
                # 使用force_original_aspect_ratio=decrease确保图片不超出指定尺寸且保持比例
                # 然后使用pad滤镜将图片填充到目标尺寸，居中放置
                scale_filter = f"[{input_idx}:v]scale={even_w}:{even_h}:force_original_aspect_ratio=decrease,pad={even_w}:{even_h}:(ow-iw)/2:(oh-ih)/2:black@0[img{i}]"
                filter_parts.append(scale_filter)
                
                # Create overlay filter with timing
                if i == 0:
                    overlay_filter = f"{base_input}[img{i}]overlay={x}:{y}:enable='between(t,{start_time},{end_time})'[v{i}]"
                else:
                    overlay_filter = f"[v{i-1}][img{i}]overlay={x}:{y}:enable='between(t,{start_time},{end_time})'[v{i}]"
                filter_parts.append(overlay_filter)
            
            # Combine all filter parts
            filter_complex = ";".join(filter_parts)
            final_output = f"[v{len(valid_items)-1}]"
            
            logger.info(f"Image overlay filter complex: {filter_complex}")
            
            cmd.extend([
                '-filter_complex', filter_complex,
                '-map', final_output,
                '-map', '0:a?',  # Copy audio if it exists
                '-c:a', 'copy',  # Copy audio codec
                '-c:v', 'libx264',
                '-preset', 'medium',
                '-pix_fmt', 'yuv420p',
                output_path
            ])
            
            logger.info(f"Running image overlay command: {' '.join(cmd)}")
            
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            if result.returncode == 0:
                logger.info(f"Image overlay processing completed successfully")
                logger.info(f"Output file: {output_path} (size: {os.path.getsize(output_path)} bytes)")
                return True
            else:
                logger.error(f"Image overlay processing failed: {result.stderr}")
                return False
                
        except Exception as e:
            logger.error(f"Error processing image overlays: {str(e)}", exc_info=True)
            return False
    
    def _download_image(self, image_url: str, temp_dir: str, index: int) -> Dict[str, Any]:
        """
        Download an image file from URL.
        
        Args:
            image_url: URL of the image to download
            temp_dir: Temporary directory to save the image
            index: Index for naming the downloaded file
            
        Returns:
            Dictionary with success status and output path
        """
        try:
            import requests
            from urllib.parse import urlparse, unquote
            
            # Parse URL to get file extension
            parsed_url = urlparse(image_url)
            path = unquote(parsed_url.path)
            
            # Try to get file extension from URL
            file_ext = os.path.splitext(path)[1].lower()
            if not file_ext or file_ext not in ['.jpg', '.jpeg', '.png', '.gif', '.bmp']:
                file_ext = '.jpg'  # Default to jpg
            
            output_filename = f"image_{index}{file_ext}"
            output_path = os.path.join(temp_dir, output_filename)
            
            logger.info(f"Downloading image from {image_url} to {output_path}")
            
            # Download the image
            response = requests.get(image_url, stream=True, timeout=30)
            response.raise_for_status()
            
            with open(output_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            
            file_size = os.path.getsize(output_path)
            logger.info(f"Image downloaded successfully: {file_size} bytes")
            
            return {
                "success": True,
                "output_path": output_path,
                "file_size": file_size
            }
            
        except Exception as e:
            logger.error(f"Failed to download image {image_url}: {str(e)}")
            return {
                "success": False,
                "error": str(e)
            } 