"""Process-wide constants for the single-user desktop build.

The user system (accounts, sessions, RBAC) was removed in the
`desktop-only-refactor`: the app now runs as an Electron shell bound to
`127.0.0.1` with exactly one human behind it. Everything that used to be
derived from the authenticated request is folded into the two constants
below.

The frontend mirror of `LOCAL_OWNER_ID` lives in `src/lib/localOwner.ts`;
the two values must stay identical.
"""

# The desktop app has exactly one owner. Every row that used to carry the
# authenticated user's id now carries this constant. It is a fixed UUID (not
# generated) so that a database created by one install is readable by the next.
LOCAL_OWNER_ID = "00000000-0000-0000-0000-000000000001"

# Display name written into audit rows. The desktop build has no user table,
# so every settings change is attributed to the single local owner.
LOCAL_OWNER_NAME = "local-owner"
