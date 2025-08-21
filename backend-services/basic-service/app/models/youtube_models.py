from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from enum import Enum


class SearchOrientation(str, Enum):
    """视频方向枚举"""
    LANDSCAPE = "landscape"
    PORTRAIT = "portrait" 
    MIXED = "mixed"


class YoutubeSearchRequest(BaseModel):
    """YouTube视频搜索请求模型"""
    query: str = Field(..., min_length=1, max_length=200, description="搜索关键词")
    max_videos: int = Field(default=20, ge=1, le=50, description="最大返回视频数量")
    orientation: SearchOrientation = Field(default=SearchOrientation.MIXED, description="视频方向")
    min_duration: Optional[int] = Field(default=None, ge=0, description="最小时长（秒）")
    max_duration: Optional[int] = Field(default=None, ge=0, description="最大时长（秒）")
    min_views: Optional[int] = Field(default=None, ge=0, description="最小播放量")
    max_views: Optional[int] = Field(default=None, ge=0, description="最大播放量")


class YoutubeVideoInfo(BaseModel):
    """YouTube视频信息模型"""
    id: str = Field(..., description="视频ID")
    title: str = Field(..., description="视频标题")
    url: str = Field(..., description="视频URL")
    duration: Optional[int] = Field(default=0, description="视频时长（秒）")
    uploader: str = Field(default="Unknown", description="上传者")
    upload_date: str = Field(default="Unknown", description="上传日期")
    view_count: Optional[int] = Field(default=0, description="播放量")
    thumbnail_url: str = Field(default="", description="缩略图URL")
    description: str = Field(default="", description="视频描述")
    width: Optional[int] = Field(default=None, description="视频宽度")
    height: Optional[int] = Field(default=None, description="视频高度")


class YoutubeSearchResponse(BaseModel):
    """YouTube视频搜索响应模型"""
    success: bool = Field(..., description="搜索是否成功")
    videos: List[YoutubeVideoInfo] = Field(default=[], description="视频列表")
    total_found: int = Field(default=0, description="找到的视频总数")
    message: Optional[str] = Field(default=None, description="响应消息")
    error: Optional[str] = Field(default=None, description="错误信息")
    query: str = Field(default="", description="搜索关键词")


class YoutubeVideoDownloadRequest(BaseModel):
    """YouTube视频下载请求模型"""
    url: str = Field(..., description="YouTube视频URL")
    video_quality: str = Field(default="720p", description="视频质量")
    audio_quality: str = Field(default="best", description="音频质量")
    format_type: str = Field(default="mp4", description="输出格式")
    start_time: Optional[str] = Field(default=None, description="开始时间")
    end_time: Optional[str] = Field(default=None, description="结束时间")
    duration: Optional[str] = Field(default=None, description="持续时间")
    subtitle: bool = Field(default=False, description="是否下载字幕")


class YoutubeVideoDownloadResponse(BaseModel):
    """YouTube视频下载响应模型"""
    success: bool = Field(..., description="下载是否成功")
    message: str = Field(..., description="响应消息")
    file_path: Optional[str] = Field(default=None, description="下载文件路径")
    file_size: Optional[int] = Field(default=None, description="文件大小（字节）")
    error: Optional[str] = Field(default=None, description="错误信息")


class YoutubeVideoInfoRequest(BaseModel):
    """YouTube视频信息获取请求模型"""
    url: str = Field(..., description="YouTube视频URL")


class YoutubeVideoInfoResponse(BaseModel):
    """YouTube视频信息获取响应模型"""
    success: bool = Field(..., description="获取是否成功")
    video: Optional[YoutubeVideoInfo] = Field(default=None, description="视频信息")
    message: Optional[str] = Field(default=None, description="响应消息")
    error: Optional[str] = Field(default=None, description="错误信息")


class YoutubeVideoDownloadAndUploadRequest(BaseModel):
    """YouTube视频下载并上传请求模型"""
    url: str = Field(..., description="YouTube视频URL")
    task_id: Optional[str] = Field(default=None, description="任务ID")
    video_quality: str = Field(default="720p", description="视频质量")
    audio_quality: str = Field(default="best", description="音频质量")
    format_type: str = Field(default="mp4", description="输出格式")
    generate_thumbnail: bool = Field(default=True, description="是否生成缩略图")
    custom_filename: Optional[str] = Field(default=None, description="自定义文件名")


class YoutubeVideoDownloadAndUploadResponse(BaseModel):
    """YouTube视频下载并上传响应模型"""
    success: bool = Field(..., description="操作是否成功")
    message: str = Field(..., description="响应消息")
    video_url: Optional[str] = Field(default=None, description="Supabase视频URL")
    thumbnail_url: Optional[str] = Field(default=None, description="缩略图URL")
    file_size: Optional[int] = Field(default=None, description="文件大小（字节）")
    duration: Optional[float] = Field(default=None, description="视频时长（秒）")
    width: Optional[int] = Field(default=None, description="视频宽度")
    height: Optional[int] = Field(default=None, description="视频高度")
    original_youtube_url: Optional[str] = Field(default=None, description="原始YouTube URL")
    error: Optional[str] = Field(default=None, description="错误信息") 