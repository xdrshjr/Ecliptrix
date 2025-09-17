"""
Video cutting service for extracting video clips and uploading to Supabase.
"""

import os
import time
import tempfile
import subprocess
from typing import List, Dict, Any, Optional
from pathlib import Path

from app.logger import get_logger
from app.config import settings
from app.models import VideoCutRequest, VideoCutResponse, VideoCutClipResult, VideoCutClipRequest
from app.services.supabase_service import SupabaseService

logger = get_logger(__name__)


class VideoCutService:
    """Service for cutting video clips and uploading to Supabase."""
    
    def __init__(self):
        self.supabase_service = SupabaseService()
        self.temp_dir = Path(settings.temp_dir)
        self.temp_dir.mkdir(exist_ok=True)
        
    async def cut_and_upload_video_clips(self, request: VideoCutRequest) -> VideoCutResponse:
        """
        Cut video clips from source video and upload to Supabase.
        
        Args:
            request: Video cutting request with clips information
            
        Returns:
            VideoCutResponse: Response with uploaded clips information
        """
        start_time = time.time()
        
        logger.info(f"Starting video cutting process for task {request.task_id}")
        logger.info(f"Source video: {request.video_url}")
        logger.info(f"Number of clips to cut: {len(request.clips)}")
        
        try:
            # Download source video if it's a remote URL
            source_video_path = await self._download_video_if_needed(request.video_url)
            
            # Get video information
            video_info = await self._get_video_info(source_video_path)
            
            # Cut and upload each clip
            clip_results = []
            for clip in request.clips:
                logger.info(f"Processing clip {clip.id}: {clip.name} ({clip.start_time}s - {clip.end_time}s)")
                
                try:
                    clip_result = await self._cut_and_upload_clip(
                        source_video_path, 
                        clip, 
                        video_info, 
                        request.task_id,
                        request.generate_thumbnails
                    )
                    clip_results.append(clip_result)
                    logger.info(f"Successfully processed clip {clip.id}")
                except Exception as e:
                    logger.error(f"Failed to process clip {clip.id}: {str(e)}")
                    # Continue with other clips even if one fails
                    continue
            
            processing_time = time.time() - start_time
            
            logger.info(f"Video cutting completed for task {request.task_id}")
            logger.info(f"Successfully processed {len(clip_results)} out of {len(request.clips)} clips")
            logger.info(f"Total processing time: {processing_time:.2f}s")
            
            return VideoCutResponse(
                success=True,
                message=f"Successfully cut and uploaded {len(clip_results)} video clips",
                clips=clip_results,
                total_clips=len(clip_results),
                processing_time=processing_time
            )
            
        except Exception as e:
            logger.error(f"Video cutting failed for task {request.task_id}: {str(e)}")
            return VideoCutResponse(
                success=False,
                message=f"Video cutting failed: {str(e)}",
                clips=[],
                total_clips=0,
                processing_time=time.time() - start_time
            )
    
    async def _download_video_if_needed(self, video_url: str) -> str:
        """Download video if it's a remote URL, otherwise return local path."""
        if video_url.startswith(('http://', 'https://')):
            # Download remote video to temp directory
            temp_video_path = self.temp_dir / f"source_{int(time.time())}.mp4"
            
            logger.info(f"Downloading video from URL: {video_url}")
            
            # Use curl to download the video
            result = subprocess.run([
                'curl', '-o', str(temp_video_path), video_url
            ], capture_output=True, text=True)
            
            if result.returncode != 0:
                raise Exception(f"Failed to download video: {result.stderr}")
                
            logger.info(f"Video downloaded to: {temp_video_path}")
            return str(temp_video_path)
        else:
            # Local file path
            if not os.path.exists(video_url):
                raise Exception(f"Video file not found: {video_url}")
            return video_url
    
    async def _get_video_info(self, video_path: str) -> Dict[str, Any]:
        """Get video information using ffprobe."""
        logger.info(f"Getting video info for: {video_path}")
        
        result = subprocess.run([
            'ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', video_path
        ], capture_output=True, text=True)
        
        if result.returncode != 0:
            raise Exception(f"Failed to get video info: {result.stderr}")
        
        import json
        probe_data = json.loads(result.stdout)
        
        # Find video stream
        video_stream = None
        for stream in probe_data['streams']:
            if stream['codec_type'] == 'video':
                video_stream = stream
                break
        
        if not video_stream:
            raise Exception("No video stream found")
        
        video_info = {
            'width': int(video_stream.get('width', 0)),
            'height': int(video_stream.get('height', 0)),
            'duration': float(probe_data['format'].get('duration', 0)),
            'format': probe_data['format'].get('format_name', 'unknown').split(',')[0]
        }
        
        logger.info(f"Video info: {video_info}")
        return video_info
    
    async def _cut_and_upload_clip(
        self, 
        source_video_path: str, 
        clip: VideoCutClipRequest, 
        video_info: Dict[str, Any], 
        task_id: str,
        generate_thumbnails: bool
    ) -> VideoCutClipResult:
        """Cut a single clip and upload to Supabase."""
        
        # Generate temporary file names
        clip_filename = f"{task_id}_{clip.id}.mp4"
        clip_temp_path = self.temp_dir / clip_filename
        
        # Cut video clip using ffmpeg
        logger.info(f"Cutting clip from {clip.start_time}s to {clip.end_time}s")
        
        result = subprocess.run([
            'ffmpeg', '-i', source_video_path,
            '-ss', str(clip.start_time),
            '-t', str(clip.duration),
            '-c', 'copy',
            '-avoid_negative_ts', 'make_zero',
            '-y',  # Overwrite output file
            str(clip_temp_path)
        ], capture_output=True, text=True)
        
        if result.returncode != 0:
            raise Exception(f"Failed to cut video clip: {result.stderr}")
        
        # Get clip file size
        clip_file_size = os.path.getsize(clip_temp_path)
        
        # Generate bucket path for video clip
        from datetime import datetime
        now = datetime.now()
        date_path = now.strftime("%Y/%m/%d")
        bucket_path = f"video/clips/{date_path}/task-{task_id}/{clip_filename}"
        
        # Generate thumbnail if requested (before cleaning up the clip file)
        thumbnail_url = None
        if generate_thumbnails:
            try:
                # Generate thumbnail using ffmpeg
                thumbnail_filename = f"{task_id}_{clip.id}_thumb.jpg"
                thumbnail_temp_path = self.temp_dir / thumbnail_filename
                
                # Extract thumbnail at 1 second into the clip
                thumbnail_result = subprocess.run([
                    'ffmpeg', '-i', str(clip_temp_path),
                    '-ss', '1',
                    '-vframes', '1',
                    '-q:v', '2',
                    '-y',  # Overwrite output file
                    str(thumbnail_temp_path)
                ], capture_output=True, text=True)
                
                if thumbnail_result.returncode == 0:
                    # Upload thumbnail to Supabase
                    thumbnail_bucket_path = f"video/thumbnails/{date_path}/task-{task_id}/{thumbnail_filename}"
                    thumbnail_upload_result = self.supabase_service.upload_file(
                        local_file_path=str(thumbnail_temp_path),
                        bucket_path=thumbnail_bucket_path,
                        content_type="image/jpeg"
                    )
                    
                    if thumbnail_upload_result.get('success'):
                        thumbnail_url = thumbnail_upload_result.get('file_url')
                    
                    # Clean up thumbnail temp file
                    try:
                        os.remove(thumbnail_temp_path)
                    except Exception as e:
                        logger.warning(f"Failed to remove thumbnail temp file {thumbnail_temp_path}: {e}")
                        
            except Exception as e:
                logger.warning(f"Failed to generate thumbnail for clip {clip.id}: {e}")
        
        # Upload video clip to Supabase
        logger.info(f"Uploading clip {clip.id} to Supabase")
        
        upload_result = self.supabase_service.upload_file(
            local_file_path=str(clip_temp_path),
            bucket_path=bucket_path,
            content_type="video/mp4"
        )
        
        if not upload_result.get('success'):
            raise Exception(f"Failed to upload clip to Supabase: {upload_result.get('message')}")
        
        # Clean up temporary file
        try:
            os.remove(clip_temp_path)
        except Exception as e:
            logger.warning(f"Failed to remove temp file {clip_temp_path}: {e}")

        # Create clip result
        clip_result = VideoCutClipResult(
            id=clip.id,
            name=clip.name,
            video_url=upload_result.get('file_url', ''),
            thumbnail_url=thumbnail_url,
            file_size=clip_file_size,
            duration=clip.duration,
            width=video_info['width'],
            height=video_info['height'],
            format='mp4'
        )
        
        return clip_result 