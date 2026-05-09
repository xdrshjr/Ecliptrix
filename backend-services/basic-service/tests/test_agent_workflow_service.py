"""
Tests for AgentWorkflowService.

iter4 Bug #1: ensure save_workflow returns ISO-formatted timestamps after the
db.refresh() fix, and that the catch-branch message no longer leaks raw
SQLAlchemy details.
"""

import pytest

from app.models.workflow_models import (
    SaveAgentWorkflowRequest,
    WorkflowNode,
    WorkflowNodeData,
    WorkflowNodePosition,
)
from app.services.agent_workflow_service import agent_workflow_service


def _request(*, workflow_id: str = "wf-1", with_nodes: bool = False) -> SaveAgentWorkflowRequest:
    nodes = []
    if with_nodes:
        nodes.append(
            WorkflowNode(
                id="start-1",
                type="start",
                position=WorkflowNodePosition(x=0, y=0),
                data=WorkflowNodeData(label="Start", type="start"),
            )
        )
    return SaveAgentWorkflowRequest(
        user_id="user-1",
        workflow_id=workflow_id,
        workflow_name="Test Workflow",
        workflow_description="iter4 fix verification",
        nodes=nodes,
        connections=[],
    )


@pytest.mark.asyncio
async def test_save_new_workflow_returns_iso_timestamps(db_session):
    """save_workflow on insert returns ISO-formatted created_at / updated_at."""
    req = _request()
    result = await agent_workflow_service.save_workflow(db=db_session, request=req)

    assert result["success"] is True
    record = result["data"]
    # AgentWorkflowRecord exposes created_at/updated_at as strings.
    assert isinstance(record.created_at, str) and record.created_at
    assert isinstance(record.updated_at, str) and record.updated_at
    # Sanity-check: ISO 8601 has a 'T' separator.
    assert "T" in record.created_at
    assert "T" in record.updated_at


@pytest.mark.asyncio
async def test_save_existing_workflow_increments_version(db_session):
    """A second save with the same workflow_id updates and bumps version."""
    req1 = _request()
    res1 = await agent_workflow_service.save_workflow(db=db_session, request=req1)
    assert res1["success"] is True
    assert res1["data"].version == 1

    req2 = _request(with_nodes=True)
    res2 = await agent_workflow_service.save_workflow(db=db_session, request=req2)
    assert res2["success"] is True
    assert res2["data"].version == 2
    assert len(res2["data"].nodes) == 1


@pytest.mark.asyncio
async def test_save_workflow_error_message_is_sanitized(db_session, monkeypatch):
    """When the underlying flush raises, the returned message must not leak details."""

    async def boom(*_args, **_kwargs):
        raise RuntimeError("greenlet_spawn has not been called; raw SQLAlchemy diag https://sqlalche.me/e/20/xd2s")

    # Force the flush to fail.
    monkeypatch.setattr(db_session, "flush", boom)

    req = _request()
    result = await agent_workflow_service.save_workflow(db=db_session, request=req)
    assert result["success"] is False
    assert result["message"] == "Failed to save workflow"
    # No raw SQLAlchemy URL, greenlet trace, or "error" key passthrough.
    assert "sqlalche.me" not in result["message"]
    assert "greenlet_spawn" not in result["message"]
    assert "error" not in result  # service no longer returns raw error string
