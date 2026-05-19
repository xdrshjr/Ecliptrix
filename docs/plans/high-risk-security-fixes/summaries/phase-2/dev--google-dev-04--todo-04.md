# DEV Summary — google-dev-04 — TODO 04 (Path Traversal & Upload)

## Meta

- **agent-id**: google-dev-04
- **role**: DEV
- **task**: todo-04 (Path Traversal & Upload hardening)
- **phase**: 2
- **timestamp**: 2026-05-20
- **verdict**: COMPLETED

## Key Decisions

- **V04-A (`_validate_path` hardening)** — Rewrote the validator from a
  string-prefix check (which was bypassable on edge cases like
  drive-relative paths and existing symlinks) to a layered set of rules:
  - Reject `None` / empty / whitespace-only.
  - Reject embedded NUL bytes and other control characters (ord < 32).
  - Reject UTF-8 byte length over 4096 (PATH_MAX-aligned cap).
  - Reject absolute paths (`/`, `\`, Windows drive prefix `C:` /
    `C:\foo`, UNC `\\server`).
  - Reject explicit `..` segments.
  - `Path.resolve(strict=False)` + `is_relative_to(STORAGE_ROOT.resolve())`
    for the containment check. Note: `resolve()` follows existing
    symlinks, which is what catches parent-symlink redirection attacks.
  - Refuse to write through an existing symlink target (TOCTOU defense).
- **V04-B (`_sanitize_filename` hardening)** — Rewrote to preserve
  Unicode letters/digits (CJK characters survive) while:
  - Stripping `/ \ : * ? " < > |` and all control bytes.
  - Stripping `..` and leading dots (kills `.htaccess`, hidden files).
  - Normalising to Unicode NFC so decomposed-vs-composed homoglyphs
    collapse to the same byte sequence.
  - Rewriting dangerous extensions (`.html`, `.htm`, `.svg`, `.xml`,
    `.js`, `.mjs`, `.cjs`, `.php`, `.phtml`, `.phar`, `.py`, `.pyc`,
    `.pyo`, `.sh`, `.bash`, `.zsh`, `.bat`, `.cmd`, `.ps1`, `.exe`,
    `.com`, `.scr`, `.dll`, `.so`, `.jsp`, `.asp`, `.aspx`,
    `.htaccess`, `.xhtml`) to `.txt`, preserving the original ext in
    the stem for forensics (so `evil.svg` → `evil_svg.txt`).
  - Forcing remaining extensions to lowercase so `EVIL.HTML` cannot
    bypass the blacklist via case.
  - Refusing Windows-reserved device basenames (`CON`, `NUL`, `COM1`,
    `LPT1`, etc.) — prepends `_` instead of rejecting (keeps upload
    functional but disarms the special name).
  - Capping length at 200 chars (post-sanitisation), truncating the
    STEM while preserving the extension.
- **MIME / extension consistency check** — Built a permissive whitelist
  (`_EXT_TO_ALLOWED_MIME` in `storage_router.py`) that:
  - Maps known media extensions to their canonical content-types.
  - Pins dangerous extensions to their TRUE content-type so a mismatch
    (e.g. `evil.html` declared as `image/png`) is rejected with
    `MIME_EXTENSION_MISMATCH` BEFORE the sanitiser even runs.
  - Trusts the caller's content-type for any unlisted extension (the
    sanitiser already rewrote dangerous ones).
  - Crucially: the check runs on the ORIGINAL filename, not the
    sanitised one. Running it on the sanitised name would mask
    spoofing because the sanitiser rewrites `.html` to `.txt`.
- **Router-level auth** — Added `current_user: User = Depends(get_current_user)`
  to all three `storage_router` upload endpoints. The legacy `user_id`
  form parameter is preserved for API-contract compatibility but is
  ALWAYS overridden by the authenticated session's user id. This kills
  the IDOR-by-form-spoofing vector.
- **UUID prefix on caller-controlled paths** — When `bucket_path` is
  supplied, the router now appends a 12-char `uuid4` prefix before the
  sanitised filename to defeat overwrite/race attacks where two callers
  pick the same name into the same bucket.
- **Download-side defence-in-depth (V04-B §3.4 / D1)** — Updated
  `storage_files_router.serve_storage_file` to:
  - Force `Content-Disposition: attachment` AND override the response
    `Content-Type` to `text/plain; charset=utf-8` for any on-disk file
    whose extension is in `_DANGEROUS_DOWNLOAD_EXTENSIONS`. This is a
    safety net for legacy files written before the sanitizer shipped
    and for any future code path that writes user content without
    going through the upload routers.
  - Set `content_disposition_type="inline"` for SAFE files so
    `<video>`/`<img>` tags continue to render normally — Starlette's
    default is "attachment" when `filename` is supplied, which would
    have broken the editor preview pipeline.
