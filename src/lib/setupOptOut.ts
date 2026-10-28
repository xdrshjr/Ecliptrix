import type { CapabilityId } from '@/lib/api/setupStatus';

/**
 * "I don't want this capability" memory (D7). Lives in localStorage so it
 * survives restarts; a desktop port drift only loses it, which re-shows the
 * wizard — the safe direction. Only extended capabilities may be opted out of.
 */
export const SETUP_OPT_OUT_KEY = 'ecliptrix-setup-optouts';

const OPT_OUT_CAPABILITIES: readonly CapabilityId[] = ['research', 'web_search'];

function isOptOutCapability(value: unknown): value is CapabilityId {
  return OPT_OUT_CAPABILITIES.includes(value as CapabilityId);
}

/** Read the stored opt-outs; storage faults and junk degrade to "none". */
export function readOptOuts(): CapabilityId[] {
  try {
    const raw = window.localStorage.getItem(SETUP_OPT_OUT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isOptOutCapability) : [];
  } catch {
    return [];
  }
}

function writeOptOuts(ids: CapabilityId[]): void {
  try {
    window.localStorage.setItem(SETUP_OPT_OUT_KEY, JSON.stringify(ids));
  } catch {
    /* storage unavailable — degrade to "remind every launch" */
  }
}

/** Remember that the user chose not to use `id`. Core ids are ignored. */
export function addOptOut(id: CapabilityId): void {
  if (!isOptOutCapability(id)) return;
  const current = readOptOuts();
  if (!current.includes(id)) writeOptOuts([...current, id]);
}

/** Undo an opt-out (settings page, or the user configured it after all). */
export function removeOptOut(id: CapabilityId): void {
  writeOptOuts(readOptOuts().filter((existing) => existing !== id));
}
