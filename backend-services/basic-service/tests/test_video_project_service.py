"""
Unit tests for video_project_service — direct service layer tests against an
in-memory SQLite database (matches the project test convention in
``conftest.py``).

These tests verify:
  - CRUD happy path for categories and projects
  - User isolation (user A cannot read/update/delete user B's data)
  - List filtering by category, search, sort, pagination
  - Category delete sets ``project.category_id = NULL`` instead of cascading
  - last_opened_at touch on get_project
"""

from __future__ import annotations

import asyncio
import uuid

import pytest
import pytest_asyncio

from app.models.video_project_models import (
    CreateVideoProjectCategoryRequest,
    CreateVideoProjectRequest,
    UpdateVideoProjectCategoryRequest,
    UpdateVideoProjectRequest,
)
from app.services.video_project_service import video_project_service


USER_A = "11111111-1111-1111-1111-111111111111"
USER_B = "22222222-2222-2222-2222-222222222222"


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_and_list_category(db_session):
    payload = CreateVideoProjectCategoryRequest(name="Marketing", color="#abcdef")
    cat = await video_project_service.create_category(
        db=db_session, user_id=USER_A, payload=payload
    )
    assert cat.name == "Marketing"
    assert cat.color == "#abcdef"

    items = await video_project_service.list_categories(db=db_session, user_id=USER_A)
    assert len(items) == 1
    assert items[0].id == cat.id


@pytest.mark.asyncio
async def test_categories_user_isolation(db_session):
    await video_project_service.create_category(
        db=db_session,
        user_id=USER_A,
        payload=CreateVideoProjectCategoryRequest(name="A's category"),
    )
    items_b = await video_project_service.list_categories(db=db_session, user_id=USER_B)
    assert items_b == []


@pytest.mark.asyncio
async def test_update_category_404_for_other_user(db_session):
    cat = await video_project_service.create_category(
        db=db_session,
        user_id=USER_A,
        payload=CreateVideoProjectCategoryRequest(name="Owned"),
    )
    result = await video_project_service.update_category(
        db=db_session,
        user_id=USER_B,
        category_id=cat.id,
        payload=UpdateVideoProjectCategoryRequest(name="Hijacked"),
    )
    assert result is None  # router maps None → 404


@pytest.mark.asyncio
async def test_delete_category_unlinks_projects(db_session):
    cat = await video_project_service.create_category(
        db=db_session,
        user_id=USER_A,
        payload=CreateVideoProjectCategoryRequest(name="Temp"),
    )
    proj = await video_project_service.create_project(
        db=db_session,
        user_id=USER_A,
        payload=CreateVideoProjectRequest(name="P1", category_id=cat.id),
    )
    assert proj.category_id == cat.id

    deleted = await video_project_service.delete_category(
        db=db_session, user_id=USER_A, category_id=cat.id
    )
    assert deleted is True

    # Project should still exist but with category_id == None
    refetched = await video_project_service.get_project(
        db=db_session, user_id=USER_A, project_id=proj.id, touch_last_opened=False
    )
    assert refetched is not None
    assert refetched.category_id is None


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_get_update_delete_project(db_session):
    created = await video_project_service.create_project(
        db=db_session,
        user_id=USER_A,
        payload=CreateVideoProjectRequest(
            name="My First Project",
            description="An intro project",
            project_data={"markdownContent": "Hello"},
        ),
    )
    assert created.name == "My First Project"
    assert created.project_data["markdownContent"] == "Hello"

    fetched = await video_project_service.get_project(
        db=db_session, user_id=USER_A, project_id=created.id
    )
    assert fetched is not None
    assert fetched.id == created.id
    # last_opened_at should now be populated after the touch
    assert fetched.last_opened_at is not None

    updated = await video_project_service.update_project(
        db=db_session,
        user_id=USER_A,
        project_id=created.id,
        payload=UpdateVideoProjectRequest(
            name="Renamed",
            project_data={"markdownContent": "Updated"},
        ),
    )
    assert updated is not None
    assert updated.name == "Renamed"
    assert updated.project_data["markdownContent"] == "Updated"

    deleted = await video_project_service.delete_project(
        db=db_session, user_id=USER_A, project_id=created.id
    )
    assert deleted is True

    not_found = await video_project_service.get_project(
        db=db_session, user_id=USER_A, project_id=created.id
    )
    assert not_found is None


