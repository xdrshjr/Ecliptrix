"""
AI Mixed Editing service for automatic video editing.
Handles LLM API calls with structured prompts and JSON parsing.
"""

import json
import httpx
from typing import Dict, Any, List
from app.config import settings
from app.logger import get_logger
from app.models.ai_mixed_editing_models import MaterialItemModel

logger = get_logger(__name__)


class AIMixedEditingService:
    """Service for handling AI mixed editing with LLM."""
    
    def __init__(self):
        """Initialize the AI mixed editing service."""
        self.api_key = settings.llm_api_key
        self.api_url = settings.llm_api_url
        self.model = settings.llm_model
        
        if not self.api_key or not self.api_url:
            raise ValueError("LLM API key and URL must be configured")
    
    def _load_example_json(self) -> str:
        """
        Load the example JSON template from the templates directory.
        
        Returns:
            str: Example JSON content as string
        """
        try:
            with open("templates/project-json/basic-example.json", "r", encoding="utf-8") as f:
                return f.read()
        except Exception as e:
            logger.error(f"Failed to load example JSON template: {str(e)}")
            # Return a minimal example if file loading fails
            return json.dumps({
                "metadata": {"version": "1.0.0", "total_duration": 0, "track_count": 0, "item_count": 0},
                "timeline": {"currentTime": 0, "totalDuration": 0, "zoomLevel": 1, "selectedItems": [], "playbackRate": 1, "isPlaying": False, "snapToGrid": True, "gridSize": 0.5, "scrollLeft": 0},
                "tracks": [],
                "materials": []
            }, indent=2)
    
    def _format_materials_for_prompt(self, materials: List[MaterialItemModel]) -> str:
        """
        Format materials information for LLM prompt with HTML tags.
        
        Args:
            materials: List of material items
            
        Returns:
            str: Formatted materials information
        """
        materials_info = []
        
        # Group materials by type
        videos = [m for m in materials if m.type == 'video']
        audios = [m for m in materials if m.type == 'audio']
        images = [m for m in materials if m.type == 'image']
        
        # Format video materials
        if videos:
            materials_info.append("<video_materials>")
            for video in videos:
                materials_info.append(f"- ID: {video.id}")
                materials_info.append(f"  名称: {video.name}")
                materials_info.append(f"  时长: {video.duration or 0}秒")
                materials_info.append(f"  尺寸: {video.width or 0}x{video.height or 0}")
                if video.description:
                    materials_info.append(f"  描述: {video.description}")
                if video.tags:
                    materials_info.append(f"  标签: {', '.join(video.tags)}")
                materials_info.append("")
            materials_info.append("</video_materials>")
            materials_info.append("")
        
        # Format audio materials
        if audios:
            materials_info.append("<audio_materials>")
            for audio in audios:
                materials_info.append(f"- ID: {audio.id}")
                materials_info.append(f"  名称: {audio.name}")
                materials_info.append(f"  时长: {audio.duration or 0}秒")
                if audio.description:
                    materials_info.append(f"  描述: {audio.description}")
                if audio.tags:
                    materials_info.append(f"  标签: {', '.join(audio.tags)}")
                # Include metadata for audio segments
                if audio.metadata and 'segment_id' in audio.metadata:
                    materials_info.append(f"  片段ID: {audio.metadata['segment_id']}")
                    materials_info.append(f"  片段序号: {audio.metadata.get('segment_number', 'N/A')}")
                materials_info.append("")
            materials_info.append("</audio_materials>")
            materials_info.append("")
        
        # Format image materials
        if images:
            materials_info.append("<image_materials>")
            for image in images:
                materials_info.append(f"- ID: {image.id}")
                materials_info.append(f"  名称: {image.name}")
                materials_info.append(f"  尺寸: {image.width or 0}x{image.height or 0}")
                if image.description:
                    materials_info.append(f"  描述: {image.description}")
                if image.tags:
                    materials_info.append(f"  标签: {', '.join(image.tags)}")
                materials_info.append("")
            materials_info.append("</image_materials>")
        
        return "\n".join(materials_info)
    
    def _create_prompt(self, materials: List[MaterialItemModel]) -> str:
        """
        Create the prompt for LLM to generate timeline JSON.
        
        Args:
            materials: List of material items
            
        Returns:
            str: Complete prompt for LLM
        """
        example_json = self._load_example_json()
        materials_info = self._format_materials_for_prompt(materials)
        
        prompt = f"""你是一个专业的视频剪辑AI助手。请基于提供的素材信息，生成一个完整的视频剪辑时间轴JSON配置。

<materials_information>
{materials_info}
</materials_information>

<example_json_format>
以下是一个完整的时间轴JSON格式示例，请严格按照这个格式生成：
{example_json}
</example_json_format>

<requirements>
请按照以下要求生成时间轴配置：

1. **轨道安排**：
   - 视频轨道：将视频素材按合理顺序排列在video-track-1上
   - 图片轨道：将图片素材安排在image-track-1上，每个图片显示3-5秒
   - 音频轨道：将音频素材安排在audio-track-1上，语音类音频优先
   - 背景音乐：如果有背景音乐，安排在audio-track-2上，音量设置为10%
   - 字幕轨道：如果有语音音频，在subtitle-track-1上生成对应字幕

2. **时间安排**：
   - 确保各轨道的素材时间不冲突
   - 视频和音频要合理同步
   - 计算准确的总时长

3. **素材属性**：
   - 使用提供的素材ID作为materialId
   - 保持素材的原始时长和尺寸信息
   - 为每个素材生成唯一的item ID

4. **输出格式**：
   - 严格按照示例JSON的结构
   - 确保所有必需字段都存在
   - 使用正确的数据类型
</requirements>

请直接输出完整的JSON配置，不要包含任何解释文字："""

        return prompt
    
    def _log_request(self, materials_count: int, task_id: str) -> None:
        """
        Log the incoming request details.
        
        Args:
            materials_count: Number of materials
            task_id: Task identifier
        """
        logger.info(
            f"AI mixed editing request - Task ID: {task_id}",
            extra={
                "task_id": task_id,
                "model": self.model,
                "materials_count": materials_count
            }
        )
    
    def _log_response(self, success: bool, task_id: str, error: str = None, timeline_data: Dict[str, Any] = None) -> None:
        """
        Log the response status.
        
        Args:
            success: Whether the response was successful
            task_id: Task identifier
            error: Error message if failed
            timeline_data: Generated timeline data if successful
        """
        if success:
            extra_info = {"task_id": task_id}
            if timeline_data:
                extra_info.update({
                    "tracks_count": len(timeline_data.get("tracks", [])),
                    "materials_count": len(timeline_data.get("materials", [])),
                    "total_duration": timeline_data.get("metadata", {}).get("total_duration", 0)
                })
            logger.info(f"AI mixed editing response completed successfully - Task ID: {task_id}", extra=extra_info)
        else:
            logger.error(
                f"AI mixed editing response failed - Task ID: {task_id}",
                extra={"task_id": task_id, "error": error}
            )
    
    async def generate_mixed_editing(
        self, 
        materials: List[MaterialItemModel], 
        task_id: str
    ) -> Dict[str, Any]:
        """
        Generate mixed editing timeline using LLM API.
        
        Args:
            materials: List of material items
            task_id: Task identifier
            
        Returns:
            Dict[str, Any]: Generated timeline JSON data
            
        Raises:
            Exception: If API call fails or JSON parsing fails
        """
        self._log_request(len(materials), task_id)
        
        # Create prompt
        prompt = self._create_prompt(materials)
        
        # Prepare request data
        request_data = {
            "model": self.model,
            "messages": [
                {"role": "user", "content": prompt}
            ],
            "stream": False,
            "temperature": 0.3,  # Lower temperature for more consistent JSON output
            "max_tokens": 4000   # Increased tokens for complete JSON response
        }
        
        logger.info(f"Calling LLM API: {self.api_url}/chat/completions for task: {task_id}")
        
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:  # Increased timeout for JSON generation
                response = await client.post(
                    f"{self.api_url}/chat/completions",
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {self.api_key}"
                    },
                    json=request_data
                )
                
                if response.status_code != 200:
                    error_text = response.text
                    error_msg = f"LLM API error: {response.status_code} - {error_text}"
                    logger.error(error_msg, extra={"task_id": task_id, "status_code": response.status_code})
                    self._log_response(False, task_id, error_msg)
                    raise Exception(error_msg)
                
                # Parse response
                response_data = response.json()
                
                if "choices" not in response_data or not response_data["choices"]:
                    error_msg = "Invalid LLM response format: no choices found"
                    logger.error(error_msg, extra={"task_id": task_id})
                    self._log_response(False, task_id, error_msg)
                    raise Exception(error_msg)
                
                content = response_data["choices"][0]["message"]["content"]
                
                # Parse JSON from content
                try:
                    # Try to find JSON in the content (remove any markdown formatting)
                    content = content.strip()
                    if content.startswith("```json"):
                        content = content[7:]
                    if content.endswith("```"):
                        content = content[:-3]
                    content = content.strip()
                    
                    timeline_data = json.loads(content)
                    
                    # Validate basic structure
                    required_keys = ["metadata", "timeline", "tracks", "materials"]
                    for key in required_keys:
                        if key not in timeline_data:
                            raise ValueError(f"Missing required key: {key}")
                    
                    self._log_response(True, task_id, timeline_data=timeline_data)
                    return timeline_data
                    
                except (json.JSONDecodeError, ValueError) as e:
                    error_msg = f"Failed to parse JSON from LLM response: {str(e)}"
                    logger.error(error_msg, extra={"task_id": task_id, "llm_content": content[:500]})
                    self._log_response(False, task_id, error_msg)
                    raise Exception(error_msg)
                    
        except Exception as e:
            error_msg = f"AI mixed editing service error: {str(e)}"
            logger.error(error_msg, extra={"task_id": task_id}, exc_info=True)
            self._log_response(False, task_id, error_msg)
            raise