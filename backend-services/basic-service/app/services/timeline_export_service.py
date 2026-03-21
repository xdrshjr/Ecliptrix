"""
Timeline Export Service for handling timeline data export functionality.
"""

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Optional

from app.models.timeline_export_models import (
    TimelineExportRequest,
    TimelineExportResponse,
    TimelineExportDataModel
)
from app.logger import get_logger

logger = get_logger(__name__)


class TimelineExportService:
    """时间轴导出服务"""
    
    def __init__(self):
        # 设置导出文件存储目录
        self.export_dir = Path("static/timeline_exports")
        self.export_dir.mkdir(parents=True, exist_ok=True)
        
        logger.info("TimelineExportService initialized", {
            "export_dir": str(self.export_dir),
            "export_dir_exists": self.export_dir.exists()
        })

    async def export_timeline_to_json(self, request: TimelineExportRequest) -> TimelineExportResponse:
        """
        导出时间轴数据为JSON文件
        
        Args:
            request: 时间轴导出请求
            
        Returns:
            TimelineExportResponse: 导出响应
        """
        try:
            logger.info("开始处理时间轴导出请求", {
                "task_id": request.task_id,
                "track_count": len(request.timeline_state.tracks),
                "material_count": len(request.materials),
                "total_duration": request.timeline_state.total_duration
            })

            # 验证请求数据
            validation_error = self._validate_request(request)
            if validation_error:
                logger.error("请求验证失败", {
                    "task_id": request.task_id,
                    "error": validation_error
                })
                return TimelineExportResponse(
                    success=False,
                    message=f"请求验证失败: {validation_error}",
                    details={"validation_error": validation_error}
                )

            # 准备导出数据
            export_data = self._prepare_export_data(request)
            
            # 生成文件名
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            file_name = f"timeline_export_{request.task_id}_{timestamp}.json"
            file_path = self.export_dir / file_name
            
            # 写入JSON文件
            self._write_json_file(export_data, file_path)
            
            # 生成下载URL（相对路径）
            download_url = f"/static/timeline_exports/{file_name}"
            
            logger.info("时间轴导出成功", {
                "task_id": request.task_id,
                "file_name": file_name,
                "file_path": str(file_path),
                "file_size": file_path.stat().st_size,
                "track_count": len(export_data.tracks),
                "material_count": len(export_data.materials)
            })

            return TimelineExportResponse(
                success=True,
                message="时间轴数据导出成功",
                file_name=file_name,
                download_url=download_url,
                data=export_data,
                details={
                    "file_size": file_path.stat().st_size,
                    "export_timestamp": export_data.metadata.exported_at,
                    "track_count": len(export_data.tracks),
                    "material_count": len(export_data.materials)
                }
            )

        except Exception as e:
            logger.error("时间轴导出失败", {
                "task_id": request.task_id,
                "error": str(e),
                "error_type": type(e).__name__
            }, exc_info=True)
            
            return TimelineExportResponse(
                success=False,
                message=f"导出失败: {str(e)}",
                details={
                    "error_type": type(e).__name__,
                    "error_message": str(e)
                }
            )

    def _validate_request(self, request: TimelineExportRequest) -> Optional[str]:
        """
        验证导出请求
        
        Args:
            request: 导出请求
            
        Returns:
            Optional[str]: 验证错误信息，None表示验证通过
        """
        if not request.task_id or not request.task_id.strip():
            return "任务ID不能为空"
            
        if not request.timeline_state:
            return "时间轴状态不能为空"
            
        if not request.timeline_state.tracks:
            return "时间轴必须包含至少一个轨道"
            
        if request.timeline_state.total_duration < 0:
            return "总时长不能为负数"
            
        # 验证轨道数据
        for i, track in enumerate(request.timeline_state.tracks):
            if not track.id or not track.id.strip():
                return f"第{i+1}个轨道的ID不能为空"
                
            if not track.name or not track.name.strip():
                return f"第{i+1}个轨道的名称不能为空"
                
            if track.type not in ['video', 'audio', 'subtitle']:
                return f"第{i+1}个轨道的类型无效: {track.type}"
                
            # 验证轨道项目
            for j, item in enumerate(track.items):
                if not item.id or not item.id.strip():
                    return f"轨道{track.name}的第{j+1}个项目ID不能为空"
                    
                if item.start_time < 0:
                    return f"轨道{track.name}的第{j+1}个项目开始时间不能为负数"
                    
                if item.duration <= 0:
                    return f"轨道{track.name}的第{j+1}个项目持续时间必须大于0"
        
        return None

    def _prepare_export_data(self, request: TimelineExportRequest) -> TimelineExportDataModel:
        """
        准备导出数据
        
        Args:
            request: 导出请求
            
        Returns:
            TimelineExportDataModel: 准备好的导出数据
        """
        # 如果请求中已包含预处理的导出数据，直接使用
        if request.export_data:
            logger.info("使用预处理的导出数据", {
                "task_id": request.task_id
            })
            return request.export_data
        
        # 计算统计信息
        total_items = sum(len(track.items) for track in request.timeline_state.tracks)
        
        # 构建导出数据
        export_data = TimelineExportDataModel(
            metadata={
                "exported_at": datetime.now().isoformat(),
                "version": "1.0.0",
                "task_id": request.task_id,
                "total_duration": request.timeline_state.total_duration,
                "track_count": len(request.timeline_state.tracks),
                "item_count": total_items
            },
            timeline={
                "current_time": request.timeline_state.current_time,
                "total_duration": request.timeline_state.total_duration,
                "zoom_level": request.timeline_state.zoom_level,
                "selected_items": request.timeline_state.selected_items.copy(),
                "playback_rate": request.timeline_state.playback_rate,
                "is_playing": request.timeline_state.is_playing,
                "snap_to_grid": request.timeline_state.snap_to_grid,
                "grid_size": request.timeline_state.grid_size,
                "scroll_left": request.timeline_state.scroll_left
            },
            tracks=[
                {
                    "id": track.id,
                    "name": track.name,
                    "type": track.type,
                    "height": track.height,
                    "is_locked": track.is_locked,
                    "is_muted": track.is_muted,
                    "is_visible": track.is_visible,
                    "volume": track.volume,
                    "order": track.order,
                    "items": [
                        {
                            "id": item.id,
                            "name": item.name,
                            "type": item.type,
                            "start_time": item.start_time,
                            "duration": item.duration,
                            "track_id": item.track_id,
                            "color": item.color,
                            "thumbnail_url": item.thumbnail_url,
                            "waveform_data": item.waveform_data,
                            "text": item.text,
                            "material_id": item.material_id,
                            "volume": item.volume,
                            "opacity": item.opacity,
                            "is_selected": item.is_selected,
                            "clip_start": item.clip_start,
                            "clip_end": item.clip_end,
                            "original_duration": item.original_duration,
                            "original_material_type": item.original_material_type,
                            "subtitle_style": item.subtitle_style,
                            "image_position": item.image_position
                        }
                        for item in track.items
                    ]
                }
                for track in request.timeline_state.tracks
            ],
            materials=[
                {
                    "id": material.id,
                    "name": material.name,
                    "type": material.type,
                    "format": material.format,
                    "size": material.size,
                    "duration": material.duration,
                    "width": material.width,
                    "height": material.height,
                    "thumbnail_url": material.thumbnail_url,
                    "url": material.url,
                    "server_url": material.server_url,
                    "created_at": material.created_at,
                    "tags": material.tags,
                    "description": material.description,
                    "metadata": material.metadata
                }
                for material in request.materials
            ]
        )
        
        logger.info("导出数据准备完成", {
            "task_id": request.task_id,
            "track_count": len(export_data.tracks),
            "material_count": len(export_data.materials),
            "total_items": total_items
        })
        
        return export_data

    def _write_json_file(self, export_data: TimelineExportDataModel, file_path: Path) -> None:
        """
        写入JSON文件
        
        Args:
            export_data: 导出数据
            file_path: 文件路径
        """
        try:
            # 转换为字典以便序列化
            data_dict = export_data.dict() if hasattr(export_data, 'dict') else export_data.__dict__
            
            # 写入文件
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(data_dict, f, ensure_ascii=False, indent=2)
                
            logger.info("JSON文件写入成功", {
                "file_path": str(file_path),
                "file_size": file_path.stat().st_size
            })
            
        except Exception as e:
            logger.error("JSON文件写入失败", {
                "file_path": str(file_path),
                "error": str(e)
            }, exc_info=True)
            raise

    def cleanup_old_exports(self, max_age_hours: int = 24) -> int:
        """
        清理过期的导出文件
        
        Args:
            max_age_hours: 最大保留时间（小时）
            
        Returns:
            int: 清理的文件数量
        """
        try:
            current_time = datetime.now()
            cleaned_count = 0
            
            for file_path in self.export_dir.glob("timeline_export_*.json"):
                # 获取文件修改时间
                file_mtime = datetime.fromtimestamp(file_path.stat().st_mtime)
                age_hours = (current_time - file_mtime).total_seconds() / 3600
                
                if age_hours > max_age_hours:
                    file_path.unlink()
                    cleaned_count += 1
                    logger.info("清理过期导出文件", {
                        "file_name": file_path.name,
                        "age_hours": age_hours
                    })
            
            logger.info("导出文件清理完成", {
                "cleaned_count": cleaned_count,
                "max_age_hours": max_age_hours
            })
            
            return cleaned_count
            
        except Exception as e:
            logger.error("清理导出文件失败", {
                "error": str(e)
            }, exc_info=True)
            return 0