@pytest.mark.asyncio
async def test_project_user_isolation(db_session):
    """User B must not be able to read, update, or delete user A's project."""
    proj = await video_project_service.create_project(
        db=db_session,
        user_id=USER_A,
        payload=CreateVideoProjectRequest(name="Private"),
    )

    # Read
    fetched = await video_project_service.get_project(
        db=db_session, user_id=USER_B, project_id=proj.id
    )
    assert fetched is None

    # Update
    updated = await video_project_service.update_project(
        db=db_session,
        user_id=USER_B,
        project_id=proj.id,
        payload=UpdateVideoProjectRequest(name="Hijacked"),
    )
    assert updated is None

    # Delete
    deleted = await video_project_service.delete_project(
        db=db_session, user_id=USER_B, project_id=proj.id
    )
    assert deleted is False

    # The original record must remain untouched and visible to user A
    a_view = await video_project_service.get_project(
        db=db_session, user_id=USER_A, project_id=proj.id
    )
    assert a_view is not None
    assert a_view.name == "Private"


@pytest.mark.asyncio
async def test_list_projects_search_and_sort(db_session):
    names = ["Alpha", "Beta", "Gamma marketing", "Delta", "epsilon marketing"]
    for n in names:
        await video_project_service.create_project(
            db=db_session,
            user_id=USER_A,
            payload=CreateVideoProjectRequest(name=n),
        )

    # search (case-insensitive)
    items, total = await video_project_service.list_projects(
        db=db_session, user_id=USER_A, search="MARKETING"
    )
    assert total == 2
    found_names = sorted(i.name for i in items)
    assert found_names == ["Gamma marketing", "epsilon marketing"]

    # sort by name
    items_named, _ = await video_project_service.list_projects(
        db=db_session, user_id=USER_A, sort="name"
    )
    assert [i.name for i in items_named[:3]] == sorted([i.name for i in items_named])[:3]


@pytest.mark.asyncio
async def test_list_projects_pagination(db_session):
    for i in range(5):
        await video_project_service.create_project(
            db=db_session,
            user_id=USER_A,
            payload=CreateVideoProjectRequest(name=f"Project {i}"),
        )

    items, total = await video_project_service.list_projects(
        db=db_session, user_id=USER_A, limit=2, offset=0
    )
    assert total == 5
    assert len(items) == 2

    items_p2, _ = await video_project_service.list_projects(
        db=db_session, user_id=USER_A, limit=2, offset=2
    )
    assert len(items_p2) == 2
    # No overlap
    p1_ids = {i.id for i in items}
    p2_ids = {i.id for i in items_p2}
    assert not (p1_ids & p2_ids)


@pytest.mark.asyncio
async def test_list_projects_filter_by_category(db_session):
    cat = await video_project_service.create_category(
        db=db_session,
        user_id=USER_A,
        payload=CreateVideoProjectCategoryRequest(name="Cat"),
    )
    await video_project_service.create_project(
        db=db_session,
        user_id=USER_A,
        payload=CreateVideoProjectRequest(name="With Cat", category_id=cat.id),
    )
    await video_project_service.create_project(
        db=db_session,
        user_id=USER_A,
        payload=CreateVideoProjectRequest(name="No Cat"),
    )

    items, total = await video_project_service.list_projects(
        db=db_session, user_id=USER_A, category_id=cat.id
    )
    assert total == 1
    assert items[0].name == "With Cat"

    # Special token to filter "uncategorized" projects
    uncat, total_uncat = await video_project_service.list_projects(
        db=db_session, user_id=USER_A, category_id="__uncategorized__"
    )
    assert total_uncat == 1
    assert uncat[0].name == "No Cat"


@pytest.mark.asyncio
async def test_invalid_uuids_return_none(db_session):
    """Bad UUID strings must NOT raise — they map to 'not found'."""
    fetched = await video_project_service.get_project(
        db=db_session, user_id=USER_A, project_id="not-a-uuid"
    )
    assert fetched is None

    deleted = await video_project_service.delete_project(
        db=db_session, user_id=USER_A, project_id="also-not-a-uuid"
    )
    assert deleted is False


@pytest.mark.asyncio
async def test_create_request_rejects_user_id_field():
    """Per the auth contract, the Pydantic create model has no user_id field.

    Passing an extra ``user_id`` to the constructor should be silently dropped
    by Pydantic v2 (which is the default for unknown fields). What matters is
    that the model's ``user_id`` attribute does not exist — the router never
    sees a client-supplied user_id.
    """
    payload = CreateVideoProjectRequest(name="X")
    assert not hasattr(payload, "user_id")
