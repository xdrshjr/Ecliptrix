"""
AI Mixed Editing service for automatic video editing.
Handles Video Cut LLM API calls with structured prompts and JSON parsing.
"""

import json
import logging
from typing import Any, Dict, List, Optional, Tuple

from app.config import settings
from app.logger import get_logger
from app.models.ai_mixed_editing_models import (
    MaterialItemModel,
    SimplifiedTimelineModel,
    VideoAnalysisMetadata,
)
from app.models.model_settings_models import ModelFunctionType
from app.services.llm_client import LLMCallConfig, call_chat, normalize_api_type
from app.services.llm_json import extract_json_object
from app.services.model_settings_service import model_settings_service
from app.services.timeline_parser_service import (
    SanitizeReport,
    TimelineParserService,
)
from app.services.video_analysis_storage_service import video_analysis_storage

logger = get_logger(__name__)

# One normal attempt plus one repair round (AM-05).
PLAN_ATTEMPTS = 2
ERROR_DETAIL_MAX_CHARS = 300
# Replayed in the repair round instead of an empty assistant reply.
EMPTY_REPLY_PLACEHOLDER = "(empty response)"
REPAIR_PROMPT = (
    "上一次输出无法解析为有效 JSON（错误：{error}）。"
    "请只输出一个符合示例结构的 JSON 对象，不要任何解释或代码块标记。"
)


class AIMixError(Exception):
    """AI mix failure; the router maps it onto an ErrorResponse."""

    error_code = "AI_MIX_INTERNAL"
    status_code = 500


class AIMixModelNotConfiguredError(AIMixError):
    """No URL, key or model is resolved for the VIDEO_CUT function."""

    error_code = "AI_MIX_MODEL_NOT_CONFIGURED"
    status_code = 503


class AIMixUpstreamError(AIMixError):
    """The request to the video editing model failed."""

    error_code = "AI_MIX_LLM_UPSTREAM_FAILED"
    status_code = 502


class AIMixPlanUnparseableError(AIMixError):
    """Every attempt returned an unusable editing plan."""

    error_code = "AI_MIX_PLAN_UNPARSEABLE"
    status_code = 422


