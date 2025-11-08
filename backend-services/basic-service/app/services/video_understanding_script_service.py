"""
Video Understanding Script service for generating scripts from video analysis.
Handles LLM API calls with video understanding prompts and structured responses.
"""

import json
import httpx
import uuid
from typing import Dict, Any, List, Optional
from datetime import datetime
from app.config import settings
from app.logger import get_logger
from app.models.video_understanding_script_models import (
    VideoUnderstandingScriptRequest,
    VideoAnalysisResult,
    ScriptSegment,
    ScriptSentence,
    VideoItem,
    LLMScriptGenerationRequest
)
from app.services.video_analysis_storage_service import video_analysis_storage

logger = get_logger(__name__)


class VideoUnderstandingScriptService:
    """Service for handling video understanding script generation with LLM."""
    
    def __init__(self):
        """Initialize the video understanding script service."""
        self.api_key = ***REMOVED***
        self.api_url = settings.video_cut_llm_api_url
        self.model = settings.video_cut_llm_model
        
        if not self.api_key or not self.api_url:
            raise ValueError("Video Cut LLM API key and URL must be configured")
    
    async def generate_script(
        self,
        request: VideoUnderstandingScriptRequest,
        retry_count: int = 0
    ) -> Dict[str, Any]:
        """
        Generate script based on video understanding analysis with retry mechanism.
        
        Args:
            request: Script generation request with videos and parameters
            retry_count: Current retry attempt number (for internal use)
            
        Returns:
            Dict[str, Any]: Generated script segments and metadata
            
        Raises:
            Exception: If video analysis or script generation fails after retries
        """
        max_retries = 1  # Retry once on failure
        
        try:
            logger.info(f"Starting video understanding script generation for task: {request.taskId} (attempt {retry_count + 1}/{max_retries + 1})")
            logger.info(f"Processing {len(request.selectedVideos)} videos with {request.parameters.analysisDepth} analysis depth")
            logger.info(f"Analysis mode: {request.analysisMode} ({'thumbnail only' if request.analysisMode == 'quick' else 'frame extraction'})")
            if request.referenceText:
                logger.info(f"User requirements (chatContent) provided as foundation: length={len(request.referenceText)}, preview='{request.referenceText[:100]}...'")
                logger.info("Script will be generated based on user requirements combined with video analysis")
            else:
                logger.warning("No user requirements (chatContent) provided - script will be generated solely from video analysis")
            
            # Step 1: Analyze videos to get understanding results
            video_analysis_results = await self._analyze_videos(
                request.selectedVideos, 
                request.parameters,
                request.taskId,
                request.analysisMode
            )
            
            logger.info(f"Video analysis completed for task: {request.taskId}, analyzed {len(video_analysis_results)} videos")
            
            # Validate analysis results
            for i, result in enumerate(video_analysis_results):
                logger.debug(f"Analysis result {i + 1}: videoId={result.videoId}, frames={'None' if result.frames is None else len(result.frames)}")
            
            # Step 2: Generate script using LLM based on analysis results
            script_segments = await self._generate_script_with_llm(
                video_analysis_results,
                request.referenceText,
                request.parameters,
                request.taskId,
                request.selectedVideos
            )
            
            # Step 3: Prepare metadata
            metadata = self._create_metadata(
                request, 
                video_analysis_results, 
                script_segments
            )
            
            logger.info(f"Video understanding script generation completed for task: {request.taskId}, generated {len(script_segments)} segments in {request.analysisMode} mode")
            
            return {
                "segments": [segment.model_dump() for segment in script_segments],
                "metadata": metadata
            }
            
        except Exception as e:
            error_msg = f"Video understanding script generation error: {str(e)}"
            logger.error(error_msg, extra={"task_id": request.taskId, "retry_count": retry_count}, exc_info=True)
            
            # Retry logic
            if retry_count < max_retries:
                logger.warning(f"Retrying video understanding script generation for task: {request.taskId} (retry {retry_count + 1}/{max_retries})")
                return await self.generate_script(request, retry_count + 1)
            else:
                logger.error(f"Video understanding script generation failed after {max_retries + 1} attempts for task: {request.taskId}")
                raise Exception(error_msg)
    
    async def _analyze_videos(
        self,
        videos: List[VideoItem],
        parameters,
        task_id: str,
        analysis_mode: str = 'quick'
    ) -> List[VideoAnalysisResult]:
        """
        Analyze videos to extract understanding information.
        
        Args:
            videos: List of selected videos
            parameters: Analysis parameters
            task_id: Task identifier
            analysis_mode: Analysis mode ('quick' or 'professional')
            
        Returns:
            List[VideoAnalysisResult]: Video analysis results
        """
        analysis_results = []
        
        logger.info(f"Starting video analysis for task {task_id} in {analysis_mode} mode")
        logger.info(f"Total videos to analyze: {len(videos)}")
        
        for idx, video in enumerate(videos, 1):
            try:
                logger.info(f"Analyzing video {idx}/{len(videos)}: {video.id} ({video.name}) for task: {task_id} in {analysis_mode} mode")
                
                # First, try to use analysis data from frontend (in metadata.video_analysis)
                if (hasattr(video, 'metadata') and video.metadata and 
                    'video_analysis' in video.metadata and video.metadata['video_analysis']):
                    logger.info(f"Using video analysis data from frontend metadata for video {video.id} in {analysis_mode} mode")
                    try:
                        analysis_result = self._convert_frontend_analysis_to_result(
                            video, video.metadata['video_analysis'], parameters, analysis_mode
                        )
                        analysis_results.append(analysis_result)
                        logger.info(f"Successfully analyzed video {idx}/{len(videos)} from frontend metadata")
                        continue
                    except Exception as convert_error:
                        logger.error(f"Error converting frontend metadata analysis for video {video.id}: {str(convert_error)}", exc_info=True)
                        raise  # Re-raise to trigger fallback
                
                # Fallback: try to use analysis data from frontend (legacy analysisData field)
                if hasattr(video, 'analysisData') and video.analysisData:
                    logger.info(f"Using legacy analysis data from frontend for video {video.id} in {analysis_mode} mode")
                    try:
                        analysis_result = self._convert_frontend_analysis_to_result(
                            video, video.analysisData, parameters, analysis_mode
                        )
                        analysis_results.append(analysis_result)
                        logger.info(f"Successfully analyzed video {idx}/{len(videos)} from legacy analysisData")
                        continue
                    except Exception as convert_error:
                        logger.error(f"Error converting legacy analysis data for video {video.id}: {str(convert_error)}", exc_info=True)
                        raise  # Re-raise to trigger fallback
                
                # Try to get existing video analysis data from storage
                existing_analysis = video_analysis_storage.get_video_analysis(video.id)
                
                if existing_analysis:
                    logger.info(f"Using existing analysis data from storage for video {video.id}")
                    analysis_result = self._convert_existing_analysis_to_result(
                        video, existing_analysis, parameters
                    )
                else:
                    logger.info(f"No existing analysis found for video {video.id}, performing basic analysis")
                    analysis_result = self._perform_basic_video_analysis(video, parameters)
                
                analysis_results.append(analysis_result)
                logger.info(f"Successfully analyzed video {idx}/{len(videos)}")
                
            except Exception as e:
                logger.error(f"Failed to analyze video {video.id} (video {idx}/{len(videos)}): {str(e)}", exc_info=True)
                # Create fallback analysis result
                logger.warning(f"Creating fallback analysis result for video {video.id}")
                fallback_result = self._create_fallback_analysis_result(video, parameters)
                analysis_results.append(fallback_result)
        
        logger.info(f"Completed video analysis for task {task_id}: {len(analysis_results)} videos analyzed")
        return analysis_results
    
    def _convert_frontend_analysis_to_result(
        self,
        video: VideoItem,
        frontend_analysis_data: Dict[str, Any],
        parameters,
        analysis_mode: str = 'professional'
    ) -> VideoAnalysisResult:
        """
        Convert frontend analysis data to VideoAnalysisResult.
        
        Args:
            video: Video item
            frontend_analysis_data: Analysis data from frontend
            parameters: Analysis parameters
            analysis_mode: Analysis mode ('quick' or 'professional')
            
        Returns:
            VideoAnalysisResult: Converted analysis result
        """
        logger.info(f"Converting frontend analysis to result for video {video.id} ({video.name}) in {analysis_mode} mode")
        
        # Extract frame descriptions for content understanding
        frame_descriptions = []
        frame_analyses = frontend_analysis_data.get('frame_analyses', [])
        
        logger.info(f"Processing frontend analysis data for video {video.id} in {analysis_mode} mode: found {len(frame_analyses)} frame analyses")
        
        # Validate frame_analyses data
        if not isinstance(frame_analyses, list):
            logger.error(f"Invalid frame_analyses data type for video {video.id}: expected list, got {type(frame_analyses)}")
            frame_analyses = []
        
        # For quick mode, only use first frame (thumbnail)
        # For professional mode, use up to 10 frames
        max_frames = 1 if analysis_mode == 'quick' else 10
        
        for i, frame in enumerate(frame_analyses[:max_frames]):
            if not isinstance(frame, dict):
                logger.warning(f"Invalid frame data at index {i} for video {video.id}: expected dict, got {type(frame)}")
                continue
                
            analysis_text = frame.get('analysis', '')
            if analysis_text:
                # Truncate frame analysis to 200 characters as mentioned in requirements
                truncated_analysis = analysis_text[:200] + "..." if len(analysis_text) > 200 else analysis_text
                frame_descriptions.append(truncated_analysis)
                logger.debug(f"Frame {frame.get('frame_number', 'unknown')}: {truncated_analysis[:50]}...")
            else:
                logger.warning(f"Frame {i} for video {video.id} has no analysis text")
        
        logger.info(f"Extracted {len(frame_descriptions)} frame descriptions for video {video.id} (max_frames={max_frames} for {analysis_mode} mode)")
        
        # Generate content description from frame analyses
        content_description = self._generate_content_description_from_frames(frame_descriptions)
        
        # Extract visual and audio elements based on parameters
        visual_elements = []
        audio_elements = []
        key_topics = []
        
        if parameters.includeVisualElements:
            visual_elements = self._extract_visual_elements_from_analysis(frame_descriptions)
            logger.debug(f"Extracted {len(visual_elements)} visual elements for video {video.id}")
        
        if parameters.includeAudioAnalysis:
            audio_elements = self._extract_audio_elements_from_frontend_analysis(frontend_analysis_data)
            logger.debug(f"Extracted {len(audio_elements)} audio elements for video {video.id}")
        
        key_topics = self._extract_key_topics_from_analysis(frame_descriptions, content_description)
        logger.debug(f"Extracted {len(key_topics)} key topics for video {video.id}")
        
        # Get video duration from analysis data or video item
        video_duration = frontend_analysis_data.get('video_duration', video.duration or 0.0)
        logger.info(f"Video {video.id} duration: {video_duration}s")
        
        # Prepare frames data for result - ensure it's not None
        frames_for_result = []
        if frame_analyses and len(frame_analyses) > 0:
            for i, frame in enumerate(frame_analyses[:5]):  # Show first 5 frames
                if isinstance(frame, dict):
                    frames_for_result.append({
                        "frame_number": frame.get('frame_number', i),
                        "timestamp": frame.get('timestamp', i * 2.0),
                        "analysis": frame.get('analysis', '')[:200]
                    })
        
        logger.info(f"Prepared {len(frames_for_result)} frames for result for video {video.id}")
        
        analysis_result = VideoAnalysisResult(
            videoId=video.id,
            videoName=video.name,
            visualElements=visual_elements,
            audioElements=audio_elements,
            keyTopics=key_topics,
            contentDescription=content_description,
            estimatedDuration=video_duration,
            frames=frames_for_result if frames_for_result else None  # Set to None if empty to match model default
        )
        
        logger.info(f"Successfully converted frontend analysis to result for video {video.id}")
        return analysis_result
    
    def _convert_existing_analysis_to_result(
        self,
        video: VideoItem,
        existing_analysis,
        parameters
    ) -> VideoAnalysisResult:
        """
        Convert existing video analysis data to VideoAnalysisResult.
        
        Args:
            video: Video item
            existing_analysis: Existing analysis data
            parameters: Analysis parameters
            
        Returns:
            VideoAnalysisResult: Converted analysis result
        """
        # Extract frame descriptions for content understanding
        frame_descriptions = []
        if hasattr(existing_analysis, 'frame_analyses') and existing_analysis.frame_analyses:
            for frame in existing_analysis.frame_analyses[:10]:  # Limit to first 10 frames
                if hasattr(frame, 'analysis'):
                    # Truncate frame analysis to 200 characters as mentioned in requirements
                    truncated_analysis = frame.analysis[:200] + "..." if len(frame.analysis) > 200 else frame.analysis
                    frame_descriptions.append(truncated_analysis)
        
        # Generate content description from frame analyses
        content_description = self._generate_content_description_from_frames(frame_descriptions)
        
        # Extract visual and audio elements based on parameters
        visual_elements = []
        audio_elements = []
        key_topics = []
        
        if parameters.includeVisualElements:
            visual_elements = self._extract_visual_elements_from_analysis(frame_descriptions)
        
        if parameters.includeAudioAnalysis:
            audio_elements = self._extract_audio_elements_from_analysis(existing_analysis)
        
        key_topics = self._extract_key_topics_from_analysis(frame_descriptions, content_description)
        
        return VideoAnalysisResult(
            videoId=video.id,
            videoName=video.name,
            visualElements=visual_elements,
            audioElements=audio_elements,
            keyTopics=key_topics,
            contentDescription=content_description,
            estimatedDuration=video.duration or 0.0,
            frames=[{
                "frame_number": getattr(frame, 'frame_number', i),
                "timestamp": getattr(frame, 'timestamp', i * 2.0),
                "analysis": getattr(frame, 'analysis', '')[:200]
            } for i, frame in enumerate(existing_analysis.frame_analyses[:5])] if hasattr(existing_analysis, 'frame_analyses') else []
        )
    
    def _perform_basic_video_analysis(
        self,
        video: VideoItem,
        parameters
    ) -> VideoAnalysisResult:
        """
        Perform basic video analysis when no existing data is available.
        
        Args:
            video: Video item
            parameters: Analysis parameters
            
        Returns:
            VideoAnalysisResult: Basic analysis result
        """
        # Generate basic analysis based on video metadata
        visual_elements = []
        audio_elements = []
        key_topics = ["视频内容", "创意表达"]
        
        if parameters.includeVisualElements:
            visual_elements = [
                "画面构图",
                "色彩搭配", 
                "视觉效果",
                "场景设置"
            ]
        
        if parameters.includeAudioAnalysis:
            audio_elements = [
                "音频质量",
                "声音设计",
                "背景音乐",
                "音效处理"
            ]
        
        content_description = f"这是一个名为'{video.name}'的视频，包含丰富的视觉和听觉元素。"
        
        return VideoAnalysisResult(
            videoId=video.id,
            videoName=video.name,
            visualElements=visual_elements,
            audioElements=audio_elements,
            keyTopics=key_topics,
            contentDescription=content_description,
            estimatedDuration=video.duration or 15.0
        )
    
    def _create_fallback_analysis_result(
        self,
        video: VideoItem,
        parameters
    ) -> VideoAnalysisResult:
        """
        Create fallback analysis result when analysis fails.
        
        Args:
            video: Video item
            parameters: Analysis parameters
            
        Returns:
            VideoAnalysisResult: Fallback analysis result
        """
        return VideoAnalysisResult(
            videoId=video.id,
            videoName=video.name,
            visualElements=["基础视觉元素"] if parameters.includeVisualElements else [],
            audioElements=["基础音频元素"] if parameters.includeAudioAnalysis else [],
            keyTopics=["视频内容"],
            contentDescription=f"视频: {video.name}",
            estimatedDuration=video.duration or 10.0
        )
    
    async def _generate_script_with_llm(
        self,
        analysis_results: List[VideoAnalysisResult],
        reference_text: str,
        parameters,
        task_id: str,
        original_videos: List[VideoItem] = None
    ) -> List[ScriptSegment]:
        """
        Generate script segments using LLM based on video analysis results.
        
        Args:
            analysis_results: Video analysis results
            reference_text: Reference text for context (user's chatContent as foundation)
            parameters: Generation parameters
            task_id: Task identifier
            original_videos: Original video items with complete information including URLs
            
        Returns:
            List[ScriptSegment]: Generated script segments
        """
        logger.info(f"Starting LLM-based script generation for task: {task_id}")
        logger.info(f"Generation approach: Using chatContent as foundation + video analysis as support")
        logger.info(f"Reference text (chatContent): {'Provided' if reference_text and reference_text.strip() else 'Empty'}")
        logger.info(f"Video analysis results: {len(analysis_results)} videos analyzed")
        
        # Create prompt for script generation
        prompt = self._create_script_generation_prompt(
            analysis_results, 
            reference_text, 
            parameters
        )
        
        logger.info(f"LLM prompt generated: length={len(prompt)}, includes_user_requirements={'<user_requirements>' in prompt}")
        
        # Prepare request data
        request_data = {
            "model": self.model,
            "messages": [
                {"role": "user", "content": prompt}
            ],
            "stream": False,
            "temperature": 0.3,  # Slightly higher temperature for creative script generation
            "max_tokens": 6000   # Sufficient tokens for script content
        }
        
        logger.info(f"Calling LLM API for script generation: {self.api_url}/chat/completions for task: {task_id}")
        
        # Debug logging: print request body if DEBUG=true
        if settings.debug:
            print(f"\n=== DEBUG: Script Generation LLM API Request for task {task_id} ===")
            print(f"URL: {self.api_url}/chat/completions")
            print(f"Headers: Content-Type: application/json, Authorization: Bearer {self.api_key[:10]}...{self.api_key[-4:]}")
            print(f"Request Body:")
            print(json.dumps(request_data, indent=2, ensure_ascii=False))
            print("=" * 50)
        
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
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
                    raise Exception(error_msg)
                
                # Parse response
                response_data = response.json()
                
                # Debug logging: print response body if DEBUG=true
                if settings.debug:
                    print(f"\n=== DEBUG: Script Generation LLM API Response for task {task_id} ===")
                    print(f"Status Code: {response.status_code}")
                    print(f"Response Body:")
                    print(json.dumps(response_data, indent=2, ensure_ascii=False))
                    print("=" * 50)
                
                # Extract generated content
                if ("choices" not in response_data or 
                    not response_data["choices"] or 
                    "message" not in response_data["choices"][0] or
                    "content" not in response_data["choices"][0]["message"]):
                    raise Exception("Invalid LLM response format")
                
                generated_content = response_data["choices"][0]["message"]["content"]
                
                # Parse the generated script content
                script_segments = self._parse_generated_script(
                    generated_content, 
                    analysis_results, 
                    parameters,
                    task_id,
                    original_videos
                )
                
                logger.info(f"Successfully generated {len(script_segments)} script segments for task: {task_id}")
                return script_segments
                
        except httpx.RequestError as e:
            error_msg = f"HTTP request error: {str(e)}"
            logger.error(error_msg, extra={"task_id": task_id})
            raise Exception(error_msg)
        except json.JSONDecodeError as e:
            error_msg = f"JSON decode error: {str(e)}"
            logger.error(error_msg, extra={"task_id": task_id})
            raise Exception(error_msg)
        except Exception as e:
            error_msg = f"Script generation error: {str(e)}"
            logger.error(error_msg, extra={"task_id": task_id})
            raise Exception(error_msg)
    
    def _create_script_generation_prompt(
        self,
        analysis_results: List[VideoAnalysisResult],
        reference_text: str,
        parameters
    ) -> str:
        """
        Create prompt for LLM script generation.
        
        Args:
            analysis_results: Video analysis results
            reference_text: Reference text
            parameters: Generation parameters
            
        Returns:
            str: Generated prompt
        """
        # Create example output format
        example_output = self._create_script_example(parameters)
        
        # Build video analysis summary
        video_analysis_summary = ""
        for i, result in enumerate(analysis_results, 1):
            # Safely check frames availability
            frames_count = len(result.frames) if result.frames is not None else 0
            logger.info(f"Building prompt for video {result.videoId}: {frames_count} frames available")
            
            video_analysis_summary += f"""
<video id="{result.videoId}">
  <name>{result.videoName}</name>
  <duration_for_script_length>{result.estimatedDuration:.1f}秒</duration_for_script_length>
  <content_description>{result.contentDescription}</content_description>
  <key_topics>{', '.join(result.keyTopics)}</key_topics>"""
            if result.visualElements:
                video_analysis_summary += f"\n  <visual_elements>{', '.join(result.visualElements)}</visual_elements>"
            if result.audioElements:
                video_analysis_summary += f"\n  <audio_elements>{', '.join(result.audioElements)}</audio_elements>"
            
            # Safely handle frames data
            if result.frames is not None and len(result.frames) > 0:
                video_analysis_summary += f"\n  <frame_analysis count='{len(result.frames)}'>"
                for frame in result.frames[:3]:  # Show first 3 frames
                    frame_analysis = frame.get('analysis', '')[:150]
                    frame_number = frame.get('frame_number', 0)
                    video_analysis_summary += f"\n    <frame sequence='{frame_number}'>{frame_analysis}...</frame>"
                    logger.debug(f"Including frame {frame_number} analysis in prompt: {frame_analysis[:30]}...")
                video_analysis_summary += "\n  </frame_analysis>"
                logger.info(f"Added {len(result.frames[:3])} frame analyses to prompt for video {result.videoId}")
            else:
                logger.warning(f"No frame analysis data available for video {result.videoId}")
            
            video_analysis_summary += "\n</video>\n"
        
        # Build reference context
        reference_context = ""
        if reference_text.strip():
            logger.info(f"Using reference text for prompt generation: '{reference_text[:100]}...' (length: {len(reference_text)})")
            reference_context = f"""
<user_requirements>
{reference_text}
</user_requirements>"""
        else:
            logger.warning("No reference text provided or reference text is empty")
        
        # Language instruction
        language_instruction = {
            'chinese': '使用中文生成脚本内容',
            'english': 'Generate script content in English',
            'mixed': '混合使用中文和英文生成脚本内容，根据内容需要选择合适的语言'
        }.get(parameters.language, '使用中文生成脚本内容')
        
        # Analysis depth instruction
        depth_instruction = {
            'basic': '提供基础的内容描述和要点总结',
            'detailed': '提供详细的内容分析和深入的观点阐述',
            'comprehensive': '提供全面深入的内容分析，包括多维度的解读和专业见解'
        }.get(parameters.analysisDepth, '提供详细的内容分析和深入的观点阐述')
        
        prompt = f"""<role>你是一个专业的视频脚本编写专家，擅长基于用户需求和视频内容分析结果生成连贯、有逻辑的视频脚本文案。</role>

<task>
**核心任务**：以用户提供的对话内容（user_requirements）为基础，结合视频分析结果，融合编写一套完整的视频脚本文案。

**创作原则**：
1. **以用户需求为主导**：用户的对话内容是脚本的核心基础和主题方向
2. **结合视频内容**：将视频分析结果作为素材支撑，丰富和具体化用户的需求
3. **深度融合**：不是简单拼接，而是将用户需求和视频内容有机融合，创作出连贯统一的脚本
4. **保持一致性**：脚本的主题、风格、表达方式要与用户需求保持一致
</task>

<video_analysis>
{video_analysis_summary}
</video_analysis>

{reference_context}

<generation_requirements>
<basic_requirements>
- 生成 {parameters.segmentCount} 个相互关联的脚本段落
- 每个段落包含一个吸引人的标题和适量的句子（根据视频长度调整）
- 段落之间要有逻辑连接，形成完整的叙事流程
- **首要原则：以用户需求（user_requirements）为脚本创作的核心基础**
- **次要原则：结合视频分析结果提供具体素材和细节支撑**
- {language_instruction}
- {depth_instruction}
</basic_requirements>

<content_requirements>
- **最重要：脚本内容必须紧密围绕用户在对话中提出的需求、主题和方向**
- **将视频分析结果作为实现用户需求的具体素材和案例**
- 脚本文案要具有视频脚本的特点：生动、吸引人、易于理解
- 开头段落要能够吸引观众注意力，引入用户关注的主题
- 中间段落要深入展开用户需求的内容，结合视频素材提供有价值的信息
- 结尾段落要总结要点，呼应用户需求，给观众留下深刻印象
- 如果用户提供了具体要求，这些要求是最高优先级，必须严格遵循
- 每个段落都要体现用户需求与视频内容的融合
- **重要：生成的脚本文案中不得包含任何时间相关的描述（如"XX秒"、"XX分钟"、"时长"等）**
- 专注于内容本身的描述，而非时间维度的信息
</content_requirements>

<script_length_requirements>
- **根据视频时长调整脚本文案的长度和详细程度：**
  - 短视频（0-30秒）：每段落2-3个简洁有力的句子，突出核心要点
  - 中等视频（31-120秒）：每段落3-4个句子，适度展开内容描述
  - 长视频（121秒以上）：每段落4-5个句子，深入详细地描述内容
- 文案长度要与视频内容的丰富程度相匹配
- 确保每个段落的文案能够充分覆盖对应视频的主要内容
- 避免文案过短导致内容空洞，也避免文案过长导致冗余
</script_length_requirements>

<video_association>
- 每个段落必须关联一个或多个相关视频（使用video_ids数组）
- 单个视频关联：当段落专门讲述某个视频的内容时
- 多个视频关联：当段落涉及多个视频的对比、结合或综合分析时
- 视频关联必须与段落内容逻辑一致
</video_association>

<keywords_generation>
- 为每个段落生成3-5个相关关键词
- 关键词要准确反映段落的核心内容
- 关键词要有助于SEO和内容检索
</keywords_generation>
</generation_requirements>

<output_format>
请严格按照以下JSON格式输出，不要添加任何其他内容：
{example_output}
</output_format>

<instruction>
现在开始生成视频脚本文案，创作流程如下：

**第一步：理解用户需求**
- 仔细阅读 <user_requirements> 中的用户对话内容
- 提取用户的核心需求、主题方向、风格偏好
- 用户的需求是脚本的"灵魂"和"骨架"

**第二步：分析视频素材**
- 研究 <video_analysis> 中的视频内容分析
- 识别哪些视频素材可以用来支撑用户需求
- 视频内容是脚本的"血肉"和"细节"

**第三步：融合创作**
- 以用户需求为主线，构建脚本结构
- 将视频内容作为具体案例和素材，融入到用户需求的表达中
- 确保每个段落都体现"用户需求+视频素材"的深度融合
- 不是"用户说什么+视频有什么"的简单拼接，而是"用户需要什么，视频如何体现"的有机结合

**质量检查标准：**
1. **核心符合度**：脚本是否紧密围绕用户在对话中表达的需求和意图？
2. **素材支撑度**：视频分析结果是否被恰当地用来丰富和支撑用户需求？
3. **逻辑连贯性**：段落之间是否形成完整的故事线，逻辑是否连贯？
4. **语言适配性**：语言是否生动，是否适合视频脚本？
5. **视频关联性**：是否准确关联对应的视频ID？
6. **时间规避性**：绝对不要在生成的文案中提及任何时间信息（时长、秒数、分钟数等）
7. **长度匹配度**：根据每个视频的时长（duration_for_script_length）调整对应段落的文案长度
8. **详略得当性**：确保文案详细程度与视频内容丰富度相匹配

**记住：用户需求是"目标"，视频内容是"工具"。脚本要回答的是"如何用这些视频素材来实现用户的需求"。**
</instruction>"""
        
        # Debug logging: print full prompt if DEBUG=true
        if settings.debug:
            logger.debug(f"Generated LLM prompt for script generation (length: {len(prompt)}):")
            logger.debug(f"Reference context included: {'<user_requirements>' in prompt}")
            logger.debug(f"Full prompt content:\n{prompt}")
        
        return prompt
    
    def _create_script_example(self, parameters) -> str:
        """
        Create example script output format.
        
        Args:
            parameters: Generation parameters
            
        Returns:
            str: Example JSON format
        """
        # 创建不同长度的示例，展示如何根据视频时长调整文案
        if parameters.segmentCount == 1:
            example = {
                "segments": [
                    {
                        "title": "精彩内容呈现",
                        "sentences": [
                            "这里展现了令人惊叹的创意表达。",
                            "独特的视觉风格让内容更加引人入胜。"
                        ],
                        "video_ids": ["video_001"],
                        "keywords": ["创意表达", "视觉风格", "引人入胜"]
                    }
                ]
            }
        else:
            example = {
                "segments": [
                    {
                        "title": "引人入胜的开场",
                        "sentences": [
                            "欢迎来到今天的精彩内容，我们将为您揭示一个令人惊叹的故事。",
                            "这个内容展现了独特的创意视角和精湛的制作工艺。",
                            "让我们一起深入探索其中蕴含的丰富内涵。"
                        ],
                        "video_ids": ["video_001"],
                        "keywords": ["精彩内容", "创意视角", "制作工艺", "丰富内涵"]
                    }
                ]
            }
        
        if parameters.segmentCount > 1:
            example["segments"].append({
                "title": "深度内容解析", 
                "sentences": [
                    "接下来让我们深入分析内容中的核心要素。",
                    "从技术层面来看，这里运用了多种先进的制作技巧。",
                    "这些细节的处理体现了创作者的专业水准和匠心精神。"
                ],
                "video_ids": ["video_002"],
                "keywords": ["深度解析", "核心要素", "制作技巧", "专业水准"]
            })
        
        # 如果有足够多的视频，添加一个多视频关联的示例
        if parameters.segmentCount > 2:
            example["segments"].append({
                "title": "精彩总结与展望", 
                "sentences": [
                    "通过对这些内容的综合分析，我们可以看到完整的创作理念。",
                    "不同内容片段之间形成了完美的呼应和递进关系。",
                    "这样的内容组合为观众提供了丰富而深刻的体验。"
                ],
                "video_ids": ["video_001", "video_002"],  # 多个视频关联示例
                "keywords": ["综合分析", "创作理念", "呼应递进", "深刻体验"]
            })
        
        return json.dumps(example, indent=2, ensure_ascii=False)
    
    def _parse_generated_script(
        self,
        generated_content: str,
        analysis_results: List[VideoAnalysisResult],
        parameters,
        task_id: str,
        original_videos: List[VideoItem] = None
    ) -> List[ScriptSegment]:
        """
        Parse generated script content into ScriptSegment objects.
        
        Args:
            generated_content: Generated content from LLM
            analysis_results: Original video analysis results
            parameters: Generation parameters
            task_id: Task identifier
            original_videos: Original video items with complete information including URLs
            
        Returns:
            List[ScriptSegment]: Parsed script segments
        """
        try:
            # Try to extract JSON from the response
            json_start = generated_content.find('{')
            json_end = generated_content.rfind('}') + 1
            
            if json_start == -1 or json_end == 0:
                raise ValueError("No JSON found in generated content")
            
            json_content = generated_content[json_start:json_end]
            parsed_data = json.loads(json_content)
            
            if "segments" not in parsed_data:
                raise ValueError("No 'segments' key found in parsed JSON")
            
            script_segments = []
            
            for i, segment_data in enumerate(parsed_data["segments"]):
                # Generate unique segment ID
                segment_id = f"script-segment-{task_id}-{uuid.uuid4().hex[:8]}"
                
                # Parse sentences
                sentences = []
                if "sentences" in segment_data and isinstance(segment_data["sentences"], list):
                    for j, sentence_text in enumerate(segment_data["sentences"]):
                        sentence_id = f"{segment_id}-sentence-{j+1}"
                        sentences.append(ScriptSentence(
                            id=sentence_id,
                            text=str(sentence_text)
                        ))
                
                # Find associated videos
                associated_videos = []
                video_ids = segment_data.get("video_ids")
                
                # 兼容旧格式的单个video_id
                if not video_ids and segment_data.get("video_id"):
                    video_ids = [segment_data.get("video_id")]
                
                if video_ids:
                    # Find corresponding analysis results and videos
                    for video_id in video_ids:
                        for analysis_result in analysis_results:
                            if analysis_result.videoId == video_id:
                                # Find original video data to get complete information including URLs
                                original_video = self._find_original_video(video_id, original_videos)
                                if original_video:
                                    # Use original video data with complete information
                                    # Auto-detect format from URL if not provided
                                    video_format = getattr(original_video, 'format', None)
                                    if not video_format and original_video.url:
                                        if '.webm' in original_video.url.lower():
                                            video_format = 'webm'
                                        elif '.mov' in original_video.url.lower():
                                            video_format = 'mov'
                                        elif '.avi' in original_video.url.lower():
                                            video_format = 'avi'
                                        else:
                                            video_format = 'mp4'  # Default to mp4
                                    
                                    logger.info(f"Found original video data for {video_id}: url={original_video.url}, thumbnailUrl={original_video.thumbnailUrl}, format={video_format}")
                                    associated_videos.append(VideoItem(
                                        id=original_video.id,
                                        name=original_video.name,
                                        type=original_video.type,
                                        url=original_video.url,
                                        thumbnailUrl=original_video.thumbnailUrl,
                                        duration=original_video.duration or analysis_result.estimatedDuration,
                                        format=video_format,
                                        width=getattr(original_video, 'width', None),
                                        height=getattr(original_video, 'height', None)
                                    ))
                                else:
                                    # Fallback to analysis result only
                                    associated_videos.append(VideoItem(
                                        id=analysis_result.videoId,
                                        name=analysis_result.videoName,
                                        type="video",
                                        duration=analysis_result.estimatedDuration
                                    ))
                                break # Found the video, move to the next one
                
                # If no specific video_ids, associate with video by index
                if not associated_videos and i < len(analysis_results):
                    analysis_result = analysis_results[i]
                    # Find original video data to get complete information including URLs
                    original_video = self._find_original_video(analysis_result.videoId, original_videos)
                    if original_video:
                        # Use original video data with complete information
                        # Auto-detect format from URL if not provided
                        video_format = getattr(original_video, 'format', None)
                        if not video_format and original_video.url:
                            if '.webm' in original_video.url.lower():
                                video_format = 'webm'
                            elif '.mov' in original_video.url.lower():
                                video_format = 'mov'
                            elif '.avi' in original_video.url.lower():
                                video_format = 'avi'
                            else:
                                video_format = 'mp4'  # Default to mp4
                        
                        associated_videos.append(VideoItem(
                            id=original_video.id,
                            name=original_video.name,
                            type=original_video.type,
                            url=original_video.url,
                            thumbnailUrl=original_video.thumbnailUrl,
                            duration=original_video.duration or analysis_result.estimatedDuration,
                            format=video_format,
                            width=getattr(original_video, 'width', None),
                            height=getattr(original_video, 'height', None)
                        ))
                    else:
                        # Fallback to analysis result only
                        associated_videos.append(VideoItem(
                            id=analysis_result.videoId,
                            name=analysis_result.videoName,
                            type="video",
                            duration=analysis_result.estimatedDuration
                        ))
                
                # Create script segment
                segment = ScriptSegment(
                    id=segment_id,
                    title=segment_data.get("title", f"脚本段落 {i+1}"),
                    sentences=sentences,
                    duration=associated_videos[0].duration if associated_videos else 15.0,
                    videos=associated_videos,
                    keywords=segment_data.get("keywords", [])
                )
                
                script_segments.append(segment)
            
            logger.info(f"Successfully parsed {len(script_segments)} script segments for task: {task_id}")
            return script_segments
            
        except json.JSONDecodeError as e:
            logger.warning(f"Failed to parse JSON from LLM response for task: {task_id}, falling back to text parsing")
            return self._fallback_parse_script(generated_content, analysis_results, parameters, task_id, original_videos)
        except Exception as e:
            logger.warning(f"Failed to parse generated script for task: {task_id}: {str(e)}, creating fallback segments")
            return self._create_fallback_script_segments(analysis_results, parameters, task_id, original_videos)
    
    def _find_original_video(self, video_id: str, original_videos: List[VideoItem] = None) -> VideoItem:
        """
        Find original video data by video ID to get complete information including URLs.
        
        Args:
            video_id: Video ID to find
            original_videos: List of original video items
            
        Returns:
            VideoItem: Original video item if found, None otherwise
        """
        if not original_videos:
            return None
            
        for video in original_videos:
            if video.id == video_id:
                return video
        
        return None
    
    def _fallback_parse_script(
        self,
        generated_content: str,
        analysis_results: List[VideoAnalysisResult],
        parameters,
        task_id: str,
        original_videos: List[VideoItem] = None
    ) -> List[ScriptSegment]:
        """
        Fallback script parsing when JSON parsing fails.
        
        Args:
            generated_content: Generated content
            analysis_results: Video analysis results
            parameters: Generation parameters
            task_id: Task identifier
            
        Returns:
            List[ScriptSegment]: Fallback script segments
        """
        # Simple text-based parsing
        lines = [line.strip() for line in generated_content.split('\n') if line.strip()]
        
        script_segments = []
        current_title = None
        current_sentences = []
        
        for line in lines:
            if line.startswith('##') or line.startswith('**') or '标题' in line or '段落' in line:
                # This looks like a title
                if current_title and current_sentences:
                    # Save previous segment
                    segment_id = f"script-segment-{task_id}-{uuid.uuid4().hex[:8]}"
                    segment = self._create_segment_from_text(
                        segment_id, current_title, current_sentences, 
                        analysis_results, len(script_segments), original_videos
                    )
                    script_segments.append(segment)
                
                current_title = line.replace('##', '').replace('**', '').strip()
                current_sentences = []
            else:
                # This looks like content
                if len(line) > 10:  # Ignore very short lines
                    current_sentences.append(line)
        
        # Add the last segment
        if current_title and current_sentences:
            segment_id = f"script-segment-{task_id}-{uuid.uuid4().hex[:8]}"
            segment = self._create_segment_from_text(
                segment_id, current_title, current_sentences,
                analysis_results, len(script_segments), original_videos
            )
            script_segments.append(segment)
        
        # If no segments were created, create fallback segments
        if not script_segments:
            return self._create_fallback_script_segments(analysis_results, parameters, task_id, original_videos)
        
        return script_segments[:parameters.segmentCount]
    
    def _create_segment_from_text(
        self,
        segment_id: str,
        title: str,
        sentences_text: List[str],
        analysis_results: List[VideoAnalysisResult],
        segment_index: int,
        original_videos: List[VideoItem] = None
    ) -> ScriptSegment:
        """
        Create script segment from text components.
        
        Args:
            segment_id: Segment identifier
            title: Segment title
            sentences_text: List of sentence texts
            analysis_results: Video analysis results
            segment_index: Segment index
            
        Returns:
            ScriptSegment: Created segment
        """
        # Create sentences
        sentences = []
        for i, text in enumerate(sentences_text[:3]):  # Limit to 3 sentences
            sentence_id = f"{segment_id}-sentence-{i+1}"
            sentences.append(ScriptSentence(id=sentence_id, text=text))
        
        # Associate with video
        associated_videos = []
        if segment_index < len(analysis_results):
            analysis_result = analysis_results[segment_index]
            # Find original video data to get complete information including URLs
            original_video = self._find_original_video(analysis_result.videoId, original_videos)
            if original_video:
                # Use original video data with complete information
                # Auto-detect format from URL if not provided
                video_format = getattr(original_video, 'format', None)
                if not video_format and original_video.url:
                    if '.webm' in original_video.url.lower():
                        video_format = 'webm'
                    elif '.mov' in original_video.url.lower():
                        video_format = 'mov'
                    elif '.avi' in original_video.url.lower():
                        video_format = 'avi'
                    else:
                        video_format = 'mp4'  # Default to mp4
                
                associated_videos.append(VideoItem(
                    id=original_video.id,
                    name=original_video.name,
                    type=original_video.type,
                    url=original_video.url,
                    thumbnailUrl=original_video.thumbnailUrl,
                    duration=original_video.duration or analysis_result.estimatedDuration,
                    format=video_format,
                    width=getattr(original_video, 'width', None),
                    height=getattr(original_video, 'height', None)
                ))
            else:
                # Fallback to analysis result only
                associated_videos.append(VideoItem(
                    id=analysis_result.videoId,
                    name=analysis_result.videoName,
                    type="video",
                    duration=analysis_result.estimatedDuration
                ))
        
        return ScriptSegment(
            id=segment_id,
            title=title,
            sentences=sentences,
            duration=associated_videos[0].duration if associated_videos else 15.0,
            videos=associated_videos,
            keywords=self._extract_keywords_from_text(title + " " + " ".join(sentences_text))
        )
    
    def _create_fallback_script_segments(
        self,
        analysis_results: List[VideoAnalysisResult],
        parameters,
        task_id: str,
        original_videos: List[VideoItem] = None
    ) -> List[ScriptSegment]:
        """
        Create fallback script segments when parsing fails.
        
        Args:
            analysis_results: Video analysis results
            parameters: Generation parameters
            task_id: Task identifier
            
        Returns:
            List[ScriptSegment]: Fallback script segments
        """
        script_segments = []
        
        # 计算每个段落应该关联多少个视频
        videos_per_segment = max(1, len(analysis_results) // parameters.segmentCount)
        
        for i in range(parameters.segmentCount):
            segment_id = f"fallback-segment-{task_id}-{i+1}"
            
            # 计算这个段落应该关联的视频范围
            start_idx = i * videos_per_segment
            end_idx = min((i + 1) * videos_per_segment, len(analysis_results))
            
            # 如果是最后一个段落，包含剩余的所有视频
            if i == parameters.segmentCount - 1:
                end_idx = len(analysis_results)
            
            segment_analysis_results = analysis_results[start_idx:end_idx]
            
            if not segment_analysis_results:
                continue
            
            # 创建基础句子，考虑多个视频的情况
            if len(segment_analysis_results) == 1:
                analysis_result = segment_analysis_results[0]
                sentences = [
                    ScriptSentence(
                        id=f"{segment_id}-sentence-1",
                        text=f"这个视频展现了{', '.join(analysis_result.keyTopics[:2])}等精彩内容。"
                    ),
                    ScriptSentence(
                        id=f"{segment_id}-sentence-2", 
                        text=f"{analysis_result.contentDescription}"
                    )
                ]
                title = f"{analysis_result.videoName} - 内容分析"
                keywords = analysis_result.keyTopics[:5]
            else:
                # 多个视频的情况
                video_names = [result.videoName for result in segment_analysis_results]
                all_topics = []
                for result in segment_analysis_results:
                    all_topics.extend(result.keyTopics)
                unique_topics = list(dict.fromkeys(all_topics))  # 去重保持顺序
                
                sentences = [
                    ScriptSentence(
                        id=f"{segment_id}-sentence-1",
                        text=f"这些视频共同展现了{', '.join(unique_topics[:3])}等丰富内容。"
                    ),
                    ScriptSentence(
                        id=f"{segment_id}-sentence-2", 
                        text=f"通过{len(segment_analysis_results)}个视频的综合呈现，形成了完整的内容体系。"
                    )
                ]
                title = f"综合内容展示 {i+1}"
                keywords = unique_topics[:5]
            
            # 关联的视频列表
            associated_videos = []
            total_duration = 0.0
            for result in segment_analysis_results:
                # Find original video data to get complete information including URLs
                original_video = self._find_original_video(result.videoId, original_videos)
                if original_video:
                    # Use original video data with complete information
                    associated_videos.append(VideoItem(
                        id=original_video.id,
                        name=original_video.name,
                        type=original_video.type,
                        url=original_video.url,
                        thumbnailUrl=original_video.thumbnailUrl,
                        duration=original_video.duration or result.estimatedDuration
                    ))
                    total_duration += (original_video.duration or result.estimatedDuration)
                else:
                    # Fallback to analysis result only
                    associated_videos.append(VideoItem(
                        id=result.videoId,
                        name=result.videoName,
                        type="video",
                        duration=result.estimatedDuration
                    ))
                    total_duration += result.estimatedDuration
            
            segment = ScriptSegment(
                id=segment_id,
                title=title,
                sentences=sentences,
                duration=total_duration,
                videos=associated_videos,
                keywords=keywords
            )
            
            script_segments.append(segment)
        
        return script_segments
    
    def _create_metadata(
        self,
        request: VideoUnderstandingScriptRequest,
        analysis_results: List[VideoAnalysisResult],
        script_segments: List[ScriptSegment]
    ) -> Dict[str, Any]:
        """
        Create metadata for the generation result.
        
        Args:
            request: Original request
            analysis_results: Video analysis results
            script_segments: Generated script segments
            
        Returns:
            Dict[str, Any]: Metadata dictionary
        """
        total_duration = sum(segment.duration or 0.0 for segment in script_segments)
        
        return {
            "processedVideoCount": len(request.selectedVideos),
            "generatedSegmentCount": len(script_segments),
            "totalEstimatedDuration": total_duration,
            "analysisDepth": request.parameters.analysisDepth,
            "analysisMode": request.analysisMode,
            "language": request.parameters.language,
            "includeVisualElements": request.parameters.includeVisualElements,
            "includeAudioAnalysis": request.parameters.includeAudioAnalysis,
            "referenceTextLength": len(request.referenceText),
            "generatedAt": datetime.now().isoformat(),
            "videoAnalysisResultsCount": len(analysis_results)
        }
    
    # Helper methods for content analysis
    def _generate_content_description_from_frames(self, frame_descriptions: List[str]) -> str:
        """Generate content description from frame descriptions."""
        if not frame_descriptions:
            logger.warning("No frame descriptions provided, using fallback content description")
            return "视频内容丰富，包含多种视觉元素。"
        
        logger.info(f"Generating content description from {len(frame_descriptions)} frame descriptions")
        
        # Combine first few frame descriptions
        combined = " ".join(frame_descriptions[:3])
        if len(combined) > 200:
            combined = combined[:200] + "..."
        
        content_description = f"视频内容包含: {combined}"
        logger.debug(f"Generated content description: {content_description[:100]}...")
        
        return content_description
    
    def _extract_visual_elements_from_analysis(self, frame_descriptions: List[str]) -> List[str]:
        """Extract visual elements from frame descriptions."""
        visual_keywords = ["画面", "色彩", "构图", "光线", "场景", "人物", "物体", "背景", "前景", "特效"]
        elements = []
        
        for desc in frame_descriptions:
            for keyword in visual_keywords:
                if keyword in desc and keyword not in elements:
                    elements.append(f"{keyword}设计")
        
        # Add default visual elements if none found
        if not elements:
            elements = ["画面构图", "色彩搭配", "视觉效果"]
        
        return elements[:5]  # Limit to 5 elements
    
    def _extract_audio_elements_from_analysis(self, existing_analysis) -> List[str]:
        """Extract audio elements from existing analysis."""
        # Default audio elements since we don't have specific audio analysis
        return ["音频质量", "声音设计", "背景音乐", "音效处理"]
    
    def _extract_audio_elements_from_frontend_analysis(self, frontend_analysis_data: Dict[str, Any]) -> List[str]:
        """Extract audio elements from frontend analysis data."""
        # Default audio elements since we don't have specific audio analysis
        return ["音频质量", "声音设计", "背景音乐", "音效处理"]
    
    def _extract_key_topics_from_analysis(self, frame_descriptions: List[str], content_description: str) -> List[str]:
        """Extract key topics from analysis data."""
        topic_keywords = ["创意", "技术", "艺术", "表现", "内容", "设计", "制作", "效果"]
        topics = []
        
        all_text = " ".join(frame_descriptions) + " " + content_description
        
        for keyword in topic_keywords:
            if keyword in all_text and keyword not in topics:
                topics.append(f"{keyword}表达")
        
        # Add default topics if none found
        if not topics:
            topics = ["视频内容", "创意表达", "技术实现"]
        
        return topics[:5]  # Limit to 5 topics
    
    def _extract_keywords_from_text(self, text: str) -> List[str]:
        """Extract keywords from text content."""
        common_keywords = ["视频", "内容", "创意", "表达", "技术", "设计", "制作", "效果", "呈现", "分析"]
        keywords = []
        
        for keyword in common_keywords:
            if keyword in text and keyword not in keywords:
                keywords.append(keyword)
        
        return keywords[:5]  # Limit to 5 keywords 