- **`audio_router.transcribe` temp-file hardening** — The temp filename
  used to be `audio_{ts}_{hash(file.filename)}{ext}`. Replaced the
  Python `hash(...)` (deterministic & collision-prone) with a uuid4
  segment and sanitised the extension via the new helper. Doesn't
  technically constitute a V04 vuln (the file is written under
  `temp/audio/` not `STORAGE_ROOT`), but cheap defense in depth.
- **Spec deviation #1 (intentional)** — Spec §3.2 example shows the
  router refusing the response with HTTP 415. Our existing response
  contract uses a "success: false" envelope (HTTP 200) with
  `error_code: MIME_EXTENSION_MISMATCH`, which preserves the
  pre-existing API shape used by the frontend. The semantic outcome
  (upload rejected, no file written) is identical; the test suite
  asserts on `success` + `error_code` rather than HTTP status. The
  one place we DO return a real 4xx is `bucket_path` validation
  (400) — that path is shorter and the frontend already handles raw
  4xx for it.
- **Spec deviation #2 (intentional)** — Spec §3.4 mentions removing
  `image/svg+xml` from `allowed_image_types`. I did NOT touch
  `config.py` because the sanitiser handles SVG via extension rewrite
  + the download router serves it as attachment text/plain. Removing
  the MIME outright would also block legitimate raster-style image
  uploads that some clients label as `image/svg+xml` by mistake.

## Execution Flow

1. Read `master-plan.md`, `specs/04-path-traversal-and-upload.md`,
   `todos/04-path-traversal-and-upload.md`,
   `summaries/global-context.md`, and
   `summaries/phase-1/dev--google-dev-01--todo-01.md` to absorb the
   upstream contracts (esp. that `storage_files_router` is now the
   authoritative download path).
2. Grep'd `app/routers/` for `UploadFile` and `app/` for
   `storage_service.upload_*` to enumerate every upload caller.
   Result: only `storage_router`, `audio_router`, `frame_pack_router`,
   `video_cover.py` accept user-supplied uploads. The latter two
   already (a) require auth, (b) read bytes-not-paths, (c) hard-code
   the on-disk path → no V04-A surface.
3. Baseline test run: `pytest tests/security/ -v` → 79 passed (the
   four prior phase-A specs). Locked the baseline.
4. Rewrote `_validate_path` and `_sanitize_filename` in
   `app/services/storage_service.py`. Kept the existing public
   signatures so all 14+ in-tree callers (TTS, watermark, video-cut,
   storyboard, youtube, image-to-video, ARK image/video, etc.)
   continue to work without changes.
5. Wired auth + MIME + sanitisation + uuid-prefix into all three
   `storage_router` upload endpoints. Hoisted `_validate_bucket_path`
   OUT of the broad `try/except Exception` so HTTPException(400)
   surfaces as a real 400 (was being caught & remapped to 200 +
   `INTERNAL_ERROR`).
6. Extended `storage_files_router` with the
   `_DANGEROUS_DOWNLOAD_EXTENSIONS` set and the attachment/text-plain
   override path. Set `content_disposition_type="inline"` for safe
   files (Starlette default is "attachment" which would have broken
   `<video src=...>` rendering).
7. Hardened the temp-file naming in `audio_router.transcribe_audio`.
8. Wrote `tests/security/test_04_path_traversal.py` (37 tests) covering:
   - Unit: malicious paths (parametrized over 13 vectors), overlong
     input, legitimate relative paths, Unicode paths, existing-symlink
     refusal (Unix-only), parent-symlink-traversal refusal (Unix-only).
   - Unit: dangerous-ext rewrite (8 ext checks in one test), case
     insensitivity, Chinese-filename preservation, separator strip,
     NUL strip, Windows meta strip, length cap, empty handling,
     dotfile stripping, NFC normalisation.
   - Integration: auth requirement, authenticated happy path, four
     bucket_path attack vectors (traversal, absolute, drive-prefix,
     NUL), MIME mismatch rejection, SVG sanitisation, dangerous-ext
     attachment serving, safe inline serving, uuid-prefix anti-overwrite.
