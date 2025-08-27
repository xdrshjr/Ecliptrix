import requests
import json
import time
import uuid
import os
from datetime import datetime


class ComfyUIClient:
    def __init__(self, base_url):
        self.base_url = base_url.rstrip('/')
        self.client_id = str(uuid.uuid4())

    def submit_workflow(self, workflow):
        """Submit workflow to ComfyUI and return prompt_id"""
        prompt_data = {
            "prompt": workflow,
            "client_id": self.client_id
        }

        try:
            response = requests.post(f"{self.base_url}/prompt", json=prompt_data)
            response.raise_for_status()
            result = response.json()
            return result["prompt_id"]
        except Exception as e:
            print(f"Error submitting workflow: {e}")
            return None

    def check_status(self, prompt_id):
        """Check if the workflow is complete"""
        try:
            response = requests.get(f"{self.base_url}/history/{prompt_id}")
            response.raise_for_status()
            history = response.json()
            return prompt_id in history
        except Exception as e:
            print(f"Error checking status: {e}")
            return False

    def get_generated_images(self, prompt_id):
        """Get the generated images from completed workflow"""
        try:
            response = requests.get(f"{self.base_url}/history/{prompt_id}")
            response.raise_for_status()
            history = response.json()

            if prompt_id not in history:
                return []

            outputs = history[prompt_id]["outputs"]
            images = []

            for node_id, node_output in outputs.items():
                if "images" in node_output:
                    for image_info in node_output["images"]:
                        images.append({
                            "filename": image_info["filename"],
                            "subfolder": image_info.get("subfolder", ""),
                            "type": image_info.get("type", "output")
                        })

            return images
        except Exception as e:
            print(f"Error getting generated images: {e}")
            return []

    def download_image(self, image_info, save_path):
        """Download a specific image"""
        try:
            params = {
                "filename": image_info["filename"],
                "subfolder": image_info["subfolder"],
                "type": image_info["type"]
            }

            response = requests.get(f"{self.base_url}/view", params=params)
            response.raise_for_status()

            with open(save_path, 'wb') as f:
                f.write(response.content)

            print(f"Image saved to: {save_path}")
            return True
        except Exception as e:
            print(f"Error downloading image: {e}")
            return False


def create_workflow(positive_prompt, negative_prompt, width, height, steps, seed, cfg, guidance):
    """Create workflow with specified parameters"""
    workflow = {
        "6": {
            "inputs": {
                "text": positive_prompt,
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
                "width": width,
                "height": height,
                "batch_size": 1
            },
            "class_type": "EmptySD3LatentImage",
            "_meta": {"title": "空Latent图像（SD3）"}
        },
        "30": {
            "inputs": {
                "ckpt_name": "flux1-dev-fp8.safetensors"
            },
            "class_type": "CheckpointLoaderSimple",
            "_meta": {"title": "Checkpoint加载器（简易）"}
        },
        "31": {
            "inputs": {
                "seed": seed,
                "steps": steps,
                "cfg": cfg,
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
                "text": negative_prompt,
                "clip": ["30", 1]
            },
            "class_type": "CLIPTextEncode",
            "_meta": {"title": "CLIP Text Encode (Negative Prompt)"}
        },
        "35": {
            "inputs": {
                "guidance": guidance,
                "conditioning": ["6", 0]
            },
            "class_type": "FluxGuidance",
            "_meta": {"title": "Flux引导"}
        }
    }
    return workflow


def main():
    # Hardcoded parameters as requested
    base_url = "http://comfyui-base.vip.cpolar.top"
    positive_prompt = "cute anime girl with massive fluffy fennec ears and a big fluffy tail blonde messy long hair blue eyes wearing a maid outfit with a long black gold leaf pattern dress and a white apron mouth open placing a fancy black forest cake with candles on top of a dinner table of an old dark Victorian mansion lit by candlelight with a bright window to the foggy forest and very expensive stuff everywhere there are paintings on the walls"
    negative_prompt = "low quality, blurry, distorted"
    width = 1024
    height = 1024
    steps = 20
    seed = 365736383682994
    cfg = 1.0
    guidance = 3.5

    # Create output directory
    output_dir = "generated_images"
    os.makedirs(output_dir, exist_ok=True)

    # Initialize client
    client = ComfyUIClient(base_url)

    # Create workflow with parameters
    workflow = create_workflow(
        positive_prompt=positive_prompt,
        negative_prompt=negative_prompt,
        width=width,
        height=height,
        steps=steps,
        seed=seed,
        cfg=cfg,
        guidance=guidance
    )

    print("Submitting workflow to ComfyUI...")
    prompt_id = client.submit_workflow(workflow)

    if not prompt_id:
        print("Failed to submit workflow")
        return

    print(f"Workflow submitted with ID: {prompt_id}")
    print("Waiting for completion...")

    # Poll for completion
    max_wait_time = 300  # 5 minutes
    start_time = time.time()

    while time.time() - start_time < max_wait_time:
        if client.check_status(prompt_id):
            print("Workflow completed!")
            break
        time.sleep(5)
        print("Still processing...")
    else:
        print("Timeout waiting for completion")
        return

    # Get generated images
    images = client.get_generated_images(prompt_id)

    if not images:
        print("No images found")
        return

    # Download images
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    for i, image_info in enumerate(images):
        filename = f"generated_image_{timestamp}_{i}.png"
        save_path = os.path.join(output_dir, filename)

        if client.download_image(image_info, save_path):
            print(f"Successfully downloaded image {i + 1}/{len(images)}")
        else:
            print(f"Failed to download image {i + 1}/{len(images)}")


if __name__ == "__main__":
    main()