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
            failed_clips = []
            for i, clip in enumerate(request.clips):
                logger.info(f"Processing clip {i+1}/{len(request.clips)}: {clip.id} - {clip.name}")
                logger.info(f"Clip parameters: start={clip.start_time}s, end={clip.end_time}s, duration={clip.duration}s")
                
                try:
                    clip_start_time = time.time()
                    clip_result = await self._cut_and_upload_clip(
                        source_video_path, 
                        clip, 
                        video_info, 
                        request.task_id,
                        request.generate_thumbnails
                    )
                    clip_processing_time = time.time() - clip_start_time
                    
                    clip_results.append(clip_result)
                    logger.info(f"Successfully processed clip {clip.id} in {clip_processing_time:.2f}s")
                except Exception as e:
                    clip_processing_time = time.time() - clip_start_time
                    logger.error(f"Failed to process clip {clip.id} after {clip_processing_time:.2f}s: {str(e)}")
                    logger.debug(f"Clip processing error details for {clip.id}: {str(e)}", exc_info=True)
                    failed_clips.append({"id": clip.id, "name": clip.name, "error": str(e)})
                    # Continue with other clips even if one fails
                    continue
            
            # Log summary of failed clips
            if failed_clips:
                logger.warning(f"Failed to process {len(failed_clips)} clips out of {len(request.clips)}")
                for failed_clip in failed_clips:
                    logger.warning(f"Failed clip: {failed_clip['id']} ({failed_clip['name']}) - {failed_clip['error']}")
            else:
                logger.info(f"All {len(request.clips)} clips processed successfully")
            
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
        
        # Cut video clip using ffmpeg with precise frame positioning
        logger.info(f"Cutting clip {clip.id}: {clip.name}")
        logger.info(f"Time range: {clip.start_time}s to {clip.end_time}s (duration: {clip.duration}s)")
        logger.info(f"Output path: {clip_temp_path}")
        
        # Use precise seeking and re-encoding to avoid keyframe issues
        # -ss before -i for faster seeking, -ss after -i for precise cutting
        result = subprocess.run([
            'ffmpeg',
            '-ss', str(clip.start_time),  # Fast seek to approximate position
            '-i', source_video_path,
            '-ss', '0',  # Precise seek from the fast-seek position  
            '-t', str(clip.duration),
            '-c:v', 'libx264',  # Re-encode video to ensure keyframes
            '-c:a', 'aac',      # Re-encode audio for consistency
            '-preset', 'medium', # Balance between speed and quality
            '-crf', '23',       # Good quality setting
            '-avoid_negative_ts', 'make_zero',
            '-movflags', '+faststart',  # Optimize for web playback
            '-y',  # Overwrite output file
            str(clip_temp_path)
        ], capture_output=True, text=True)
        
        logger.info(f"FFmpeg command executed for clip {clip.id}")
        if result.stderr:
            logger.debug(f"FFmpeg stderr for clip {clip.id}: {result.stderr[:500]}...")
        
        if result.returncode != 0:
            logger.error(f"FFmpeg failed for clip {clip.id}")
            logger.error(f"FFmpeg stderr: {result.stderr}")
            logger.error(f"FFmpeg stdout: {result.stdout}")
            raise Exception(f"Failed to cut video clip {clip.id}: {result.stderr}")
        
        # Verify the output file was created and has reasonable size
        if not os.path.exists(clip_temp_path):
            raise Exception(f"Output file not created for clip {clip.id}")
            
        clip_file_size = os.path.getsize(clip_temp_path)
        if clip_file_size == 0:
            raise Exception(f"Output file is empty for clip {clip.id}")
            
        logger.info(f"Successfully cut clip {clip.id}, file size: {clip_file_size / 1024 / 1024:.2f} MB")
        
        # Generate bucket path for video clip
        from datetime import datetime
        now = datetime.now()
        date_path = now.strftime("%Y/%m/%d")
        bucket_path = f"video/clips/{date_path}/task-{task_id}/{clip_filename}"
        
        # Generate thumbnail if requested (before cleaning up the clip file)
        thumbnail_url = None
        if generate_thumbnails:
            try:
                logger.info(f"Generating thumbnail for clip {clip.id}")
                thumbnail_filename = f"{task_id}_{clip.id}_thumb.jpg"
                thumbnail_temp_path = self.temp_dir / thumbnail_filename
                
                # Extract thumbnail at a safer position (0.5 seconds or 1/4 of duration, whichever is smaller)
                thumbnail_time = min(0.5, clip.duration / 4)
                logger.debug(f"Extracting thumbnail at {thumbnail_time}s for clip {clip.id}")
                
                thumbnail_result = subprocess.run([
                    'ffmpeg', '-i', str(clip_temp_path),
                    '-ss', str(thumbnail_time),
                    '-vframes', '1',
                    '-q:v', '2',
                    '-y',  # Overwrite output file
                    str(thumbnail_temp_path)
                ], capture_output=True, text=True)
                
                if thumbnail_result.returncode == 0:
                    logger.info(f"Thumbnail generated successfully for clip {clip.id}")
                    # Upload thumbnail to Supabase
                    thumbnail_bucket_path = f"video/thumbnails/{date_path}/task-{task_id}/{thumbnail_filename}"
                    logger.debug(f"Uploading thumbnail to: {thumbnail_bucket_path}")
                    
                    thumbnail_upload_result = self.supabase_service.upload_file(
                        local_file_path=str(thumbnail_temp_path),
                        bucket_path=thumbnail_bucket_path,
                        content_type="image/jpeg"
                    )
                    
                    if thumbnail_upload_result.get('success'):
                        thumbnail_url = thumbnail_upload_result.get('file_url')
                        logger.info(f"Thumbnail uploaded successfully for clip {clip.id}: {thumbnail_url}")
                    else:
                        logger.warning(f"Failed to upload thumbnail for clip {clip.id}: {thumbnail_upload_result.get('message')}")
                    
                    # Clean up thumbnail temp file
                    try:
                        os.remove(thumbnail_temp_path)
                        logger.debug(f"Cleaned up thumbnail temp file: {thumbnail_temp_path}")
                    except Exception as e:
                        logger.warning(f"Failed to remove thumbnail temp file {thumbnail_temp_path}: {e}")
                else:
                    logger.warning(f"Failed to generate thumbnail for clip {clip.id}: {thumbnail_result.stderr}")
                        
            except Exception as e:
                logger.warning(f"Failed to generate thumbnail for clip {clip.id}: {e}")
                logger.debug(f"Thumbnail generation error details: {str(e)}", exc_info=True)
        
        # Upload video clip to Supabase
        logger.info(f"Uploading clip {clip.id} to Supabase")
        logger.info(f"Upload path: {bucket_path}")
        logger.info(f"File size: {clip_file_size / 1024 / 1024:.2f} MB")
        
        upload_result = self.supabase_service.upload_file(
            local_file_path=str(clip_temp_path),
            bucket_path=bucket_path,
            content_type="video/mp4"
        )
        
        if not upload_result.get('success'):
            logger.error(f"Failed to upload clip {clip.id} to Supabase")
            logger.error(f"Upload error: {upload_result.get('message')}")
            raise Exception(f"Failed to upload clip {clip.id} to Supabase: {upload_result.get('message')}")
        
        logger.info(f"Successfully uploaded clip {clip.id} to: {upload_result.get('file_url')}")
        
        # Clean up temporary file
        try:
            os.remove(clip_temp_path)
            logger.debug(f"Cleaned up temp file: {clip_temp_path}")
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