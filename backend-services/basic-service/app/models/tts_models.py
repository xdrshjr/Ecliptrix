"""
Text-to-Speech (TTS) models for Volcano TTS API integration.
"""

from typing import Optional, Dict, Any, List
from enum import Enum
from pydantic import BaseModel, Field, validator


class VoiceType(str, Enum):
    """Available voice types for TTS conversion."""
    
    # 通用场景 - General Scenarios
    ZH_MALE_SHAONIANZIXIN_MOON_BIGTTS = "zh_male_shaonianzixin_moon_bigtts"  # 少年梓辛/Brayan (男声)
    ZH_FEMALE_LINJIANVHAI_MOON_BIGTTS = "zh_female_linjianvhai_moon_bigtts"  # 邻家女孩 (女声)
    ZH_MALE_YUANBOXIAOSHU_MOON_BIGTTS = "zh_male_yuanboxiaoshu_moon_bigtts"  # 渊博小叔 (男声)
    ZH_MALE_YANGGUANGQINGNIAN_MOON_BIGTTS = "zh_male_yangguangqingnian_moon_bigtts"  # 阳光青年 (男声)
    ZH_FEMALE_SHUANGKUAISISI_MOON_BIGTTS = "zh_female_shuangkuaisisi_moon_bigtts"  # 爽快思思/Skye (女声)
    ZH_FEMALE_TIANMEIXIAOYUAN_MOON_BIGTTS = "zh_female_tianmeixiaoyuan_moon_bigtts"  # 甜美小源 (女声)
    ZH_FEMALE_QINGCHEZIZI_MOON_BIGTTS = "zh_female_qingchezizi_moon_bigtts"  # 清澈梓梓 (女声)
    ZH_MALE_JIESHUOXIAOMING_MOON_BIGTTS = "zh_male_jieshuoxiaoming_moon_bigtts"  # 解说小明 (男声)
    ZH_FEMALE_KAILANGJIEJIE_MOON_BIGTTS = "zh_female_kailangjiejie_moon_bigtts"  # 开朗姐姐 (女声)
    ZH_MALE_LINJIANANHAI_MOON_BIGTTS = "zh_male_linjiananhai_moon_bigtts"  # 邻家男孩 (男声)
    ZH_FEMALE_TIANMEIYUEYUE_MOON_BIGTTS = "zh_female_tianmeiyueyue_moon_bigtts"  # 甜美悦悦 (女声)
    ZH_FEMALE_XINLINGJITANG_MOON_BIGTTS = "zh_female_xinlingjitang_moon_bigtts"  # 心灵鸡汤 (女声)
    ZH_FEMALE_CANCAN_MARS_BIGTTS = "zh_female_cancan_mars_bigtts"  # 灿灿 (女声)
    ZH_FEMALE_ZHIXINGNVSHENG_MARS_BIGTTS = "zh_female_zhixingnvsheng_mars_bigtts"  # 知性女声 (女声)
    ZH_FEMALE_QINGXINNVSHENG_MARS_BIGTTS = "zh_female_qingxinnvsheng_mars_bigtts"  # 清新女声 (女声)
    ZH_MALE_QINGSHUANGNANDA_MARS_BIGTTS = "zh_male_qingshuangnanda_mars_bigtts"  # 清爽男大 (男声)
    ZH_FEMALE_TIEXINNVSHENG_MARS_BIGTTS = "zh_female_tiexinnvsheng_mars_bigtts"  # 贴心女声 (女声)
    
    # 趣味方言 - Regional Dialects
    ZH_FEMALE_WANQUDASHU_MOON_BIGTTS = "zh_female_wanqudashu_moon_bigtts"  # 湾区大叔 (男声)
    ZH_FEMALE_DAIMENGCHUANMEI_MOON_BIGTTS = "zh_female_daimengchuanmei_moon_bigtts"  # 呆萌川妹 (女声)
    ZH_MALE_GUOZHOUDEGE_MOON_BIGTTS = "zh_male_guozhoudege_moon_bigtts"  # 广州德哥 (男声)
    ZH_MALE_BEIJINGXIAOYE_MOON_BIGTTS = "zh_male_beijingxiaoye_moon_bigtts"  # 北京小爷 (男声)
    ZH_MALE_HAOYUXIAOGE_MOON_BIGTTS = "zh_male_haoyuxiaoge_moon_bigtts"  # 浩宇小哥 (男声)
    ZH_MALE_GUANGXIYUANZHOU_MOON_BIGTTS = "zh_male_guangxiyuanzhou_moon_bigtts"  # 广西远舟 (男声)
    ZH_FEMALE_MEITUOJIEER_MOON_BIGTTS = "zh_female_meituojieer_moon_bigtts"  # 妹坨洁儿 (女声)
    ZH_MALE_YUZHOUZIXUAN_MOON_BIGTTS = "zh_male_yuzhouzixuan_moon_bigtts"  # 豫州子轩 (男声)
    ZH_MALE_JINGQIANGKANYE_MOON_BIGTTS = "zh_male_jingqiangkanye_moon_bigtts"  # 京腔侃爷/Harmony (男声)
    
    # 角色扮演 - Role Playing
    ZH_FEMALE_MEILINVYOU_MOON_BIGTTS = "zh_female_meilinvyou_moon_bigtts"  # 魅力女友 (女声)
    ZH_MALE_SHENYEBOKE_MOON_BIGTTS = "zh_male_shenyeboke_moon_bigtts"  # 深夜播客 (男声)
    ZH_FEMALE_YUANYOUSHAOER_MOON_BIGTTS = "zh_female_yuanyoushaoer_moon_bigtts"  # 元气少儿 (女声)
    ZH_MALE_CHENGSHUXIAOSHU_MOON_BIGTTS = "zh_male_chengshuxiaoshu_moon_bigtts"  # 成熟小叔 (男声)
    ZH_FEMALE_KEAISHAOER_MOON_BIGTTS = "zh_female_keaishaoer_moon_bigtts"  # 可爱少儿 (女声)
    ZH_MALE_JIATINGDADDY_MOON_BIGTTS = "zh_male_jiatingdaddy_moon_bigtts"  # 家庭Daddy (男声)
    ZH_FEMALE_WENNUANNVSHENG_MOON_BIGTTS = "zh_female_wennuannvsheng_moon_bigtts"  # 温暖女声 (女声)
    ZH_MALE_CIXIANGJIAZHANG_MOON_BIGTTS = "zh_male_cixiangjiazhang_moon_bigtts"  # 慈祥家长 (男声)
    
    # 播报解说 - Broadcasting & Commentary  
    ZH_MALE_ZHUANYEXINWEN_MARS_BIGTTS = "zh_male_zhuanyexinwen_mars_bigtts"  # 专业新闻 (男声)
    ZH_FEMALE_ZHUANYEXINWEN_MARS_BIGTTS = "zh_female_zhuanyexinwen_mars_bigtts"  # 专业新闻 (女声)
    EN_FEMALE_ANNA_MARS_BIGTTS = "en_female_anna_mars_bigtts"  # Anna (女声)
    EN_MALE_JOHN_MARS_BIGTTS = "en_male_john_mars_bigtts"  # John (男声)
    
    # 有声阅读 - Audio Reading
    ZH_MALE_RUYAQINGNIAN_MARS_BIGTTS = "zh_male_ruyaqingnian_mars_bigtts"  # 儒雅青年 (男声)
    ZH_FEMALE_WENZHIZHUREN_MARS_BIGTTS = "zh_female_wenzhizhuren_mars_bigtts"  # 文质主人 (女声)
    
    # 兼容旧版本的简化名称
    ZH_FEMALE_SWEET = "zh_female_sweet"
    ZH_FEMALE_GENTLE = "zh_female_gentle" 
    ZH_MALE_WARM = "zh_male_warm"
    ZH_MALE_POWERFUL = "zh_male_powerful"
    ZH_MALE_STEADY = "zh_male_steady"
    EN_FEMALE_NATURAL = "en_female_natural"
    EN_MALE_NATURAL = "en_male_natural"


