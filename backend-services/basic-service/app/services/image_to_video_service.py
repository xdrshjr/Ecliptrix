"""
Image to video conversion service using FFmpeg.
Supports static, Ken Burns, and pan effects.
"""

import os
import time
import tempfile
import subprocess
import requests
from pathlib import Path
from typing import Dict, Any, Optional, Tuple
from PIL import Image

from app.logger import get_logger
from app.models import (
    ImageToVideoRequest,
    ImageToVideoResponse,
    ImageToVideoErrorResponse,
    ImageToVideoEffect
)
from app.services.supabase_service import SupabaseService

logger = get_logger(__name__)


class ImageToVideoService:
    """Service for converting images to videos with various effects."""
    
    def __init__(self):
        """Initialize the image to video service."""
        self.output_dir = Path("static/video/generated")
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        # Initialize Supabase service
        self.supabase_service = SupabaseService()
        
        # Check ffmpeg availability
        self._check_ffmpeg()
        
        logger.info("ImageToVideoService initialized")
    
    def _check_ffmpeg(self) -> bool:
        """Check if ffmpeg is available."""
        try:
            subprocess.run(['ffmpeg', '-version'], 
                         capture_output=True, check=True)
            logger.info("ffmpeg is available for image-to-video conversion")
            return True
        except (subprocess.CalledProcessError, FileNotFoundError):
            logger.error("ffmpeg not found - image-to-video conversion will not work")
            return False
    
    async def download_image(self, image_url: str) -> str:
        """Download image from URL to temporary file."""
        try:
            logger.info(f"Downloading image from URL: {image_url}")
            
            response = requests.get(image_url, timeout=30)
            response.raise_for_status()
            
            # Create temporary file with appropriate extension
            file_extension = self._get_image_extension(image_url, response.headers.get('content-type'))
            temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=file_extension)
            temp_file.write(response.content)
            temp_file.close()
            
            logger.info(f"Image downloaded to: {temp_file.name}")
            return temp_file.name
            
        except Exception as e:
            logger.error(f"Failed to download image: {str(e)}")
            raise

    async def save_image_data(self, image_data: str, filename: Optional[str] = None) -> str:
        """Save base64 image data to temporary file."""
        try:
            import base64
            
            logger.info("Saving base64 image data to temporary file")
            
            # Remove data URL prefix if present (e.g., "data:image/jpeg;base64,")
            if image_data.startswith('data:'):
                header, image_data = image_data.split(',', 1)
                # Extract content type from header
                content_type = header.split(';')[0].split(':')[1]
            else:
                content_type = None
            
            # Decode base64 data
            image_bytes = base64.b64decode(image_data)
            
            # Determine file extension
            file_extension = self._get_image_extension_from_content_type(content_type) if content_type else '.jpg'
            if filename:
                original_ext = os.path.splitext(filename)[1].lower()
                if original_ext in ['.jpg', '.jpeg', '.png', '.webp']:
                    file_extension = original_ext
            
            # Create temporary file
            temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=file_extension)
            temp_file.write(image_bytes)
            temp_file.close()
            
            logger.info(f"Image data saved to: {temp_file.name}")
            return temp_file.name
            
        except Exception as e:
            logger.error(f"Failed to save image data: {str(e)}")
            raise

    def _get_image_extension_from_content_type(self, content_type: str) -> str:
        """Get file extension from content type."""
        if not content_type:
            return '.jpg'
        
        if 'jpeg' in content_type or 'jpg' in content_type:
            return '.jpg'
        elif 'png' in content_type:
            return '.png'
        elif 'webp' in content_type:
            return '.webp'
        
        return '.jpg'  # Default

    def _sanitize_filename(self, filename: str) -> str:
        """Sanitize filename to remove special characters and non-ASCII characters."""
        import re
        
        # Remove file extension if present
        name_without_ext = os.path.splitext(filename)[0]
        
        # Keep only ASCII alphanumeric characters, hyphens, and underscores
        # Replace everything else with underscores
        sanitized = re.sub(r'[^a-zA-Z0-9\-_]', '_', name_without_ext)
        
        # Remove multiple consecutive underscores
        sanitized = re.sub(r'_+', '_', sanitized)
        
        # Remove leading/trailing underscores
        sanitized = sanitized.strip('_')
        
        # Ensure the filename is not empty
        if not sanitized:
            sanitized = 'image'
        
        # Limit length to avoid issues
        if len(sanitized) > 50:
            sanitized = sanitized[:50]
        
        return sanitized
    
    def _get_image_extension(self, url: str, content_type: Optional[str]) -> str:
        """Get appropriate file extension for image."""
        if content_type:
            if 'jpeg' in content_type or 'jpg' in content_type:
                return '.jpg'
            elif 'png' in content_type:
                return '.png'
            elif 'webp' in content_type:
                return '.webp'
        
        # Fallback to URL extension
        if url.lower().endswith(('.jpg', '.jpeg')):
            return '.jpg'
        elif url.lower().endswith('.png'):
            return '.png'
        elif url.lower().endswith('.webp'):
            return '.webp'
        
        return '.jpg'  # Default
    
    def get_image_dimensions(self, image_path: str) -> Tuple[int, int]:
        """Get image dimensions."""
        try:
            with Image.open(image_path) as img:
                return img.size
        except Exception as e:
            logger.error(f"Failed to get image dimensions: {str(e)}")
            return (1920, 1080)  # Default dimensions
    
    def _ensure_even_dimensions(self, width: int, height: int) -> Tuple[int, int]:
        """Ensure dimensions are even numbers (divisible by 2) for H.264 encoding."""
        # Round up to next even number if odd
        even_width = width if width % 2 == 0 else width + 1
        even_height = height if height % 2 == 0 else height + 1
        return even_width, even_height
    
    def _build_static_ffmpeg_command(
        self, 
        input_image: str, 
        output_video: str, 
        duration: float,
        width: int,
        height: int
    ) -> list:
        """Build FFmpeg command for static image to video conversion."""
        # Ensure minimum dimensions for video encoding
        min_width = max(width, 64)  # Minimum 64 pixels width
        min_height = max(height, 64)  # Minimum 64 pixels height
        
        # Ensure dimensions are even for H.264 encoding
        even_width, even_height = self._ensure_even_dimensions(min_width, min_height)
        
        return [
            'ffmpeg',
            '-loop', '1',
            '-i', input_image,
            '-c:v', 'libx264',
            '-t', str(duration),
            '-pix_fmt', 'yuv420p',
            '-vf', f'scale={even_width}:{even_height}:force_original_aspect_ratio=decrease,pad={even_width}:{even_height}:(ow-iw)/2:(oh-ih)/2:color=black',
            '-r', '30',
            '-y',
            output_video
        ]
    
    def _build_ken_burns_ffmpeg_command(
        self, 
        input_image: str, 
        output_video: str, 
        duration: float,
        width: int,
        height: int,
        direction: str = "zoom_in"
    ) -> list:
        """Build FFmpeg command for Ken Burns effect."""
        # Ensure minimum dimensions for video encoding
        min_width = max(width, 64)
        min_height = max(height, 64)
        
        # Ensure dimensions are even for H.264 encoding
        even_width, even_height = self._ensure_even_dimensions(min_width, min_height)
        
        # Ensure doubled dimensions are also even for scaling
        scale_width, scale_height = self._ensure_even_dimensions(even_width * 2, even_height * 2)
        
        # Calculate total frames for the duration
        fps = 30
        total_frames = int(duration * fps)
        
        # Define zoom range for Ken Burns effect (subtle zoom for natural look)
        if direction == "zoom_out":
            # Start slightly zoomed in, zoom out to normal
            zoom_start = 1.1
            zoom_end = 1.0
            logger.info(f"Ken Burns zoom_out effect: {zoom_start} -> {zoom_end} over {duration}s ({total_frames} frames)")
        else:
            # Start normal, zoom in slightly
            zoom_start = 1.0
            zoom_end = 1.1
            logger.info(f"Ken Burns zoom_in effect: {zoom_start} -> {zoom_end} over {duration}s ({total_frames} frames)")
        
        # Create smooth linear interpolation for zoom
        # Formula: zoom_start + (zoom_end - zoom_start) * (frame / total_frames)
        # Using 'on' variable which represents current frame number in zoompan
        zoom_formula = f"{zoom_start}+({zoom_end}-{zoom_start})*on/{total_frames}"
        
        # Ken Burns effect with smooth zoom transition and absolutely stable center position
        # Use a different approach: scale to exact output size and use zoompan with fixed center
        # This eliminates any potential for coordinate drift or jitter
        
        filter_complex = (
            f"scale={even_width}:{even_height}:force_original_aspect_ratio=increase,"
            f"crop={even_width}:{even_height},"
            f"zoompan=z='{zoom_formula}'"
            f":d={total_frames}"
            f":x='(iw-ow)/2'"
            f":y='(ih-oh)/2'"
            f":s={even_width}x{even_height}"
            f":fps={fps}"
        )
        
        logger.info(f"Ken Burns effect configured with stable center positioning using (iw-ow)/2, (ih-oh)/2")
        logger.info(f"Ken Burns filter complex: {filter_complex}")
        
        return [
            'ffmpeg',
            '-loop', '1',
            '-i', input_image,
            '-c:v', 'libx264',
            '-t', str(duration),
            '-pix_fmt', 'yuv420p',
            '-vf', filter_complex,
            '-r', str(fps),
            '-y',
            output_video
        ]
    
    def _build_pan_ffmpeg_command(
        self, 
        input_image: str, 
        output_video: str, 
        duration: float,
        width: int,
        height: int,
        direction: str = "left_to_right"
    ) -> list:
        """Build FFmpeg command for pan effect."""
        # Ensure minimum dimensions for video encoding
        min_width = max(width, 64)
        min_height = max(height, 64)
        
        # Ensure dimensions are even for H.264 encoding
        even_width, even_height = self._ensure_even_dimensions(min_width, min_height)
        
        # Scale image larger than output for panning, ensure it's also even
        scale_width_raw = int(even_width * 1.5)
        scale_width, _ = self._ensure_even_dimensions(scale_width_raw, even_height)
        
        if direction == "right_to_left":
            # Start from right, pan to left
            x_start = f"{scale_width - even_width}"
            x_end = "0"
        else:
            # Start from left, pan to right
            x_start = "0"
            x_end = f"{scale_width - even_width}"
        
        filter_complex = (
            f"scale={scale_width}:{even_height}:force_original_aspect_ratio=increase,"
            f"crop={scale_width}:{even_height},"
            f"crop={even_width}:{even_height}:x='if(lte(t,0),{x_start},{x_start}+({x_end}-{x_start})*t/{duration})':y=0"
        )
        
        return [
            'ffmpeg',
            '-loop', '1',
            '-i', input_image,
            '-c:v', 'libx264',
            '-t', str(duration),
            '-pix_fmt', 'yuv420p',
            '-vf', filter_complex,
            '-r', '30',
            '-y',
            output_video
        ]
    
    def generate_thumbnail(self, video_path: str) -> str:
        """Generate thumbnail from video."""
        try:
            thumbnail_path = video_path.replace('.mp4', '_thumb.jpg')
            
            cmd = [
                'ffmpeg',
                '-i', video_path,
                '-ss', '1',
                '-vframes', '1',
                '-y',
                thumbnail_path
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='ignore')
            
            if result.returncode == 0 and os.path.exists(thumbnail_path):
                logger.info(f"Thumbnail generated: {thumbnail_path}")
                return thumbnail_path
            else:
                logger.error(f"Failed to generate thumbnail: {result.stderr}")
                return None
                
        except Exception as e:
            logger.error(f"Thumbnail generation error: {str(e)}")
            return None
    
    async def convert_image_to_video(self, request: ImageToVideoRequest) -> ImageToVideoResponse:
        """Convert image to video with specified effect."""
        start_time = time.time()
        temp_image_path = None
        output_video_path = None
        thumbnail_path = None
        
        try:
            logger.info(f"Starting image-to-video conversion", {
                "image_url": request.image_url,
                "has_image_data": bool(request.image_data),
                "effect": request.effect,
                "duration": request.duration,
                "task_id": request.task_id,
                "ken_burns_direction": request.ken_burns_direction,
                "pan_direction": request.pan_direction,
                "custom_filename": request.custom_filename
            })
            
            # Get image (either download from URL or save from base64 data)
            if request.image_data:
                temp_image_path = await self.save_image_data(request.image_data, request.image_filename)
            elif request.image_url:
                temp_image_path = await self.download_image(request.image_url)
            else:
                raise ValueError("Either image_url or image_data must be provided")
            
            # Get image dimensions
            img_width, img_height = self.get_image_dimensions(temp_image_path)
            logger.info(f"Image dimensions: {img_width}x{img_height}")
            
            # Generate output filename (sanitize to avoid special characters)
            timestamp = int(time.time())
            if request.custom_filename:
                # Sanitize custom filename
                safe_custom_name = self._sanitize_filename(request.custom_filename)
                filename = f"{safe_custom_name}_{timestamp}.mp4"
            else:
                filename = f"image_to_video_{request.effect}_{timestamp}.mp4"
            
            output_video_path = str(self.output_dir / filename)
            
            # Build FFmpeg command based on effect
            if request.effect == ImageToVideoEffect.STATIC:
                ffmpeg_cmd = self._build_static_ffmpeg_command(
                    temp_image_path, output_video_path, request.duration, img_width, img_height
                )
            elif request.effect == ImageToVideoEffect.KEN_BURNS:
                ffmpeg_cmd = self._build_ken_burns_ffmpeg_command(
                    temp_image_path, output_video_path, request.duration, 
                    img_width, img_height, request.ken_burns_direction
                )
            elif request.effect == ImageToVideoEffect.PAN:
                ffmpeg_cmd = self._build_pan_ffmpeg_command(
                    temp_image_path, output_video_path, request.duration,
                    img_width, img_height, request.pan_direction
                )
            else:
                raise ValueError(f"Unsupported effect: {request.effect}")
            
            # Execute FFmpeg command
            logger.info(f"Executing FFmpeg command: {' '.join(ffmpeg_cmd)}")
            
            result = subprocess.run(
                ffmpeg_cmd,
                capture_output=True,
                text=True,
                encoding='utf-8',
                errors='ignore',  # 忽略编码错误
                timeout=300  # 5 minute timeout
            )
            
            if result.returncode != 0:
                logger.error(f"FFmpeg failed: {result.stderr}")
                return ImageToVideoErrorResponse(
                    success=False,
                    message="Video generation failed",
                    error_code="FFMPEG_ERROR",
                    details=result.stderr
                )
            
            # Check if output file was created
            if not os.path.exists(output_video_path):
                logger.error("Output video file was not created")
                return ImageToVideoErrorResponse(
                    success=False,
                    message="Output video file was not created",
                    error_code="FILE_NOT_CREATED"
                )
            
            # Generate thumbnail
            thumbnail_path = self.generate_thumbnail(output_video_path)
            
            # Get file size
            file_size = os.path.getsize(output_video_path)
            
            # Upload to Supabase
            video_upload_result = await self._upload_to_supabase(
                output_video_path, request.task_id, "video"
            )
            
            thumbnail_url = None
            if thumbnail_path:
                thumbnail_upload_result = await self._upload_to_supabase(
                    thumbnail_path, request.task_id, "thumbnail"
                )
                if thumbnail_upload_result["success"]:
                    thumbnail_url = thumbnail_upload_result["file_url"]
            
            if not video_upload_result["success"]:
                logger.error(f"Failed to upload video to Supabase: {video_upload_result['message']}")
                return ImageToVideoErrorResponse(
                    success=False,
                    message="Failed to upload video to storage",
                    error_code="UPLOAD_FAILED",
                    details=video_upload_result["message"]
                )
            
            processing_time = time.time() - start_time
            
            logger.info(f"Image-to-video conversion completed successfully", {
                "processing_time": processing_time,
                "file_size": file_size,
                "video_url": video_upload_result["file_url"],
                "thumbnail_url": thumbnail_url
            })
            
            return ImageToVideoResponse(
                success=True,
                message="Image converted to video successfully",
                video_url=video_upload_result["file_url"],
                thumbnail_url=thumbnail_url,
                file_size=file_size,
                duration=request.duration,
                width=img_width,
                height=img_height,
                effect_applied=request.effect,
                processing_time=processing_time
            )
            
        except Exception as e:
            logger.error(f"Image-to-video conversion failed: {str(e)}")
            return ImageToVideoErrorResponse(
                success=False,
                message=f"Conversion failed: {str(e)}",
                error_code="CONVERSION_ERROR",
                details=str(e)
            )
        
        finally:
            # Cleanup temporary files
            if temp_image_path and os.path.exists(temp_image_path):
                try:
                    os.unlink(temp_image_path)
                    logger.debug(f"Cleaned up temporary image: {temp_image_path}")
                except Exception as e:
                    logger.warning(f"Failed to cleanup temporary image: {e}")
            
            if output_video_path and os.path.exists(output_video_path):
                try:
                    os.unlink(output_video_path)
                    logger.debug(f"Cleaned up output video: {output_video_path}")
                except Exception as e:
                    logger.warning(f"Failed to cleanup output video: {e}")
            
            if thumbnail_path and os.path.exists(thumbnail_path):
                try:
                    os.unlink(thumbnail_path)
                    logger.debug(f"Cleaned up thumbnail: {thumbnail_path}")
                except Exception as e:
                    logger.warning(f"Failed to cleanup thumbnail: {e}")
    
    async def _upload_to_supabase(self, file_path: str, task_id: Optional[str], file_type: str) -> Dict[str, Any]:
        """Upload file to Supabase storage."""
        try:
            from datetime import datetime
            now = datetime.now()
            date_path = now.strftime("%Y/%m/%d")
            
            filename = os.path.basename(file_path)
            
            if task_id:
                bucket_path = f"video/generated/{date_path}/task-{task_id}/{filename}"
            else:
                bucket_path = f"video/generated/{date_path}/{filename}"
            
            result = self.supabase_service.upload_file(
                local_file_path=file_path,
                bucket_path=bucket_path
            )
            
            logger.info(f"File uploaded to Supabase", {
                "file_type": file_type,
                "bucket_path": bucket_path,
                "success": result["success"]
            })
            
            return result
            
        except Exception as e:
            logger.error(f"Supabase upload failed: {str(e)}")
            return {
                "success": False,
                "message": str(e)
            } 