"""Shared "is this a real credential?" predicate (setup-wizard-full-capability-coverage §3.2).

Placeholders are the values the desktop packaging step writes into the
bundled ``.env`` (``your_<key>_here``) plus the obvious hand-typed fillers.
The same predicate backs the model-provider keys, the Tavily keys and every
integration credential, so the wizard can never call a value "configured"
while the runtime would treat it as empty.

Relationship to ``desktop/scripts/lib/secret-shape.js``: that list answers
"which values may ship in the installer", this one answers "is this a usable
credential". It is therefore deliberately NARROWER: every pattern is anchored
to the whole string, and ``^sk-test``, an un-anchored ``EXAMPLE`` and the
``xxxxxxxx`` substring are NOT included. Adding them would reject genuine
keys that merely contain those characters and break the existing wizard tests
that use ``sk-test-secret-123``. The frontend mirror lives in
``src/components/Onboarding/wizard/modelHints.ts`` (``isPlaceholderKey``);
``tests/test_integrations_contract.py`` drives both with one sample table.
"""

from __future__ import annotations

import re
from typing import Optional

PLACEHOLDER_PATTERNS = (
    re.compile(r"^your_.*_here$", re.IGNORECASE),
    re.compile(r"^your_[a-z0-9_]*$", re.IGNORECASE),
    re.compile(r"^x+$", re.IGNORECASE),
    re.compile(r"^<.+>$"),
    re.compile(r"^(change|replace)[_-]?me$", re.IGNORECASE),
    re.compile(
        r"^(test|example|dummy|fake|sample|placeholder|todo|none|null)$",
        re.IGNORECASE,
    ),
    re.compile(r"^0+$"),
)


def is_placeholder(value: Optional[str]) -> bool:
    """True when the stripped value matches a known template placeholder."""
    stripped = (value or "").strip()
    return any(pattern.match(stripped) for pattern in PLACEHOLDER_PATTERNS)


def is_usable_secret(value: Optional[str]) -> bool:
    """True for a non-empty value that is not a template placeholder."""
    stripped = (value or "").strip()
    return bool(stripped) and not is_placeholder(stripped)
