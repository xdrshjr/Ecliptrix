/**
 * The desktop build has exactly one owner. This mirrors
 * `LOCAL_OWNER_ID` in `backend-services/basic-service/app/constants.py`
 * — the two values MUST stay identical; the backend docstring points back
 * at this file.
 *
 * It is passed as the `user_id` query parameter of the material APIs. The
 * backend ignores it for *reads* (D13: listing enumerates every `user_*`
 * directory so pre-refactor material stays visible) and uses it for the
 * *write* path (new files land under `user_<LOCAL_OWNER_ID>/`).
 */
export const LOCAL_OWNER_ID = '00000000-0000-0000-0000-000000000001';
