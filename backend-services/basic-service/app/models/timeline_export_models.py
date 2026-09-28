"""
Timeline Export related Pydantic models for request/response validation.
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Any, Dict


class TimelineItemModel(BaseModel):
    """时间轴项目模型"""
    model_config = ConfigDict(populate_by_name=True)
    
    id: str = Field(..., description="项目唯一标识符")
    name: str = Field(..., description="项目名称")
    type: str = Field(..., description="项目类型：video, audio, subtitle")
    start_time: float = Field(..., alias="startTime", description="开始时间（秒）")
    duration: float = Field(..., description="持续时间（秒）")
    track_id: str = Field(..., alias="trackId", description="所属轨道ID")
    color: str = Field(..., description="显示颜色")
    thumbnail_url: Optional[str] = Field(None, alias="thumbnailUrl", description="缩略图URL")
    waveform_data: Optional[List[float]] = Field(None, alias="waveformData", description="波形数据")
    text: Optional[str] = Field(None, description="文本内容（字幕用）")
    material_id: Optional[str] = Field(None, alias="materialId", description="关联的素材ID")
    volume: Optional[float] = Field(None, description="音量 (0-1)")
    opacity: Optional[float] = Field(None, description="透明度 (0-1)")
    is_selected: Optional[bool] = Field(None, alias="isSelected", description="是否选中")
    clip_start: Optional[float] = Field(None, alias="clipStart", description="原始素材中的开始时间（秒）")
    clip_end: Optional[float] = Field(None, alias="clipEnd", description="原始素材中的结束时间（秒）")
    original_duration: Optional[float] = Field(None, alias="originalDuration", description="原始素材的总时长（秒）")
    original_material_type: Optional[str] = Field(None, alias="originalMaterialType", description="原始素材类型")
    subtitle_style: Optional[Dict[str, Any]] = Field(None, alias="subtitleStyle", description="字幕样式")
    image_position: Optional[Dict[str, Any]] = Field(None, alias="imagePosition", description="图片位置信息")
    metadata: Optional[Dict[str, Any]] = None
    url: Optional[str] = None
    server_url: Optional[str] = Field(None, alias="serverUrl")


class TrackModel(BaseModel):
    """轨道模型"""
    model_config = ConfigDict(populate_by_name=True)
    
    id: str = Field(..., description="轨道唯一标识符")
    name: str = Field(..., description="轨道名称")
    type: str = Field(..., description="轨道类型：video, audio, subtitle")
    height: int = Field(..., description="轨道高度（像素）")
    is_locked: bool = Field(..., alias="isLocked", description="是否锁定")
    is_muted: bool = Field(..., alias="isMuted", description="是否静音")
    is_visible: bool = Field(..., alias="isVisible", description="是否可见")
    volume: float = Field(..., description="音量大小（0-200）")
    order: int = Field(..., description="轨道顺序")
    items: List[TimelineItemModel] = Field(default_factory=list, description="轨道中的项目列表")


class TimelineStateModel(BaseModel):
    """时间轴状态模型"""
    model_config = ConfigDict(populate_by_name=True)
    
    current_time: float = Field(..., alias="currentTime", description="当前播放时间（秒）")
    total_duration: float = Field(..., alias="totalDuration", description="总时长（秒）")
    zoom_level: float = Field(..., alias="zoomLevel", description="缩放级别 (0.1 - 5.0)")
    selected_items: List[str] = Field(default_factory=list, alias="selectedItems", description="选中的项目ID数组")
    tracks: List[TrackModel] = Field(..., description="轨道列表")
    playback_rate: float = Field(..., alias="playbackRate", description="播放速度")
    is_playing: bool = Field(..., alias="isPlaying", description="是否正在播放")
    snap_to_grid: bool = Field(..., alias="snapToGrid", description="是否吸附到网格")
    grid_size: float = Field(..., alias="gridSize", description="网格大小（秒）")
    scroll_left: float = Field(..., alias="scrollLeft", description="水平滚动位置（像素）")


class MaterialModel(BaseModel):
    """素材模型"""
    model_config = ConfigDict(populate_by_name=True)
    
    id: str = Field(..., description="素材唯一标识符")
    name: str = Field(..., description="素材名称")
    type: str = Field(..., description="素材类型")
    format: str = Field(..., description="文件格式")
    size: int = Field(..., description="文件大小（字节）")
    duration: Optional[float] = Field(None, description="时长（秒）")
    width: Optional[int] = Field(None, description="宽度（像素）")
    height: Optional[int] = Field(None, description="高度（像素）")
    thumbnail_url: Optional[str] = Field(None, alias="thumbnailUrl", description="缩略图URL")
    url: str = Field(..., description="文件URL")
    server_url: Optional[str] = Field(None, alias="serverUrl", description="服务器文件URL")
    created_at: str = Field(..., alias="createdAt", description="创建时间ISO字符串")
    tags: Optional[List[str]] = Field(None, description="标签列表")
    description: Optional[str] = Field(None, description="描述信息")
    metadata: Optional[Dict[str, Any]] = Field(None, description="额外元数据")


class ExportMetadataModel(BaseModel):
    """导出元数据模型"""
    model_config = ConfigDict(populate_by_name=True)
    
    exported_at: str = Field(..., alias="exportedAt", description="导出时间ISO字符串")
    version: str = Field(..., description="导出格式版本")
    task_id: str = Field(..., alias="taskId", description="任务ID")
    total_duration: float = Field(..., alias="totalDuration", description="总时长")
    track_count: int = Field(..., alias="trackCount", description="轨道数量")
    item_count: int = Field(..., alias="itemCount", description="项目数量")
    cover_schema_version: Optional[int] = Field(None, alias="coverSchemaVersion")


class TimelineExportDataModel(BaseModel):
    """时间轴导出数据模型"""
    metadata: ExportMetadataModel = Field(..., description="导出元数据")
    timeline: Dict[str, Any] = Field(..., description="时间轴状态数据")
    tracks: List[Dict[str, Any]] = Field(..., description="轨道数据")
    materials: List[Dict[str, Any]] = Field(..., description="素材数据")


class TimelineExportRequest(BaseModel):
    """时间轴导出请求模型"""
    model_config = ConfigDict(populate_by_name=True)
    
    task_id: str = Field(..., alias="taskId", description="任务ID", min_length=1)
    cover_schema_version: Optional[int] = Field(None, alias="coverSchemaVersion")
    timeline_state: TimelineStateModel = Field(..., alias="timelineState", description="时间轴状态")
    materials: List[MaterialModel] = Field(default_factory=list, description="素材列表")
    export_data: Optional[TimelineExportDataModel] = Field(None, alias="exportData", description="预处理的导出数据")


class TimelineExportResponse(BaseModel):
    """时间轴导出响应模型"""
    model_config = ConfigDict(populate_by_name=True)
    
    success: bool = Field(..., description="是否成功")
    message: str = Field(..., description="响应消息")
    file_name: Optional[str] = Field(None, alias="fileName", description="生成的文件名")
    download_url: Optional[str] = Field(None, alias="downloadUrl", description="下载链接")
    data: Optional[TimelineExportDataModel] = Field(None, description="导出的数据")
    details: Optional[Dict[str, Any]] = Field(None, description="额外的详细信息")


class TimelineExportErrorResponse(BaseModel):
    """时间轴导出错误响应模型"""
    success: bool = Field(False, description="是否成功")
    message: str = Field(..., description="错误消息")
    error_code: Optional[str] = Field(None, description="错误代码")
    details: Optional[Dict[str, Any]] = Field(None, description="错误详细信息")