class TTSRequest(BaseModel):
    """Request model for text-to-speech conversion."""
    
    text: str = Field(..., description="Text to convert to speech", max_length=10000)
    voice_type: str = Field(
        default="zh_male_shaonianzixin_uranus_bigtts",
        description="Voice type for speech synthesis"
    )
    speed_ratio: float = Field(default=1.0, description="Speech speed ratio", ge=0.1, le=3.0)
    segment_id: Optional[str] = Field(None, description="Script segment ID for reference")
    task_id: Optional[str] = Field(None, description="Task ID for reference")
    
    @validator('voice_type')
    def validate_voice_type(cls, v):
        """验证语音类型是否有效"""
        # 这里可以添加动态验证逻辑，从配置文件加载有效的语音类型
        # 暂时允许所有字符串类型，由TTS服务进行实际验证
        if not v or not isinstance(v, str):
            raise ValueError('Voice type must be a non-empty string')
        return v
    
    class Config:
        json_schema_extra = {
            "example": {
                "text": "这是一段需要转换为语音的文本内容。",
                "voice_type": "zh_male_shaonianzixin_moon_bigtts",
                "speed_ratio": 1.0,
                "segment_id": "segment_001",
                "task_id": "task_123"
            }
        }


class BatchTTSSegmentRequest(BaseModel):
    """Single segment request for batch TTS conversion."""
    
    segment_id: str = Field(..., description="Unique segment identifier")
    text: str = Field(..., description="Text to convert to speech", max_length=5000)
    title: Optional[str] = Field(None, description="Segment title for reference")


