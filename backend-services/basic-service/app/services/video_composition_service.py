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
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import cv2
from pydub import AudioSegment

from app.logger import get_logger
from app.models import (
    VideoCompositionRequest,
    VideoCompositionResponse,
    VideoCompositionItem,
    AudioCompositionItem,
    SubtitleCompositionItem,
    AspectRatio,
    SubtitleAddRequest
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
    
    def _is_youtube_url(self, url: str) -> bool:
        """Check if the URL is a YouTube URL."""
        return "youtube.com" in url or "youtu.be" in url
    
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
        logger.info(f"Video items: {len(request.video_items)}, Audio items: {len(request.audio_items)}, Subtitle items: {len(request.subtitle_items)}")
        logger.info(f"Frontend provided total duration: {request.total_duration}s")
        
        # Calculate actual total duration from clipped video segments
        actual_total_duration = 0
        clipped_video_durations = []
        
        for i, video_item in enumerate(request.video_items):
            clip_start = video_item.clip_start if hasattr(video_item, 'clip_start') else 0.0
            clip_end = video_item.clip_end if hasattr(video_item, 'clip_end') else video_item.duration
            clipped_duration = clip_end - clip_start
            
            clipped_video_durations.append(clipped_duration)
            actual_total_duration += clipped_duration
            
            logger.info(f"Video {i+1} duration calculation: "
                       f"clip_start={clip_start}s, clip_end={clip_end}s, "
                       f"clipped_duration={clipped_duration}s")
        
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
            ]
        })
        
        # Log individual video and audio items for debugging
        for i, video_item in enumerate(request.video_items):
            # 增强日志：包含裁剪信息
            clip_start = video_item.clip_start if hasattr(video_item, 'clip_start') else 0.0
            clip_end = video_item.clip_end if hasattr(video_item, 'clip_end') else video_item.duration
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
            # 增强日志：包含音频裁剪信息  
            clip_start = audio_item.clip_start if hasattr(audio_item, 'clip_start') else 0.0
            clip_end = audio_item.clip_end if hasattr(audio_item, 'clip_end') else audio_item.duration
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
                       
        # 统计裁剪信息
        trimmed_video_count = sum(1 for item in request.video_items 
                                if (hasattr(item, 'clip_start') and item.clip_start > 0.0) or
                                   (hasattr(item, 'clip_end') and item.clip_end != item.duration))
        trimmed_audio_count = sum(1 for item in request.audio_items 
                                if (hasattr(item, 'clip_start') and item.clip_start > 0.0) or
                                   (hasattr(item, 'clip_end') and item.clip_end != item.duration))
                                   
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
            
            # Download videos
            logger.info("Starting video downloads...")
            video_urls = [item.url for item in request.video_items]
            downloaded_videos = []
            
            with ThreadPoolExecutor(max_workers=5) as executor:
                futures = {
                    executor.submit(self._download_video, url, temp_dir, i): i 
                    for i, url in enumerate(video_urls)
                }
                
                # 收集结果并保持原始顺序
                results = {}
                for future in as_completed(futures):
                    original_index = futures[future]
                    result = future.result()
                    if result['success']:
                        results[original_index] = result['output_path']
                        logger.info(f"Downloaded video {len(results)}/{len(video_urls)} (index: {original_index})")
                    else:
                        raise Exception(f"Video download failed at index {original_index}: {result['error']}")
                
                # 按原始顺序添加到列表
                for i in range(len(video_urls)):
                    downloaded_videos.append(results[i])
                    
            logger.info(f"Video download completed in correct order", extra={
                "downloaded_order": [
                    {"index": i, "path": path.split('/')[-1]} 
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
                    # 新增：剪辑参数
                    'clip_start': video_item.clip_start if video_item else 0.0,
                    'clip_end': video_item.clip_end if video_item else None,
                    # 新增：目标宽高比
                    'target_aspect_ratio': target_aspect_ratio
                }
                video_tasks.append(video_info)
                
                # 记录剪辑信息
                if video_item:
                    logger.info(f"Video {i+1} clipping: {video_item.clip_start:.2f}s - {video_item.clip_end:.2f}s")
            
            normalized_videos = []
            with ThreadPoolExecutor(max_workers=5) as executor:
                futures = {executor.submit(self._normalize_video, task): task['index'] for task in video_tasks}
                
                # 收集结果并保持原始顺序
                norm_results = {}
                for future in as_completed(futures):
                    original_index = futures[future]
                    result = future.result()
                    if result['success']:
                        norm_results[original_index] = result['normalized_path']
                        logger.info(f"Normalized video {len(norm_results)}/{len(video_tasks)} (index: {original_index})")
                    else:
                        raise Exception(f"Video normalization failed at index {original_index}: {result['error']}")
                
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
            
            # Update composition info
            self.compositions[composition_id].update({
                "status": "failed",
                "error_details": {"error": error_msg},
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
                error_details={"error": error_msg}
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
                logger.info(f"Audio clipping: start={audio_item.clip_start}s, end={audio_item.clip_end}s")
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
                    if audio_item.clip_start > 0:
                        audio_segment_cmd.extend(['-ss', str(audio_item.clip_start)])
                    
                    audio_segment_cmd.extend([
                        '-i', local_audio_path
                    ])
                    
                    # 计算实际的音频时长（考虑剪辑）
                    clip_duration = audio_item.clip_end - audio_item.clip_start
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
                    if audio_item.clip_start > 0:
                        final_cmd.extend(['-ss', str(audio_item.clip_start)])
                    
                    final_cmd.extend([
                        '-i', local_audio_path
                    ])
                    
                    # 计算实际的音频时长（考虑剪辑）
                    clip_duration = audio_item.clip_end - audio_item.clip_start
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
                        
                        logger.info(f"Pre-processing audio {i+1}/{len(request.audio_items)}: {audio_item.name}", {
                            'volume': audio_item.volume,
                            'start_time': audio_item.start_time,
                            'clip_start': audio_item.clip_start,
                            'clip_end': audio_item.clip_end,
                            'track_id': audio_item.track_id
                        })
                        
                        # Calculate clipped duration for this audio item
                        clip_duration = audio_item.clip_end - audio_item.clip_start
                        
                        # Pre-process this audio item with volume and clipping
                        process_cmd = [
                            ffmpeg_path,
                            '-y'
                        ]
                        
                        # Add clipping parameters for the audio input
                        if audio_item.clip_start > 0:
                            process_cmd.extend(['-ss', str(audio_item.clip_start)])
                        
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
            # Direct scaling
            return {
                "scale_width": target_width,
                "scale_height": target_height,
                "pad_width": target_width,
                "pad_height": target_height,
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
        
        logger.info(f"Scaling result: scale={scale_width}x{scale_height}, "
                   f"pad=({pad_x},{pad_y}), final={target_width}x{target_height}")
        
        return {
            "scale_width": scale_width,
            "scale_height": scale_height,
            "pad_width": target_width,
            "pad_height": target_height,
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
            
            # Use the first subtitle item's properties, with proper defaults from test script
            first_subtitle = subtitle_items[0]
            
            # Apply defaults based on the verified test script
            font_family = getattr(first_subtitle, 'font_family', 'default')
            font_size = getattr(first_subtitle, 'font_size', 50)  # Use 50 as default, tested font size
            font_color = getattr(first_subtitle, 'font_color', '#FFFFFF')
            background_color = getattr(first_subtitle, 'background_color', None)
            position = getattr(first_subtitle, 'position', 'bottom')
            
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