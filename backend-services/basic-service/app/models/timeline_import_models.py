"""
Timeline Import related Pydantic models for request/response validation.
"""

from pydantic import BaseModel, Field, ConfigDict, validator
from typing import List, Optional, Any, Dict

from .timeline_export_models import (
    TimelineExportDataModel,
    ExportMetadataModel,
    TimelineStateModel,
    MaterialModel
)


class TimelineImportRequest(BaseModel):
    """时间轴导入请求模型"""
    model_config = ConfigDict(populate_by_name=True)
    
    task_id: str = Field(..., alias="taskId", description="任务ID", min_length=1)
    import_data: TimelineExportDataModel = Field(..., alias="importData", description="要导入的时间轴数据")
    merge_mode: Optional[str] = Field("replace", alias="mergeMode", description="合并模式：replace（替换）, append（追加）")
    preserve_ids: Optional[bool] = Field(True, alias="preserveIds", description="是否保留原始ID")
    
    @validator('merge_mode')
    def validate_merge_mode(cls, v):
        if v not in ['replace', 'append']:
            raise ValueError('merge_mode must be either "replace" or "append"')
        return v


class TimelineImportValidationResult(BaseModel):
    """时间轴导入验证结果"""
    is_valid: bool = Field(..., alias="isValid", description="是否有效")
    errors: List[str] = Field(default_factory=list, description="验证错误列表")
    warnings: List[str] = Field(default_factory=list, description="验证警告列表")
    metadata: Optional[ExportMetadataModel] = Field(None, description="导入文件的元数据")
    track_count: Optional[int] = Field(None, alias="trackCount", description="轨道数量")
    item_count: Optional[int] = Field(None, alias="itemCount", description="项目数量")
    material_count: Optional[int] = Field(None, alias="materialCount", description="素材数量")


class ProcessedImportData(BaseModel):
    """处理后的导入数据"""
    model_config = ConfigDict(populate_by_name=True)
    
    timeline_state: TimelineStateModel = Field(..., alias="timelineState", description="处理后的时间轴状态")
    materials: List[MaterialModel] = Field(..., description="处理后的素材列表")
    id_mappings: Dict[str, str] = Field(default_factory=dict, alias="idMappings", description="ID映射关系（原始ID -> 新ID）")
    processing_notes: List[str] = Field(default_factory=list, alias="processingNotes", description="处理过程中的注意事项")


class TimelineImportResponse(BaseModel):
    """时间轴导入响应模型"""
    model_config = ConfigDict(populate_by_name=True)
    
    success: bool = Field(..., description="是否成功")
    message: str = Field(..., description="响应消息")
    validation_result: Optional[TimelineImportValidationResult] = Field(None, alias="validationResult", description="验证结果")
    imported_data: Optional[ProcessedImportData] = Field(None, alias="importedData", description="导入的数据")
    statistics: Optional[Dict[str, Any]] = Field(None, description="导入统计信息")
    details: Optional[Dict[str, Any]] = Field(None, description="额外的详细信息")


class TimelineImportErrorResponse(BaseModel):
    """时间轴导入错误响应模型"""
    success: bool = Field(False, description="是否成功")
    message: str = Field(..., description="错误消息")
    error_code: Optional[str] = Field(None, description="错误代码")
    validation_errors: Optional[List[str]] = Field(None, alias="validationErrors", description="验证错误列表")
    details: Optional[Dict[str, Any]] = Field(None, description="错误详细信息")


class ImportFileUploadRequest(BaseModel):
    """导入文件上传请求模型"""
    model_config = ConfigDict(populate_by_name=True)
    
    task_id: str = Field(..., alias="taskId", description="任务ID", min_length=1)
    file_content: str = Field(..., alias="fileContent", description="JSON文件内容")
    file_name: Optional[str] = Field(None, alias="fileName", description="原始文件名")
    merge_mode: Optional[str] = Field("replace", alias="mergeMode", description="合并模式")
    preserve_ids: Optional[bool] = Field(True, alias="preserveIds", description="是否保留原始ID")