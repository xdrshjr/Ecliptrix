"""
Timeline Import Service for handling timeline data import functionality.
"""

import json
import uuid
import copy
from datetime import datetime
from typing import Dict, Any, List

from app.models.timeline_import_models import (
    TimelineImportRequest,
    TimelineImportResponse,
    TimelineImportValidationResult,
    ProcessedImportData,
    ImportFileUploadRequest
)
from app.models.timeline_export_models import (
    TimelineExportDataModel,
    ExportMetadataModel,
    TimelineStateModel,
    MaterialModel
)
from app.logger import get_logger
from app.models.video_cover_v2_models import CoverError, ImportCoverRequest

logger = get_logger(__name__)


class TimelineImportService:
    """时间轴导入服务"""
    
    def __init__(self):
        logger.info("TimelineImportService initialized", {
            "service": "timeline_import",
            "timestamp": datetime.now().isoformat()
        })

    async def validate_import_file(self, file_content: str, task_id: str) -> TimelineImportValidationResult:
        """
        验证导入的JSON文件格式和内容
        
        Args:
            file_content: JSON文件内容字符串
            task_id: 任务ID
            
        Returns:
            TimelineImportValidationResult: 验证结果
        """
        try:
            logger.info("开始验证导入文件", {
                "task_id": task_id,
                "file_size": len(file_content),
                "timestamp": datetime.now().isoformat()
            })

            errors = []
            warnings = []
            
            # 1. 验证JSON格式
            try:
                data = json.loads(file_content)
            except json.JSONDecodeError as e:
                errors.append(f"JSON格式错误: {str(e)}")
                return TimelineImportValidationResult(
                    is_valid=False,
                    errors=errors,
                    warnings=warnings
                )

            # 2. 验证必需的顶级字段
            required_fields = ['metadata', 'timeline', 'tracks', 'materials']
            for field in required_fields:
                if field not in data:
                    errors.append(f"缺少必需字段: {field}")

            if errors:
                return TimelineImportValidationResult(
                    is_valid=False,
                    errors=errors,
                    warnings=warnings
                )

            # 3. 验证元数据
            metadata = data.get('metadata', {})
            metadata_validation = self._validate_metadata(metadata)
            errors.extend(metadata_validation['errors'])
            warnings.extend(metadata_validation['warnings'])

            # 4. 验证时间轴数据
            timeline = data.get('timeline', {})
            timeline_validation = self._validate_timeline(timeline)
            errors.extend(timeline_validation['errors'])
            warnings.extend(timeline_validation['warnings'])

            # 5. 验证轨道数据
            tracks = data.get('tracks', [])
            tracks_validation = self._validate_tracks(tracks)
            errors.extend(tracks_validation['errors'])
            warnings.extend(tracks_validation['warnings'])

            # 6. 验证素材数据
            materials = data.get('materials', [])
            materials_validation = self._validate_materials(materials)
            errors.extend(materials_validation['errors'])
            warnings.extend(materials_validation['warnings'])

            # 7. 验证数据一致性
            consistency_validation = self._validate_data_consistency(data)
            errors.extend(consistency_validation['errors'])
            warnings.extend(consistency_validation['warnings'])

            is_valid = len(errors) == 0
            
            # 提取统计信息
            track_count = len(tracks)
            item_count = sum(len(track.get('items', [])) for track in tracks)
            material_count = len(materials)

            logger.info("导入文件验证完成", {
                "task_id": task_id,
                "is_valid": is_valid,
                "error_count": len(errors),
                "warning_count": len(warnings),
                "track_count": track_count,
                "item_count": item_count,
                "material_count": material_count
            })

            return TimelineImportValidationResult(
                isValid=is_valid,
                errors=errors,
                warnings=warnings,
                metadata=ExportMetadataModel(**metadata) if is_valid and metadata else None,
                trackCount=track_count,
                itemCount=item_count,
                materialCount=material_count
            )

        except Exception as e:
            logger.error("验证导入文件时发生异常", {
                "task_id": task_id,
                "error": str(e),
                "error_type": type(e).__name__
            }, exc_info=True)
            
            return TimelineImportValidationResult(
                isValid=False,
                errors=[f"验证过程中发生异常: {str(e)}"],
                warnings=[]
            )

    async def import_timeline_from_json(self, request: TimelineImportRequest) -> TimelineImportResponse:
        """
        从JSON数据导入时间轴
        
        Args:
            request: 时间轴导入请求
            
        Returns:
            TimelineImportResponse: 导入响应
        """
        try:
            logger.info("开始处理时间轴导入请求", {
                "task_id": request.task_id,
                "merge_mode": request.merge_mode,
                "preserve_ids": request.preserve_ids,
                "timestamp": datetime.now().isoformat()
            })

            # 1. 验证导入数据
            import_data = request.import_data.model_copy(deep=True)
            await self._rebind_cover_references(import_data, request)
            validation_result = await self._validate_import_data(import_data, request.task_id)
            
            if not validation_result.is_valid:
                logger.error("导入数据验证失败", {
                    "task_id": request.task_id,
                    "errors": validation_result.errors
                })
                return TimelineImportResponse(
                    success=False,
                    message="导入数据验证失败",
                    validation_result=validation_result
                )

            # 2. 处理导入数据
            processed_data = await self._process_import_data(import_data, request)
            
            # 3. 生成统计信息
            statistics = self._generate_import_statistics(processed_data, import_data)

            logger.info("时间轴导入成功", {
                "task_id": request.task_id,
                "track_count": len(processed_data.timeline_state.tracks),
                "material_count": len(processed_data.materials),
                "id_mappings_count": len(processed_data.id_mappings),
                "statistics": statistics
            })

            return TimelineImportResponse(
                success=True,
                message="时间轴导入成功",
                validation_result=validation_result,
                imported_data=processed_data,
                statistics=statistics
            )

        except CoverError:
            raise
        except Exception as e:
            logger.error("处理时间轴导入时发生异常", {
                "task_id": request.task_id,
                "error": str(e),
                "error_type": type(e).__name__
            }, exc_info=True)
            
            return TimelineImportResponse(
                success=False,
                message=f"导入过程中发生异常: {str(e)}",
                details={"error_type": type(e).__name__}
            )

    async def process_file_upload(self, request: ImportFileUploadRequest) -> TimelineImportResponse:
        """
        处理文件上传并导入
        
        Args:
            request: 文件上传请求
            
        Returns:
            TimelineImportResponse: 导入响应
        """
        try:
            logger.info("开始处理文件上传导入", {
                "task_id": request.task_id,
                "file_name": request.file_name,
                "file_size": len(request.file_content),
                "merge_mode": request.merge_mode
            })

            # 1. 验证文件内容
            validation_result = await self.validate_import_file(request.file_content, request.task_id)
            
            if not validation_result.is_valid:
                return TimelineImportResponse(
                    success=False,
                    message="上传的文件格式不正确",
                    validation_result=validation_result
                )

            # 2. 解析JSON数据
            try:
                json_data = json.loads(request.file_content)
                import_data = TimelineExportDataModel(**json_data)
            except Exception as e:
                logger.error("解析JSON数据失败", {
                    "task_id": request.task_id,
                    "error": str(e)
                })
                return TimelineImportResponse(
                    success=False,
                    message=f"解析JSON数据失败: {str(e)}",
                    validation_result=validation_result
                )

            # 3. 创建导入请求
            import_request = TimelineImportRequest(
                task_id=request.task_id,
                project_id=request.project_id,
                import_data=import_data,
                merge_mode=request.merge_mode,
                preserve_ids=request.preserve_ids
            )

            # 4. 执行导入
            return await self.import_timeline_from_json(import_request)

        except CoverError:
            raise
        except Exception as e:
            logger.error("处理文件上传导入时发生异常", {
                "task_id": request.task_id,
                "error": str(e),
                "error_type": type(e).__name__
            }, exc_info=True)
            
            return TimelineImportResponse(
                success=False,
                message=f"文件上传处理异常: {str(e)}",
                details={"error_type": type(e).__name__}
            )

    def _validate_metadata(self, metadata: Dict[str, Any]) -> Dict[str, List[str]]:
        """验证元数据"""
        errors = []
        warnings = []
        
        metadata = dict(metadata)
        for snake, camel in {"exported_at": "exportedAt", "task_id": "taskId",
            "total_duration": "totalDuration", "track_count": "trackCount",
            "item_count": "itemCount"}.items():
            if camel in metadata:
                metadata[snake] = metadata[camel]
        required_fields = ['exported_at', 'version', 'task_id', 'total_duration', 'track_count', 'item_count']
        for field in required_fields:
            if field not in metadata:
                errors.append(f"元数据缺少字段: {field}")
        
        # 检查版本兼容性
        version = metadata.get('version', '')
        if version and not version.startswith('1.'):
            warnings.append(f"版本 {version} 可能不完全兼容，建议使用版本 1.x")
        
        return {"errors": errors, "warnings": warnings}

    def _validate_timeline(self, timeline: Dict[str, Any]) -> Dict[str, List[str]]:
        """验证时间轴数据"""
        errors = []
        warnings = []
        
        timeline = dict(timeline)
        for snake, camel in {"current_time": "currentTime",
            "total_duration": "totalDuration", "zoom_level": "zoomLevel"}.items():
            if snake in timeline:
                timeline[camel] = timeline[snake]
        required_fields = ['currentTime', 'totalDuration', 'zoomLevel']
        for field in required_fields:
            if field not in timeline:
                errors.append(f"时间轴数据缺少字段: {field}")
        
        # 验证数值范围
        if 'zoomLevel' in timeline:
            zoom = timeline['zoomLevel']
            if not isinstance(zoom, (int, float)) or zoom <= 0:
                errors.append("缩放级别必须是大于0的数值")
        
        if 'totalDuration' in timeline:
            duration = timeline['totalDuration']
            if not isinstance(duration, (int, float)) or duration < 0:
                errors.append("总时长必须是非负数值")
        
        return {"errors": errors, "warnings": warnings}

    def _validate_tracks(self, tracks: List[Dict[str, Any]]) -> Dict[str, List[str]]:
        """验证轨道数据"""
        errors = []
        warnings = []
        
        if not isinstance(tracks, list):
            errors.append("轨道数据必须是数组")
            return {"errors": errors, "warnings": warnings}
        
        track_ids = set()
        for i, track in enumerate(tracks):
            if not isinstance(track, dict):
                errors.append(f"轨道 {i} 必须是对象")
                continue
            
            # 检查必需字段
            required_fields = ['id', 'name', 'type', 'height']
            for field in required_fields:
                if field not in track:
                    errors.append(f"轨道 {i} 缺少字段: {field}")
            
            # 检查ID唯一性
            track_id = track.get('id')
            if track_id:
                if track_id in track_ids:
                    errors.append(f"轨道ID重复: {track_id}")
                track_ids.add(track_id)
            
            # 验证轨道类型
            track_type = track.get('type')
            if track_type and track_type not in ['video', 'audio', 'subtitle']:
                warnings.append(f"轨道 {i} 类型 '{track_type}' 可能不支持")
        
        return {"errors": errors, "warnings": warnings}

    def _validate_materials(self, materials: List[Dict[str, Any]]) -> Dict[str, List[str]]:
        """验证素材数据"""
        errors = []
        warnings = []
        
        if not isinstance(materials, list):
            errors.append("素材数据必须是数组")
            return {"errors": errors, "warnings": warnings}
        
        material_ids = set()
        for i, material in enumerate(materials):
            if not isinstance(material, dict):
                errors.append(f"素材 {i} 必须是对象")
                continue
            
            # 检查必需字段
            required_fields = ['id', 'name', 'type', 'url']
            for field in required_fields:
                if field not in material:
                    errors.append(f"素材 {i} 缺少字段: {field}")
            
            # 检查ID唯一性
            material_id = material.get('id')
            if material_id:
                if material_id in material_ids:
                    errors.append(f"素材ID重复: {material_id}")
                material_ids.add(material_id)
        
        return {"errors": errors, "warnings": warnings}

    def _validate_data_consistency(self, data: Dict[str, Any]) -> Dict[str, List[str]]:
        """验证数据一致性"""
        errors = []
        warnings = []
        
        tracks = data.get('tracks', [])
        materials = data.get('materials', [])
        
        # 收集所有素材ID
        material_ids = {m.get('id') for m in materials if m.get('id')}
        
        # 检查轨道项目引用的素材是否存在
        for track in tracks:
            items = track.get('items', [])
            for item in items:
                material_id = item.get('materialId')
                if material_id and material_id not in material_ids:
                    warnings.append(f"项目 {item.get('id', 'unknown')} 引用的素材 {material_id} 不存在")
        
        return {"errors": errors, "warnings": warnings}

    async def _validate_import_data(self, import_data: TimelineExportDataModel, task_id: str) -> TimelineImportValidationResult:
        """验证导入数据模型"""
        errors = []
        warnings = []
        
        try:
            # 基本验证已通过Pydantic模型完成
            track_count = len(import_data.tracks)
            item_count = sum(len(track.get('items', [])) for track in import_data.tracks)
            material_count = len(import_data.materials)
            
            logger.info("导入数据验证通过", {
                "task_id": task_id,
                "track_count": track_count,
                "item_count": item_count,
                "material_count": material_count
            })
            
            return TimelineImportValidationResult(
                isValid=True,
                errors=errors,
                warnings=warnings,
                metadata=import_data.metadata,
                trackCount=track_count,
                itemCount=item_count,
                materialCount=material_count
            )
            
        except Exception as e:
            errors.append(f"数据模型验证失败: {str(e)}")
            return TimelineImportValidationResult(
                isValid=False,
                errors=errors,
                warnings=warnings
            )

    async def _rebind_cover_references(self, data, request) -> None:
        from app.database import async_session_factory
        from app.services import video_cover_v2_service as covers
        from app.services import video_cover_asset_service as assets
        marked = [(track, item) for track in data.tracks
                  for item in track.get("items", [])
                  if (item.get("metadata") or {}).get("role") == "video-cover"]
        if not marked:
            return
        if not request.project_id:
            raise CoverError("COVER_PROJECT_CHANGED", "导入封面需要目标项目", 422)
        if len(marked) > 1:
            raise CoverError("COVER_TIMELINE_CONFLICT", "导入数据包含多个封面", 409)
        async with async_session_factory() as db:
            await assets.require_project(db, request.project_id)
            for track, item in marked:
                material_id = item.get("materialId", item.get("material_id"))
                if len(track.get("items", [])) != 1 or not any(
                    material.get("id") == material_id for material in data.materials
                ):
                    raise CoverError("COVER_TIMELINE_CONFLICT", "封面轨道或素材引用不完整", 409)
                ref = (item.get("metadata") or {}).get("cover", {})
                try:
                    source = str(uuid.UUID(ref["projectId"]))
                    source_revision = str(uuid.UUID(ref["revisionId"]))
                except (KeyError, ValueError, TypeError) as exc:
                    raise CoverError("COVER_ASSET_MISSING", "封面引用不完整", 422) from exc
                if source != request.project_id:
                    resolved = await covers.import_revision(db, request.project_id,
                        ImportCoverRequest(request_id=f"import:{source}:{source_revision}",
                            source_project_id=source, source_revision_id=source_revision))
                else:
                    async with assets.project_locks(source):
                        await assets.require_project(db, source)
                        row = await covers.get_revision(db, source, source_revision)
                        asset = await assets.get_asset(db, source, row.asset_id)
                        await assets.verify_asset(asset)
                        resolved = await covers.revision_data(db, row)
                self._apply_imported_cover(data, track, item, resolved, request)
        if request.merge_mode == "replace":
            data.metadata.cover_schema_version = 2

    def _apply_imported_cover(self, data, track, item, revision, request) -> None:
        old_material = item.get("materialId", item.get("material_id"))
        append = request.merge_mode == "append"
        material_id = f"cover-material:{revision['id']}"
        metadata = copy.deepcopy(item.get("metadata") or {})
        reference = {"schemaVersion": 2, "projectId": request.project_id,
            "revisionId": revision["id"], "assetId": revision["asset_id"],
            "sha256": revision["sha256"]}
        metadata["cover"] = reference
        if append:
            metadata.pop("role", None)
            metadata["coverProvenance"] = metadata.pop("cover")
        track_id = (f"image-track-import:{uuid.uuid4()}" if append else
                    f"image-track-cover:{request.project_id}")
        track["id"] = track_id
        item.update(id=(f"image-clip:{uuid.uuid4()}" if append else
                        f"cover-clip:{request.project_id}"),
                    trackId=track_id, materialId=material_id,
                    metadata=metadata, url=revision["url"],
                    serverUrl=revision["url"], thumbnailUrl=revision["url"])
        for material in data.materials:
            if material["id"] == old_material:
                material.update(id=material_id, url=revision["url"],
                    serverUrl=revision["url"], thumbnailUrl=revision["url"],
                    metadata=copy.deepcopy(metadata))
        self._rebind_shared_cover_material(data, old_material, material_id,
                                          revision["url"])

    def _rebind_shared_cover_material(self, data, old_id, new_id, url) -> None:
        # 同一成品也可能被正文普通图片复用，素材改名必须更新所有使用者。
        for track in data.tracks:
            for item in track.get("items", []):
                if item.get("materialId", item.get("material_id")) != old_id:
                    continue
                item.pop("material_id", None)
                item.update(materialId=new_id, url=url,
                            serverUrl=url, thumbnailUrl=url)

    async def _process_import_data(self, import_data: TimelineExportDataModel, request: TimelineImportRequest) -> ProcessedImportData:
        """处理导入数据"""
        id_mappings = {}
        processing_notes = []
        
        # 处理时间轴状态
        timeline_dict = dict(import_data.timeline)
        
        # 处理轨道和项目
        processed_tracks = []
        for track_data in import_data.tracks:
            track_dict = dict(track_data)
            
            # 处理ID映射
            is_cover_track = track_dict['id'].startswith('image-track-cover:')
            if not request.preserve_ids and not is_cover_track:
                old_id = track_dict['id']
                new_id = f"track_{uuid.uuid4().hex[:8]}"
                track_dict['id'] = new_id
                id_mappings[old_id] = new_id
                processing_notes.append(f"轨道ID {old_id} -> {new_id}")
            
            # 处理轨道项目
            processed_items = []
            for item_data in track_dict.get('items', []):
                item_dict = dict(item_data)
                
                if not request.preserve_ids and not is_cover_track:
                    old_item_id = item_dict['id']
                    new_item_id = f"item_{uuid.uuid4().hex[:8]}"
                    item_dict['id'] = new_item_id
                    id_mappings[old_item_id] = new_item_id
                    
                    # 更新trackId引用
                    if item_dict.get('trackId') in id_mappings:
                        item_dict['trackId'] = id_mappings[item_dict['trackId']]
                
                processed_items.append(item_dict)
            
            track_dict['items'] = processed_items
            processed_tracks.append(track_dict)
        
        timeline_dict['tracks'] = processed_tracks
        
        # 处理素材
        processed_materials = []
        for material_data in import_data.materials:
            material_dict = dict(material_data)
            
            if not request.preserve_ids and not material_dict['id'].startswith('cover-material:'):
                old_material_id = material_dict['id']
                new_material_id = f"material_{uuid.uuid4().hex[:8]}"
                material_dict['id'] = new_material_id
                id_mappings[old_material_id] = new_material_id
                processing_notes.append(f"素材ID {old_material_id} -> {new_material_id}")
            
            processed_materials.append(material_dict)
        
        # 更新项目中的materialId引用
        for track_dict in timeline_dict['tracks']:
            for item_dict in track_dict.get('items', []):
                material_id = item_dict.get('materialId')
                if material_id and material_id in id_mappings:
                    item_dict['materialId'] = id_mappings[material_id]
        
        # 创建处理后的模型
        timeline_state = TimelineStateModel(**timeline_dict)
        materials = [MaterialModel(**m) for m in processed_materials]
        
        return ProcessedImportData(
            timelineState=timeline_state,
            materials=materials,
            idMappings=id_mappings,
            coverSchemaVersion=(import_data.metadata.cover_schema_version
                                if request.merge_mode == "replace" else None),
            processingNotes=processing_notes
        )

    def _generate_import_statistics(self, processed_data: ProcessedImportData, original_data: TimelineExportDataModel) -> Dict[str, Any]:
        """生成导入统计信息"""
        return {
            "original_track_count": len(original_data.tracks),
            "imported_track_count": len(processed_data.timeline_state.tracks),
            "original_material_count": len(original_data.materials),
            "imported_material_count": len(processed_data.materials),
            "id_mappings_created": len(processed_data.id_mappings),
            "processing_notes_count": len(processed_data.processing_notes),
            "import_timestamp": datetime.now().isoformat()
        }
