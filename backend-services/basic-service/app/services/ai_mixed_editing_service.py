"""
AI Mixed Editing service for automatic video editing.
Handles Video Cut LLM API calls with structured prompts and JSON parsing.
"""

import json
import httpx
from typing import Dict, Any, List
from app.config import settings
from app.logger import get_logger
from app.models.ai_mixed_editing_models import MaterialItemModel, SimplifiedTimelineModel
from app.services.timeline_parser_service import TimelineParserService

logger = get_logger(__name__)


class AIMixedEditingService:
    """Service for handling AI mixed editing with Video Cut LLM."""
    
    def __init__(self):
        """Initialize the AI mixed editing service."""
        self.api_key = ***REMOVED***
        self.api_url = settings.video_cut_llm_api_url
        self.model = settings.video_cut_llm_model
        self.timeline_parser = TimelineParserService()
        
        if not self.api_key or not self.api_url:
            raise ValueError("Video Cut LLM API key and URL must be configured")
    
    def _create_simplified_example(self) -> str:
        """
        Create simplified JSON example for LLM prompt.
        
        Returns:
            str: Simplified JSON example as string
        """
        example = {
            "total_duration": 90.5,
            "video_segments": [
                {
                    "material_id": "video_001",
                    "start_time": 0,
                    "duration": 30.5,
                    "clip_start": 0.0,
                    "clip_end": 30.5
                },
                {
                    "material_id": "video_002", 
                    "start_time": 30.5,
                    "duration": 25.0,
                    "clip_start": 5.0,
                    "clip_end": 30.0
                }
            ],
            "audio_segments": [
                {
                    "material_id": "audio_001",
                    "start_time": 0,
                    "duration": 55.5,
                    "track": "audio-track-1",
                    "volume": 200,
                    "clip_start": 0.0,
                    "clip_end": 55.5
                },
                {
                    "material_id": "audio_002",
                    "start_time": 60.0,
                    "duration": 30.5,
                    "track": "audio-track-1", 
                    "volume": 150,
                    "clip_start": 0.0,
                    "clip_end": 30.5
                }
            ],
            "image_segments": [
                {
                    "material_id": "image_001",
                    "start_time": 55.5,
                    "duration": 5.0
                }
            ]
        }
        return json.dumps(example, indent=2, ensure_ascii=False)
    
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
        Create the prompt for LLM to generate simplified timeline JSON.
        
        Args:
            materials: List of material items
            
        Returns:
            str: Complete prompt for LLM
        """
        example_json = self._create_simplified_example()
        materials_info = self._format_materials_for_prompt(materials)
        
        prompt = f"""你是一个专业的视频剪辑AI助手。请基于提供的素材信息，生成一个简化的视频剪辑配置JSON。

<materials_information>
{materials_info}
</materials_information>

<simplified_json_format>
以下是简化的JSON格式示例，请严格按照这个格式生成：
{example_json}
</simplified_json_format>

<requirements>
请按照以下要求生成简化的剪辑配置：

1. **总时长计算**：
   - 根据素材安排计算合理的total_duration
   - 确保所有片段都在总时长范围内

2. **视频片段安排** (video_segments)：
   - 使用提供的视频素材ID作为material_id
   - 设定合理的start_time（开始时间）和duration（持续时间）
   - 可以设置clip_start和clip_end来截取视频的特定片段
   - 按时间顺序排列，避免重叠

3. **音频片段安排** (audio_segments)：
   - 使用提供的音频素材ID作为material_id
   - 设定合理的start_time和duration
   - 默认使用audio-track-1，如需要可以使用audio-track-2
   - volume设置为100-300之间的数值（100=正常音量）
   - 可以设置clip_start和clip_end来截取音频的特定片段

4. **图片片段安排** (image_segments)：
   - 使用提供的图片素材ID作为material_id
   - 每个图片建议显示3-8秒（duration）
   - 设定合理的start_time

5. **输出要求**：
   - 严格按照示例JSON的结构和字段名
   - 确保所有数值类型正确（时间为浮点数）
   - 不要添加示例中没有的额外字段
   - material_id必须使用提供素材的实际ID

