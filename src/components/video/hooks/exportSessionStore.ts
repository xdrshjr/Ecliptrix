/**
 * exportSessionStore — export progress that outlives the editor (EXO-14).
 *
 * Switching task or project unmounts the editor while the backend keeps
 * rendering. Keeping the session in a module-level store lets a remounted
 * editor show the running export again and refuse to start a second one.
 * Sessions are keyed by `taskId:projectId` (RV3-07): two projects of one task
 * export independently. The hook reads it through `useSyncExternalStore`, so
 * every update replaces the session object instead of mutating it.
 *
 * A session is owned by the `AbortController` that began it. Writes from an
 * older run (its success tick timer, a late poll) never touch a newer session
 * under the same key. `finished` is the short success tick after the
 * download: still shown, but it no longer blocks a new export.
 */

import type { CompositionStage } from '@/lib/api/videoComposition';

export interface ExportSession {
  status: 'running' | 'finished';
  progress: number;
  startTime: number;
  stage?: CompositionStage;
  compositionId?: string;
  /** Owns the session; aborting it stops the client-side poll. */
  controller: AbortController;
}

export type ExportSessionPatch = Partial<
  Pick<ExportSession, 'status' | 'progress' | 'stage' | 'compositionId'>
>;

const sessions = new Map<string, ExportSession>();
const listeners = new Set<() => void>();

function notifyListeners(): void {
  listeners.forEach((listener) => listener());
}

/** `taskId:projectId`, or the task id alone when no project is bound. */
export function exportSessionKey(taskId: string, projectId?: string): string {
  return projectId ? `${taskId}:${projectId}` : taskId;
}

export function getExportSession(sessionKey: string): ExportSession | undefined {
  return sessions.get(sessionKey);
}

/** Starts a session; returns false, changing nothing, while one is already running. */
export function beginExportSession(sessionKey: string, controller: AbortController): boolean {
  if (sessions.get(sessionKey)?.status === 'running') return false;
  sessions.set(sessionKey, { status: 'running', progress: 0, startTime: Date.now(), controller });
  notifyListeners();
  return true;
}

/** Applies `patch` only to the session that `owner` began. */
export function updateExportSession(
  sessionKey: string,
  patch: ExportSessionPatch,
  owner: AbortController,
): void {
  const current = sessions.get(sessionKey);
  if (!current || current.controller !== owner) return;
  sessions.set(sessionKey, { ...current, ...patch });
  notifyListeners();
}

/** Ends the session that `owner` began; a newer session under the same key is kept. */
export function endExportSession(sessionKey: string, owner: AbortController): void {
  if (sessions.get(sessionKey)?.controller !== owner) return;
  sessions.delete(sessionKey);
  notifyListeners();
}

export function subscribeExportSessions(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
