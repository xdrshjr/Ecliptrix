'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WizardSlot } from '@/lib/api/modelSettings';
import type { CapabilityStatus } from '@/lib/api/setupStatus';
import { notifySetupConfigUpdated } from '@/lib/setupEvents';
import { saveOneSlot, saveSlots, type SlotStatus } from './slotSave';

interface ModelsStepArgs {
  providerId: string | null;
  models: string[];
  /** Slots this run may write (gaps in auto mode, everything in manual). */
  slots: WizardSlot[];
  capabilities: CapabilityStatus[];
  /** Called once every enabled slot has been saved. */
  onSaved: () => void;
}

type Flags<T> = Partial<Record<WizardSlot, T>>;

function isOwnReady(slot: WizardSlot, capabilities: CapabilityStatus[]): boolean {
  return capabilities.some((item) => item.id === slot && item.state === 'ready');
}

/**
 * Main-model choice + batch slot assignment (wizard step 2). Never overwrites
 * a ready slot unless the user ticked it (D4 — only possible in manual mode,
 * where ready slots start unticked).
 */
export function useModelsStep(args: ModelsStepArgs) {
  const { providerId, models, slots, capabilities, onSaved } = args;
  // `null` = the user has not typed yet, so the first listed model applies.
  const [typedModel, setMainModel] = useState<string | null>(null);
  const mainModel = typedModel ?? models[0] ?? '';
  const [enabled, setEnabled] = useState<Flags<boolean>>({});
  const [status, setStatus] = useState<Flags<SlotStatus>>({});
  const [errors, setErrors] = useState<Flags<string>>({});
  const [saving, setSaving] = useState(false);
  const [chatBlocked, setChatBlocked] = useState(false);

  // A different provider / model list invalidates whatever was typed before.
  useEffect(() => {
    setMainModel(null);
  }, [models]);

  useEffect(() => {
    setEnabled(
      Object.fromEntries(slots.map((slot) => [slot, !isOwnReady(slot, capabilities)])),
    );
    // Seeded when the slot set changes, not on every status refetch: a refetch
    // right after the first save must not re-tick rows the user unticked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots.join(',')]);

  const report = useCallback(
    (slot: WizardSlot, next: SlotStatus, message?: string) => {
      setStatus((prev) => ({ ...prev, [slot]: next }));
      setErrors((prev) => ({ ...prev, [slot]: next === 'error' ? message : undefined }));
    },
    [],
  );

  const toggleSlot = useCallback((slot: WizardSlot, value: boolean) => {
    setEnabled((prev) => ({ ...prev, [slot]: value }));
  }, []);

  const chosen = useMemo(() => slots.filter((slot) => enabled[slot]), [slots, enabled]);

  const save = useCallback(async () => {
    const model = mainModel.trim();
    if (!providerId || !model || chosen.length === 0) return;
    setSaving(true);
    setChatBlocked(false);
    setStatus({});
    const jobs = chosen.map((slot) => ({ slot, model }));
    const result = await saveSlots(jobs, providerId, report);
    setSaving(false);
    setChatBlocked(result.blockedByChat);
    notifySetupConfigUpdated();
    if (!result.blockedByChat && result.failed.length === 0) onSaved();
  }, [chosen, mainModel, onSaved, providerId, report]);

  const retry = useCallback(
    async (slot: WizardSlot) => {
      if (!providerId) return;
      const model = mainModel.trim();
      if (await saveOneSlot({ slot, model }, providerId, report)) {
        notifySetupConfigUpdated();
      }
    },
    [mainModel, providerId, report],
  );

  const hasAttempted = Object.keys(status).length > 0;
  const hasFailure = chosen.some((slot) => status[slot] === 'error');

  return {
    mainModel,
    enabled,
    status,
    errors,
    saving,
    chatBlocked,
    chosen,
    hasAttempted,
    hasFailure,
    canSave: Boolean(providerId && mainModel.trim() && chosen.length > 0) && !saving,
    setMainModel,
    toggleSlot,
    save,
    retry,
    proceedAnyway: onSaved,
  };
}