class BatchTTSRequest(BaseModel):
    """Request model for batch text-to-speech conversion."""
    
    segments: List[BatchTTSSegmentRequest] = Field(
        ..., 
        description="List of text segments to convert",
        min_items=1,
        max_items=50
    )
    voice_type: str = Field(
        default="zh_male_shaonianzixin_uranus_bigtts",
        description="Voice type for speech synthesis"
    )
    speed_ratio: float = Field(default=1.0, description="Speech speed ratio", ge=0.1, le=3.0)
    task_id: Optional[str] = Field(None, description="Task ID for reference")
    concurrent_threads: Optional[int] = Field(
        None, 
        description="Number of concurrent threads (overrides config)",
        ge=1,
        le=10
    )
    
    @validator('voice_type')
    def validate_voice_type(cls, v):
        """验证语音类型是否有效"""
        if not v or not isinstance(v, str):
            raise ValueError('Voice type must be a non-empty string')
        return v
    
    class Config:
        json_schema_extra = {
            "example": {
                "segments": [
                    {
                        "segment_id": "segment-1",
                        "text": "大家好，欢迎来到今天的视频教程。",
                        "title": "开场介绍"
                    },
                    {
                        "segment_id": "segment-2", 
                        "text": "今天我们要学习如何使用这个强大的视频编辑工具。",
                        "title": "功能演示"
                    }
                ],
                "voice_type": "zh_male_shaonianzixin_moon_bigtts",
                "speed_ratio": 1.0,
                "task_id": "task_123",
                "concurrent_threads": 3
            }
        }


class BatchTTSSegmentResult(BaseModel):
    """Result for a single segment in batch TTS conversion."""
    
    segment_id: str = Field(..., description="Segment identifier")
    success: bool = Field(..., description="Conversion success status for this segment")
    audio_url: Optional[str] = Field(None, description="Generated audio file URL")
    duration: Optional[float] = Field(None, description="Audio duration in seconds")
    file_size: Optional[int] = Field(None, description="Audio file size in bytes")
    error: Optional[str] = Field(None, description="Error message if conversion failed")
    processing_time: Optional[float] = Field(None, description="Processing time in seconds")


