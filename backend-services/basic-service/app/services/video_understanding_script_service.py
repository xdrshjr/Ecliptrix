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
        request: VideoUnderstandingScriptRequest
    ) -> Dict[str, Any]:
        """
        Generate script based on video understanding analysis.
        
        Args:
            request: Script generation request with videos and parameters
            
        Returns:
            Dict[str, Any]: Generated script segments and metadata
            
        Raises:
            Exception: If video analysis or script generation fails
        """
        try:
            logger.info(f"Starting video understanding script generation for task: {request.taskId}")
            logger.info(f"Processing {len(request.selectedVideos)} videos with {request.parameters.analysisDepth} analysis depth")
            
            # Step 1: Analyze videos to get understanding results
            video_analysis_results = await self._analyze_videos(
                request.selectedVideos, 
                request.parameters,
                request.taskId
            )
            
            logger.info(f"Video analysis completed for task: {request.taskId}, analyzed {len(video_analysis_results)} videos")
            
            # Step 2: Generate script using LLM based on analysis results
            script_segments = await self._generate_script_with_llm(
                video_analysis_results,
                request.referenceText,
                request.parameters,
                request.taskId
            )
            
            # Step 3: Prepare metadata
            metadata = self._create_metadata(
                request, 
                video_analysis_results, 
                script_segments
            )
            
            logger.info(f"Video understanding script generation completed for task: {request.taskId}, generated {len(script_segments)} segments")
            
            return {
                "segments": [segment.model_dump() for segment in script_segments],
                "metadata": metadata
            }
            
        except Exception as e:
            error_msg = f"Video understanding script generation error: {str(e)}"
            logger.error(error_msg, extra={"task_id": request.taskId}, exc_info=True)
            raise Exception(error_msg)
    
    async def _analyze_videos(
        self,
        videos: List[VideoItem],
        parameters,
        task_id: str
    ) -> List[VideoAnalysisResult]:
        """
        Analyze videos to extract understanding information.
        
        Args:
            videos: List of selected videos
            parameters: Analysis parameters
            task_id: Task identifier
            
        Returns:
            List[VideoAnalysisResult]: Video analysis results
        """
        analysis_results = []
        
        for video in videos:
            try:
                logger.info(f"Analyzing video {video.id} ({video.name}) for task: {task_id}")
                
                # First, try to use analysis data from frontend
                if hasattr(video, 'analysisData') and video.analysisData:
                    logger.info(f"Using analysis data from frontend for video {video.id}")
                    analysis_result = self._convert_frontend_analysis_to_result(
                        video, video.analysisData, parameters
                    )
                    analysis_results.append(analysis_result)
                    continue
                
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
                
            except Exception as e:
                logger.warning(f"Failed to analyze video {video.id}: {str(e)}")
                # Create fallback analysis result
                fallback_result = self._create_fallback_analysis_result(video, parameters)
                analysis_results.append(fallback_result)
        
        return analysis_results
    
    def _convert_frontend_analysis_to_result(
        self,
        video: VideoItem,
        frontend_analysis_data: Dict[str, Any],
        parameters
    ) -> VideoAnalysisResult:
        """
        Convert frontend analysis data to VideoAnalysisResult.
        
        Args:
            video: Video item
            frontend_analysis_data: Analysis data from frontend
            parameters: Analysis parameters
            
        Returns:
            VideoAnalysisResult: Converted analysis result
        """
        # Extract frame descriptions for content understanding
        frame_descriptions = []
        frame_analyses = frontend_analysis_data.get('frame_analyses', [])
        
        for frame in frame_analyses[:10]:  # Limit to first 10 frames
            analysis_text = frame.get('analysis', '')
            if analysis_text:
                # Truncate frame analysis to 200 characters as mentioned in requirements
                truncated_analysis = analysis_text[:200] + "..." if len(analysis_text) > 200 else analysis_text
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
            audio_elements = self._extract_audio_elements_from_frontend_analysis(frontend_analysis_data)
        
        key_topics = self._extract_key_topics_from_analysis(frame_descriptions, content_description)
        
        # Get video duration from analysis data or video item
        video_duration = frontend_analysis_data.get('video_duration', video.duration or 0.0)
        
        return VideoAnalysisResult(
            videoId=video.id,
            videoName=video.name,
            visualElements=visual_elements,
            audioElements=audio_elements,
            keyTopics=key_topics,
            contentDescription=content_description,
            estimatedDuration=video_duration,
            frames=[{
                "frame_number": frame.get('frame_number', i),
                "timestamp": frame.get('timestamp', i * 2.0),
                "analysis": frame.get('analysis', '')[:200]
            } for i, frame in enumerate(frame_analyses[:5])]  # Show first 5 frames
        )
    
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
        task_id: str
    ) -> List[ScriptSegment]:
        """
        Generate script segments using LLM based on video analysis results.
        
        Args:
            analysis_results: Video analysis results
            reference_text: Reference text for context
            parameters: Generation parameters
            task_id: Task identifier
            
        Returns:
            List[ScriptSegment]: Generated script segments
        """
        # Create prompt for script generation
        prompt = self._create_script_generation_prompt(
            analysis_results, 
            reference_text, 
            parameters
        )
        
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
                    task_id
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
            video_analysis_summary += f"""
视频 {i}: {result.videoName} (ID: {result.videoId})
- 时长: {result.estimatedDuration:.1f}秒
- 内容描述: {result.contentDescription}
- 关键主题: {', '.join(result.keyTopics)}
"""
            if result.visualElements:
                video_analysis_summary += f"- 视觉元素: {', '.join(result.visualElements)}\n"
            if result.audioElements:
                video_analysis_summary += f"- 音频元素: {', '.join(result.audioElements)}\n"
            if result.frames:
                video_analysis_summary += f"- 帧分析样本: {len(result.frames)}个关键帧\n"
                for frame in result.frames[:2]:  # Show first 2 frames
                    video_analysis_summary += f"  * 第{frame['frame_number']}帧 ({frame['timestamp']:.1f}s): {frame['analysis'][:100]}...\n"
        
        # Build reference context
        reference_context = ""
        if reference_text.strip():
            reference_context = f"""
参考文本内容:
{reference_text}

请在生成脚本时考虑参考文本的要求和风格。
"""
        
        # Language instruction
        language_instruction = {
            'chinese': '请使用中文生成脚本内容。',
            'english': 'Please generate script content in English.',
            'mixed': '请混合使用中文和英文生成脚本内容，根据内容需要选择合适的语言。'
        }.get(parameters.language, '请使用中文生成脚本内容。')
        
        # Analysis depth instruction
        depth_instruction = {
            'basic': '提供基础的内容描述和要点总结。',
            'detailed': '提供详细的内容分析和深入的观点阐述。',
            'comprehensive': '提供全面深入的内容分析，包括多维度的解读和专业见解。'
        }.get(parameters.analysisDepth, '提供详细的内容分析和深入的观点阐述。')
        
        prompt = f"""你是一个专业的视频内容分析师和脚本编写专家。基于以下视频分析结果，为视频内容生成对应的脚本段落。

## 视频分析结果
{video_analysis_summary}

## 生成要求
- 生成 {parameters.segmentCount} 个脚本段落
- 每个段落包含标题和2-3个句子
- {language_instruction}
- {depth_instruction}
- 每个段落可以关联一个或多个相关的视频（使用video_ids数组）
- 如果段落内容涉及多个视频的对比、结合或综合分析，可以关联多个视频
- 为每个段落生成3-5个相关关键词

{reference_context}

## 输出格式
请严格按照以下JSON格式输出，不要添加任何其他内容:
- video_ids: 数组格式，包含与该段落相关的视频ID
- 可以是单个视频: ["video_001"] 
- 也可以是多个视频: ["video_001", "video_002"]

{example_output}

请开始生成脚本:"""
        
        return prompt
    
    def _create_script_example(self, parameters) -> str:
        """
        Create example script output format.
        
        Args:
            parameters: Generation parameters
            
        Returns:
            str: Example JSON format
        """
        example = {
            "segments": [
                {
                    "title": "视频内容分析 1",
                    "sentences": [
                        "这个视频展现了精彩的内容和创意表达。",
                        "通过深入分析可以看到其独特的视觉呈现方式。"
                    ],
                    "video_ids": ["video_001"],  # 支持多个视频ID
                    "keywords": ["创意表达", "视觉呈现", "内容分析"]
                }
            ]
        }
        
        if parameters.segmentCount > 1:
            example["segments"].append({
                "title": "视频内容分析 2", 
                "sentences": [
                    "第二个视频在技术实现上有着出色的表现。",
                    "整体制作水准体现了专业性和创新性。"
                ],
                "video_ids": ["video_002"],  # 支持多个视频ID
                "keywords": ["技术实现", "专业制作", "创新表达"]
            })
        
        # 如果有足够多的视频，添加一个多视频关联的示例
        if parameters.segmentCount > 2:
            example["segments"].append({
                "title": "综合内容展示", 
                "sentences": [
                    "这些视频共同展现了完整的内容体系。",
                    "不同视频之间形成了良好的互补关系。"
                ],
                "video_ids": ["video_001", "video_002"],  # 多个视频关联示例
                "keywords": ["综合展示", "内容体系", "互补关系"]
            })
        
        return json.dumps(example, indent=2, ensure_ascii=False)
    
    def _parse_generated_script(
        self,
        generated_content: str,
        analysis_results: List[VideoAnalysisResult],
        parameters,
        task_id: str
    ) -> List[ScriptSegment]:
        """
        Parse generated script content into ScriptSegment objects.
        
        Args:
            generated_content: Generated content from LLM
            analysis_results: Original video analysis results
            parameters: Generation parameters
            task_id: Task identifier
            
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
            return self._fallback_parse_script(generated_content, analysis_results, parameters, task_id)
        except Exception as e:
            logger.warning(f"Failed to parse generated script for task: {task_id}: {str(e)}, creating fallback segments")
            return self._create_fallback_script_segments(analysis_results, parameters, task_id)
    
    def _fallback_parse_script(
        self,
        generated_content: str,
        analysis_results: List[VideoAnalysisResult],
        parameters,
        task_id: str
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
                        analysis_results, len(script_segments)
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
                analysis_results, len(script_segments)
            )
            script_segments.append(segment)
        
        # If no segments were created, create fallback segments
        if not script_segments:
            return self._create_fallback_script_segments(analysis_results, parameters, task_id)
        
        return script_segments[:parameters.segmentCount]
    
    def _create_segment_from_text(
        self,
        segment_id: str,
        title: str,
        sentences_text: List[str],
        analysis_results: List[VideoAnalysisResult],
        segment_index: int
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
        task_id: str
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
            return "视频内容丰富，包含多种视觉元素。"
        
        # Combine first few frame descriptions
        combined = " ".join(frame_descriptions[:3])
        if len(combined) > 200:
            combined = combined[:200] + "..."
        
        return f"视频内容包含: {combined}"
    
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