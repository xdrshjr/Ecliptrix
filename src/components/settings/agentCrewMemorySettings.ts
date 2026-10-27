/**
 * The five `agent_toolkit` keys added for the research crew and conversation
 * memory (spec docs/plans/agent-research-crew-and-context-memory §6). Kept out
 * of `AgentToolkitSettingsPanel` so its form model only gains one spread.
 */

export interface CrewMemorySettings {
  crew_enabled: boolean;
  crew_max_parallel: number;
  crew_member_timeout_s: number;
  auto_compact: boolean;
  auto_compact_ratio: number;
}

export type CrewMemoryNumericKey =
  'crew_max_parallel' | 'crew_member_timeout_s' | 'auto_compact_ratio';

export const CREW_MEMORY_DEFAULTS: CrewMemorySettings = {
  crew_enabled: true,
  crew_max_parallel: 3,
  crew_member_timeout_s: 90,
  auto_compact: true,
  auto_compact_ratio: 0.75,
};

export const CREW_MEMORY_LIMITS: Record<CrewMemoryNumericKey, {
  min: number; max: number; step: number;
}> = {
  crew_max_parallel: { min: 1, max: 3, step: 1 },
  crew_member_timeout_s: { min: 30, max: 180, step: 1 },
  auto_compact_ratio: { min: 0.6, max: 0.9, step: 0.05 },
};

const NUMERIC_KEYS = Object.keys(CREW_MEMORY_LIMITS) as CrewMemoryNumericKey[];
const BOOLEAN_KEYS = ['crew_enabled', 'auto_compact'] as const;

/** Read the five keys from a settings response; anything invalid falls back to the default. */
export function crewMemoryFrom(raw: Record<string, unknown>): CrewMemorySettings {
  const values: CrewMemorySettings = { ...CREW_MEMORY_DEFAULTS };
  for (const key of BOOLEAN_KEYS) {
    if (typeof raw[key] === 'boolean') values[key] = raw[key] as boolean;
  }
  for (const key of NUMERIC_KEYS) {
    const value = raw[key];
    if (typeof value === 'number' && Number.isFinite(value)) values[key] = value;
  }
  return values;
}

/** Only the keys that changed, as the settings endpoint expects. */
export function crewMemoryPayload(
  values: CrewMemorySettings, original: CrewMemorySettings,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const key of [...BOOLEAN_KEYS, ...NUMERIC_KEYS]) {
    if (values[key] !== original[key]) payload[key] = values[key];
  }
  return payload;
}

export function hasCrewMemoryRangeError(values: CrewMemorySettings): boolean {
  return NUMERIC_KEYS.some(key => {
    const { min, max } = CREW_MEMORY_LIMITS[key];
    return !(values[key] >= min && values[key] <= max);
  });
}
