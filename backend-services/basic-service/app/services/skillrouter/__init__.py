"""SkillRouter capability gateway integration (docs/plans/skillrouter-capability-gateway).

Public surface used by every seam: ``is_routed`` (the single routing decision),
``get_snapshot`` and ``require_ready``. Adapters live in sibling modules and are
imported by the seam that needs them.
"""

from app.services.skillrouter.config import (  # noqa: F401
    RouterSnapshot, get_snapshot, is_routed, require_ready,
)
from app.services.skillrouter.errors import RouterError  # noqa: F401
