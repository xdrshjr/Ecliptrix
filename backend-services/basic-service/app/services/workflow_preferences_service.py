"""
Workflow preferences service for managing user workflow UI state.
"""

from typing import Dict
from datetime import datetime

from app.logger import get_logger
from app.models.workflow_preferences_models import WorkflowPreference

logger = get_logger(__name__)


class WorkflowPreferencesService:
    """工作流偏好设置服务
    
    负责管理用户在Video Editing任务中的工作流UI状态（展开/折叠状态）
    当前使用内存存储，实际生产环境应使用数据库
    """
    
    def __init__(self):
        """初始化工作流偏好设置服务"""
        # 使用内存存储，key为user_id，value为Dict[workflow_id, WorkflowPreference]
        # 生产环境应替换为数据库存储
        self._preferences_store: Dict[str, Dict[str, WorkflowPreference]] = {}
        
        logger.info("工作流偏好设置服务初始化完成", {
            "service": "WorkflowPreferencesService",
            "storage_type": "memory",
            "note": "生产环境应使用数据库存储",
            "timestamp": datetime.now().isoformat()
        })
    
    async def save_preferences(
        self, 
        user_id: str, 
        preferences: Dict[str, WorkflowPreference]
    ) -> Dict:
        """保存用户的工作流偏好设置
        
        Args:
            user_id: 用户ID
            preferences: 工作流偏好设置字典
            
        Returns:
            Dict: 包含success, message, saved_count的结果字典
        """
        try:
            logger.info("开始保存工作流偏好设置", {
                "user_id": user_id,
                "preferences_count": len(preferences),
                "workflow_ids": list(preferences.keys()),
                "timestamp": datetime.now().isoformat()
            })
            
            # 验证preferences数据
            if not preferences:
                logger.warning("尝试保存空的偏好设置", {"user_id": user_id})
                return {
                    "success": False,
                    "message": "偏好设置不能为空",
                    "saved_count": 0
                }
            
            # 保存到内存存储
            self._preferences_store[user_id] = preferences
            
            logger.info("工作流偏好设置保存成功", {
                "user_id": user_id,
                "saved_count": len(preferences),
                "expanded_workflows": [
                    wf_id for wf_id, pref in preferences.items() 
                    if pref.is_expanded
                ],
                "timestamp": datetime.now().isoformat()
            })
            
            return {
                "success": True,
                "message": "工作流偏好设置保存成功",
                "saved_count": len(preferences)
            }
            
        except Exception as e:
            logger.error("保存工作流偏好设置失败", {
                "user_id": user_id,
                "error": str(e),
                "error_type": type(e).__name__,
                "timestamp": datetime.now().isoformat()
            })
            return {
                "success": False,
                "message": f"保存工作流偏好设置失败: {str(e)}",
                "saved_count": 0
            }
    
    async def load_preferences(self, user_id: str) -> Dict:
        """加载用户的工作流偏好设置
        
        Args:
            user_id: 用户ID
            
        Returns:
            Dict: 包含success, message, preferences的结果字典
        """
        try:
            logger.info("开始加载工作流偏好设置", {
                "user_id": user_id,
                "timestamp": datetime.now().isoformat()
            })
            
            # 从内存存储加载
            preferences = self._preferences_store.get(user_id, {})
            
            logger.info("工作流偏好设置加载成功", {
                "user_id": user_id,
                "preferences_count": len(preferences),
                "workflow_ids": list(preferences.keys()),
                "expanded_count": sum(
                    1 for pref in preferences.values() if pref.is_expanded
                ),
                "timestamp": datetime.now().isoformat()
            })
            
            return {
                "success": True,
                "message": "工作流偏好设置加载成功" if preferences else "未找到已保存的偏好设置",
                "preferences": preferences
            }
            
        except Exception as e:
            logger.error("加载工作流偏好设置失败", {
                "user_id": user_id,
                "error": str(e),
                "error_type": type(e).__name__,
                "timestamp": datetime.now().isoformat()
            })
            return {
                "success": False,
                "message": f"加载工作流偏好设置失败: {str(e)}",
                "preferences": {}
            }
    
    async def clear_preferences(self, user_id: str) -> Dict:
        """清除用户的工作流偏好设置
        
        Args:
            user_id: 用户ID
            
        Returns:
            Dict: 包含success和message的结果字典
        """
        try:
            logger.info("开始清除工作流偏好设置", {
                "user_id": user_id,
                "timestamp": datetime.now().isoformat()
            })
            
            if user_id in self._preferences_store:
                del self._preferences_store[user_id]
                logger.info("工作流偏好设置清除成功", {"user_id": user_id})
                return {
                    "success": True,
                    "message": "工作流偏好设置清除成功"
                }
            else:
                logger.info("未找到需要清除的偏好设置", {"user_id": user_id})
                return {
                    "success": True,
                    "message": "未找到需要清除的偏好设置"
                }
                
        except Exception as e:
            logger.error("清除工作流偏好设置失败", {
                "user_id": user_id,
                "error": str(e),
                "error_type": type(e).__name__,
                "timestamp": datetime.now().isoformat()
            })
            return {
                "success": False,
                "message": f"清除工作流偏好设置失败: {str(e)}"
            }

