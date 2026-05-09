"""
Tests for user-stats / user-list consistency.

iter4 Bug #5: stats totals must match the list view's row count for any caller
role. Admin callers should not see admin/root rows in either stats or list.
"""

import bcrypt
import pytest

from app.models.db_models import User
from app.services.user_service import user_service


def _make_user(
    *,
    username: str,
    email: str,
    is_admin: bool = False,
    is_root: bool = False,
    user_role: str = "regular",
    is_active: bool = True,
) -> User:
    password_hash = bcrypt.hashpw("Pass1234!".encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    return User(
        username=username,
        email=email,
        password_hash=password_hash,
        is_active=is_active,
        is_admin=is_admin,
        is_root=is_root,
        user_role=user_role,
    )


async def _seed(db_session):
    """Seed: 1 root, 1 admin, 2 regulars."""
    root_user = _make_user(
        username="root",
        email="root@test.local",
        is_admin=True,
        is_root=True,
        user_role="admin",
    )
    admin_user = _make_user(
        username="admin",
        email="admin@test.local",
        is_admin=True,
        user_role="admin",
    )
    reg1 = _make_user(username="reg1", email="reg1@test.local")
    reg2 = _make_user(username="reg2", email="reg2@test.local")
    for u in (root_user, admin_user, reg1, reg2):
        db_session.add(u)
    await db_session.flush()
    return root_user, admin_user, reg1, reg2


@pytest.mark.asyncio
async def test_admin_stats_total_matches_list_total(db_session):
    """Admin caller's stats.total_users == list.total_count (both exclude admin/root)."""
    _root, admin, _r1, _r2 = await _seed(db_session)

    list_result = await user_service.get_all_users(db_session, current_user=admin)
    stats_result = await user_service.get_user_stats(db_session, current_user=admin)

    assert list_result["success"] is True
    assert stats_result["success"] is True

    # Both should see only the 2 regulars.
    assert list_result["data"]["total"] == 2
    assert stats_result["data"]["total_users"] == 2
    assert stats_result["data"]["admin_count"] == 0  # admin/root rows excluded
    assert stats_result["data"]["regular_count"] == 2


@pytest.mark.asyncio
async def test_root_stats_includes_everyone(db_session):
    """Root caller sees all rows in stats; list excludes self."""
    root, _admin, _r1, _r2 = await _seed(db_session)

    list_result = await user_service.get_all_users(db_session, current_user=root)
    stats_result = await user_service.get_user_stats(db_session, current_user=root)

    assert stats_result["data"]["total_users"] == 4  # root + admin + 2 regulars
    # List excludes the calling root user → 3.
    assert list_result["data"]["total"] == 3
    assert stats_result["data"]["admin_count"] == 2  # root + admin (both have role=admin)


@pytest.mark.asyncio
async def test_stats_no_caller_returns_full_counts(db_session):
    """Backward compatibility: when current_user is None, no permission filter is applied."""
    await _seed(db_session)

    stats_result = await user_service.get_user_stats(db_session, current_user=None)
    assert stats_result["success"] is True
    assert stats_result["data"]["total_users"] == 4