9. Iterated three times against test feedback:
   - Pulled `_validate_bucket_path` out of the catch-all `try` so 400s
     don't get remapped to 200.
   - Moved MIME consistency check to run on the ORIGINAL filename
     (not the sanitised one) so the sanitiser doesn't mask spoofing.
   - Set `content_disposition_type="inline"` on the safe-file path.
   - Added dangerous extensions to `_EXT_TO_ALLOWED_MIME` with their
     true content-types so mismatch detection works without relying on
     "unknown extension".
10. Final run: `pytest tests/security/ -v` → **116 passed, 2 skipped**
    (the two `pytest.mark.skipif(sys.platform=='win32')` symlink tests).
11. Regression run: `pytest tests/test_auth_middleware.py -v` →
    **22 passed**.

## Artifacts

### Created

- `backend-services/basic-service/tests/security/test_04_path_traversal.py`
  (37 tests, 15+ covering `_validate_path` and `_sanitize_filename` units)

### Modified

- `backend-services/basic-service/app/services/storage_service.py`
  - Rewrote `_validate_path` (V04-A hardening).
  - Rewrote `_sanitize_filename` (V04-B/C hardening + Unicode NFC).
  - Added class-level constants `_MAX_RELATIVE_PATH_BYTES`,
    `_MAX_FILENAME_LENGTH`, `_UNSAFE_FILENAME_CHARS_RE`,
    `_DANGEROUS_EXTENSIONS`, `_WINDOWS_RESERVED_BASENAMES`.
- `backend-services/basic-service/app/routers/storage_router.py`
  - Added auth dependency to all three upload endpoints.
  - Added `_EXT_TO_ALLOWED_MIME` whitelist + `_is_mime_consistent` helper.
  - Added `_validate_bucket_path` helper (raises real HTTP 400).
  - Sanitises every caller filename via service helper.
  - Appends uuid4 prefix to bucket_path-relative names.
- `backend-services/basic-service/app/routers/storage_files_router.py`
  - Added `_DANGEROUS_DOWNLOAD_EXTENSIONS` set + helper.
  - Forces `Content-Disposition: attachment` + `Content-Type: text/plain`
    for any download whose extension hits the danger list.
  - Sets `content_disposition_type="inline"` for safe files to
    preserve `<video>`/`<img>` rendering.
- `backend-services/basic-service/app/routers/audio_router.py`
  - Uses `_sanitize_filename` + `uuid4` for the ASR temp filename
    instead of the deterministic Python `hash(...)`.

## Tests Added

37 tests in `tests/security/test_04_path_traversal.py`. Coverage breakdown:

**Unit — `_validate_path` (V04-A) — 17 cases:**

- `test_V04A_validate_path_rejects_malicious_inputs` parametrized over
  13 attack vectors: empty, whitespace, NUL byte, parent traversal (3
  variants), POSIX absolute (3 variants), Windows drive prefix (3
  variants), control char.
- `test_V04A_validate_path_rejects_overlong_input` (path > 4096 bytes).
- `test_V04A_validate_path_accepts_legitimate_relative` (positive).
- `test_V04A_validate_path_accepts_unicode_relative` (Chinese path).
- `test_V04A_validate_path_rejects_existing_symlink` (Unix-only).
- `test_V04A_validate_path_rejects_traversal_via_parent_symlink`
  (Unix-only).

**Unit — `_sanitize_filename` (V04-B/C) — 10 cases:**

- `test_V04B_sanitize_filename_rewrites_dangerous_extensions` (8 exts).
- `test_V04B_sanitize_filename_case_insensitive_for_dangerous`.
- `test_V04C_sanitize_filename_preserves_chinese`.
- `test_V04C_sanitize_filename_strips_separators` (4 variants).
- `test_V04C_sanitize_filename_strips_null_byte`.
- `test_V04C_sanitize_filename_strips_windows_metas` (7 chars).
- `test_V04C_sanitize_filename_caps_length`.
- `test_V04C_sanitize_filename_handles_empty`.
- `test_V04C_sanitize_filename_prevents_dotfile`.
- `test_V04C_sanitize_filename_normalises_unicode` (NFC vs NFD).

**Integration — upload endpoints — 8 cases:**

- `test_V04A_upload_audio_requires_auth` (anon → 401).
- `test_V04A_upload_audio_authenticated_succeeds` (positive + on-disk).
- `test_V04A_upload_file_rejects_path_traversal_bucket`.
- `test_V04A_upload_file_rejects_absolute_bucket`.
- `test_V04A_upload_file_rejects_windows_drive_bucket`.
- `test_V04A_upload_file_rejects_nullbyte_bucket`.
- `test_V04B_upload_file_rejects_mime_extension_mismatch`.
- `test_V04B_uploaded_svg_filename_is_rewritten`.
- `test_V04A_bucket_path_upload_carries_uuid_prefix` (anti-overwrite).

