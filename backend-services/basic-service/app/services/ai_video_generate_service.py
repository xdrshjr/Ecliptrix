"""
AI Video Generate service for workflow node.
Handles multiple input types (text, video, audio, image) and generates video editing timeline.
Uses VIDEO_CUT_LLM API (same as AI mixed editing).
"""

import json
from typing import Dict, Any, Optional
from app.config import settings
from app.logger import get_logger
from app.services.llm_client import LLMCallConfig, call_chat, normalize_api_type
from app.services.timeline_parser_service import TimelineParserService
from app.models.ai_mixed_editing_models import SimplifiedTimelineModel

logger = get_logger(__name__)


class AIVideoGenerateService:
    """Service for handling AI video generation with multiple input types."""
    
    def __init__(self):
        """Initialize the AI video generate service."""
        self.api_key = ***REMOVED***
        self.api_url = settings.video_cut_llm_api_url
        self.model = settings.video_cut_llm_model
        self.api_type = normalize_api_type(settings.video_cut_llm_api_type)
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
    
    def _parse_input_data(self, input_value: str, input_format: str) -> Any:
        """
        Parse input data based on specified format.
        
        Args:
            input_value: Raw input string
            input_format: Format type (text/plain, application/json, array)
            
        Returns:
            Parsed data (string, dict, or list)
        """
        if not input_value:
            return None
            
        if input_format == 'text/plain':
            return input_value
        elif input_format == 'application/json':
            try:
                return json.loads(input_value)
            except json.JSONDecodeError as e:
                logger.warning(f"Failed to parse JSON input: {str(e)}, treating as plain text")
                return input_value
        elif input_format == 'array':
            try:
                parsed = json.loads(input_value)
                if isinstance(parsed, list):
                    return parsed
                else:
                    logger.warning(f"Input is not an array, wrapping in array")
                    return [parsed]
            except json.JSONDecodeError as e:
                logger.warning(f"Failed to parse array input: {str(e)}, treating as plain text")
                return [input_value]
        else:
            return input_value
    
    def _format_inputs_for_prompt(self, inputs: Dict[str, Any]) -> str:
        """
        Format multiple inputs for LLM prompt.
        
        Args:
            inputs: Dictionary containing parsed inputs
            
        Returns:
            str: Formatted inputs for prompt
        """
        formatted_parts = []
        
        # Process text input
        if inputs.get('textInput'):
            formatted_parts.append("<text_input>")
            formatted_parts.append(str(inputs['textInput']))
            formatted_parts.append("</text_input>")
        
        # Process video input
        if inputs.get('videoInput'):
            formatted_parts.append("<video_input>")
            if isinstance(inputs['videoInput'], dict):
                formatted_parts.append(json.dumps(inputs['videoInput'], indent=2, ensure_ascii=False))
            elif isinstance(inputs['videoInput'], list):
                formatted_parts.append(json.dumps(inputs['videoInput'], indent=2, ensure_ascii=False))
            else:
                formatted_parts.append(str(inputs['videoInput']))
            formatted_parts.append("</video_input>")
        
        # Process audio input
        if inputs.get('audioInput'):
            formatted_parts.append("<audio_input>")
            if isinstance(inputs['audioInput'], dict):
                formatted_parts.append(json.dumps(inputs['audioInput'], indent=2, ensure_ascii=False))
            elif isinstance(inputs['audioInput'], list):
                formatted_parts.append(json.dumps(inputs['audioInput'], indent=2, ensure_ascii=False))
            else:
                formatted_parts.append(str(inputs['audioInput']))
            formatted_parts.append("</audio_input>")
        
        # Process image input
        if inputs.get('imageInput'):
            formatted_parts.append("<image_input>")
            if isinstance(inputs['imageInput'], dict):
                formatted_parts.append(json.dumps(inputs['imageInput'], indent=2, ensure_ascii=False))
            elif isinstance(inputs['imageInput'], list):
                formatted_parts.append(json.dumps(inputs['imageInput'], indent=2, ensure_ascii=False))
            else:
                formatted_parts.append(str(inputs['imageInput']))
            formatted_parts.append("</image_input>")
        
        return "\n".join(formatted_parts)
    
    def _create_prompt(self, inputs: Dict[str, Any], custom_prompt: Optional[str] = None) -> str:
        """
        Create prompt for LLM to generate video editing timeline.
        
        Args:
            inputs: Dictionary containing parsed inputs (text, video, audio, image)
            custom_prompt: Optional custom system prompt override
            
        Returns:
            str: Complete prompt for LLM
        """
        # Format inputs
        formatted_inputs = self._format_inputs_for_prompt(inputs)
        
        # Get example
        example_json = self._create_simplified_example()
        
        # Build prompt
        if custom_prompt:
            system_instruction = custom_prompt
        else:
            system_instruction = """你是一个专业的视频剪辑AI助手。你的任务是根据提供的多种输入（文案、视频、音频、图片）生成标准的视频编辑时间轴配置。

**核心要求**：
1. 仔细分析所有提供的输入数据
2. 理解用户的创作意图和内容需求
3. 生成合理的视频编辑时间轴配置
4. 确保各种素材协调配合，形成流畅的视频

**输入说明**：
- text_input: 文案内容，可能包含视频脚本、字幕文本或创作说明
- video_input: 视频素材信息，可能是URL、JSON对象或数组
- audio_input: 音频素材信息，可能是URL、JSON对象或数组  
- image_input: 图片素材信息，可能是URL、JSON对象或数组

**注意**：所有输入都是可选的，但至少会有一个输入。"""
        
        prompt = f"""{system_instruction}

以下是需要处理的输入数据：

{formatted_inputs}

请根据以上输入，生成一个视频编辑时间轴配置。

**输出JSON格式示例**：
{example_json}

**JSON字段说明**：

1. **total_duration**: 视频总时长（秒）

2. **video_segments**: 视频片段数组
   - material_id: 素材ID（使用输入中提供的ID或自定义）
   - start_time: 在时间轴上的开始时间（秒）
   - duration: 片段持续时间（秒）
   - clip_start: 从原素材的哪个时间点开始（秒）
   - clip_end: 到原素材的哪个时间点结束（秒）

3. **audio_segments**: 音频片段数组
   - material_id: 素材ID（使用输入中提供的ID或自定义）
   - start_time: 在时间轴上的开始时间（秒）
   - duration: 片段持续时间（秒）
   - track: 音轨ID（如"audio-track-1"）
   - volume: 音量（100-300，200为正常音量）
   - clip_start: 从原素材的哪个时间点开始（秒）
   - clip_end: 到原素材的哪个时间点结束（秒）

4. **image_segments**: 图片片段数组
   - material_id: 素材ID（使用输入中提供的ID或自定义）
   - start_time: 在时间轴上的开始时间（秒）
   - duration: 图片显示持续时间（秒，建议3-8秒）

**重要提示**：
- 严格按照示例JSON的结构输出
- 确保所有时间值为浮点数
- material_id必须使用输入中提供的实际ID
- 如果没有某类型素材，对应数组可为空[]
- 不要添加示例中没有的额外字段

请直接输出JSON配置，不要包含任何解释文字："""

        return prompt
    
    async def generate_video_timeline(
        self, 
        inputs_raw: Dict[str, str],
        node_id: str,
        task_id: str,
        config: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Generate video editing timeline from multiple inputs.
        
        Args:
            inputs_raw: Raw input data with format specifications
            node_id: Workflow node identifier
            task_id: Task identifier
            config: Optional configuration (system_prompt, temperature, max_tokens)
            
        Returns:
            Dict[str, Any]: Generated full timeline JSON data
            
        Raises:
            Exception: If API call, parsing, or conversion fails
        """
        logger.info(f"AI video generate request - Node ID: {node_id}, Task ID: {task_id}")
        
        try:
            # Step 1: Parse inputs based on their formats
            logger.info(f"Step 1: Parsing inputs for node: {node_id}")
            parsed_inputs = {}
            
            if inputs_raw.get('textInput'):
                parsed_inputs['textInput'] = self._parse_input_data(
                    inputs_raw['textInput'],
                    inputs_raw.get('textInputFormat', 'text/plain')
                )
            
            if inputs_raw.get('videoInput'):
                parsed_inputs['videoInput'] = self._parse_input_data(
                    inputs_raw['videoInput'],
                    inputs_raw.get('videoInputFormat', 'text/plain')
                )
            
            if inputs_raw.get('audioInput'):
                parsed_inputs['audioInput'] = self._parse_input_data(
                    inputs_raw['audioInput'],
                    inputs_raw.get('audioInputFormat', 'text/plain')
                )
            
            if inputs_raw.get('imageInput'):
                parsed_inputs['imageInput'] = self._parse_input_data(
                    inputs_raw['imageInput'],
                    inputs_raw.get('imageInputFormat', 'text/plain')
                )
            
            logger.info(f"Parsed inputs: {list(parsed_inputs.keys())}")
            
            # Step 2: Generate simplified timeline using LLM
            logger.info(f"Step 2: Generating simplified timeline with LLM for node: {node_id}")
            simplified_timeline = await self._generate_simplified_timeline(
                parsed_inputs, 
                node_id, 
                task_id,
                config
            )
            
            # Step 3: Convert simplified timeline to full format
            logger.info(f"Step 3: Converting simplified timeline to full format for node: {node_id}")
            # For AI Video Generate, we don't have material objects, so we create placeholders
            timeline_data = self._convert_to_full_timeline(simplified_timeline, node_id, task_id)
            
            logger.info(f"AI video generate completed successfully for node: {node_id}")
            return timeline_data
            
        except Exception as e:
            error_msg = f"AI video generate service error: {str(e)}"
            logger.error(error_msg, extra={"node_id": node_id, "task_id": task_id}, exc_info=True)
            raise Exception(error_msg)
    
    async def _generate_simplified_timeline(
        self, 
        parsed_inputs: Dict[str, Any],
        node_id: str,
        task_id: str,
        config: Optional[Dict[str, Any]] = None
    ) -> SimplifiedTimelineModel:
        """
        Generate simplified timeline using LLM API.
        
        Args:
            parsed_inputs: Parsed input data
            node_id: Node identifier
            task_id: Task identifier
            config: Optional LLM configuration
            
        Returns:
            SimplifiedTimelineModel: Generated simplified timeline data
            
        Raises:
            Exception: If API call or JSON parsing fails
        """
        # Create prompt
        custom_prompt = config.get('systemPrompt') if config else None
        prompt = self._create_prompt(parsed_inputs, custom_prompt)
        
        # Get LLM parameters
        temperature = config.get('temperature', 0.7) if config else 0.7
        max_tokens = config.get('maxTokens', 2000) if config else 2000

        messages = [{"role": "user", "content": prompt}]

        logger.info(f"Calling Video Cut LLM API for node: {node_id} (api_type={self.api_type})")
        logger.debug(f"LLM Request: model={self.model}, temperature={temperature}, max_tokens={max_tokens}")

        try:
            content = await call_chat(
                messages,
                config=LLMCallConfig(
                    api_url=self.api_url,
                    api_key=self.api_key,
                    model=self.model,
                    api_type=self.api_type,
                ),
                temperature=temperature,
                max_tokens=max_tokens,
                timeout=60.0,
            )
        except Exception as e:
            error_msg = f"LLM API error for node {node_id}: {str(e)}"
            logger.error(error_msg)
            raise Exception(error_msg)

        logger.info(f"LLM API call successful for node: {node_id}")
        logger.debug(f"LLM raw response length: {len(content)} characters")
        
        # Parse JSON from response
        try:
            # Try to extract JSON from code blocks if present
            if "```json" in content:
                json_start = content.find("```json") + 7
                json_end = content.find("```", json_start)
                content = content[json_start:json_end].strip()
            elif "```" in content:
                json_start = content.find("```") + 3
                json_end = content.find("```", json_start)
                content = content[json_start:json_end].strip()
            
            # Parse the JSON
            timeline_json = json.loads(content)
            simplified_timeline = SimplifiedTimelineModel(**timeline_json)
            
            logger.info(f"Successfully parsed simplified timeline: {len(simplified_timeline.video_segments)} video segments, "
                       f"{len(simplified_timeline.audio_segments)} audio segments, "
                       f"{len(simplified_timeline.image_segments)} image segments")
            
            return simplified_timeline
            
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse JSON from LLM response: {str(e)}")
            logger.error(f"Raw content: {content}")
            raise Exception(f"Failed to parse LLM response as JSON: {str(e)}")
        except Exception as e:
            logger.error(f"Failed to create SimplifiedTimelineModel: {str(e)}")
            raise Exception(f"Failed to validate timeline data: {str(e)}")
    
    def _convert_to_full_timeline(
        self, 
        simplified_timeline: SimplifiedTimelineModel,
        node_id: str,
        task_id: str
    ) -> Dict[str, Any]:
        """
        Convert simplified timeline to full timeline format.
        Uses TimelineParserService similar to AI mixed editing.
        
        Args:
            simplified_timeline: Simplified timeline model
            node_id: Node identifier
            task_id: Task identifier
            
        Returns:
            Dict[str, Any]: Full timeline JSON data
        """
        try:
            # Convert using timeline parser service
            # We pass empty materials list since AI Video Generate doesn't have material objects
            timeline_data = self.timeline_parser.parse_simplified_timeline(
                simplified_timeline=simplified_timeline,
                materials=[],  # Empty materials - IDs are placeholders from LLM
                task_id=task_id
            )
            
            logger.info(f"Successfully converted simplified timeline to full format for node: {node_id}")
            logger.debug(f"Timeline data: {len(timeline_data.get('tracks', []))} tracks, "
                        f"{len(timeline_data.get('materials', []))} materials")
            
            return timeline_data
            
        except Exception as e:
            error_msg = f"Failed to convert timeline: {str(e)}"
            logger.error(error_msg, extra={"node_id": node_id, "task_id": task_id})
            raise Exception(error_msg)


# Create singleton instance
ai_video_generate_service = AIVideoGenerateService()

