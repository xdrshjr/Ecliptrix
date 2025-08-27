"""
Video analysis service for extracting frames and analyzing them with LLM.
"""

import os
import cv2
import base64
import time
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional
from uuid import uuid4

from openai import OpenAI
from PIL import Image

import sys
sys.path.append(str(Path(__file__).resolve().parent.parent.parent))
from config import VL_LLM_API_KEY, VL_LLM_API_URL, VL_LLM_MODEL, TMP_DIR
from app.utils import get_logger
from app.models.video import FrameAnalysis, VideoAnalysisResponse

# Set up logger
logger = get_logger("video_analysis_service")


class VideoAnalysisService:
    """Service for video frame extraction and LLM analysis."""
    
    def __init__(self):
        """Initialize the video analysis service."""
        self.client = OpenAI(
            api_key=VL_LLM_API_KEY,
            base_url=VL_LLM_API_URL,
        )
        logger.info("VideoAnalysisService initialized with VL_LLM configuration")
    
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
        duration = total_frames / fps
        
        logger.info(f"Video properties - FPS: {fps}, Total frames: {total_frames}, Duration: {duration:.2f}s")
        
        # Calculate frame interval in frame numbers
        frame_step = int(fps * frame_interval)
        
        # Create output directory for frames
        video_name = Path(video_path).stem
        frames_dir = os.path.join(TMP_DIR, f"frames_{video_name}_{uuid4().hex[:8]}")
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
                timestamp = frame_count / fps
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
                encoded_string = base64.b64encode(image_file.read()).decode('utf-8')
                return f"data:image/jpeg;base64,{encoded_string}"
        except Exception as e:
            logger.error(f"Failed to encode image {image_path}: {str(e)}")
            raise
    
    async def analyze_frame_with_llm(self, frame_path: str, custom_prompt: Optional[str] = None) -> str:
        """
        Analyze a single frame using LLM.
        
        Args:
            frame_path: Path to the frame image
            custom_prompt: Custom prompt for analysis
            
        Returns:
            Analysis description from LLM
        """
        logger.debug(f"Analyzing frame: {frame_path}")
        
        try:
            # Encode image to base64
            image_base64 = self.encode_image_to_base64(frame_path)
            
            # Prepare prompt
            prompt = custom_prompt or "请详细描述这张图片中的内容，包括场景、人物、物体、动作等。"
            
            # Call LLM API
            completion = self.client.chat.completions.create(
                model=VL_LLM_MODEL,
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
            logger.debug(f"LLM analysis completed for frame: {frame_path}")
            return analysis
            
        except Exception as e:
            logger.error(f"Failed to analyze frame {frame_path}: {str(e)}")
            return f"分析失败: {str(e)}"
    
    async def analyze_video(
        self, 
        video_path: str, 
        frame_interval: int = 5,
        custom_prompt: Optional[str] = None
    ) -> VideoAnalysisResponse:
        """
        Analyze video by extracting frames and analyzing them with LLM.
        
        Args:
            video_path: Path to the video file
            frame_interval: Interval in seconds between frames to extract
            custom_prompt: Custom prompt for LLM analysis
            
        Returns:
            VideoAnalysisResponse with analysis results
        """
        start_time = time.time()
        logger.info(f"Starting video analysis for: {video_path}")
        
        try:
            # Extract frames
            frames_info, video_duration = self.extract_frames(video_path, frame_interval)
            
            # Analyze each frame with LLM
            frame_analyses = []
            for frame_info in frames_info:
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
                
                logger.info(f"Completed analysis for frame {frame_info['frame_number']} at {frame_info['timestamp']:.2f}s")
            
            processing_time = time.time() - start_time
            
            response = VideoAnalysisResponse(
                success=True,
                video_path=video_path,
                total_frames_extracted=len(frames_info),
                video_duration=video_duration,
                frame_analyses=frame_analyses,
                processing_time=processing_time,
                message=f"Successfully analyzed {len(frames_info)} frames from video"
            )
            
            logger.info(f"Video analysis completed in {processing_time:.2f}s")
            return response
            
        except Exception as e:
            processing_time = time.time() - start_time
            logger.error(f"Video analysis failed: {str(e)}")
            
            return VideoAnalysisResponse(
                success=False,
                video_path=video_path,
                total_frames_extracted=0,
                video_duration=0.0,
                frame_analyses=[],
                processing_time=processing_time,
                message=f"Analysis failed: {str(e)}"
            )
    
    def cleanup_frames(self, frames_dir: str) -> None:
        """
        Clean up extracted frame files.
        
        Args:
            frames_dir: Directory containing extracted frames
        """
        try:
            if os.path.exists(frames_dir):
                import shutil
                shutil.rmtree(frames_dir)
                logger.info(f"Cleaned up frames directory: {frames_dir}")
        except Exception as e:
            logger.warning(f"Failed to cleanup frames directory {frames_dir}: {str(e)}") 