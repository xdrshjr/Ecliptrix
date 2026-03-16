"""
FastAPI dependency injection modules for authentication and authorization.
"""

from app.dependencies.auth import get_current_user, require_admin, require_root

__all__ = ["get_current_user", "require_admin", "require_root"]
