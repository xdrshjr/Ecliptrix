/**
 * Camera motion — preset id → i18n key mapping.
 *
 * The preset table (`playback/camera/cameraPresets.ts`) is deliberately
 * language-neutral, so the UI resolves labels here. Keeping the map in one
 * place means a new preset fails loudly (falls back to its id) rather than
 * silently rendering an empty card.
 */

import type { Translations } from '@/lib/i18n';

type PresetLabels = Translations['timeline']['cameraMotion']['presets'];

const PRESET_LABEL_KEYS: Record<string, keyof PresetLabels> = {
  none: 'none',
  'push-in': 'pushIn',
  'pull-out': 'pullOut',
  'pan-left': 'panLeft',
  'pan-right': 'panRight',
  'pan-up': 'panUp',
  'pan-down': 'panDown',
  'zoom-pan-diagonal': 'zoomPanDiagonal',
  'roll-slight': 'rollSlight',
  'dolly-in-3d': 'dollyIn3d',
  'dolly-out-3d': 'dollyOut3d',
  'orbit-left': 'orbitLeft',
  'orbit-right': 'orbitRight',
  'tilt-down': 'tiltDown',
  'tilt-up': 'tiltUp',
  'parallax-push': 'parallaxPush',
  'sway-3d': 'sway3d',
  custom: 'custom',
};

export function presetLabel(presetId: string, labels: PresetLabels): string {
  const key = PRESET_LABEL_KEYS[presetId];
  return key ? labels[key] : presetId;
}
