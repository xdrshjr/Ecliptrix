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
from app.models.request_models import ImageGenerationRequest
from app.models.response_models import ImageInfo, GenerationStatus

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
        
        logger.info(f"ComfyUI service initialized with base URL: {self.base_url}")
        logger.info(f"Client ID: {self.client_id}")
        logger.info(f"Generated images directory: {self.generated_dir}")
    
    async def health_check(self) -> Dict[str, Any]:
        """
        Check ComfyUI health status.
        
        Returns:
            Health status information
        """
        try:
            logger.debug("Performing ComfyUI health check")
            
            # Try to get system stats from ComfyUI
            # Use asyncio to run the sync request in a thread pool
            import asyncio
            import functools
            loop = asyncio.get_event_loop()
            
            response = await loop.run_in_executor(
                None, 
                functools.partial(
                    self.session.get, 
                    f"{self.base_url}/system_stats", 
                    timeout=5
                )
            )
            response.raise_for_status()
            
            logger.info("ComfyUI health check successful")
            return {
                "status": "healthy",
                "base_url": self.base_url,
                "response_time_ms": int(response.elapsed.total_seconds() * 1000)
            }
            
        except requests.exceptions.RequestException as e:
            logger.error(f"ComfyUI health check failed: {e}")
            return {
                "status": "unhealthy",
                "base_url": self.base_url,
                "error": str(e)
            }
        except Exception as e:
            logger.error(f"Unexpected error during health check: {e}")
            return {
                "status": "error",
                "base_url": self.base_url,
                "error": str(e)
            }
    
    def create_workflow(self, request: ImageGenerationRequest) -> Dict[str, Any]:
        """
        Create ComfyUI workflow from request parameters.
        
        Args:
            request: Image generation request
            
        Returns:
            ComfyUI workflow dictionary
        """
        # Use provided seed or generate random one
        seed = request.seed if request.seed is not None else int(time.time() * 1000000) % 2**32
        
        workflow = {
            "6": {
                "inputs": {
                    "text": request.positive_prompt,
                    "clip": ["30", 1]
                },
                "class_type": "CLIPTextEncode",
                "_meta": {"title": "CLIP Text Encode (Positive Prompt)"}
            },
            "8": {
                "inputs": {
                    "samples": ["31", 0],
                    "vae": ["30", 2]
                },
                "class_type": "VAEDecode",
                "_meta": {"title": "VAE解码"}
            },
            "9": {
                "inputs": {
                    "filename_prefix": "ComfyUI",
                    "images": ["8", 0]
                },
                "class_type": "SaveImage",
                "_meta": {"title": "保存图像"}
            },
            "27": {
                "inputs": {
                    "width": request.width,
                    "height": request.height,
                    "batch_size": 1
                },
                "class_type": "EmptySD3LatentImage",
                "_meta": {"title": "空Latent图像（SD3）"}
            },
            "30": {
                "inputs": {
                    "ckpt_name": request.checkpoint
                },
                "class_type": "CheckpointLoaderSimple",
                "_meta": {"title": "Checkpoint加载器（简易）"}
            },
            "31": {
                "inputs": {
                    "seed": seed,
                    "steps": request.steps,
                    "cfg": request.cfg,
                    "sampler_name": "euler",
                    "scheduler": "simple",
                    "denoise": 1,
                    "model": ["30", 0],
                    "positive": ["35", 0],
                    "negative": ["33", 0],
                    "latent_image": ["27", 0]
                },
                "class_type": "KSampler",
                "_meta": {"title": "K采样器"}
            },
            "33": {
                "inputs": {
                    "text": request.negative_prompt,
                    "clip": ["30", 1]
                },
                "class_type": "CLIPTextEncode",
                "_meta": {"title": "CLIP Text Encode (Negative Prompt)"}
            },
            "35": {
                "inputs": {
                    "guidance": request.guidance,
                    "conditioning": ["6", 0]
                },
                "class_type": "FluxGuidance",
                "_meta": {"title": "Flux引导"}
            }
        }
        
        logger.debug(f"Created workflow with parameters: width={request.width}, height={request.height}, "
                    f"steps={request.steps}, seed={seed}, cfg={request.cfg}, guidance={request.guidance}")
        
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
    
    async def check_status(self, prompt_id: str) -> bool:
        """
        Check if the workflow is complete.
        
        Args:
            prompt_id: The prompt ID to check
            
        Returns:
            True if complete, False otherwise
        """
        try:
            logger.debug(f"Checking status for prompt_id: {prompt_id}")
            
            response = self.session.get(f"{self.base_url}/history/{prompt_id}")
            response.raise_for_status()
            history = response.json()
            
            is_complete = prompt_id in history
            logger.debug(f"Status check for {prompt_id}: {'complete' if is_complete else 'processing'}")
            
            return is_complete
            
        except requests.exceptions.RequestException as e:
            logger.error(f"Error checking status for {prompt_id}: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error checking status for {prompt_id}: {e}")
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


# Global service instance
comfyui_service = ComfyUIService() 