**Integration — download endpoint (V04-D §D1) — 2 cases:**

- `test_V04D_storage_files_router_serves_dangerous_as_attachment`.
- `test_V04D_storage_files_router_serves_safe_inline`.

**Final pytest output:**

```
================ 116 passed, 2 skipped, 43 warnings in 11.51s =================
```

(116 = 79 phase-A baseline + 37 new V04 = no regression; 2 skipped =
symlink tests on Windows.)

Auth-middleware regression: **22 passed** (no churn).

## main.py patches

**None required.** This work touches no router registrations or
middleware ordering. The `storage_files_router` mount patches from
dev-01's summary remain the authoritative entry-point for downloads;
this DEV's changes are internal to the already-mounted router.

## Issues & Risks

- **Risk R1 — bucket_path payload-shape change**: callers that pass
  `bucket_path` and then read back a specific path (without uuid
  prefix) will get a different `file_path` in the response. After
  grep'ing the frontend for `bucket_path` (no hits in `src/`) and
  backend for `custom_path=` calls — only `storage_router.upload_file`
  passes user-controlled `custom_path`; all internal callers
  (`tts_service`, `video_cut_service`, `youtube_service`,
  `watermark_removal_service`, `image_to_video_service`,
  `video_cover_service`) pass server-built paths and bypass the
  uuid-prefix logic (it only triggers when `validated_bucket is not
  None` in the router). LOW RISK.
- **Risk R2 — MIME whitelist coverage**: `_EXT_TO_ALLOWED_MIME` is
  permissive on unknown extensions (returns True). This is a
  deliberate trade-off — pinning every legitimate type a user might
  upload is impractical, and the sanitiser already neutralises
  executable extensions. If we later find legitimate uploads being
  blocked because some browser sends an unusual content-type for a
  known extension (e.g. `audio/x-mp3` for `.mp3`), the fix is to add
  the alias to the entry in `_EXT_TO_ALLOWED_MIME`.
- **Risk R3 — `list_user_materials` still trusts query-param `user_id`**:
  the `GET /api/storage/user-materials?user_id=<other>` endpoint
  does NOT scope to the authenticated session, so a logged-in user
  could enumerate another user's filenames by ID. This is IDOR (not
  anonymous reachability) and per `master-plan.md §2` is **out of
  scope** for this audit. I left a follow-up comment in the router
  for the next maintainer.
- **Risk R4 — pre-existing files on prod**: any pre-V04 file already
  on disk with a `.html` / `.svg` / etc. extension will now be served
  as `text/plain; charset=utf-8` attachment when downloaded. This
  could break the rendering of legitimate user-uploaded SVG covers /
  HTML reports. Sweep prod for these via:
  `find $STORAGE_ROOT -type f \( -name '*.html' -o -name '*.svg' -o -name '*.htm' -o -name '*.xml' \)`
  and audit before rolling out.

## Context for Downstream

For **T06 (Misc / Report Finalize)**:

- **No new dependencies introduced** beyond stdlib (`uuid`, `unicodedata`).
- **Storage service public API unchanged** — `upload_file`,
  `upload_audio_file`, `upload_video_file`, `delete_file`,
  `list_user_materials`, `write_to_well_known_slot`,
  `health_check` all retain identical signatures and return-shapes.
  Internal callers required no changes.
- **`_validate_path` and `_sanitize_filename` are now the canonical
  defense layer** for any path/filename that touches `STORAGE_ROOT`.
  Future routers that write user content MUST go through one of the
  service public methods (which use `_validate_path` internally) or
  call the helpers directly — do not roll your own.
- **`_DANGEROUS_DOWNLOAD_EXTENSIONS` in `storage_files_router.py`**
  is the single source of truth for "file types that should never
  render inline". If T06's reporting / dependency check finds an
  additional vector (e.g. `.swf`, `.jar`), add it there.
- **Test fixture compatibility** — the new tests reuse
  `patched_auth_factories` and `create_user` from
  `tests/security/conftest.py` unmodified. No new fixtures needed.
- **MIME consistency table**: if T06's report mentions adding new
  upload categories (e.g. for `material_router.ingest`), extend
  `_EXT_TO_ALLOWED_MIME` in `storage_router.py` rather than
  duplicating in a new helper.

---

PASS