class AIMixedEditingService:
    """Service for handling AI mixed editing with Video Cut LLM."""

    def __init__(self, llm_config: Optional[LLMCallConfig] = None) -> None:
        """
        Initialize the AI mixed editing service.

        Args:
            llm_config: Resolved model config. ``None`` keeps the legacy
                behaviour of reading ``VIDEO_CUT_LLM_*`` settings; request
                handlers use :meth:`create`, which honours 模型设置.

        Raises:
            ValueError: ``llm_config`` is None and VIDEO_CUT_LLM_* is unset
        """
        self.timeline_parser = TimelineParserService()
        if llm_config is None:
            llm_config = self._config_from_settings()
        self.llm_config: LLMCallConfig = llm_config

    @classmethod
    async def create(cls) -> "AIMixedEditingService":
        """
        Build the service from the effective VIDEO_CUT model config
        (模型设置 assignment first, env fallback second).

        Raises:
            AIMixModelNotConfiguredError: URL, key or model is missing
        """
        resolved = await model_settings_service.get_effective_config(
            ModelFunctionType.VIDEO_CUT
        )
        config = LLMCallConfig(
            api_url=resolved.api_url or "",
            api_key=resolved.api_key or "",
            model=resolved.model_name or "",
            api_type=normalize_api_type(resolved.api_type),
        )
        if not (config.api_url and config.api_key and config.model):
            raise AIMixModelNotConfiguredError(
                "No model is assigned to video editing"
            )
        logger.info(
            f"AI mix model resolved from {resolved.source}: "
            f"api_type={config.api_type} model={config.model}"
        )
        return cls(config)

    @staticmethod
    def _config_from_settings() -> LLMCallConfig:
        """Legacy VIDEO_CUT_LLM_* config; raises ValueError when unset."""
        api_key = settings.video_cut_llm_api_key
        api_url = settings.video_cut_llm_api_url
        if not api_key or not api_url:
            raise ValueError("Video Cut LLM API key and URL must be configured")
        return LLMCallConfig(
            api_url=api_url,
            api_key=api_key,
            model=settings.video_cut_llm_model,
            api_type=normalize_api_type(settings.video_cut_llm_api_type),
        )

    def _create_simplified_example(self) -> str:
        """
        Create simplified JSON example for LLM prompt.

        Models copy the example's shape, so it must obey the prompt's own
        rules (AM2-06): every lane starts at 0 and is contiguous, narration
        and music sit on separate audio tracks, and the video lane is the
        longest.

        Returns:
            str: Simplified JSON example as string
        """
        example = {
            "total_duration": 61.0,
            "video_segments": [
                {
                    "material_id": "video_001",
                    "start_time": 0,
                    "duration": 30.5,
                    "clip_start": 0.0,
                    "clip_end": 30.5,
                },
                {
                    "material_id": "video_002",
                    "start_time": 30.5,
                    "duration": 30.5,
                    "clip_start": 5.0,
                    "clip_end": 35.5,
                },
            ],
            "audio_segments": [
                {
                    "material_id": "audio_001",
                    "start_time": 0,
                    "duration": 55.5,
                    "track": "audio-track-1",
                    "volume": 100,
                    "clip_start": 0.0,
                    "clip_end": 55.5,
                },
                {
                    "material_id": "audio_002",
                    "start_time": 0,
                    "duration": 60.0,
                    "track": "audio-track-2",
                    "volume": 30,
                    "clip_start": 0.0,
                    "clip_end": 60.0,
                },
            ],
            "image_segments": [
                {"material_id": "image_001", "start_time": 0, "duration": 5.0}
            ],
        }
        return json.dumps(example, indent=2, ensure_ascii=False)

    def _truncate_frame_analysis(self, analysis: str, max_length: int = 200) -> str:
        """
        Truncate frame analysis description to specified maximum length.

        Args:
            analysis: Original frame analysis text
            max_length: Maximum allowed length (default 200 characters)

        Returns:
            str: Truncated analysis text
        """
        if len(analysis) <= max_length:
            return analysis

        # Truncate and add ellipsis
        return analysis[: max_length - 3] + "..."

    def _extract_video_analysis_data(
        self, material: MaterialItemModel
    ) -> VideoAnalysisMetadata:
        """
        Extract video analysis data from material metadata or storage service.

        This method first checks if video analysis data is provided in the material metadata.
        If not found, it checks the video analysis storage service for previously analyzed data.

        Args:
            material: Material item that may contain video analysis data

        Returns:
            VideoAnalysisMetadata: Video analysis data if available, None otherwise
        """
        # First, try to get analysis data from material metadata (highest priority)
        if material.metadata and "video_analysis" in material.metadata:
            try:
                analysis_data = material.metadata["video_analysis"]
                logger.info(
                    f"Found video analysis data in material metadata for {material.id}"
                )

                # Log the structure of the analysis data for debugging
                if isinstance(analysis_data, dict):
                    frame_count = len(analysis_data.get("frame_analyses", []))
                    logger.info(
                        f"Material {material.id} contains {frame_count} frame analyses"
                    )

                    # Log sample frame data for debugging
                    if frame_count > 0:
                        sample_frame = analysis_data["frame_analyses"][0]
                        logger.debug(
                            f"Sample frame data for {material.id}: frame_number={sample_frame.get('frame_number')}, timestamp={sample_frame.get('timestamp')}, analysis_length={len(sample_frame.get('analysis', ''))}"
                        )

                # Parse the analysis data
                video_analysis = VideoAnalysisMetadata(**analysis_data)
                logger.info(
                    f"Successfully parsed video analysis data for material {material.id}: {len(video_analysis.frame_analyses)} frames"
                )
                return video_analysis

            except (ValueError, TypeError) as e:
                logger.error(
                    f"Failed to parse video analysis data from metadata for material {material.id}: {str(e)}"
                )
                logger.error(f"Analysis data structure: {analysis_data}")

        # If not in metadata, try to retrieve from storage service using video URL
        if material.type == "video" and material.url:
            try:
                stored_analysis = video_analysis_storage.get_analysis_result(
                    material.url
                )
                if stored_analysis:
                    logger.info(
                        f"Retrieved stored video analysis data for material {material.id} from storage service: {len(stored_analysis.frame_analyses)} frames"
                    )
                    return stored_analysis
                else:
                    logger.debug(
                        f"No stored video analysis data found for material {material.id} with URL: {material.url}"
                    )
            except Exception as e:
                logger.error(
                    f"Error retrieving stored video analysis for material {material.id}: {str(e)}"
                )

        logger.debug(f"No video analysis data found for material {material.id}")
        return None

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
        videos = [m for m in materials if m.type == "video"]
        audios = [m for m in materials if m.type == "audio"]
        images = [m for m in materials if m.type == "image"]

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

                # Include video analysis data if available
                video_analysis = self._extract_video_analysis_data(video)
                if video_analysis:
                    materials_info.append(f"  视频解析数据:")
                    materials_info.append(
                        f"    - 总帧数: {video_analysis.total_frames_extracted}"
                    )
                    materials_info.append(
                        f"    - 视频时长: {video_analysis.video_duration:.2f}秒"
                    )
                    materials_info.append(f"    - 帧解析内容:")

                    for frame_analysis in video_analysis.frame_analyses:
                        # Truncate analysis to 200 characters as required
                        truncated_analysis = self._truncate_frame_analysis(
                            frame_analysis.analysis
                        )
                        materials_info.append(
                            f"      * 帧{frame_analysis.frame_number} ({frame_analysis.timestamp:.2f}s): {truncated_analysis}"
                        )

                    logger.info(
                        f"Included video analysis data for material {video.id}: {len(video_analysis.frame_analyses)} frames"
                    )
                else:
                    logger.debug(
                        f"No video analysis data found for material {video.id}"
                    )

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
                if audio.metadata and "segment_id" in audio.metadata:
                    materials_info.append(f"  片段ID: {audio.metadata['segment_id']}")
                    materials_info.append(
                        f"  片段序号: {audio.metadata.get('segment_number', 'N/A')}"
                    )
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
   - total_duration 等于最后一段视频的结束时间
   - 确保所有片段都在总时长范围内