class BatchTTSResponse(BaseModel):
    """Response model for batch text-to-speech conversion."""
    
    success: bool = Field(..., description="Overall batch success status")
    message: str = Field(..., description="Response message")
    total_segments: int = Field(..., description="Total number of segments processed")
    successful_segments: int = Field(..., description="Number of successfully processed segments")
    failed_segments: int = Field(..., description="Number of failed segments")
    total_processing_time: float = Field(..., description="Total processing time in seconds")
    results: List[BatchTTSSegmentResult] = Field(..., description="Individual segment results")
    
    class Config:
        json_schema_extra = {
            "example": {
                "success": True,
                "message": "批量语音转换完成",
                "total_segments": 2,
                "successful_segments": 2,
                "failed_segments": 0,
                "total_processing_time": 12.5,
                "results": [
                    {
                        "segment_id": "segment-1",
                        "success": True,
                        "audio_url": "/api/audio/generated/tts_segment-1_20240101_abc123.mp3",
                        "duration": 5.2,
                        "file_size": 83456,
                        "processing_time": 6.1
                    },
                    {
                        "segment_id": "segment-2",
                        "success": True,
                        "audio_url": "/api/audio/generated/tts_segment-2_20240101_def456.mp3",
                        "duration": 7.8,
                        "file_size": 124928,
                        "processing_time": 6.4
                    }
                ]
            }
        }


class TTSResponse(BaseModel):
    """Response model for successful text-to-speech conversion."""
    
    success: bool = Field(True, description="Conversion success status")
    message: str = Field(default="语音转换成功", description="Response message")
    data: Dict[str, Any] = Field(..., description="Response data")
    
    class Config:
        json_schema_extra = {
            "example": {
                "success": True,
                "message": "语音转换成功",
                "data": {
                    "audio_url": "/api/audio/generated/audio_12345.mp3",
                    "duration": 15.5,
                    "file_size": 248576,
                    "voice_type": "zh_female_wanqudashu_moon_bigtts",
                    "text_length": 45,
                    "request_id": "req_67890"
                }
            }
        }


class TTSErrorResponse(BaseModel):
    """Response model for failed text-to-speech conversion."""
    
    success: bool = Field(False, description="Conversion success status")
    message: str = Field(..., description="Error message")
    error_code: Optional[str] = Field(None, description="Error code")
    
    class Config:
        json_schema_extra = {
            "example": {
                "success": False,
                "message": "语音转换失败：文本内容过长",
                "error_code": "TEXT_TOO_LONG"
            }
        }


class VoiceTypeInfo(BaseModel):
    """Information about a specific voice type."""
    
    id: str = Field(..., description="Voice type identifier")
    name: str = Field(..., description="Display name")
    language: str = Field(..., description="Language code")
    gender: str = Field(..., description="Voice gender")
    description: str = Field(..., description="Voice description")
    category: str = Field(..., description="Voice category")
    
    class Config:
        json_schema_extra = {
            "example": {
                "id": "zh_female_wanqudashu_moon_bigtts",
                "name": "温柔女声",
                "language": "zh-CN",
                "gender": "female",
                "description": "温柔甜美的女性声音，适合讲解和叙述",
                "category": "通用场景"
            }
        }


class VoiceTypesResponse(BaseModel):
    """Response model for voice types list."""
    
    success: bool = Field(True, description="Request success status")
    message: str = Field(default="获取音色列表成功", description="Response message")
    data: Dict[str, VoiceTypeInfo] = Field(..., description="Available voice types")
    
    class Config:
        json_schema_extra = {
            "example": {
                "success": True,
                "message": "获取音色列表成功",
                "data": {
                    "zh_female_wanqudashu_moon_bigtts": {
                        "id": "zh_female_wanqudashu_moon_bigtts",
                        "name": "温柔女声",
                        "language": "zh-CN",
                        "gender": "female",
                        "description": "温柔甜美的女性声音，适合讲解和叙述"
                    }
                }
            }
        }


class SentenceTTSRequest(BaseModel):
    """Single sentence request for sentence-level TTS conversion."""
    
    sentence_id: str = Field(..., description="Unique sentence identifier")
    text: str = Field(..., description="Sentence text to convert to speech", max_length=2000)
    order: int = Field(..., description="Sentence order in the segment for proper sequencing")


