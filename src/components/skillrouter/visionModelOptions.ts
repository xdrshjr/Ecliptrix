import type { RouterLlmSlot, RouterModel } from '@/lib/api/skillrouter';

/**
 * Vision calls go through the OpenAI-style image-input API; an Anthropic-protocol
 * model answers 404 there (spec R2-07). Such a model may stay saved, but must not
 * be picked anew for the vision slot.
 */
const VISION_SLOT: RouterLlmSlot = 'vision';

export interface SlotModelOption {
  model: RouterModel;
  /** Not selectable as a NEW choice for this slot. */
  disabled: boolean;
}

export interface SlotModelOptions {
  options: SlotModelOption[];
  /** The saved model cannot serve this slot (shown as a warning, never hidden). */
  selectedIncompatible: boolean;
}

/** True when `model` cannot serve the vision slot. */
export function isVisionIncompatible(slot: RouterLlmSlot, model: RouterModel): boolean {
  return slot === VISION_SLOT && model.protocol === 'anthropic';
}

/**
 * Dropdown entries for one slot. The currently saved model is never disabled or
 * dropped, otherwise a stored incompatible choice would silently vanish and the
 * user would face an empty select.
 */
export function buildSlotModelOptions(
  slot: RouterLlmSlot,
  models: readonly RouterModel[],
  selected: string,
): SlotModelOptions {
  const options = models.map((model) => ({
    model,
    disabled: isVisionIncompatible(slot, model) && model.id !== selected,
  }));
  const saved = models.find((model) => model.id === selected);
  return {
    options,
    selectedIncompatible: saved !== undefined && isVisionIncompatible(slot, saved),
  };
}
