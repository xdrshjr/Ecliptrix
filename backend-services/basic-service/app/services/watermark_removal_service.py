"""
Watermark removal service for removing watermarks from videos using OpenCV inpainting.
"""

import os
import time
import tempfile
import subprocess
import cv2
import numpy as np
import requests
import re
from typing import Optional, Union, List, Tuple
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
from queue import Queue

from app.logger import get_logger
from app.config import settings
from app.models.video_models import (
    WatermarkRemovalRequest, 
    WatermarkRemovalResponse, 
    WatermarkRemovalErrorResponse,
    WatermarkArea
)
from app.services.storage_service import storage_service

logger = get_logger(__name__)


class WatermarkRemovalService:
    """Service for removing watermarks from videos using OpenCV inpainting."""
    
    def __init__(self):
        self.temp_dir = Path(settings.temp_dir)
        self.temp_dir.mkdir(exist_ok=True)
        self.config = settings.watermark_removal
        self._thread_local = threading.local()
    
    def _sanitize_filename(self, filename: str) -> str:
        """
        Sanitize filename to ensure compatibility with storage service.
        
        Args:
            filename: Original filename
            
        Returns:
            Sanitized filename safe for storage
        """
        # Remove file extension if present to handle it separately
        name_without_ext = os.path.splitext(filename)[0]
        ext = os.path.splitext(filename)[1]
        
        # Keep only ASCII alphanumeric characters, hyphens, and underscores
        # Replace everything else (including Chinese characters) with underscores
        sanitized = re.sub(r'[^a-zA-Z0-9\-_]', '_', name_without_ext)
        
        # Replace multiple underscores with single underscore
        sanitized = re.sub(r'_+', '_', sanitized)
        
        # Remove leading/trailing underscores
        sanitized = sanitized.strip('_')
        
        # Ensure filename is not empty
        if not sanitized:
            sanitized = 'watermark_removed'
        
        # Limit length to avoid issues
        if len(sanitized) > 50:
            sanitized = sanitized[:50]
        
        # Add back the extension (default to .mp4 if no extension)
        if not ext:
            ext = '.mp4'
        sanitized += ext
        
        logger.info(f"Sanitized filename: '{filename}' -> '{sanitized}'")
        return sanitized
        
    async def remove_watermark(self, request: WatermarkRemovalRequest) -> Union[WatermarkRemovalResponse, WatermarkRemovalErrorResponse]:
        """
        Remove watermark from video using OpenCV inpainting.
        
        Args:
            request: Watermark removal request with video URL and watermark coordinates
            
        Returns:
            WatermarkRemovalResponse: Response with processed video URL and metadata
            WatermarkRemovalErrorResponse: Error response if processing fails
        """
        start_time = time.time()
        
        logger.info(f"Starting watermark removal process for task {request.task_id}")
        logger.info(f"Source video: {request.video_url}")
        logger.info(f"Watermark area: ({request.watermark_area.x1},{request.watermark_area.y1}) to ({request.watermark_area.x2},{request.watermark_area.y2})")
        logger.info(f"Inpaint method: {request.inpaint_method}, radius: {request.inpaint_radius}")
        
        try:
            # Download source video if it's a remote URL
            source_video_path = await self._download_video_if_needed(request.video_url)
            
            # Get video information
            video_info = await self._get_video_info(source_video_path)
            
            # Process video to remove watermark
            processed_video_path = await self._process_video_watermark_removal(
                source_video_path, 
                request.watermark_area,
                request.inpaint_radius,
                request.inpaint_method,
                request.task_id
            )
            
            # Upload processed video to storage
            processed_video_url = await self._upload_processed_video(
                processed_video_path,
                request.task_id,
                request.custom_filename
            )
            
            processing_time = time.time() - start_time
            
            logger.info(f"Watermark removal completed successfully for task {request.task_id}")
            logger.info(f"Processing time: {processing_time:.2f}s")
            logger.info(f"Processed video URL: {processed_video_url}")
            
            return WatermarkRemovalResponse(
                success=True,
                message="Watermark removal completed successfully",
                task_id=request.task_id,
                original_video_url=request.video_url,
                processed_video_url=processed_video_url,
                watermark_area=request.watermark_area,
                processing_time=processing_time,
                video_duration=video_info.get('duration', 0.0),
                total_frames=video_info.get('total_frames', 0),
                inpaint_method=request.inpaint_method
            )
            
        except Exception as e:
            processing_time = time.time() - start_time
            error_message = f"Watermark removal failed: {str(e)}"
            
            logger.error(f"Watermark removal error for task {request.task_id}: {error_message}")
            logger.debug(f"Watermark removal error details: {str(e)}", exc_info=True)
            
            return WatermarkRemovalErrorResponse(
                success=False,
                message=error_message,
                task_id=request.task_id,
                error_code="PROCESSING_ERROR",
                details=str(e)
            )
    
    async def _download_video_if_needed(self, video_url: str) -> str:
        """Download video if it's a remote URL, otherwise return local path."""
        if video_url.startswith(('http://', 'https://')):
            logger.info(f"Downloading remote video: {video_url}")
            
            # Create temporary file for downloaded video
            temp_video = tempfile.NamedTemporaryFile(suffix='.mp4', delete=False, dir=self.temp_dir)
            temp_video_path = temp_video.name
            temp_video.close()
            
            try:
                # Download video using requests library
                logger.info(f"Starting video download with requests library")
                
                # Set headers to mimic a browser request
                headers = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
                
                # Download with streaming to handle large files
                response = requests.get(video_url, headers=headers, stream=True, timeout=300)
                response.raise_for_status()
                
                # Get file size if available
                total_size = int(response.headers.get('content-length', 0))
                logger.info(f"Video file size: {total_size / 1024 / 1024:.2f} MB" if total_size > 0 else "Video file size: unknown")
                
                # Write video data to temporary file
                downloaded_size = 0
                with open(temp_video_path, 'wb') as f:
                    for chunk in response.iter_content(chunk_size=8192):
                        if chunk:
                            f.write(chunk)
                            downloaded_size += len(chunk)
                            
                            # Log progress every 10MB
                            if downloaded_size % (10 * 1024 * 1024) == 0:
                                if total_size > 0:
                                    progress = (downloaded_size / total_size) * 100
                                    logger.info(f"Download progress: {downloaded_size / 1024 / 1024:.2f}MB / {total_size / 1024 / 1024:.2f}MB ({progress:.1f}%)")
                                else:
                                    logger.info(f"Downloaded: {downloaded_size / 1024 / 1024:.2f}MB")
                
                logger.info(f"Video downloaded successfully to: {temp_video_path}")
                logger.info(f"Final file size: {os.path.getsize(temp_video_path) / 1024 / 1024:.2f} MB")
                return temp_video_path
                
            except requests.exceptions.RequestException as e:
                # Clean up temporary file on error
                if os.path.exists(temp_video_path):
                    os.unlink(temp_video_path)
                raise Exception(f"Failed to download video: {str(e)}")
            except Exception as e:
                # Clean up temporary file on error
                if os.path.exists(temp_video_path):
                    os.unlink(temp_video_path)
                raise e
        else:
            # Local file path
            if not os.path.exists(video_url):
                raise FileNotFoundError(f"Local video file not found: {video_url}")
            return video_url
    
    async def _get_video_info(self, video_path: str) -> dict:
        """Get video information using OpenCV."""
        logger.info(f"Getting video information for: {video_path}")
        
        cap = cv2.VideoCapture(video_path)
        
        if not cap.isOpened():
            raise Exception(f"Failed to open video file: {video_path}")
        
        try:
            frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            fps = cap.get(cv2.CAP_PROP_FPS)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            duration = total_frames / fps if fps > 0 else 0
            
            video_info = {
                'width': frame_width,
                'height': frame_height,
                'fps': fps,
                'total_frames': total_frames,
                'duration': duration
            }
            
            logger.info(f"Video info: {frame_width}x{frame_height}, {fps:.2f}fps, {total_frames} frames, {duration:.2f}s")
            return video_info
            
        finally:
            cap.release()
    
    async def _process_video_watermark_removal(
        self, 
        source_video_path: str, 
        watermark_area: WatermarkArea,
        inpaint_radius: int,
        inpaint_method: str,
        task_id: str
    ) -> str:
        """Process video to remove watermark using OpenCV inpainting."""
        logger.info(f"Starting watermark removal processing for task {task_id}")
        
        # Create temporary file for processed video
        temp_processed_video = tempfile.NamedTemporaryFile(
            suffix='_no_watermark.mp4', 
            delete=False, 
            dir=self.temp_dir
        )
        processed_video_path = temp_processed_video.name
        temp_processed_video.close()
        
        # Create temporary file for video without audio (intermediate)
        temp_no_audio_video = tempfile.NamedTemporaryFile(
            suffix='_no_audio.mp4', 
            delete=False, 
            dir=self.temp_dir
        )
        no_audio_video_path = temp_no_audio_video.name
        temp_no_audio_video.close()
        
        try:
            # Open input video
            cap = cv2.VideoCapture(source_video_path)
            
            if not cap.isOpened():
                raise Exception(f"Failed to open source video: {source_video_path}")
            
            # Get video properties
            frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            fps = cap.get(cv2.CAP_PROP_FPS)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            
            # Log detailed coordinate information
            logger.info(f"Video dimensions: {frame_width}x{frame_height}")
            logger.info(f"Watermark area coordinates: x1={watermark_area.x1}, y1={watermark_area.y1}, x2={watermark_area.x2}, y2={watermark_area.y2}")
            logger.info(f"Watermark area size: {watermark_area.x2 - watermark_area.x1}x{watermark_area.y2 - watermark_area.y1}")
            logger.info(f"Watermark area position: top-left=({watermark_area.x1},{watermark_area.y1}), bottom-right=({watermark_area.x2},{watermark_area.y2})")
            logger.info(f"Watermark area as percentage of video: x=({watermark_area.x1/frame_width*100:.1f}%-{watermark_area.x2/frame_width*100:.1f}%), y=({watermark_area.y1/frame_height*100:.1f}%-{watermark_area.y2/frame_height*100:.1f}%)")
            
            # Validate watermark area coordinates
            if (watermark_area.x1 >= frame_width or watermark_area.y1 >= frame_height or
                watermark_area.x2 > frame_width or watermark_area.y2 > frame_height):
                error_msg = f"Watermark area coordinates exceed video dimensions ({frame_width}x{frame_height}). Coordinates: ({watermark_area.x1},{watermark_area.y1}) to ({watermark_area.x2},{watermark_area.y2})"
                logger.error(error_msg)
                raise ValueError(error_msg)
            
            if watermark_area.x1 < 0 or watermark_area.y1 < 0:
                error_msg = f"Watermark area coordinates cannot be negative. Coordinates: ({watermark_area.x1},{watermark_area.y1}) to ({watermark_area.x2},{watermark_area.y2})"
                logger.error(error_msg)
                raise ValueError(error_msg)
            
            # Set up video writer with web-compatible codec
            # Use a temporary AVI file first for better compatibility with OpenCV processing
            temp_avi_path = no_audio_video_path.replace('.mp4', '_temp.avi')
            fourcc = cv2.VideoWriter_fourcc(*'XVID')  # Use XVID for intermediate processing
            out = cv2.VideoWriter(temp_avi_path, fourcc, fps, (frame_width, frame_height))
            
            # Create watermark mask
            mask = np.zeros((frame_height, frame_width), dtype=np.uint8)
            mask[watermark_area.y1:watermark_area.y2, watermark_area.x1:watermark_area.x2] = 255
            
            # Log mask information
            mask_area = np.sum(mask > 0)
            mask_rows, mask_cols = np.where(mask > 0)
            logger.info(f"Created watermark mask with {mask_area} pixels marked for inpainting")
            logger.info(f"Mask coordinate range: rows {mask_rows.min()}-{mask_rows.max()}, cols {mask_cols.min()}-{mask_cols.max()}")
            logger.info(f"Mask dimensions: {mask.shape} (height x width)")
            logger.info(f"Mask area bounds: y={watermark_area.y1}:{watermark_area.y2}, x={watermark_area.x1}:{watermark_area.x2}")
            logger.info(f"Expected mask pixels: {(watermark_area.x2 - watermark_area.x1) * (watermark_area.y2 - watermark_area.y1)}, actual: {mask_area}")
            
            # Set inpaint method
            if inpaint_method == "telea":
                cv_inpaint_method = cv2.INPAINT_TELEA
            else:  # "ns"
                cv_inpaint_method = cv2.INPAINT_NS
            
            logger.info(f"Processing {total_frames} frames with {inpaint_method} method using {self.config.concurrent_threads} threads")
            logger.info(f"Batch size: {self.config.batch_size} frames per batch")
            
            # Process frames using multi-threading
            frame_count = await self._process_frames_multithreaded(
                cap, out, mask, inpaint_radius, cv_inpaint_method, total_frames, task_id
            )
            
            # Release resources
            cap.release()
            out.release()
            cv2.destroyAllWindows()
            
            logger.info(f"Frame processing completed. Total frames processed: {frame_count}")
            
            # Convert AVI to web-compatible MP4 using FFmpeg
            logger.info("Converting processed video to web-compatible MP4 format...")
            
            convert_cmd = [
                'ffmpeg', '-y',  # -y to overwrite output file
                '-i', temp_avi_path,  # input AVI file
                '-c:v', 'libx264',    # use H.264 codec for web compatibility
                '-preset', 'medium',   # balance between speed and compression
                '-crf', '23',         # good quality setting
                '-pix_fmt', 'yuv420p', # ensure compatibility with browsers
                '-movflags', '+faststart',  # optimize for web streaming
                no_audio_video_path   # output MP4 file
            ]
            
            try:
                convert_result = subprocess.run(
                    convert_cmd,
                    capture_output=True,
                    text=True,
                    timeout=600  # 10 minutes timeout
                )
                
                if convert_result.returncode != 0:
                    logger.error(f"Video conversion failed: {convert_result.stderr}")
                    raise Exception(f"Failed to convert video to web-compatible format: {convert_result.stderr}")
                
                logger.info("Video conversion to MP4 completed successfully")
                
                # Clean up temporary AVI file
                if os.path.exists(temp_avi_path):
                    os.unlink(temp_avi_path)
                    
            except subprocess.TimeoutExpired:
                logger.error("Video conversion timeout")
                raise Exception("Video conversion timed out")
            except Exception as e:
                # Clean up temporary files on error
                if os.path.exists(temp_avi_path):
                    os.unlink(temp_avi_path)
                raise e
            
            # Merge audio from original video using ffmpeg
            logger.info("Merging audio from original video...")
            
            # First, check if the original video has audio
            probe_cmd = [
                'ffprobe', '-v', 'quiet', '-select_streams', 'a', 
                '-show_entries', 'stream=index', '-of', 'csv=p=0', source_video_path
            ]
            
            try:
                probe_result = subprocess.run(
                    probe_cmd,
                    capture_output=True,
                    text=True,
                    timeout=30
                )
                
                has_audio = bool(probe_result.stdout.strip())
                logger.info(f"Original video has audio: {has_audio}")
                
                if has_audio:
                    # Try to merge audio
                    ffmpeg_cmd = [
                        'ffmpeg', '-y',  # -y to overwrite output file
                        '-i', no_audio_video_path,  # processed video (no audio)
                        '-i', source_video_path,    # original video (with audio)
                        '-c:v', 'copy',             # copy video stream
                        '-c:a', 'aac',              # encode audio as AAC
                        '-map', '0:v:0',            # map video from first input
                        '-map', '1:a:0',            # map audio from second input
                        processed_video_path
                    ]
                    
                    result = subprocess.run(
                        ffmpeg_cmd,
                        capture_output=True,
                        text=True,
                        timeout=600  # 10 minutes timeout
                    )
                    
                    if result.returncode != 0:
                        logger.warning(f"FFmpeg audio merge failed: {result.stderr}")
                        logger.info("Using video without audio as fallback")
                        # Remove target file if it exists before renaming
                        if os.path.exists(processed_video_path):
                            os.unlink(processed_video_path)
                        os.rename(no_audio_video_path, processed_video_path)
                    else:
                        logger.info("Audio merge completed successfully")
                        # Clean up intermediate file
                        if os.path.exists(no_audio_video_path):
                            os.unlink(no_audio_video_path)
                else:
                    logger.info("Original video has no audio, using processed video without audio")
                    # Remove target file if it exists before renaming
                    if os.path.exists(processed_video_path):
                        os.unlink(processed_video_path)
                    os.rename(no_audio_video_path, processed_video_path)
                    
            except subprocess.TimeoutExpired:
                logger.warning("FFprobe timeout, assuming no audio")
                # Remove target file if it exists before renaming
                if os.path.exists(processed_video_path):
                    os.unlink(processed_video_path)
                os.rename(no_audio_video_path, processed_video_path)
            except Exception as e:
                logger.warning(f"Error checking for audio: {str(e)}, using video without audio")
                # Remove target file if it exists before renaming
                if os.path.exists(processed_video_path):
                    os.unlink(processed_video_path)
                os.rename(no_audio_video_path, processed_video_path)
            
            logger.info(f"Watermark removal processing completed: {processed_video_path}")
            return processed_video_path
            
        except Exception as e:
            # Clean up temporary files on error
            temp_avi_path = no_audio_video_path.replace('.mp4', '_temp.avi') if no_audio_video_path else None
            for temp_file in [processed_video_path, no_audio_video_path, temp_avi_path]:
                if temp_file and os.path.exists(temp_file):
                    os.unlink(temp_file)
            raise e
    
    async def _upload_processed_video(
        self,
        processed_video_path: str,
        task_id: str,
        custom_filename: Optional[str] = None
    ) -> str:
        """Upload processed video to storage service."""
        logger.info(f"Uploading processed video for task {task_id}")

        try:
            # Determine filename
            if custom_filename:
                filename = self._sanitize_filename(custom_filename)
                if not filename.endswith('.mp4'):
                    filename += '.mp4'
            else:
                filename = f"{task_id}_watermark_removed.mp4"

            logger.info(f"Uploading video: {filename}")

            with open(processed_video_path, "rb") as f:
                file_data = f.read()

            upload_result = await storage_service.upload_file(
                file_data=file_data,
                filename=filename,
                content_type="video/mp4",
                folder="video",
                user_id="anonymous",
                task_id=task_id,
            )

            if not upload_result.get("success"):
                raise Exception(f"Upload failed: {upload_result.get('message', 'Unknown error')}")

            video_url = upload_result.get("file_url")
            if not video_url:
                raise Exception("No file URL returned from upload")

            logger.info(f"Video uploaded successfully: {video_url}")
            return video_url

        finally:
            # Clean up temporary file
            if os.path.exists(processed_video_path):
                os.unlink(processed_video_path)
    
    async def _process_frames_multithreaded(
        self, 
        cap: cv2.VideoCapture,
        out: cv2.VideoWriter,
        mask: np.ndarray,
        inpaint_radius: int,
        cv_inpaint_method: int,
        total_frames: int,
        task_id: str
    ) -> int:
        """Process video frames using multi-threading for faster watermark removal."""
        logger.info(f"Starting multi-threaded frame processing for task {task_id}")
        
        # Read all frames first
        logger.info("Reading all frames into memory...")
        frames = []
        frame_count = 0
        
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            frames.append((frame_count, frame.copy()))
            frame_count += 1
            
            # Log reading progress
            if frame_count % self.config.logging.log_progress_interval == 0:
                progress = (frame_count / total_frames) * 100
                logger.info(f"Reading progress: {frame_count}/{total_frames} ({progress:.1f}%)")
        
        logger.info(f"Finished reading {frame_count} frames into memory")
        
        # Create batches
        batches = self._create_frame_batches(frames)
        logger.info(f"Created {len(batches)} batches for processing")
        
        # Process batches using ThreadPoolExecutor
        processed_frames = {}
        completed_frames = 0
        
        with ThreadPoolExecutor(max_workers=self.config.concurrent_threads) as executor:
            # Submit all batch processing tasks
            future_to_batch = {}
            for batch_idx, batch in enumerate(batches):
                future = executor.submit(
                    self._process_frame_batch, 
                    batch, mask, inpaint_radius, cv_inpaint_method, batch_idx, task_id
                )
                future_to_batch[future] = batch_idx
            
            # Collect results as they complete
            for future in as_completed(future_to_batch):
                batch_idx = future_to_batch[future]
                try:
                    batch_results = future.result(timeout=self.config.batch_timeout)
                    
                    # Store processed frames
                    for frame_idx, processed_frame in batch_results:
                        processed_frames[frame_idx] = processed_frame
                    
                    completed_frames += len(batch_results)
                    
                    # Log progress
                    if self.config.logging.enable_detailed_logs:
                        progress = (completed_frames / frame_count) * 100
                        logger.info(f"Batch {batch_idx} completed. Overall progress: {completed_frames}/{frame_count} ({progress:.1f}%)")
                        
                except Exception as e:
                    logger.error(f"Batch {batch_idx} processing failed: {str(e)}")
                    raise e
        
        # Write processed frames in order
        logger.info("Writing processed frames to output video...")
        frames_written = 0
        for frame_idx in range(frame_count):
            if frame_idx in processed_frames:
                out.write(processed_frames[frame_idx])
                frames_written += 1
                
                # Log writing progress
                if frames_written % self.config.logging.log_progress_interval == 0:
                    progress = (frames_written / frame_count) * 100
                    logger.info(f"Writing progress: {frames_written}/{frame_count} ({progress:.1f}%)")
            else:
                logger.error(f"Missing processed frame at index {frame_idx}")
                raise Exception(f"Missing processed frame at index {frame_idx}")
        
        logger.info(f"Multi-threaded frame processing completed. Total frames: {frames_written}")
        return frames_written
    
    def _create_frame_batches(self, frames: List[Tuple[int, np.ndarray]]) -> List[List[Tuple[int, np.ndarray]]]:
        """Create batches of frames for parallel processing."""
        batches = []
        batch_size = self.config.batch_size
        
        for i in range(0, len(frames), batch_size):
            batch = frames[i:i + batch_size]
            batches.append(batch)
        
        logger.info(f"Created {len(batches)} batches with batch size {batch_size}")
        return batches
    
    def _process_frame_batch(
        self, 
        batch: List[Tuple[int, np.ndarray]], 
        mask: np.ndarray, 
        inpaint_radius: int, 
        cv_inpaint_method: int,
        batch_idx: int,
        task_id: str
    ) -> List[Tuple[int, np.ndarray]]:
        """Process a batch of frames in a single thread."""
        thread_id = threading.get_ident()
        
        if self.config.logging.enable_thread_logging:
            logger.info(f"Thread {thread_id}: Processing batch {batch_idx} with {len(batch)} frames for task {task_id}")
        
        processed_batch = []
        
        for frame_idx, frame in batch:
            try:
                # Apply inpainting to remove watermark
                processed_frame = cv2.inpaint(frame, mask, inpaint_radius, cv_inpaint_method)
                processed_batch.append((frame_idx, processed_frame))
                
            except Exception as e:
                logger.error(f"Thread {thread_id}: Error processing frame {frame_idx} in batch {batch_idx}: {str(e)}")
                raise e
        
        if self.config.logging.enable_thread_logging:
            logger.info(f"Thread {thread_id}: Completed batch {batch_idx} with {len(processed_batch)} frames")
        
        return processed_batch 