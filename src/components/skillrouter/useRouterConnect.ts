'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import {
  DEFAULT_ROUTER_BASE_URL,
  describeRouterFailure,
  updateSkillRouter,
  verifySkillRouter,
  type RouterErrorDescription,
  type SkillRouterPatch,
  type SkillRouterStatus,
  type SkillRouterVerifyResult,
} from '@/lib/api/skillrouter';

/** Wait after a paste so the value has settled before the check is sent. */
export const AUTO_VERIFY_DELAY_MS = 600;

export type ConnectPhase = 'idle' | 'verifying' | 'saving';

export interface UseRouterConnectOptions {
  status: SkillRouterStatus;
  onSaved: (status: SkillRouterStatus) => void;
  onVerified?: (result: SkillRouterVerifyResult) => void;
  autoVerify: boolean;
  /** Tells the host whether an unsaved key is typed (to confirm before closing). */
  onDraftChange?: (hasDraft: boolean) => void;
}

/** Pasted keys often carry a trailing newline or stray spaces. */
export function cleanKeyInput(raw: string): string {
  return raw.replace(/\s+/g, '');
}

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

/**
 * State machine behind the connection card: verify (zero cost) then save.
 * The key lives only in this hook's state and is dropped after a save.
 *
 * Longer than the usual 50 lines on purpose: verify, save, the paste timer and
 * the stale-result guard all share one set of refs, and splitting them would
 * only thread those refs through several hooks. Revisit if a fourth action is added.
 */
export function useRouterConnect({
  status,
  onSaved,
  onVerified,
  autoVerify,
  onDraftChange,
}: UseRouterConnectOptions) {
  const { t } = useLocale();
  const [key, setKeyState] = useState('');
  const [baseUrl, setBaseUrl] = useState(status.baseUrl || DEFAULT_ROUTER_BASE_URL);
  const [phase, setPhase] = useState<ConnectPhase>('idle');
  const [result, setResult] = useState<SkillRouterVerifyResult | null>(null);
  const [error, setError] = useState<RouterErrorDescription | null>(null);
  const [pasteTick, setPasteTick] = useState(0);
  const sequenceRef = useRef(0);
  const latestRef = useRef({ key, baseUrl });
  latestRef.current = { key, baseUrl };

  useEffect(() => {
    onDraftChange?.(key !== '');
  }, [key, onDraftChange]);

  const hasSavedKey = status.keyConfigured;
  const baseUrlChanged = normalizeBaseUrl(baseUrl) !== normalizeBaseUrl(status.baseUrl || DEFAULT_ROUTER_BASE_URL);

  const resetOutcome = useCallback(() => {
    sequenceRef.current += 1;
    setResult(null);
    setError(null);
    setPhase('idle');
  }, []);

  const setKey = useCallback(
    (raw: string) => {
      setKeyState(cleanKeyInput(raw));
      resetOutcome();
    },
    [resetOutcome],
  );

  const changeBaseUrl = useCallback(
    (raw: string) => {
      setBaseUrl(raw);
      resetOutcome();
    },
    [resetOutcome],
  );

  const verify = useCallback(async () => {
    const { key: apiKey, baseUrl: url } = latestRef.current;
    if (!apiKey && !hasSavedKey) return;
    const ticket = ++sequenceRef.current;
    setPhase('verifying');
    setError(null);
    try {
      const verified = await verifySkillRouter({
        ...(apiKey ? { apiKey } : {}),
        ...(normalizeBaseUrl(url) ? { baseUrl: normalizeBaseUrl(url) } : {}),
      });
      if (ticket !== sequenceRef.current) return;
      setResult(verified);
      onVerified?.(verified);
    } catch (failure) {
      if (ticket === sequenceRef.current) setError(describeRouterFailure(failure, t));
    } finally {
      if (ticket === sequenceRef.current) setPhase('idle');
    }
  }, [hasSavedKey, onVerified, t]);

  const verifyRef = useRef(verify);
  verifyRef.current = verify;
  useEffect(() => {
    if (pasteTick === 0 || !autoVerify) return undefined;
    const timer = setTimeout(() => void verifyRef.current(), AUTO_VERIFY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [pasteTick, autoVerify]);

  const save = useCallback(async () => {
    const { key: apiKey, baseUrl: url } = latestRef.current;
    const patch: SkillRouterPatch = { mode: 'router' };
    if (apiKey) patch.apiKey = apiKey;
    if (baseUrlChanged) patch.baseUrl = normalizeBaseUrl(url);
    setPhase('saving');
    setError(null);
    try {
      const saved = await updateSkillRouter(patch);
      setKeyState('');
      onSaved(saved);
    } catch (failure) {
      setError(describeRouterFailure(failure, t));
    } finally {
      setPhase('idle');
    }
  }, [baseUrlChanged, onSaved, t]);

  const markPasted = useCallback(() => setPasteTick((tick) => tick + 1), []);

  return {
    key,
    setKey,
    baseUrl,
    setBaseUrl: changeBaseUrl,
    baseUrlChanged,
    phase,
    result,
    error,
    hasSavedKey,
    canVerify: key !== '' || hasSavedKey,
    verify,
    save,
    markPasted,
  };
}
