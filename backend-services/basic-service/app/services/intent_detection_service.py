"""
Intent Detection Service
使用Fast LLM检测用户意图，判断是否需要调用工作流
"""
import os
import json
import logging
from typing import List, Dict, Any, Optional
import httpx
from app.models.intent_detection_models import (
    IntentDetectionRequest,
    IntentDetectionResponse,
    WorkflowIntention,
    WorkflowInfo
)

# 配置日志
logger = logging.getLogger(__name__)


class IntentDetectionService:
    """意图检测服务"""

    def __init__(self):
        """初始化意图检测服务"""
        self.api_key = os.getenv("FAST_LLM_API_KEY")
        self.api_url = os.getenv("FAST_LLM_API_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
        self.model = os.getenv("FAST_LLM_MODEL", "qwen-max-latest")
        
        # 不在初始化时就抛出异常，允许服务启动
        # 在实际调用时再检查配置
        if not self.api_key:
            logger.warning(
                "[IntentDetectionService] FAST_LLM_API_KEY 未配置 - "
                "意图检测功能将不可用，请在环境变量中配置 FAST_LLM_API_KEY"
            )
        else:
            logger.info(
                f"[IntentDetectionService] 初始化完成 - "
                f"API URL: {self.api_url}, Model: {self.model}"
            )

    def _build_system_prompt(self, workflows: List[WorkflowInfo]) -> str:
        """构建系统提示词"""
        workflows_info = "\n".join([
            f"- ID: {wf.workflow_id}\n  名称: {wf.workflow_name}\n  描述: {wf.tool_description}"
            for wf in workflows
        ])
        
        system_prompt = f"""你是一个专业的AI助手，负责分析用户意图并判断是否需要调用特定的工作流。

当前可用的工作流：
{workflows_info}

你的任务：
1. 仔细分析用户的问题或请求
2. 判断用户的需求是否匹配任何一个可用的工作流
3. 如果匹配，选择最合适的工作流
4. 返回结构化的JSON响应

响应格式：
{{
    "should_call_workflow": true/false,
    "workflow_id": "工作流ID（如果需要调用）",
    "workflow_name": "工作流名称（如果需要调用）",
    "reasoning": "判断理由",
    "confidence": 0.0-1.0 (置信度)
}}

判断原则：
- 只有当用户的需求明确匹配某个工作流的功能时，才应该调用工作流
- 如果用户只是普通聊天或询问，不需要调用工作流
- 置信度应基于匹配程度：完全匹配>0.8，部分匹配0.5-0.8，不确定<0.5
- 当有多个工作流都匹配时，选择最相关的一个

请严格按照JSON格式返回，不要包含其他文本。"""

        return system_prompt

    async def detect_intent(
        self,
        request: IntentDetectionRequest
    ) -> IntentDetectionResponse:
        """
        检测用户意图
        
        Args:
            request: 意图检测请求
            
        Returns:
            IntentDetectionResponse: 意图检测结果
        """
        try:
            logger.info(
                f"[IntentDetectionService] 开始意图检测 - "
                f"用户消息: {request.user_message[:100]}... "
                f"启用的工作流数: {len(request.enabled_workflows)}"
            )
            
            # 运行时检查FAST_LLM配置
            if not self.api_key:
                logger.error(
                    "[IntentDetectionService] FAST_LLM_API_KEY 未配置 - "
                    "无法执行意图检测，请检查环境变量配置"
                )
                return IntentDetectionResponse(
                    success=False,
                    message="Fast LLM not configured",
                    error="FAST_LLM_API_KEY environment variable is not set. Please configure it in .env file."
                )
            
            # 如果没有启用的工作流，直接返回不需要调用
            if not request.enabled_workflows:
                logger.info("[IntentDetectionService] 没有启用的工作流，跳过意图检测")
                return IntentDetectionResponse(
                    success=True,
                    message="No enabled workflows available",
                    data=WorkflowIntention(
                        should_call_workflow=False,
                        reasoning="没有启用的工作流",
                        confidence=1.0
                    )
                )
            
            # 构建系统提示词
            system_prompt = self._build_system_prompt(request.enabled_workflows)
            
            # 准备消息列表
            messages = [
                {"role": "system", "content": system_prompt}
            ]
            
            # 添加对话历史（如果有）
            if request.conversation_history:
                for msg in request.conversation_history[-5:]:  # 只取最近5条
                    messages.append(msg)
            
            # 添加当前用户消息
            messages.append({
                "role": "user",
                "content": f"请分析这个用户请求：{request.user_message}"
            })
            
            # 调用Fast LLM API
            logger.info(
                f"[IntentDetectionService] 调用Fast LLM API - "
                f"URL: {self.api_url}/chat/completions, Model: {self.model}"
            )
            logger.debug(
                f"[IntentDetectionService] 准备调用Fast LLM - "
                f"消息数量: {len(messages)}, "
                f"API Key前缀: {self.api_key[:10]}..."
            )
            
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{self.api_url}/chat/completions",
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {self.api_key}"
                    },
                    json={
                        "model": self.model,
                        "messages": messages,
                        "temperature": 0.3,  # 较低温度，更确定的输出
                        "max_tokens": 500,
                        "response_format": {"type": "json_object"}  # 强制JSON输出
                    }
                )
                
            logger.info(
                f"[IntentDetectionService] Fast LLM API响应 - "
                f"状态码: {response.status_code}"
            )
            
            if response.status_code != 200:
                error_text = response.text
                logger.error(
                    f"[IntentDetectionService] Fast LLM API调用失败 - "
                    f"状态码: {response.status_code}, 错误: {error_text}"
                )
                return IntentDetectionResponse(
                    success=False,
                    message=f"LLM API调用失败: {response.status_code}",
                    error=error_text
                )
            
            # 解析响应
            response_data = response.json()
            logger.debug(f"[IntentDetectionService] LLM响应: {response_data}")
            
            # 提取LLM的回复内容
            llm_content = response_data.get("choices", [{}])[0].get("message", {}).get("content", "")
            
            if not llm_content:
                logger.error("[IntentDetectionService] LLM响应内容为空")
                return IntentDetectionResponse(
                    success=False,
                    message="LLM响应内容为空",
                    error="Empty response from LLM"
                )
            
            logger.info(f"[IntentDetectionService] LLM返回内容: {llm_content}")
            
            # 解析JSON响应
            try:
                intent_data = json.loads(llm_content)
            except json.JSONDecodeError as e:
                logger.error(f"[IntentDetectionService] JSON解析失败: {e}, 内容: {llm_content}")
                return IntentDetectionResponse(
                    success=False,
                    message="JSON解析失败",
                    error=str(e)
                )
            
            # 构建WorkflowIntention对象
            intention = WorkflowIntention(
                should_call_workflow=intent_data.get("should_call_workflow", False),
                workflow_id=intent_data.get("workflow_id"),
                workflow_name=intent_data.get("workflow_name"),
                reasoning=intent_data.get("reasoning", ""),
                confidence=float(intent_data.get("confidence", 0.0))
            )
            
            logger.info(
                f"[IntentDetectionService] 意图检测完成 - "
                f"需要调用工作流: {intention.should_call_workflow}, "
                f"工作流: {intention.workflow_name}, "
                f"置信度: {intention.confidence:.2f}, "
                f"理由: {intention.reasoning}"
            )
            
            return IntentDetectionResponse(
                success=True,
                message="Intent detection completed successfully",
                data=intention
            )
            
        except Exception as e:
            logger.exception(f"[IntentDetectionService] 意图检测异常: {e}")
            return IntentDetectionResponse(
                success=False,
                message="Intent detection failed",
                error=str(e)
            )


# 创建全局服务实例
intent_detection_service = IntentDetectionService()

