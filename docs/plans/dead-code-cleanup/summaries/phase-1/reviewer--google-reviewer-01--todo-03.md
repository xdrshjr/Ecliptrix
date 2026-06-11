# Reviewer Report: TODO 03 — untracked-ops-junk-cleanup

## Meta

- **Role**: REVIEWER
- **Agent**: `google-reviewer-01` (Google Core Engineering Team)
- **Task**: TODO 03 (`specs/03-untracked-ops-junk-cleanup.md` / `todos/03-untracked-ops-junk-cleanup.md`)
- **Reviewing**: dev-03 output — delete 4 ops tarballs + 13 duplicate/one-off scratch scripts
- **Date**: 2026-06-11
- **Branch**: `feat/local-video-editing-refactor`
- **Verdict**: **PASS**

> Context reminder: these were UNTRACKED deletions with no git safety net. Top
> review priority = confirm NO in-use tool was destroyed. All evidence below is
> from independent verification against the live repo, not from trusting the dev
> summary.

---

## Findings per the 6 checks

### Check 1 — Tarballs gone ✅
`ls ops/*.tgz` returns nothing. All 4 (`_deploy.tgz`, `_fresh_deploy.tgz`,
`_update.tgz`, `_update_head.tgz`, ~272MB) are removed. These are
`git archive`-regenerable build artifacts; deletion is lossless per spec §3/§8.

### Check 2 — RED-LINE tools survive ✅
Both survive on disk:
- `ops/_dp_upload2.py` (5201 bytes, mtime 6/6 04:47)
- `ops/_dp_wait2.py` (1681 bytes, mtime 6/6 04:52)

The hard red line ("dev-03 不删 `_dp_upload2.py`/`_dp_wait2.py`") held.

### Check 3 — Deleted-list justification (all 13) ✅
All 13 confirmed GONE, each matching a high-confidence spec §4.2 rule:
- **Superseded-old-version pair** (delete old only if higher sibling kept):
  - `_dp_recover.py` deleted → `_dp_recover2.py` **still present** ✅
  - `_ssh_verify.py` deleted → `_ssh_verify2.py` **still present** ✅
  - Both surviving higher versions verified on disk. The rule "don't delete the
    old version unless the new one is kept" is satisfied.
- **Closed same-incident numbered series** (6): `_ssh_diag502.py` +
  `b/c/d/e/f` — the resolved 502-troubleshooting iteration, deleted as a group.
- **Merged-fix iteration** (3): `_ssh_fix_cors.py` / `2` / `3` — CORS fix that
  is already committed to the repo (the SSRF/CORS commits are in HEAD history).
- **Resolved one-off incident-response** (2): `_ssh_ir1.py` / `_ssh_ir2.py`.

### Check 4 — No over-deletion ✅
All borderline "2-variant" scripts the dev deliberately KEPT survive:
`_ssh_prod_check2`, `_ssh_alembic_fix2`, `_ssh_diag_reset2`, `_ssh_trace2`,
`_ssh_fix_python2`, `_ssh_seed_models2`, `_ssh_check_backend2`,
`_ssh_poll_sysdeps2`, `_dp_state2` — all present. The `_dp_check3` vs
`_dp_check_deps` / `_dp_check_extract` anti-pattern trio (explicitly flagged in
spec §4.2 as NOT a version pair) all survive — the dev correctly did not
cross-delete them.

### Check 5 — Whitelist soundness ✅ (the load-bearing check)
- The dev correctly **excluded `docs/plans/dead-code-cleanup/` self-mentions**
  from the whitelist grep. Verified this exclusion was *necessary*: each deleted
  name (`_ssh_diag502`, `_ssh_fix_cors`, `_ssh_ir1`, `_dp_recover`,
  `_ssh_verify`) appears in **3** cleanup-dir docs (spec+todo+summary). Without
  the exclusion every deletion candidate would have self-whitelisted and the
  task would have been a no-op. Good judgment, correctly reasoned.
- Confirmed the 13 deleted scripts are referenced by **NO non-cleanup doc**:
  `grep -rl <name> docs/ --exclude-dir=dead-code-cleanup` → clean for all.
- Confirmed **NO memory-dir reference** to any deleted bare name. One substring
  hit (`_ssh_verify` in `project_ecliptrix_deploy_pitfalls.md`) was investigated
  and resolves to **`_ssh_verify_final.py`** — a different, WHITELISTED script
  that survives on disk. The bare `_ssh_verify.py` is referenced **nowhere** in
  memory (`grep '_ssh_verify\.py'` → NONE). No false positive turned into a
  wrongful deletion.
- All 15 whitelist entries verified present on disk (incl. `_dp_upload.py`,
  `_dp_wait.py`, `_ssh_update_deploy.py` — kept despite "broken/superseded"
  memory notes, because doc-referenced; conservative bias is correct here).

### Check 6 — No git changes ✅
- `git status --short ops/` shows only 3 pre-existing tracked-file `M` entries
  (`config.env`, two `.service` templates) — untouched by this task — plus the
  `??` untracked survivors. No deletions appear (correct: untracked deletions
  don't surface in git status).
- HEAD unchanged: `fed1e02` ("fix: stop mid-clip preview play..."). No commit
  was produced, as mandated (commit authority belongs to dev-04 only).

---

## Additional verification (beyond the 6)

- **Counts match the dev claim exactly**: 35 `_dp_*.py`, 90 `_ssh_*.py`,
  3 `_*.sh`, 1 `_*.conf`. (142 enumerated − 13 deleted = 129 remaining.)
- **Out-of-scope `_*.py` correctly untouched**: `_import_gate.py`,
  `_llm_live.py`, `_tts_llm_check.py` are `_*.py` but not `_dp_*`/`_ssh_*`, so
  they fell outside the dev's enumeration glob and survive. This is correct —
  not in the deletion scope, and not erroneously swept.

## Concerns

- **None blocking.** Minor note: the dev's enumeration glob
  (`_dp_*.py`/`_ssh_*.py`) does not cover three other `ops/_*.py` scratch files
  (`_import_gate.py`, `_llm_live.py`, `_tts_llm_check.py`). They were left in
  place, which is the safe/conservative outcome, but they remain workspace
  clutter for a future pass. Out of scope for this TODO — not a defect.
- **Unrecoverable-deletion reminder**: per spec §2 these 13 scripts have no git
  recovery path. The deletion set was correctly limited to spec-§4.2 explicitly
  named high-confidence items; the full deleted list is recorded in the dev
  summary (Artifacts.A) for human traceability, satisfying the §2/§8 留痕
  requirement. If any deleted script is ever needed, recovery must come from a
  prior session or backup.

## Verdict rationale

All 4 tarballs removed; both red-line tools survived; all 13 deletions map to a
high-confidence superseded/closed-incident/resolved-IR rule with surviving
higher-version siblings verified on disk; zero over-deletion of kept variants;
whitelist correctly computed with the necessary cleanup-dir exclusion and zero
genuine doc/memory references to any deleted name; no git/HEAD changes.

**PASS.**