class SentenceBatchTTSRequest(BaseModel):
    """Request model for sentence-level batch text-to-speech conversion."""
    
    segment_id: str = Field(..., description="Segment identifier for grouping sentences")
    sentences: List[SentenceTTSRequest] = Field(
        ..., 
        description="List of sentences to convert",
        min_items=1,
        max_items=20
    )
    voice_type: str = Field(
        default="zh_male_shaonianzixin_uranus_bigtts",
        description="Voice type for speech synthesis"
    )
    speed_ratio: float = Field(default=1.0, description="Speech speed ratio", ge=0.1, le=3.0)
    task_id: Optional[str] = Field(None, description="Task ID for reference")
    concurrent_threads: Optional[int] = Field(
        None, 
        description="Number of concurrent threads (overrides config)",
        ge=1,
        le=10
    )
    
    @validator('voice_type')
    def validate_voice_type(cls, v):
        """验证语音类型是否有效"""
        if not v or not isinstance(v, str):
            raise ValueError('Voice type must be a non-empty string')
        return v
    
    class Config:
        json_schema_extra = {
            "example": {
                "segment_id": "segment-1",
                "sentences": [
                    {
                        "sentence_id": "sentence-1",
                        "text": "大家好，欢迎来到今天的视频教程。",
                        "order": 0
                    },
                    {
                        "sentence_id": "sentence-2",
                        "text": "今天我们要学习如何使用这个强大的视频编辑工具。",
                        "order": 1
                    }
                ],
                "voice_type": "zh_male_shaonianzixin_moon_bigtts",
                "speed_ratio": 1.0,
                "task_id": "task_123",
                "concurrent_threads": 3
            }
        }


class SentenceTTSResult(BaseModel):
    """Result for a single sentence in sentence-level TTS conversion."""
    
    sentence_id: str = Field(..., description="Sentence identifier")
    order: int = Field(..., description="Sentence order in the segment")
    success: bool = Field(..., description="Conversion success status for this sentence")
    audio_url: Optional[str] = Field(None, description="Generated audio file URL")
    duration: Optional[float] = Field(None, description="Audio duration in seconds")
    file_size: Optional[int] = Field(None, description="Audio file size in bytes")
    start_time: Optional[float] = Field(None, description="Start time in concatenated audio (seconds)")
    end_time: Optional[float] = Field(None, description="End time in concatenated audio (seconds)")
    error: Optional[str] = Field(None, description="Error message if conversion failed")
    processing_time: Optional[float] = Field(None, description="Processing time in seconds")


class SentenceBatchTTSResponse(BaseModel):
    """Response model for sentence-level batch text-to-speech conversion."""
    
    success: bool = Field(..., description="Overall batch success status")
    message: str = Field(..., description="Response message")
    segment_id: str = Field(..., description="Segment identifier")
    total_sentences: int = Field(..., description="Total number of sentences processed")
    successful_sentences: int = Field(..., description="Number of successfully processed sentences")
    failed_sentences: int = Field(..., description="Number of failed sentences")
    total_processing_time: float = Field(..., description="Total processing time in seconds")
    concatenated_audio_url: Optional[str] = Field(None, description="URL of the concatenated audio file")
    total_duration: Optional[float] = Field(None, description="Total duration of concatenated audio in seconds")
    concatenated_file_size: Optional[int] = Field(None, description="File size of concatenated audio in bytes")
    sentence_results: List[SentenceTTSResult] = Field(..., description="Individual sentence results with timing")
    
    class Config:
        json_schema_extra = {
            "example": {
                "success": True,
                "message": "句子级语音转换完成",
                "segment_id": "segment-1",
                "total_sentences": 2,
                "successful_sentences": 2,
                "failed_sentences": 0,
                "total_processing_time": 15.2,
                "concatenated_audio_url": "/api/audio/generated/segment-1_concatenated_20240101_abc123.mp3",
                "total_duration": 12.8,
                "concatenated_file_size": 205440,
                "sentence_results": [
                    {
                        "sentence_id": "sentence-1",
                        "order": 0,
                        "success": True,
                        "audio_url": "/api/audio/generated/sentence-1_20240101_abc123.mp3",
                        "duration": 5.2,
                        "file_size": 83456,
                        "start_time": 0.0,
                        "end_time": 5.2,
                        "processing_time": 6.1
                    },
                    {
                        "sentence_id": "sentence-2",
                        "order": 1,
                        "success": True,
                        "audio_url": "/api/audio/generated/sentence-2_20240101_def456.mp3",
                        "duration": 7.6,
                        "file_size": 121984,
                        "start_time": 5.2,
                        "end_time": 12.8,
                        "processing_time": 7.3
                    }
                ]
            }
        } 