import { useCallback, useMemo } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import type { UseContextMemoryReturn } from '@/components/video/hooks/useContextMemory';
import { buildComposerCommands, type ComposerCommand } from './composerCommands';

/**
 * Glue between the chat window and `useContextMemory`: the `/compact` command
 * and the ring button share one handler that turns a result into a notice.
 * Without `memory` there is no ring and no command.
 */
export function useChatCompaction(memory: UseContextMemoryReturn | undefined) {
  const { t } = useLocale();
  const { showSuccess, showWarning, showError } = useNotification();
  const copy = t.agentContext;
  const enabled = memory !== undefined;
  const compactNow = memory?.compactNow;

  const commands = useMemo(() => (enabled ? buildComposerCommands(copy) : []), [enabled, copy]);

  const handleCompact = useCallback(async () => {
    const result = await compactNow?.();
    if (result === 'compacted') showSuccess(copy.done);
    else if (result === 'too_short') showWarning(copy.tooShort);
    else if (result === 'failed') showError(copy.failed);
  }, [compactNow, copy, showSuccess, showWarning, showError]);

  const onCommand = useCallback((command: ComposerCommand) => {
    if (command.id === 'compact') void handleCompact();
  }, [handleCompact]);

  return { commands, onCommand, handleCompact };
}
