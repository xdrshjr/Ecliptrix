"""
ComfyUI integration service for the ComfyUI API Service.
"""

import requests
import json
import time
import uuid
import os
import asyncio
from datetime import datetime
from typing import Dict, List, Optional, Any
from pathlib import Path

from app.config import settings
from app.logger import get_logger
from app.models.request_models import ImageGenerationRequest, DigitalHumanGenerationRequest
from app.models.response_models import ImageInfo, VideoInfo, GenerationStatus

logger = get_logger(__name__)


class ComfyUIService:
    """Service class for ComfyUI integration."""
    
    def __init__(self):
        """Initialize ComfyUI service."""
        self.base_url = settings.comfyui.base_url.rstrip('/')
        self.client_id = str(uuid.uuid4())
        self.session = requests.Session()
        self.session.timeout = settings.comfyui.request_timeout
        
        # Ensure generated images directory exists
        self.generated_dir = Path(settings.storage.generated_images_dir)
        self.generated_dir.mkdir(parents=True, exist_ok=True)
        
        # Ensure ComfyUI input directory exists
        self.input_dir = Path(settings.comfyui.input_dir)
        self.input_dir.mkdir(parents=True, exist_ok=True)
        
        logger.info(f"ComfyUI service initialized with base URL: {self.base_url}")
        logger.info(f"Client ID: {self.client_id}")
        logger.info(f"Generated images directory: {self.generated_dir}")
        logger.info(f"ComfyUI input directory: {self.input_dir}")
        logger.info(f"ComfyUI input directory exists: {self.input_dir.exists()}")
        if self.input_dir.exists():
            logger.info(f"ComfyUI input directory permissions: readable={os.access(self.input_dir, os.R_OK)}, writable={os.access(self.input_dir, os.W_OK)}")
        else:
            logger.warning(f"ComfyUI input directory does not exist and will be created: {self.input_dir}")
    
    async def health_check(self) -> Dict[str, Any]:
        """
        Check ComfyUI service health.
        
        Returns:
            Health status information
        """
        try:
            response = self.session.get(f"{self.base_url}/system_stats", timeout=5)
            response.raise_for_status()
            
            logger.info("ComfyUI health check passed")
            return {
                "status": "healthy",
                "comfyui_url": self.base_url,
                "response_time_ms": response.elapsed.total_seconds() * 1000
            }
            
        except requests.exceptions.RequestException as e:
            logger.error(f"ComfyUI health check failed: {e}")
            return {
                "status": "unhealthy",
                "comfyui_url": self.base_url,
                "error": str(e)
            }
        except Exception as e:
            logger.error(f"Unexpected error during health check: {e}")
            return {
                "status": "error",
                "comfyui_url": self.base_url,
                "error": str(e)
            }
    
    def create_workflow(self, request: ImageGenerationRequest) -> Dict[str, Any]:
        """
        Create ComfyUI workflow for image generation.
        
        Args:
            request: Image generation request
            
        Returns:
            ComfyUI workflow JSON
        """
        # Load the workflow template
        workflow_path = Path(__file__).parent.parent.parent / "workflows" / "flux_dev_workflow.json"
        
        try:
            with open(workflow_path, 'r', encoding='utf-8') as f:
                workflow = json.load(f)
        except FileNotFoundError:
            logger.error(f"Workflow template not found: {workflow_path}")
            # Create a basic workflow if template is missing
            workflow = self._create_basic_workflow()
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON in workflow template: {e}")
            workflow = self._create_basic_workflow()
        
        # Update workflow with request parameters
        try:
            # Update text prompts (assuming node IDs from the workflow)
            if "6" in workflow:  # CLIP Text Encode (Prompt) - Positive
                workflow["6"]["inputs"]["text"] = request.positive_prompt
            
            if "7" in workflow:  # CLIP Text Encode (Prompt) - Negative
                workflow["7"]["inputs"]["text"] = request.negative_prompt
            
            # Update Empty Latent Image dimensions
            if "5" in workflow:  # Empty Latent Image
                workflow["5"]["inputs"]["width"] = request.width
                workflow["5"]["inputs"]["height"] = request.height
            
            # Update KSampler parameters
            if "3" in workflow:  # KSampler
                workflow["3"]["inputs"]["steps"] = request.steps
                workflow["3"]["inputs"]["cfg"] = request.cfg
                if request.seed is not None:
                    workflow["3"]["inputs"]["seed"] = request.seed
            
            # Update model checkpoint if specified
            if "4" in workflow and request.checkpoint:  # Load Checkpoint
                workflow["4"]["inputs"]["ckpt_name"] = request.checkpoint
                
        except KeyError as e:
            logger.warning(f"Workflow node not found, using default: {e}")
        
        logger.debug(f"Created workflow for image generation: prompt={request.positive_prompt[:100]}, "
                    f"dimensions={request.width}x{request.height}, steps={request.steps}, cfg={request.cfg}, guidance={request.guidance}")
        
        return workflow

    def create_digital_human_workflow(self, request: DigitalHumanGenerationRequest) -> Dict[str, Any]:
        """
        Create ComfyUI workflow for digital human video generation.
        
        Args:
            request: Digital human generation request
            
        Returns:
            ComfyUI workflow JSON
        """
        # Load the digital human workflow template
        workflow_path = Path(__file__).parent.parent.parent / "workflows" / "wanvideo_infinitetalk_digital_human.json"
        
        try:
            with open(workflow_path, 'r', encoding='utf-8') as f:
                workflow = json.load(f)
        except FileNotFoundError:
            logger.error(f"Digital human workflow template not found: {workflow_path}")
            raise ValueError("Digital human workflow template not found")
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON in digital human workflow template: {e}")
            raise ValueError("Invalid digital human workflow template")
        
        # Get absolute paths for the files
        input_dir = Path(settings.comfyui.input_dir).resolve()  # Get absolute path
        audio_abs_path = input_dir / request.audio_filename
        video_abs_path = input_dir / request.reference_video_filename
        
        logger.info(f"Using absolute paths:")
        logger.info(f"  Audio: {audio_abs_path}")
        logger.info(f"  Video: {video_abs_path}")
        
        # Update workflow with request parameters
        try:
            # Update audio input (node 125 - LoadAudio) with absolute path
            if "125" in workflow:
                workflow["125"]["inputs"]["audio"] = str(audio_abs_path)
            
            # Update reference video input (node 222 - VHS_LoadVideo) with absolute path
            if "222" in workflow:
                workflow["222"]["inputs"]["video"] = str(video_abs_path)
            
            # Update text prompts (node 135 - WanVideoTextEncode)
            if "135" in workflow:
                workflow["135"]["inputs"]["positive_prompt"] = request.positive_prompt
                workflow["135"]["inputs"]["negative_prompt"] = request.negative_prompt
            
            # Update dimensions (nodes 235, 236 - INTConstant)
            if "235" in workflow:  # width
                workflow["235"]["inputs"]["value"] = request.width
            if "236" in workflow:  # height
                workflow["236"]["inputs"]["value"] = request.height
            
            # Update sampler parameters (node 220 - WanVideoSampler)
            if "220" in workflow:
                workflow["220"]["inputs"]["steps"] = request.steps
                workflow["220"]["inputs"]["cfg"] = request.cfg
                workflow["220"]["inputs"]["shift"] = request.shift
                if request.seed is not None:
                    workflow["220"]["inputs"]["seed"] = request.seed
            
            # Update video dimensions in other nodes
            if "192" in workflow:  # WanVideoImageToVideoMultiTalk
                workflow["192"]["inputs"]["width"] = request.width
                workflow["192"]["inputs"]["height"] = request.height
                
        except KeyError as e:
            logger.warning(f"Digital human workflow node not found, using default: {e}")
        
        logger.debug(f"Created digital human workflow: prompt={request.positive_prompt[:100]}, "
                    f"dimensions={request.width}x{request.height}, steps={request.steps}, cfg={request.cfg}, "
                    f"reference_video={video_abs_path}, audio={audio_abs_path}")
        
        return workflow
    
    async def submit_workflow(self, request: ImageGenerationRequest) -> Optional[str]:
        """
        Submit workflow to ComfyUI and return prompt_id.
        
        Args:
            request: Image generation request
            
        Returns:
            Prompt ID if successful, None otherwise
        """
        try:
            workflow = self.create_workflow(request)
            prompt_data = {
                "prompt": workflow,
                "client_id": self.client_id
            }
            
            logger.info(f"Submitting workflow to ComfyUI: {request.positive_prompt[:100]}...")
            logger.debug(f"Workflow data: {json.dumps(prompt_data, indent=2)}")
            
            response = self.session.post(f"{self.base_url}/prompt", json=prompt_data)
            response.raise_for_status()
            result = response.json()
            
            prompt_id = result["prompt_id"]
            logger.info(f"Workflow submitted successfully with prompt_id: {prompt_id}")
            return prompt_id
            
        except requests.exceptions.RequestException as e:
            logger.error(f"Error submitting workflow to ComfyUI: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error submitting workflow: {e}")
            return None

    async def submit_digital_human_workflow(self, request: DigitalHumanGenerationRequest) -> Optional[str]:
        """
        Submit digital human workflow to ComfyUI and return prompt_id.
        
        Args:
            request: Digital human generation request
            
        Returns:
            Prompt ID if successful, None otherwise
        """
        try:
            # Validate files exist before submitting workflow
            await self._validate_digital_human_files(request)
            
            workflow = self.create_digital_human_workflow(request)
            prompt_data = {
                "prompt": workflow,
                "client_id": self.client_id
            }
            
            logger.info(f"Submitting digital human workflow to ComfyUI: {request.positive_prompt[:100]}...")
            logger.info(f"Using files - Audio: {request.audio_filename}, Video: {request.reference_video_filename}")
            logger.debug(f"Digital human workflow data: {json.dumps(prompt_data, indent=2)}")
            
            response = self.session.post(f"{self.base_url}/prompt", json=prompt_data)
            response.raise_for_status()
            result = response.json()
            
            prompt_id = result["prompt_id"]
            logger.info(f"Digital human workflow submitted successfully with prompt_id: {prompt_id}")
            return prompt_id
            
        except ValueError as e:
            logger.error(f"File validation error for digital human workflow: {e}")
            return None
        except requests.exceptions.RequestException as e:
            logger.error(f"Error submitting digital human workflow to ComfyUI: {e}")
            
            # Log the full response for debugging
            if hasattr(e, 'response') and e.response is not None:
                logger.error(f"ComfyUI HTTP Status: {e.response.status_code}")
                logger.error(f"ComfyUI Response Headers: {dict(e.response.headers)}")
                try:
                    response_text = e.response.text
                    logger.error(f"ComfyUI Response Body: {response_text}")
                    
                    # Try to parse as JSON
                    error_data = e.response.json()
                    logger.error(f"ComfyUI Error Data: {error_data}")
                    
                    # Check for validation error
                    if 'type' in error_data and error_data['type'] == 'prompt_outputs_failed_validation':
                        logger.error("=" * 80)
                        logger.error("COMFYUI FILE VALIDATION FAILED")
                        logger.error("=" * 80)
                        logger.error("ComfyUI cannot find the uploaded files even with absolute paths.")
                        logger.error(f"Files that ComfyUI API service can see:")
                        
                        input_dir = Path(settings.comfyui.input_dir).resolve()
                        audio_abs_path = input_dir / request.audio_filename
                        video_abs_path = input_dir / request.reference_video_filename
                        
                        logger.error(f"  - Audio: {audio_abs_path}")
                        logger.error(f"  - Video: {video_abs_path}")
                        logger.error(f"  - Input directory: {input_dir}")
                        
                        if input_dir.exists():
                            logger.error(f"  - Audio exists locally: {audio_abs_path.exists()}")
                            logger.error(f"  - Video exists locally: {video_abs_path.exists()}")
                        
                        logger.error(f"ComfyUI instance URL: {self.base_url}")
                        logger.error("=" * 80)
                        logger.error("POSSIBLE CAUSES:")
                        logger.error("1. ComfyUI is running in a different filesystem/container")
                        logger.error("2. File permissions prevent ComfyUI from accessing the files")
                        logger.error("3. ComfyUI process doesn't have read access to the directory")
                        logger.error("4. Files are on a different mount point that ComfyUI can't see")
                        logger.error("=" * 80)
                        logger.error("SOLUTIONS:")
                        logger.error("1. Check file permissions: chmod 644 <files>")
                        logger.error("2. Check directory permissions: chmod 755 <directory>")
                        logger.error("3. Ensure ComfyUI process user can access the files")
                        logger.error("4. If using Docker, check volume mounts")
                        logger.error("5. Try copying files to ComfyUI's default input directory")
                        logger.error("=" * 80)
                        
                except Exception as parse_error:
                    logger.error(f"Could not parse ComfyUI error response as JSON: {parse_error}")
                    logger.error(f"Raw response: {e.response.text if hasattr(e.response, 'text') else 'No response text'}")
            
            return None
        except Exception as e:
            logger.error(f"Unexpected error submitting digital human workflow: {e}")
            return None

    async def _validate_digital_human_files(self, request: DigitalHumanGenerationRequest) -> None:
        """
        Validate that required files exist and are accessible for digital human generation.
        
        Args:
            request: Digital human generation request
            
        Raises:
            ValueError: If files are missing or inaccessible
        """
        input_dir = Path(settings.comfyui.input_dir).resolve()  # Get absolute path
        
        logger.info(f"Validating digital human files in directory: {input_dir}")
        logger.info(f"ComfyUI base URL: {self.base_url}")
        
        # Check if input directory exists
        if not input_dir.exists():
            logger.error(f"ComfyUI input directory does not exist: {input_dir}")
            raise ValueError(f"ComfyUI input directory does not exist: {input_dir}")
        
        # List all files in the directory for debugging
        try:
            all_files = list(input_dir.glob('*'))
            logger.info(f"Files in input directory ({len(all_files)} total): {[f.name for f in all_files[:10]]}")  # Show first 10 files
            dh_files = list(input_dir.glob('dh_*'))
            logger.info(f"Digital human files found ({len(dh_files)} total): {[f.name for f in dh_files]}")
        except Exception as e:
            logger.error(f"Error listing directory contents: {e}")
        
        # Get absolute paths
        audio_abs_path = input_dir / request.audio_filename
        video_abs_path = input_dir / request.reference_video_filename
        
        # Check audio file
        logger.info(f"Checking audio file: {audio_abs_path}")
        if not audio_abs_path.exists():
            logger.error(f"Audio file not found: {audio_abs_path}")
            logger.error(f"ComfyUI input directory: {input_dir}")
            logger.error(f"Available files: {list(input_dir.glob('*')) if input_dir.exists() else 'Directory not found'}")
            raise ValueError(f"Audio file not found: {request.audio_filename}. Please ensure the file is uploaded to the ComfyUI input directory.")
        
        # Check video file
        logger.info(f"Checking video file: {video_abs_path}")
        if not video_abs_path.exists():
            logger.error(f"Video file not found: {video_abs_path}")
            logger.error(f"ComfyUI input directory: {input_dir}")
            logger.error(f"Available files: {list(input_dir.glob('*')) if input_dir.exists() else 'Directory not found'}")
            raise ValueError(f"Video file not found: {request.reference_video_filename}. Please ensure the file is uploaded to the ComfyUI input directory.")
        
        # Check file permissions
        if not audio_abs_path.is_file() or not os.access(audio_abs_path, os.R_OK):
            logger.error(f"Audio file is not readable: {audio_abs_path}")
            raise ValueError(f"Audio file is not readable: {request.audio_filename}")
            
        if not video_abs_path.is_file() or not os.access(video_abs_path, os.R_OK):
            logger.error(f"Video file is not readable: {video_abs_path}")
            raise ValueError(f"Video file is not readable: {request.reference_video_filename}")
        
        logger.info(f"File validation passed - Audio: {audio_abs_path} ({audio_abs_path.stat().st_size} bytes)")
        logger.info(f"File validation passed - Video: {video_abs_path} ({video_abs_path.stat().st_size} bytes)")
        
        # Add warning about cross-machine setup - but now we're using absolute paths
        if "192.168.1.48" in self.base_url or "localhost" not in self.base_url:
            logger.info("Cross-machine setup detected, but using absolute file paths.")
            logger.info(f"Files will be referenced with absolute paths:")
            logger.info(f"  - Audio: {audio_abs_path}")
            logger.info(f"  - Video: {video_abs_path}")
            logger.info("ComfyUI should be able to access these files if they are on the same filesystem.")
    
    async def check_status(self, prompt_id: str) -> bool:
        """
        Check if generation is complete.
        
        Args:
            prompt_id: Prompt ID to check
            
        Returns:
            True if complete, False if still processing
        """
        try:
            response = self.session.get(f"{self.base_url}/history/{prompt_id}")
            response.raise_for_status()
            history = response.json()
            
            return prompt_id in history
            
        except requests.exceptions.RequestException as e:
            logger.error(f"Error checking status for prompt_id {prompt_id}: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error checking status: {e}")
            return False
    
    async def get_generated_images(self, prompt_id: str) -> List[ImageInfo]:
        """
        Get the generated images from completed workflow.
        
        Args:
            prompt_id: The prompt ID to get images for
            
        Returns:
            List of image information
        """
        try:
            logger.debug(f"Getting generated images for prompt_id: {prompt_id}")
            
            response = self.session.get(f"{self.base_url}/history/{prompt_id}")
            response.raise_for_status()
            history = response.json()
            
            if prompt_id not in history:
                logger.warning(f"No history found for prompt_id: {prompt_id}")
                return []
            
            outputs = history[prompt_id]["outputs"]
            images = []
            
            for node_id, node_output in outputs.items():
                if "images" in node_output:
                    for image_info in node_output["images"]:
                        image = ImageInfo(
                            filename=image_info["filename"],
                            subfolder=image_info.get("subfolder", ""),
                            type=image_info.get("type", "output")
                        )
                        images.append(image)
                        logger.debug(f"Found image: {image.filename}")
            
            logger.info(f"Found {len(images)} generated images for prompt_id: {prompt_id}")
            return images
            
        except requests.exceptions.RequestException as e:
            logger.error(f"Error getting generated images for {prompt_id}: {e}")
            return []
        except Exception as e:
            logger.error(f"Unexpected error getting generated images for {prompt_id}: {e}")
            return []
    
    async def download_image(self, image_info: ImageInfo, prompt_id: str) -> Optional[str]:
        """
        Download a specific image and save locally.
        
        Args:
            image_info: Image information
            prompt_id: The prompt ID
            
        Returns:
            Local file path if successful, None otherwise
        """
        try:
            params = {
                "filename": image_info.filename,
                "subfolder": image_info.subfolder,
                "type": image_info.type
            }
            
            logger.debug(f"Downloading image: {image_info.filename}")
            
            response = self.session.get(f"{self.base_url}/view", params=params)
            response.raise_for_status()
            
            # Create unique filename with timestamp
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            file_extension = Path(image_info.filename).suffix or ".png"
            local_filename = f"{prompt_id}_{timestamp}{file_extension}"
            save_path = self.generated_dir / local_filename
            
            with open(save_path, 'wb') as f:
                f.write(response.content)
            
            # Update image info with local path and size
            image_info.url = f"/static/generated/{local_filename}"
            image_info.size_bytes = len(response.content)
            
            logger.info(f"Image downloaded successfully: {save_path}")
            return str(save_path)
            
        except requests.exceptions.RequestException as e:
            logger.error(f"Error downloading image {image_info.filename}: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error downloading image {image_info.filename}: {e}")
            return None

    async def get_generated_videos(self, prompt_id: str) -> List[VideoInfo]:
        """
        Get the generated videos from completed digital human workflow.
        
        Args:
            prompt_id: The prompt ID to get videos for
            
        Returns:
            List of video information
        """
        try:
            logger.debug(f"Getting generated videos for prompt_id: {prompt_id}")
            
            response = self.session.get(f"{self.base_url}/history/{prompt_id}")
            response.raise_for_status()
            history = response.json()
            
            if prompt_id not in history:
                logger.warning(f"No history found for prompt_id: {prompt_id}")
                return []
            
            outputs = history[prompt_id]["outputs"]
            videos = []
            
            # Import VideoInfo here to avoid circular imports
            from app.models.response_models import VideoInfo
            
            for node_id, node_output in outputs.items():
                if "gifs" in node_output:  # ComfyUI stores videos as gifs in output
                    for video_info in node_output["gifs"]:
                        video = VideoInfo(
                            filename=video_info["filename"],
                            subfolder=video_info.get("subfolder", ""),
                            type=video_info.get("type", "output")
                        )
                        videos.append(video)
                        logger.debug(f"Found video: {video.filename}")
                elif "videos" in node_output:  # Some nodes might use "videos" key
                    for video_info in node_output["videos"]:
                        video = VideoInfo(
                            filename=video_info["filename"],
                            subfolder=video_info.get("subfolder", ""),
                            type=video_info.get("type", "output")
                        )
                        videos.append(video)
                        logger.debug(f"Found video: {video.filename}")
            
            logger.info(f"Found {len(videos)} generated videos for prompt_id: {prompt_id}")
            return videos
            
        except requests.exceptions.RequestException as e:
            logger.error(f"Error getting generated videos for {prompt_id}: {e}")
            return []
        except Exception as e:
            logger.error(f"Unexpected error getting generated videos for {prompt_id}: {e}")
            return []

    async def download_video(self, video_info: VideoInfo, prompt_id: str) -> Optional[str]:
        """
        Download a specific video and save locally.
        
        Args:
            video_info: Video information
            prompt_id: The prompt ID
            
        Returns:
            Local file path if successful, None otherwise
        """
        try:
            params = {
                "filename": video_info.filename,
                "subfolder": video_info.subfolder,
                "type": video_info.type
            }
            
            logger.debug(f"Downloading video: {video_info.filename}")
            
            response = self.session.get(f"{self.base_url}/view", params=params)
            response.raise_for_status()
            
            # Create unique filename with timestamp
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            file_extension = Path(video_info.filename).suffix or ".mp4"
            local_filename = f"digital_human_{prompt_id}_{timestamp}{file_extension}"
            save_path = self.generated_dir / local_filename
            
            with open(save_path, 'wb') as f:
                f.write(response.content)
            
            # Update video info with local path and size
            video_info.url = f"/static/generated/{local_filename}"
            video_info.size_bytes = len(response.content)
            
            logger.info(f"Video downloaded successfully: {save_path}")
            return str(save_path)
            
        except requests.exceptions.RequestException as e:
            logger.error(f"Error downloading video {video_info.filename}: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error downloading video {video_info.filename}: {e}")
            return None
    
    async def wait_for_completion(self, prompt_id: str, max_wait_time: Optional[int] = None) -> GenerationStatus:
        """
        Wait for workflow completion with polling.
        
        Args:
            prompt_id: The prompt ID to wait for
            max_wait_time: Maximum wait time in seconds
            
        Returns:
            Final generation status
        """
        if max_wait_time is None:
            max_wait_time = settings.comfyui.max_wait_time
        
        poll_interval = settings.comfyui.poll_interval
        start_time = time.time()
        
        logger.info(f"Waiting for completion of prompt_id: {prompt_id} (max {max_wait_time}s)")
        
        while time.time() - start_time < max_wait_time:
            try:
                if await self.check_status(prompt_id):
                    logger.info(f"Workflow completed for prompt_id: {prompt_id}")
                    return GenerationStatus.COMPLETED
                
                await asyncio.sleep(poll_interval)
                logger.debug(f"Still processing prompt_id: {prompt_id}")
                
            except Exception as e:
                logger.error(f"Error while waiting for completion: {e}")
                return GenerationStatus.FAILED
        
        logger.warning(f"Timeout waiting for completion of prompt_id: {prompt_id}")
        return GenerationStatus.FAILED

    def _create_basic_workflow(self) -> Dict[str, Any]:
        """
        Create a basic fallback workflow for image generation.
        
        Returns:
            Basic ComfyUI workflow dictionary
        """
        return {
            "6": {
                "inputs": {
                    "text": "A beautiful landscape",
                    "clip": ["30", 1]
                },
                "class_type": "CLIPTextEncode",
                "_meta": {"title": "CLIP Text Encode (Positive Prompt)"}
            },
            "7": {
                "inputs": {
                    "text": "low quality, blurry, distorted",
                    "clip": ["30", 1]
                },
                "class_type": "CLIPTextEncode",
                "_meta": {"title": "CLIP Text Encode (Negative Prompt)"}
            },
            "8": {
                "inputs": {
                    "samples": ["31", 0],
                    "vae": ["30", 2]
                },
                "class_type": "VAEDecode",
                "_meta": {"title": "VAE Decode"}
            },
            "9": {
                "inputs": {
                    "filename_prefix": "ComfyUI",
                    "images": ["8", 0]
                },
                "class_type": "SaveImage",
                "_meta": {"title": "Save Image"}
            },
            "5": {
                "inputs": {
                    "width": 1024,
                    "height": 1024,
                    "batch_size": 1
                },
                "class_type": "EmptyLatentImage",
                "_meta": {"title": "Empty Latent Image"}
            },
            "30": {
                "inputs": {
                    "ckpt_name": "flux1-dev-fp8.safetensors"
                },
                "class_type": "CheckpointLoaderSimple",
                "_meta": {"title": "Checkpoint Loader"}
            },
            "3": {
                "inputs": {
                    "seed": 123456,
                    "steps": 20,
                    "cfg": 1.0,
                    "sampler_name": "euler",
                    "scheduler": "simple",
                    "denoise": 1,
                    "model": ["30", 0],
                    "positive": ["6", 0],
                    "negative": ["7", 0],
                    "latent_image": ["5", 0]
                },
                "class_type": "KSampler",
                "_meta": {"title": "KSampler"}
            }
        }


# Global service instance
comfyui_service = ComfyUIService() 