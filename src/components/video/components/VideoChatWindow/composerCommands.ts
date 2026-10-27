import type { Translations } from '@/lib/i18n';
import { matchesQuery } from './composerTriggers';

/**
 * Slash commands offered next to skills in the `/` menu. A command runs an
 * editor action; it is not a skill and never travels to the agent.
 */

export type ComposerCommandId = 'compact';

export interface ComposerCommand {
  id: ComposerCommandId;
  name: string;
  /** The literal the user can type, e.g. `/compact`. */
  hint: string;
}

export function buildComposerCommands(copy: Translations['agentContext']): ComposerCommand[] {
  return [{ id: 'compact', name: copy.commandCompact, hint: copy.commandCompactHint }];
}

/** Commands matching what follows the `/`; shared by the menu and the keyboard logic. */
export function visibleCommands(
  commands: readonly ComposerCommand[], query: string,
): ComposerCommand[] {
  return commands.filter(command => matchesQuery(query, command.id, command.name));
}
