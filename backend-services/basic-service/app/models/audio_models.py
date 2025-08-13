"""
Audio transcription models for the Basic Service API.
"""

from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
from datetime import datetime


class SubtitleItem(BaseModel):
    """单个字幕项目模型"""
    start_time: int = Field(..., description="开始时间（毫秒）")
    end_time: int = Field(..., description="结束时间（毫秒）")
    text: str = Field(..., description="字幕文本内容")


class AudioTranscriptionRequest(BaseModel):
    """音频转字幕请求模型"""
    language: str = Field(default="zh-CN", description="语言代码，默认中文")
    use_itn: bool = Field(default=True, description="是否使用逆文本规范化")
    use_punc: bool = Field(default=False, description="是否使用标点符号")
    max_lines: int = Field(default=2, description="最大行数")
    words_per_line: int = Field(default=15, description="每行最大字数")
    generate_srt_file: bool = Field(default=True, description="是否生成SRT字幕文件")


class AudioTranscriptionResponse(BaseModel):
    """音频转字幕成功响应模型"""
    success: bool = Field(True, description="请求是否成功")
    message: str = Field(default="音频转字幕成功", description="响应消息")
    job_id: str = Field(..., description="任务ID")
    subtitles: List[SubtitleItem] = Field(..., description="字幕列表")
    srt_content: Optional[str] = Field(None, description="SRT格式字幕内容")
    srt_file_path: Optional[str] = Field(None, description="SRT文件路径")
    srt_file_url: Optional[str] = Field(None, description="SRT文件访问URL")
    processing_time: float = Field(..., description="处理时间（秒）")
    audio_duration: Optional[float] = Field(None, description="音频时长（秒）")
    created_at: datetime = Field(default_factory=datetime.now, description="创建时间")


class AudioTranscriptionErrorResponse(BaseModel):
    """音频转字幕错误响应模型"""
    success: bool = Field(False, description="请求是否成功")
    error: str = Field(..., description="错误信息")
    error_code: Optional[str] = Field(None, description="错误代码")
    details: Optional[Dict[str, Any]] = Field(None, description="错误详情")
    created_at: datetime = Field(default_factory=datetime.now, description="创建时间")


class AudioTranscriptionStatus(BaseModel):
    """音频转字幕状态查询响应模型"""
    job_id: str = Field(..., description="任务ID")
    status: str = Field(..., description="任务状态：processing, completed, failed")
    progress: Optional[int] = Field(None, description="处理进度（0-100）")
    message: Optional[str] = Field(None, description="状态消息")
    created_at: datetime = Field(default_factory=datetime.now, description="创建时间") 