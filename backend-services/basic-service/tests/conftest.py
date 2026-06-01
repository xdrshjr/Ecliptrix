"""
Test fixtures and configuration for pytest.

Two pre-existing, environment-only blockers stop a bare ``pytest tests/`` from
collecting on a developer box; both are neutralised HERE so the whole suite is
runnable without touching production code:

1. ``app/models/db_models.py`` declares primary keys with PostgreSQL's
   ``postgresql.UUID``. SQLAlchemy cannot render that type on SQLite, so any
   test that runs ``Base.metadata.create_all`` against the in-memory SQLite DB
   raised ``UnsupportedCompilationError``. We register a **dialect-scoped**
   ``@compiles(postgresql.UUID, "sqlite")`` shim that emits ``CHAR(36)`` for the
   SQLite dialect ONLY — PostgreSQL is completely unaffected (it keeps its
   native ``uuid`` rendering). The same idea covers ``postgresql.JSONB`` (→
   ``JSON``) so the ``SystemSetting`` / ``SettingsAuditLog`` tables also create
   on SQLite. This replaces the per-file ``-p uuid_shim`` plugin / per-fixture
   JSONB→JSON metadata mutation the earlier test rounds used.

2. ``app/services/__init__.py`` eagerly imports ``video_composition_service``
   which imports ``cv2``; OpenCV's binary extension is broken on this box
   (recursion error during load). Because importing almost anything under
   ``app.services`` triggers that ``__init__``, even pure-logic modules like
   ``app.services.rate_limiter`` became unimportable. We install a lightweight
   ``cv2`` stub into ``sys.modules`` — but ONLY if the real ``import cv2`` fails,
   so a healthy install with a working OpenCV is never shadowed.

Both shims are intentionally conservative: they activate only for the SQLite
test dialect / only when the real dependency is broken, so they cannot change
behaviour in production or on a correctly-provisioned CI box.
"""

from __future__ import annotations

import sys
import types

import pytest
import pytest_asyncio


# ---------------------------------------------------------------------------
# Blocker #2 (install FIRST, before anything imports app.services): cv2 stub.
# ---------------------------------------------------------------------------
def _install_cv2_stub_if_broken() -> None:
    """Install a no-op ``cv2`` stub IFF the real OpenCV import fails.

    Guarded: we try the real import first and only fall back to the stub when
    it raises (the broken-binary case on this dev box). On a machine with a
    working OpenCV this is a no-op and the genuine module is used.
    """
    if "cv2" in sys.modules:
        return
    try:  # real import first — never shadow a working OpenCV.
        import cv2  # noqa: F401

        return
    except Exception:
        pass

    stub = types.ModuleType("cv2")
    stub.__dict__["__doc__"] = (
        "Test stub for cv2 — installed by tests/conftest.py because the real "
        "OpenCV binary failed to import in this environment. Only the import "
        "is satisfied; no real image/video ops are provided."
    )

    def _unavailable(*_args, **_kwargs):  # pragma: no cover - defensive
        raise RuntimeError(
            "cv2 is stubbed in the test environment; a test exercised a real "
            "OpenCV operation. Mock the cv2-using code path instead."
        )

    # A few commonly-referenced constants so module-level lookups don't explode.
    stub.__dict__.update(
        {
            "INTER_AREA": 3,
            "INTER_LINEAR": 1,
            "INTER_CUBIC": 2,
            "COLOR_BGR2RGB": 4,
            "COLOR_RGB2BGR": 4,
            "CAP_PROP_FPS": 5,
            "CAP_PROP_FRAME_COUNT": 7,
            "CAP_PROP_FRAME_WIDTH": 3,
            "CAP_PROP_FRAME_HEIGHT": 4,
        }
    )

    # Any attribute access returns the "unavailable" sentinel callable so the
    # stub never silently returns wrong data — it fails loudly if actually used.
    class _StubModule(types.ModuleType):
        def __getattr__(self, name):  # noqa: D401
            return _unavailable

    real_stub = _StubModule("cv2")
    real_stub.__dict__.update(stub.__dict__)
    sys.modules["cv2"] = real_stub


_install_cv2_stub_if_broken()


# ---------------------------------------------------------------------------
# Blocker #1: PostgreSQL UUID / JSONB rendering on SQLite (dialect-scoped).
# ---------------------------------------------------------------------------
def _install_sqlite_pg_type_shims() -> None:
    """Teach SQLAlchemy to render ``postgresql.UUID``/``JSONB`` on SQLite.

    Uses ``@compiles(<type>, "sqlite")`` so ONLY the SQLite dialect compiler is
    affected. On PostgreSQL the native types render exactly as before. Safe to
    call more than once — ``@compiles`` simply re-registers the same handler.
    """
    from sqlalchemy.ext.compiler import compiles
    from sqlalchemy.dialects.postgresql import UUID as PG_UUID
    from sqlalchemy.dialects.postgresql import JSONB as PG_JSONB

    @compiles(PG_UUID, "sqlite")
    def _compile_pg_uuid_sqlite(element, compiler, **kw):  # noqa: ANN001
        # 36-char canonical UUID string storage on SQLite.
        return "CHAR(36)"

    @compiles(PG_JSONB, "sqlite")
    def _compile_pg_jsonb_sqlite(element, compiler, **kw):  # noqa: ANN001
        # JSONB has no SQLite equivalent; store as TEXT-backed JSON.
        return "JSON"


_install_sqlite_pg_type_shims()


# ---------------------------------------------------------------------------
# Existing fixtures (unchanged).
# ---------------------------------------------------------------------------
from sqlalchemy.ext.asyncio import (  # noqa: E402  (after shims on purpose)
    create_async_engine,
    async_sessionmaker,
    AsyncSession,
)
from app.models.db_models import Base  # noqa: E402


TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


@pytest_asyncio.fixture
async def db_session():
    """Provide a test database session with in-memory SQLite."""
    engine = create_async_engine(TEST_DATABASE_URL, echo=False)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with session_factory() as session:
        yield session

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

    await engine.dispose()


@pytest.fixture
def storage_root(tmp_path):
    """Provide a temporary storage root directory for tests."""
    storage_dir = tmp_path / "test_uploads"
    storage_dir.mkdir()
    return storage_dir