请直接输出简化的JSON配置，不要包含任何解释文字："""

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
    
    def _log_llm_response(self, success: bool, task_id: str, error: str = None, simplified_data: SimplifiedTimelineModel = None) -> None:
        """
        Log the LLM response status.
        
        Args:
            success: Whether the LLM response was successful
            task_id: Task identifier
            error: Error message if failed
            simplified_data: Generated simplified timeline data if successful
        """
        if success:
            extra_info = {"task_id": task_id, "stage": "llm_generation"}
            if simplified_data:
                extra_info.update({
                    "total_duration": simplified_data.total_duration,
                    "video_segments": len(simplified_data.video_segments),
                    "audio_segments": len(simplified_data.audio_segments),
                    "image_segments": len(simplified_data.image_segments)
                })
            logger.info(f"LLM simplified timeline generation completed successfully - Task ID: {task_id}", extra=extra_info)
        else:
            logger.error(
                f"LLM simplified timeline generation failed - Task ID: {task_id}",
                extra={"task_id": task_id, "stage": "llm_generation", "error": error}
            )

    def _log_parsing_response(self, success: bool, task_id: str, error: str = None, timeline_data: Dict[str, Any] = None) -> None:
        """
        Log the timeline parsing response status.
        
        Args:
            success: Whether the parsing was successful
            task_id: Task identifier
            error: Error message if failed
            timeline_data: Generated full timeline data if successful
        """
        if success:
            extra_info = {"task_id": task_id, "stage": "timeline_parsing"}
            if timeline_data:
                extra_info.update({
                    "tracks_count": len(timeline_data.get("tracks", [])),
                    "materials_count": len(timeline_data.get("materials", [])),
                    "total_duration": timeline_data.get("metadata", {}).get("total_duration", 0)
                })
            logger.info(f"Timeline parsing completed successfully - Task ID: {task_id}", extra=extra_info)
        else:
            logger.error(
                f"Timeline parsing failed - Task ID: {task_id}",
                extra={"task_id": task_id, "stage": "timeline_parsing", "error": error}
            )
    
    async def generate_mixed_editing(
        self, 
        materials: List[MaterialItemModel], 
        task_id: str
    ) -> Dict[str, Any]:
        """
        Generate mixed editing timeline using simplified LLM API approach.
        
        This method:
        1. Calls LLM to generate simplified timeline JSON
        2. Parses the simplified JSON into structured data
        3. Converts simplified data to full timeline format
        
        Args:
            materials: List of material items
            task_id: Task identifier
            
        Returns:
            Dict[str, Any]: Generated full timeline JSON data
            
        Raises:
            Exception: If API call, parsing, or conversion fails
        """
        self._log_request(len(materials), task_id)
        
        try:
            # Step 1: Generate simplified timeline using LLM
            logger.info(f"Step 1: Generating simplified timeline with LLM for task: {task_id}")
            simplified_timeline = await self._generate_simplified_timeline(materials, task_id)
            
            # Step 2: Convert simplified timeline to full format
            logger.info(f"Step 2: Converting simplified timeline to full format for task: {task_id}")
            timeline_data = self._convert_to_full_timeline(simplified_timeline, materials, task_id)
            
            logger.info(f"AI mixed editing completed successfully for task: {task_id}")
            return timeline_data
            
        except Exception as e:
            error_msg = f"AI mixed editing service error: {str(e)}"
            logger.error(error_msg, extra={"task_id": task_id}, exc_info=True)
            raise Exception(error_msg)
    
    async def _generate_simplified_timeline(
        self, 
        materials: List[MaterialItemModel], 
        task_id: str
    ) -> SimplifiedTimelineModel:
        """
        Generate simplified timeline using LLM API.
        
        Args:
            materials: List of material items
            task_id: Task identifier
            
        Returns:
            SimplifiedTimelineModel: Generated simplified timeline data
            
        Raises:
            Exception: If API call or JSON parsing fails
        """
        # Create prompt for simplified JSON
        prompt = self._create_prompt(materials)
        
        # Prepare request data with reduced token requirements
        request_data = {
            "model": self.model,
            "messages": [
                {"role": "user", "content": prompt}
            ],
            "stream": False,
            "temperature": 0.2,  # Lower temperature for consistent JSON output
            "max_tokens": 8000   # Reduced tokens for simplified JSON
        }
        
        logger.info(f"Calling Video Cut LLM API for simplified timeline: {self.api_url}/chat/completions for task: {task_id}")
        
        # Debug logging: print request body if DEBUG=true
        if settings.debug:
            print(f"\n=== DEBUG: LLM API Request for task {task_id} ===")
            print(f"URL: {self.api_url}/chat/completions")
            print(f"Headers: Content-Type: application/json, Authorization: Bearer {self.api_key[:10]}...{self.api_key[-4:]}")
            print(f"Request Body:")
            # Create a copy of request_data for printing (truncate long content)
            debug_request = request_data.copy()
            if len(debug_request["messages"][0]["content"]) > 2000:
                debug_request["messages"][0]["content"] = debug_request["messages"][0]["content"][:2000] + "... [TRUNCATED]"
            print(json.dumps(debug_request, indent=2, ensure_ascii=False))
            print("=" * 50)
        
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:  # Reduced timeout for simplified generation
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
                    error_msg = f"Video Cut LLM API error: {response.status_code} - {error_text}"
                    logger.error(error_msg, extra={"task_id": task_id, "status_code": response.status_code})
                    self._log_llm_response(False, task_id, error_msg)
                    raise Exception(error_msg)
                
                # Parse response
                response_data = response.json()
                
                # Debug logging: print response body if DEBUG=true
                if settings.debug:
                    print(f"\n=== DEBUG: LLM API Response for task {task_id} ===")
                    print(f"Status Code: {response.status_code}")
                    print(f"Response Body:")
                    # Create a copy for printing (truncate long content)
                    debug_response = response_data.copy()
                    if ("choices" in debug_response and debug_response["choices"] and 
                        "message" in debug_response["choices"][0] and 
                        "content" in debug_response["choices"][0]["message"]):
                        content_length = len(debug_response["choices"][0]["message"]["content"])
                        if content_length > 3000:
                            debug_response["choices"][0]["message"]["content"] = (
                                debug_response["choices"][0]["message"]["content"][:3000] + 
                                f"... [TRUNCATED - Total length: {content_length}]"
                            )
                    print(json.dumps(debug_response, indent=2, ensure_ascii=False))
                    print("=" * 50)
                
                if "choices" not in response_data or not response_data["choices"]:
                    error_msg = "Invalid Video Cut LLM response format: no choices found"
                    logger.error(error_msg, extra={"task_id": task_id})
                    self._log_llm_response(False, task_id, error_msg)
                    raise Exception(error_msg)
                
                content = response_data["choices"][0]["message"]["content"]
                
                # Parse simplified JSON from content
                try:
                    # Clean up content (remove markdown formatting)
                    content = content.strip()
                    if content.startswith("```json"):
                        content = content[7:]
                    if content.endswith("```"):
                        content = content[:-3]
                    content = content.strip()
                    
                    # Parse JSON and validate with Pydantic model
                    simplified_data_dict = json.loads(content)
                    simplified_timeline = SimplifiedTimelineModel(**simplified_data_dict)
                    
                    # Debug logging: print parsed simplified timeline if DEBUG=true
                    if settings.debug:
                        print(f"\n=== DEBUG: Parsed Simplified Timeline for task {task_id} ===")
                        print(json.dumps(simplified_timeline.model_dump(), indent=2, ensure_ascii=False))
                        print("=" * 50)
                    
                    # Validate the simplified timeline
                    if not self.timeline_parser.validate_simplified_timeline(simplified_timeline):
                        raise ValueError("Simplified timeline validation failed")
                    
                    self._log_llm_response(True, task_id, simplified_data=simplified_timeline)
                    return simplified_timeline
                    
                except (json.JSONDecodeError, ValueError) as e:
                    error_msg = f"Failed to parse simplified JSON from LLM response: {str(e)}"
                    logger.error(error_msg, extra={"task_id": task_id, "llm_content": content[:1000]})
                    self._log_llm_response(False, task_id, error_msg)
                    raise Exception(error_msg)
                    
        except Exception as e:
            if "Video Cut LLM API error" in str(e) or "Failed to parse simplified JSON" in str(e):
                # Re-raise already handled exceptions
                raise
            else:
                error_msg = f"LLM API call failed: {str(e)}"
                logger.error(error_msg, extra={"task_id": task_id}, exc_info=True)
                self._log_llm_response(False, task_id, error_msg)
                raise Exception(error_msg)
    
    def _convert_to_full_timeline(
        self, 
        simplified_timeline: SimplifiedTimelineModel,
        materials: List[MaterialItemModel],
        task_id: str
    ) -> Dict[str, Any]:
        """
        Convert simplified timeline to full timeline format.
        
        Args:
            simplified_timeline: Simplified timeline data
            materials: List of material items
            task_id: Task identifier
            
        Returns:
            Dict[str, Any]: Full timeline JSON data
            
        Raises:
            Exception: If conversion fails
        """
        try:
            timeline_data = self.timeline_parser.parse_simplified_timeline(
                simplified_timeline=simplified_timeline,
                materials=materials,
                task_id=task_id
            )
            
            # Debug logging: print final timeline data if DEBUG=true
            if settings.debug:
                print(f"\n=== DEBUG: Final Timeline Data for task {task_id} ===")
                # Create a copy for printing (truncate materials section for readability)
                debug_timeline = timeline_data.copy()
                if "materials" in debug_timeline and len(debug_timeline["materials"]) > 3:
                    debug_timeline["materials"] = debug_timeline["materials"][:3] + [
                        f"... [TRUNCATED - Total materials: {len(timeline_data['materials'])}]"
                    ]
                print(json.dumps(debug_timeline, indent=2, ensure_ascii=False))
                print("=" * 50)
            
            self._log_parsing_response(True, task_id, timeline_data=timeline_data)
            return timeline_data
            
        except Exception as e:
            error_msg = f"Timeline conversion failed: {str(e)}"
            logger.error(error_msg, extra={"task_id": task_id}, exc_info=True)
            self._log_parsing_response(False, task_id, error_msg)
            raise Exception(error_msg)