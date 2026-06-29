# Bug Diagnosis Session

**Session UUID:** 3f4b47be-a321-48bc-a55b-55cc42a6a653
**Date:** 2026-06-29 04:39
**Mode:** Fully automatic
**Status:** Fixed

## Problem Description

Windows desktop packaging failed in the smoke-test phase. The supplied output showed the app starting successfully, then shutdown timing out, force-killing the process tree, and failing the residual-process gate:

- `graceful shutdown timed out force killing tree`
- `FAIL: residual processes after exit (now killed): PIDs 20076`

## Evidence Collected

- Build orchestrator log `desktop/cache/build-logs/build-20260629-042122.log` only reports the smoke command exit code.
- Failed run userData: `C:\Users\jdqqj\AppData\Local\Temp\ecliptrix-smoke-T5FAxd`
- Failed `process.log`: backend and frontend both became healthy at `2026-06-29T08:34:14Z`.
- Failed `main.log`: main window was created at `08:34:14Z`, shown at `08:34:16Z`, but only finished loading at `08:34:44Z`.
- The smoke script starts shutdown immediately after service/API/log checks, before proving the renderer window finished loading.
- A fresh rerun of `node desktop/scripts/smoke-test.js` against the same packaged output passed, confirming an intermittent timing/race failure rather than a deterministic packaging output failure.

## Root Cause Analysis

**Primary Hypothesis:**
`desktop/scripts/smoke-test.js:173-197` requests shutdown before the Electron main window is fully loaded, then assumes fixed sleeps are enough after a forced Windows `taskkill`.

**Why this causes the problem:**
In the failed run, the renderer load finished around the same time the smoke script's 30 second shutdown timeout expired. The early `taskkill /PID` did not drive the app through its normal `before-quit` cleanup path, and the fallback `taskkill /T /F` was followed by fixed sleeps rather than polling `processesUnder(unpackedDir)` until Windows finished tearing down descendant processes. That leaves a race where the residual-process gate can observe a process that is already being killed but has not disappeared from WMI yet.

**Alternative Possibilities:**
1. A real child-service shutdown leak in `desktop/main/processManager.js`. Current logs argue against this for the passing run because `frontend stopping...` and `backend stopping...` appeared when the app was allowed to reach normal quit.
2. A Windows-only `taskkill` delay after force-kill. This is part of the observed failure and should be handled by polling instead of a fixed sleep.

## Fix Plan

1. Add a tested helper that waits for `processesUnder(rootDir)` to become empty and returns the final observed leftovers on timeout.
2. Update the smoke test to wait for `main.log` to show the main window finished loading before requesting shutdown.
3. Replace fixed post-kill sleeps with the new process-drain helper.

## Verification Plan

- Run `node desktop/scripts/lib/process-cleanup.test.js` and observe the new test fail before implementation.
- Implement the minimal helper and smoke-test changes.
- Run `node desktop/scripts/lib/process-cleanup.test.js`.
- Run `node desktop/scripts/smoke-test.js` against `desktop/release/win-unpacked/Ecliptrix.exe`.

## Fix Applied

**Files modified:**
- `desktop/scripts/lib/process-cleanup.js` - added `waitForNoProcessesUnder()` to poll process enumeration until Windows has actually removed killed processes, returning final leftovers on timeout.
- `desktop/scripts/lib/process-cleanup.test.js` - added red/green regression coverage for successful drain and timeout-with-leftovers behavior.
- `desktop/scripts/smoke-test.js` - waits for `main.log` to report `main window finished load` before requesting shutdown, and uses `waitForNoProcessesUnder()` instead of fixed sleeps after force-kill and before the residual-process gate.

**Changes:**
The smoke test now avoids closing the packaged Electron app while the renderer window is still loading, which was the timing pattern observed in the failed run. It also treats Windows `taskkill` as asynchronous from the perspective of WMI/process enumeration and polls until the process list clears.

## Verification

- RED check: `node desktop\scripts\lib\process-cleanup.test.js` failed with `TypeError: waitForNoProcessesUnder is not a function` before implementation.
- Unit regression: `node desktop\scripts\lib\process-cleanup.test.js` passed.
- Direct smoke: `node M:\takoAI\Ecliptrix\desktop\scripts\smoke-test.js` passed and printed `main window loaded ok` and `PASS`.
- Packaging orchestration: `.\build.ps1 -Dir -SkipFrontend -SkipBackend` passed, including the smoke-test phase.

## Notes

- The working tree already had many unrelated changes, including pre-existing auth-removal changes in `desktop/scripts/smoke-test.js`; those were left intact.
- Full frontend/backend rebuild was not run; the verification reused existing frontend/backend build artifacts because the reported failure was in packaging/smoke shutdown.