2. **视频片段安排** (video_segments)：
   - 使用提供的视频素材ID作为material_id
   - 设定合理的duration（持续时间）
   - 可以设置clip_start和clip_end来截取视频的特定片段
   - 从 0 秒开始按顺序首尾相接、不留空隙、不重叠：下一段的 start_time = 上一段的 start_time + duration

3. **音频片段安排** (audio_segments)：
   - 使用提供的音频素材ID作为material_id
   - 设定合理的duration
   - 旁白/配音放在 audio-track-1，背景音乐放在 audio-track-2；track 只能是 audio-track-1 至 audio-track-4
   - 同一音频轨上的片段从 0 秒开始首尾相接、不留空隙
   - volume 为百分比（0-200），100 表示原音量；旁白/配音用 100，背景音乐建议 20-40
   - 可以设置clip_start和clip_end来截取音频的特定片段

4. **图片片段安排** (image_segments)：
   - 使用提供的图片素材ID作为material_id
   - 每个图片建议显示3-8秒（duration）
   - 图片轨上的片段同样从 0 秒开始首尾相接、不留空隙

5. **输出要求**：
   - 严格按照示例JSON的结构和字段名
   - 确保所有数值类型正确（时间为浮点数）
   - 不要添加示例中没有的额外字段
   - material_id必须使用提供素材的实际ID

