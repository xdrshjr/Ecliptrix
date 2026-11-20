from pydantic import BaseModel, Field, field_validator, model_validator
from pydantic_core import PydanticCustomError
import re
from urllib.parse import urlsplit, parse_qs
from typing import Dict, List, Optional
from enum import Enum
from dataclasses import dataclass, field


class SearchOrientation(str, Enum):
    """视频方向枚举"""
    LANDSCAPE = "landscape"
    PORTRAIT = "portrait" 
    MIXED = "mixed"


class YoutubeSearchRequest(BaseModel):
    """YouTube视频搜索请求模型"""
    query: str = Field(..., min_length=1, max_length=200, description="搜索关键词")
    max_videos: int = Field(default=20, ge=1, le=100, description="最大返回视频数量")
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


_YOUTUBE_HOSTS = ('youtube.com', 'www.youtube.com', 'm.youtube.com',
                  'youtu.be', 'music.youtube.com')


def _invalid_url(detail):
    # 必须是 PydanticCustomError：裸 ValueError 会进 ctx.error，使 422 载荷不可
    # JSON 序列化，最终被平台处理器变成 500。
    return PydanticCustomError('youtube_invalid_url', detail)


def youtube_watch_url(value):
    """把任意 YouTube 入口收敛成固定 watch URL；拒绝其它主机、端口和凭据。"""
    try:
        parsed = urlsplit(value)
        host, port = parsed.hostname, parsed.port
    except ValueError:
        # urlsplit 对非法 IPv6 直接抛错，越界端口在 .port 上抛错；都按非法入口处理。
        raise _invalid_url('请提供有效的 YouTube 视频 URL') from None
    if (parsed.scheme not in ('http', 'https') or host not in _YOUTUBE_HOSTS
            or parsed.username or parsed.password or port not in (None, 80, 443)):
        raise _invalid_url('请提供有效的 YouTube 视频 URL')
    parts = parsed.path.strip('/').split('/')
    video_id = parts[0] if parsed.hostname == 'youtu.be' else (
        parts[1] if len(parts) == 2 and parts[0] in ('shorts', 'live', 'embed') else
        parse_qs(parsed.query).get('v', [''])[0] if parsed.path == '/watch' else '')
    if not re.fullmatch(r'[A-Za-z0-9_-]{11}', video_id):
        raise _invalid_url('请提供包含 11 位视频 ID 的 YouTube URL')
    return f'https://www.youtube.com/watch?v={video_id}'


class YoutubeMediaParameters(BaseModel):
    @field_validator('url', check_fields=False)
    @classmethod
    def youtube_url(cls, value):
        return youtube_watch_url(value)

    @field_validator('video_quality', check_fields=False)
    @classmethod
    def video_quality_value(cls, value):
        if value not in ('best', 'worst') and not re.fullmatch(r'[1-9][0-9]{1,3}p', value):
            raise PydanticCustomError('youtube_invalid_video_quality', '无效的视频质量')
        return value

    @field_validator('audio_quality', check_fields=False)
    @classmethod
    def audio_quality_value(cls, value):
        if value not in ('best', 'worst') and not re.fullmatch(r'[1-9][0-9]{1,2}k', value):
            raise PydanticCustomError('youtube_invalid_audio_quality', '无效的音频质量')
        return value

    @field_validator('format_type', check_fields=False)
    @classmethod
    def format_value(cls, value):
        if value not in ('mp4', 'webm', 'mkv'):
            raise PydanticCustomError('youtube_invalid_format', '不支持的输出格式')
        return value

    @field_validator('start_time', 'end_time', 'duration', check_fields=False)
    @classmethod
    def time_value(cls, value):
        if value is not None and not re.fullmatch(r'\d+(?::[0-5]\d){0,2}(?:\.\d+)?', value):
            raise PydanticCustomError('youtube_invalid_time', '无效的时间参数')
        return value

    @model_validator(mode='after')
    def time_range(self):
        def seconds(value):
            total = 0.0
            for part in (value or '0').split(':'):
                total = total * 60 + float(part)
            return total
        if getattr(self, 'end_time', None) and seconds(self.end_time) <= seconds(self.start_time):
            raise PydanticCustomError('youtube_invalid_time', '结束时间必须大于开始时间')
        if getattr(self, 'duration', None) and seconds(self.duration) <= 0:
            raise PydanticCustomError('youtube_invalid_time', '持续时间必须大于零')
        return self


class YoutubeVideoDownloadRequest(YoutubeMediaParameters):
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
    has_audio: Optional[bool] = Field(default=None, description="源视频及最终文件是否包含音轨")


class YoutubeVideoInfoRequest(YoutubeMediaParameters):
    """YouTube视频信息获取请求模型"""
    url: str = Field(..., description="YouTube视频URL")


class YoutubeVideoInfoResponse(BaseModel):
    """YouTube视频信息获取响应模型"""
    success: bool = Field(..., description="获取是否成功")
    video: Optional[YoutubeVideoInfo] = Field(default=None, description="视频信息")
    message: Optional[str] = Field(default=None, description="响应消息")
    error: Optional[str] = Field(default=None, description="错误信息")


class YoutubeVideoDownloadAndUploadRequest(YoutubeMediaParameters):
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
    has_audio: Optional[bool] = Field(default=None, description="源视频及最终文件是否包含音轨")


@dataclass
class YoutubePreviewStream:
    """左侧预览用的渐进式（音视频合流）直链解析结果（进程内内存缓存条目）。

    仅用于「后端回代字节 → 前端同源 <video> 预览」链路，不落库、不进合成请求。
    ``http_headers`` 必须取自所选 format 的 ``fmt['http_headers']``（含匹配该
    客户端的 UA 等），回代 googlevideo 直链时原样透传；不要用顶层桌面 UA，
    否则字节回代阶段会 403（详见 spec §2.2 / §8 P1-1）。
    """
    url: str                                          # googlevideo 直链
    http_headers: Dict[str, str] = field(default_factory=dict)
    content_type: str = "video/mp4"                   # 如 "video/mp4"
    ext: str = "mp4"                                   # "mp4" / "webm"
    filesize: Optional[int] = None                    # 可能为 None（approx）
    expire_at: float = 0.0                             # time.time() + TTL，过期即重解析
    local_path: Optional[str] = None
    identity: str = ""
    proxy: Optional[str] = None
