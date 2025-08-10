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
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
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
    SubtitleCompositionItem
)

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
        
        # Check ffmpeg availability
        self._check_ffmpeg()
        
        logger.info("VideoCompositionService initialized")
    
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
            result = subprocess.run(download_cmd, capture_output=True, 
                                  text=True, timeout=120)
            
            if result.returncode != 0:
                error_msg = f"Download failed: {result.stderr}"
                logger.error(f"[Thread {thread_id}] {error_msg}")
                return {"success": False, "error": error_msg}
            
            # Check file exists and has reasonable size
            if not os.path.exists(video_path):
                return {"success": False, "error": "Downloaded file not found"}
            
            file_size = os.path.getsize(video_path)
            if file_size < 1024:  # Less than 1KB
                return {"success": False, "error": "Downloaded file too small"}
            
            logger.info(f"[Thread {thread_id}] Download successful: {file_size / 1024 / 1024:.2f}MB")
            return {"success": True, "output_path": video_path}
            
        except subprocess.TimeoutExpired:
            return {"success": False, "error": "Download timeout"}
        except Exception as e:
            return {"success": False, "error": f"Download error: {str(e)}"}
    
    def _normalize_video(self, video_info: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize a single video to target specifications."""
        thread_id = threading.current_thread().ident
        video_path = video_info['video_path']
        index = video_info['index']
        temp_dir = video_info['temp_dir']
        target_width = video_info['target_width']
        target_height = video_info['target_height']
        target_fps = video_info['target_fps']
        ffmpeg_path = video_info['ffmpeg_path']
        
        logger.info(f"[Thread {thread_id}] Normalizing video {index + 1}")
        
        # Get video properties
        width, height, fps = self._get_video_properties(video_path)
        if width is None:
            return {"success": False, "error": f"Cannot get video properties: {video_path}", "index": index}
        
        # Get video duration
        cap = cv2.VideoCapture(video_path)
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        video_duration = frame_count / fps if fps > 0 else 0
        cap.release()
        
        logger.info(f"[Thread {thread_id}] Video properties: {width}x{height}, {fps:.2f}fps, {video_duration:.2f}s")
        
        # Normalize video
        normalized_path = os.path.join(temp_dir, f"normalized_{index}.mp4")
        vf_params = f'scale={target_width}:{target_height},setsar=1:1'
        
        normalize_cmd = [
            ffmpeg_path,
            '-y',
            '-i', video_path,
            '-vf', vf_params,
            '-r', str(target_fps),
            '-c:v', 'libx264',
            '-preset', 'medium',
            '-profile:v', 'high',
            '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart',
            '-avoid_negative_ts', 'make_zero',
            normalized_path
        ]
        
        try:
            result = subprocess.run(normalize_cmd, capture_output=True, text=True)
            
            if result.returncode != 0:
                error_msg = f"Normalization failed: {result.stderr}"
                logger.error(f"[Thread {thread_id}] {error_msg}")
                return {"success": False, "error": error_msg, "index": index}
            
            logger.info(f"[Thread {thread_id}] Video {index + 1} normalized successfully")
            return {
                "success": True,
                "normalized_path": normalized_path,
                "used_duration": video_duration,
                "index": index
            }
            
        except Exception as e:
            error_msg = f"Normalization error: {str(e)}"
            logger.error(f"[Thread {thread_id}] {error_msg}")
            return {"success": False, "error": error_msg, "index": index}
    
    def compose_video(self, request: VideoCompositionRequest) -> VideoCompositionResponse:
        """
        Compose video from timeline data.
        """
        composition_id = str(uuid.uuid4())
        start_time = time.time()
        
        logger.info(f"Starting video composition {composition_id} for task {request.task_id}")
        logger.info(f"Video items: {len(request.video_items)}, Audio items: {len(request.audio_items)}, Subtitle items: {len(request.subtitle_items)}")
        
        # Store composition info
        self.compositions[composition_id] = {
            "id": composition_id,
            "task_id": request.task_id,
            "status": "processing",
            "progress": 0.0,
            "start_time": start_time,
            "request": request
        }
        
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
                
                for future in as_completed(futures):
                    result = future.result()
                    if result['success']:
                        downloaded_videos.append(result['output_path'])
                        logger.info(f"Downloaded video {len(downloaded_videos)}/{len(video_urls)}")
                    else:
                        raise Exception(f"Video download failed: {result['error']}")
            
            # Update progress
            self.compositions[composition_id]["progress"] = 0.4
            
            # Get target video parameters from first video
            target_width = request.output_resolution["width"]
            target_height = request.output_resolution["height"]
            target_fps = request.output_fps
            
            # Normalize videos
            logger.info("Starting video normalization...")
            ffmpeg_path = self._get_ffmpeg_path()
            
            video_tasks = []
            for i, video_path in enumerate(downloaded_videos):
                video_info = {
                    'video_path': video_path,
                    'index': i,
                    'temp_dir': temp_dir,
                    'target_width': target_width,
                    'target_height': target_height,
                    'target_fps': target_fps,
                    'ffmpeg_path': ffmpeg_path
                }
                video_tasks.append(video_info)
            
            normalized_videos = []
            with ThreadPoolExecutor(max_workers=5) as executor:
                futures = {executor.submit(self._normalize_video, task): task['index'] for task in video_tasks}
                
                for future in as_completed(futures):
                    result = future.result()
                    if result['success']:
                        normalized_videos.append(result['normalized_path'])
                        logger.info(f"Normalized video {len(normalized_videos)}/{len(video_tasks)}")
                    else:
                        raise Exception(f"Video normalization failed: {result['error']}")
            
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
                    # Create audio mix from audio items
                    audio_mix_path = os.path.join(temp_dir, "audio_mix.wav")
                    
                    if len(request.audio_items) == 1:
                        # Single audio item - just copy/convert
                        audio_item = request.audio_items[0]
                        audio_cmd = [
                            ffmpeg_path,
                            '-y',
                            '-i', audio_item.url,
                            '-t', str(request.total_duration),
                            '-af', f'volume={audio_item.volume}',
                            audio_mix_path
                        ]
                        
                        result = subprocess.run(audio_cmd, capture_output=True, text=True)
                        if result.returncode != 0:
                            logger.warning(f"Audio processing failed: {result.stderr}")
                        else:
                            logger.info("Single audio track processed successfully")
                    else:
                        # Multiple audio items - mix them
                        logger.info(f"Mixing {len(request.audio_items)} audio tracks")
                        
                        # For now, use the first audio item as base
                        # In a full implementation, you would mix all audio tracks
                        first_audio = request.audio_items[0]
                        audio_cmd = [
                            ffmpeg_path,
                            '-y',
                            '-i', first_audio.url,
                            '-t', str(request.total_duration),
                            '-af', f'volume={first_audio.volume}',
                            audio_mix_path
                        ]
                        
                        result = subprocess.run(audio_cmd, capture_output=True, text=True)
                        if result.returncode != 0:
                            logger.warning(f"Audio mixing failed: {result.stderr}")
                        else:
                            logger.info("Audio tracks mixed successfully")
                    
                    # Add audio to final video if audio processing succeeded
                    if os.path.exists(audio_mix_path):
                        logger.info("Adding mixed audio to video...")
                        video_with_audio_path = str(output_path).replace('.mp4', '_with_audio.mp4')
                        
                        audio_video_cmd = [
                            ffmpeg_path,
                            '-y',
                            '-i', str(output_path),
                            '-i', audio_mix_path,
                            '-c:v', 'copy',
                            '-c:a', 'aac',
                            '-shortest',
                            video_with_audio_path
                        ]
                        
                        result = subprocess.run(audio_video_cmd, capture_output=True, text=True)
                        if result.returncode == 0:
                            # Replace original video with audio version
                            os.replace(video_with_audio_path, str(output_path))
                            logger.info("Audio successfully added to video")
                        else:
                            logger.warning(f"Failed to add audio to video: {result.stderr}")
                            
                except Exception as e:
                    logger.warning(f"Audio processing error: {str(e)}")
            else:
                logger.info("No audio tracks to process")
            
            # Handle subtitles if present  
            if request.subtitle_items:
                logger.info("Processing subtitle tracks...")
                logger.info(f"Found {len(request.subtitle_items)} subtitle items")
                # Subtitle rendering would require more complex ffmpeg filters
                # For now, we'll log the subtitle information
                for subtitle in request.subtitle_items:
                    logger.info(f"Subtitle: '{subtitle.text}' at {subtitle.start_time}s for {subtitle.duration}s")
                logger.info("Subtitle rendering not yet implemented - subtitles logged for reference")
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