6. **⚠️ 强制约束：视频轨道时长必须是最长的**：
   - 视频片段的总时长（最后一段视频的end_time）必须 >= 所有音频片段和图片片段的总时长
   - 任何音频轨道的长度都不能超过视频轨道的长度
   - 如果音频比视频长，必须缩短音频的duration或clip_end，使其不超过视频总时长
   - 视频轨道应比音频轨道略长 1-2 秒

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
                "model": self.llm_config.model,
                "materials_count": materials_count,
            },
        )

    def _log_llm_response(
        self,
        success: bool,
        task_id: str,
        error: str = None,
        simplified_data: SimplifiedTimelineModel = None,
    ) -> None:
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
                extra_info.update(
                    {
                        "total_duration": simplified_data.total_duration,
                        "video_segments": len(simplified_data.video_segments),
                        "audio_segments": len(simplified_data.audio_segments),
                        "image_segments": len(simplified_data.image_segments),
                    }
                )
            logger.info(
                f"LLM simplified timeline generation completed successfully - Task ID: {task_id}",
                extra=extra_info,
            )
        else:
            logger.error(
                f"LLM simplified timeline generation failed - Task ID: {task_id}",
                extra={"task_id": task_id, "stage": "llm_generation", "error": error},
            )

    def _log_parsing_response(
        self,
        success: bool,
        task_id: str,
        error: str = None,
        timeline_data: Dict[str, Any] = None,
    ) -> None:
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
                extra_info.update(
                    {
                        "tracks_count": len(timeline_data.get("tracks", [])),
                        "materials_count": len(timeline_data.get("materials", [])),
                        "total_duration": timeline_data.get("metadata", {}).get(
                            "total_duration", 0
                        ),
                    }
                )
            logger.info(
                f"Timeline parsing completed successfully - Task ID: {task_id}",
                extra=extra_info,
            )
        else:
            logger.error(
                f"Timeline parsing failed - Task ID: {task_id}",
                extra={"task_id": task_id, "stage": "timeline_parsing", "error": error},
            )

    async def generate_mixed_editing(
        self, materials: List[MaterialItemModel], task_id: str
    ) -> Dict[str, Any]:
        """
        Generate mixed editing timeline using simplified LLM API approach.

        This method:
        1. Calls LLM to generate simplified timeline JSON (one repair retry)
        2. Sanitises it against the supplied materials
        3. Converts it to full timeline format, carrying sanitise warnings

        Args:
            materials: List of material items
            task_id: Task identifier

        Returns:
            Dict[str, Any]: Generated full timeline JSON data

        Raises:
            AIMixError: any failure; the subclass identifies the stage
        """
        self._log_request(len(materials), task_id)

        try:
            logger.info(
                f"Step 1: Generating simplified timeline with LLM for task: {task_id}"
            )
            simplified_timeline, report = (
                await self._generate_simplified_timeline(materials, task_id)
            )

            logger.info(
                f"Step 2: Converting simplified timeline to full format for task: {task_id}"
            )
            timeline_data = self._convert_to_full_timeline(
                simplified_timeline,
                materials,
                task_id,
                warnings=report.warnings(),
            )

            logger.info(f"AI mixed editing completed successfully for task: {task_id}")
            return timeline_data

        except AIMixError:
            raise
        except Exception as e:
            error_msg = f"AI mixed editing service error: {str(e)}"
            logger.error(error_msg, extra={"task_id": task_id}, exc_info=True)
            raise AIMixError(error_msg[:ERROR_DETAIL_MAX_CHARS]) from e

    async def _generate_simplified_timeline(
        self, materials: List[MaterialItemModel], task_id: str
    ) -> Tuple[SimplifiedTimelineModel, SanitizeReport]:
        """
        Generate and sanitise a simplified timeline, retrying once.

        Output that is not JSON, fails the schema, has a non-positive
        total_duration or keeps no usable segment after sanitising triggers a
        repair round that shows the model its reply and the error.

        Returns:
            Tuple of the sanitised timeline and what sanitising changed

        Raises:
            AIMixUpstreamError: the LLM request failed
            AIMixPlanUnparseableError: no attempt produced a usable plan
        """
        prompt = self._create_prompt(materials)
        self._log_prompt_summary(materials, prompt, task_id)
        messages: List[Dict[str, Any]] = [{"role": "user", "content": prompt}]
        last_error: Optional[Exception] = None

        for attempt in range(1, PLAN_ATTEMPTS + 1):
            content = await self._call_llm(messages, task_id)
            try:
                simplified_timeline = SimplifiedTimelineModel(
                    **extract_json_object(content)
                )
                if simplified_timeline.total_duration <= 0:
                    raise ValueError("total_duration must be positive")
                report = self.timeline_parser.sanitize_simplified_timeline(
                    simplified_timeline, materials
                )
                self._log_llm_response(
                    True, task_id, simplified_data=simplified_timeline
                )
                return simplified_timeline, report
            # json.JSONDecodeError and pydantic's ValidationError are both
            # ValueErrors.
            except ValueError as e:
                last_error = e
                logger.warning(
                    f"AI mix plan unparseable for task {task_id} "
                    f"(attempt {attempt}/{PLAN_ATTEMPTS}): "
                    f"{str(e)[:ERROR_DETAIL_MAX_CHARS]}",
                    extra={
                        "task_id": task_id,
                        "llm_content_head": content[:500],
                    },
                )
                messages = [
                    *messages,
                    {
                        "role": "assistant",
                        # Anthropic rejects an empty non-final assistant
                        # turn; a reasoning model can spend max_tokens
                        # before writing any text.
                        "content": content if content.strip()
                        else EMPTY_REPLY_PLACEHOLDER,
                    },
                    {
                        "role": "user",
                        "content": REPAIR_PROMPT.format(error=str(e)[:200]),
                    },
                ]

        error_msg = str(last_error)[:ERROR_DETAIL_MAX_CHARS]
        self._log_llm_response(False, task_id, error_msg)
        raise AIMixPlanUnparseableError(error_msg)

    async def _call_llm(
        self, messages: List[Dict[str, Any]], task_id: str
    ) -> str:
        """Call the video-cut model; any failure becomes AIMixUpstreamError."""
        logger.info(
            f"Calling Video Cut LLM API for simplified timeline "
            f"(api_type={self.llm_config.api_type}, "
            f"model={self.llm_config.model}) "
            f"base={self.llm_config.api_url} for task: {task_id}"
        )
        try:
            content = await call_chat(
                messages,
                config=self.llm_config,
                temperature=0.2,
                max_tokens=8000,
                timeout=120.0,
            )
        except Exception as e:
            # Timeouts often stringify to "", so fall back to the type name.
            error_msg = (str(e) or type(e).__name__)[:ERROR_DETAIL_MAX_CHARS]
            logger.error(
                f"Video Cut LLM API call failed for task {task_id}: "
                f"{error_msg}",
                extra={"task_id": task_id},
                exc_info=True,
            )
            self._log_llm_response(False, task_id, error_msg)
            raise AIMixUpstreamError(error_msg) from e

        logger.debug(
            f"Video Cut LLM response for task {task_id} "
            f"({len(content)} chars): {content[:500]}"
        )
        return content

    def _log_prompt_summary(
        self, materials: List[MaterialItemModel], prompt: str, task_id: str
    ) -> None:
        """Debug-log the prompt size and the videos with frame analysis."""
        if not logger.isEnabledFor(logging.DEBUG):
            return
        analysed_videos = sum(
            1
            for material in materials
            if material.type == "video"
            and self._extract_video_analysis_data(material) is not None
        )
        logger.debug(
            f"AI mix prompt for task {task_id}: {len(materials)} materials, "
            f"{analysed_videos} videos with frame analysis, {len(prompt)} chars"
        )

    def _convert_to_full_timeline(
        self,
        simplified_timeline: SimplifiedTimelineModel,
        materials: List[MaterialItemModel],
        task_id: str,
        *,
        warnings: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Convert simplified timeline to full timeline format.

        Args:
            simplified_timeline: Simplified timeline data
            materials: List of material items
            task_id: Task identifier
            warnings: Sanitise warnings written to ``metadata.warnings``

        Returns:
            Dict[str, Any]: Full timeline JSON data

        Raises:
            Exception: If conversion fails
        """
        try:
            timeline_data = self.timeline_parser.parse_simplified_timeline(
                simplified_timeline=simplified_timeline,
                materials=materials,
                task_id=task_id,
                warnings=warnings,
            )
            self._log_parsing_response(True, task_id, timeline_data=timeline_data)
            return timeline_data

        except Exception as e:
            error_msg = f"Timeline conversion failed: {str(e)}"
            logger.error(error_msg, extra={"task_id": task_id}, exc_info=True)
            self._log_parsing_response(False, task_id, error_msg)
            raise Exception(error_msg) from e
