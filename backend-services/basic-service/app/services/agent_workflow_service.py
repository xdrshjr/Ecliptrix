"""
Agent Workflow Persistence Service for managing workflow storage.
Uses SQLAlchemy async operations on the AgentWorkflow model.
"""

from typing import Dict, Any
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete

from app.models.db_models import AgentWorkflow
from app.logger import get_logger
from app.models.workflow_models import (
    SaveAgentWorkflowRequest,
    AgentWorkflowRecord,
    WorkflowNode,
    WorkflowConnection
)

logger = get_logger(__name__)


class AgentWorkflowService:
    """Service for handling agent workflow persistence operations."""

    def __init__(self):
        """Initialize agent workflow service."""
        logger.info("Agent workflow service initialized (SQLAlchemy mode)")

    def _record_to_model(self, record: AgentWorkflow) -> AgentWorkflowRecord:
        """Convert an AgentWorkflow ORM object to an AgentWorkflowRecord Pydantic model."""
        data = record.workflow_data or {}
        nodes_data = data.get("nodes", [])
        connections_data = data.get("connections", [])

        return AgentWorkflowRecord(
            id=str(record.id),
            user_id=record.user_id,
            workflow_id=data.get("workflow_id", str(record.id)),
            workflow_name=record.workflow_name,
            workflow_description=record.description,
            nodes=[WorkflowNode(**node) for node in nodes_data],
            connections=[WorkflowConnection(**conn) for conn in connections_data],
            is_active=True,
            is_template=record.is_template or False,
            version=data.get("version", 1),
            created_at=record.created_at.isoformat() if record.created_at else datetime.now().isoformat(),
            updated_at=record.updated_at.isoformat() if record.updated_at else datetime.now().isoformat(),
            last_executed_at=data.get("last_executed_at")
        )

    async def save_workflow(
        self,
        db: AsyncSession,
        request: SaveAgentWorkflowRequest
    ) -> Dict[str, Any]:
        """
        Save or update an agent workflow.

        Args:
            db: AsyncSession for database operations
            request: SaveAgentWorkflowRequest containing workflow data

        Returns:
            Dict containing saved workflow data or error
        """
        try:
            logger.info("Saving agent workflow", {
                "user_id": request.user_id,
                "workflow_id": request.workflow_id,
                "workflow_name": request.workflow_name,
                "nodes_count": len(request.nodes),
                "connections_count": len(request.connections),
                "timestamp": datetime.now().isoformat()
            })

            # Convert nodes and connections to JSON-serializable format
            nodes_json = [node.dict() for node in request.nodes]
            connections_json = [conn.dict() for conn in request.connections]

            # Build the workflow_data JSON payload
            workflow_data_json = {
                "workflow_id": request.workflow_id,
                "nodes": nodes_json,
                "connections": connections_json,
            }

            # Check if workflow already exists for this user with same workflow_id
            stmt = (
                select(AgentWorkflow)
                .where(
                    AgentWorkflow.user_id == request.user_id,
                    AgentWorkflow.workflow_data["workflow_id"].as_string() == request.workflow_id
                )
            )
            result = await db.execute(stmt)
            existing = result.scalar_one_or_none()

            if existing:
                # Update existing workflow
                old_data = existing.workflow_data or {}
                old_version = old_data.get("version", 1)
                workflow_data_json["version"] = old_version + 1

                logger.info("Updating existing workflow record", {
                    "record_id": str(existing.id),
                    "workflow_id": request.workflow_id
                })

                existing.workflow_name = request.workflow_name
                existing.description = request.workflow_description
                existing.workflow_data = workflow_data_json
                await db.flush()

                workflow_record = self._record_to_model(existing)
            else:
                # Insert new workflow
                workflow_data_json["version"] = 1

                logger.info("Creating new workflow record", {
                    "workflow_id": request.workflow_id
                })

                new_workflow = AgentWorkflow(
                    user_id=request.user_id,
                    workflow_name=request.workflow_name,
                    workflow_data=workflow_data_json,
                    description=request.workflow_description,
                    is_template=False
                )
                db.add(new_workflow)
                await db.flush()

                workflow_record = self._record_to_model(new_workflow)

            logger.info("Workflow save operation completed successfully", {
                "workflow_id": request.workflow_id,
                "record_id": workflow_record.id
            })

            return {
                "success": True,
                "message": "Workflow saved successfully",
                "data": workflow_record
            }

        except Exception as e:
            error_msg = str(e)
            logger.error("Error saving agent workflow", {
                "error": error_msg,
                "error_type": type(e).__name__,
                "workflow_id": request.workflow_id,
                "user_id": request.user_id
            })
            return {
                "success": False,
                "message": f"Failed to save workflow: {error_msg}",
                "error_code": "SAVE_ERROR",
                "error": error_msg
            }

    async def load_workflows(
        self,
        db: AsyncSession,
        user_id: str
    ) -> Dict[str, Any]:
        """
        Load all active workflows for a user.

        Args:
            db: AsyncSession for database operations
            user_id: User ID to load workflows for

        Returns:
            Dict containing list of workflows or error
        """
        try:
            logger.info("Loading agent workflows for user", {
                "user_id": user_id,
                "timestamp": datetime.now().isoformat()
            })

            stmt = (
                select(AgentWorkflow)
                .where(AgentWorkflow.user_id == user_id)
                .order_by(AgentWorkflow.updated_at.desc())
            )
            result = await db.execute(stmt)
            records = result.scalars().all()

            if not records:
                logger.info("No workflows found for user", {"user_id": user_id})
                return {
                    "success": True,
                    "message": "No workflows found",
                    "data": []
                }

            logger.info(f"Found {len(records)} workflows for user", {
                "user_id": user_id,
                "count": len(records)
            })

            workflows = []
            for record in records:
                try:
                    workflow_record = self._record_to_model(record)
                    workflows.append(workflow_record)
                except Exception as parse_error:
                    logger.error("Error parsing workflow record", {
                        "record_id": str(record.id),
                        "error": str(parse_error)
                    })
                    continue

            logger.info(f"Successfully loaded {len(workflows)} workflows for user", {
                "user_id": user_id,
                "count": len(workflows)
            })

            return {
                "success": True,
                "message": f"Successfully loaded {len(workflows)} workflows",
                "data": workflows
            }

        except Exception as e:
            error_msg = str(e)
            logger.error("Error loading agent workflows", {
                "error": error_msg,
                "error_type": type(e).__name__,
                "user_id": user_id
            })
            return {
                "success": False,
                "message": f"Failed to load workflows: {error_msg}",
                "error_code": "LOAD_ERROR",
                "error": error_msg
            }

    async def delete_workflow(
        self,
        db: AsyncSession,
        user_id: str,
        workflow_id: str
    ) -> Dict[str, Any]:
        """
        Delete a workflow.

        Args:
            db: AsyncSession for database operations
            user_id: User ID who owns the workflow
            workflow_id: Workflow ID to delete

        Returns:
            Dict containing operation result
        """
        try:
            logger.info("Deleting agent workflow", {
                "user_id": user_id,
                "workflow_id": workflow_id,
                "timestamp": datetime.now().isoformat()
            })

            # Find the workflow by user_id and workflow_id in JSON data
            stmt = (
                select(AgentWorkflow)
                .where(
                    AgentWorkflow.user_id == user_id,
                    AgentWorkflow.workflow_data["workflow_id"].as_string() == workflow_id
                )
            )
            result = await db.execute(stmt)
            workflow = result.scalar_one_or_none()

            if not workflow:
                logger.warning("Workflow not found for deletion", {
                    "user_id": user_id,
                    "workflow_id": workflow_id
                })
                return {
                    "success": False,
                    "message": "Workflow not found",
                    "error_code": "NOT_FOUND"
                }

            await db.delete(workflow)
            await db.flush()

            logger.info("Workflow deleted successfully", {
                "workflow_id": workflow_id,
                "user_id": user_id
            })

            return {
                "success": True,
                "message": "Workflow deleted successfully"
            }

        except Exception as e:
            error_msg = str(e)
            logger.error("Error deleting agent workflow", {
                "error": error_msg,
                "error_type": type(e).__name__,
                "workflow_id": workflow_id,
                "user_id": user_id
            })
            return {
                "success": False,
                "message": f"Failed to delete workflow: {error_msg}",
                "error_code": "DELETE_ERROR",
                "error": error_msg
            }


# Global service instance
agent_workflow_service = AgentWorkflowService()
