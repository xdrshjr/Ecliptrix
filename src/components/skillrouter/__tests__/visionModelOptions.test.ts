import { describe, expect, it } from 'vitest';
import type { RouterModel } from '@/lib/api/skillrouter';
import { buildSlotModelOptions, isVisionIncompatible } from '../visionModelOptions';

const openai: RouterModel = { id: 'gpt', label: 'GPT', protocol: 'openai', isRoute: false };
const claude: RouterModel = { id: 'claude', label: 'Claude', protocol: 'anthropic', isRoute: false };
const route: RouterModel = { id: 'route', label: 'Route', protocol: 'route', isRoute: true };

describe('visionModelOptions', () => {
  it('flags only Anthropic-protocol models, and only for the vision slot', () => {
    expect(isVisionIncompatible('vision', claude)).toBe(true);
    expect(isVisionIncompatible('vision', openai)).toBe(false);
    expect(isVisionIncompatible('vision', route)).toBe(false);
    expect(isVisionIncompatible('chat', claude)).toBe(false);
    expect(isVisionIncompatible('research', claude)).toBe(false);
  });

  it('disables a new incompatible pick but never removes any option', () => {
    const { options, selectedIncompatible } = buildSlotModelOptions('vision', [openai, claude, route], 'gpt');
    expect(options.map((o) => o.model.id)).toEqual(['gpt', 'claude', 'route']);
    expect(options.map((o) => o.disabled)).toEqual([false, true, false]);
    expect(selectedIncompatible).toBe(false);
  });

  it('keeps the saved incompatible model selectable and reports it', () => {
    const { options, selectedIncompatible } = buildSlotModelOptions('vision', [openai, claude], 'claude');
    expect(options.every((o) => !o.disabled)).toBe(true);
    expect(selectedIncompatible).toBe(true);
  });

  it('is inert for slots other than vision and for unknown saved ids', () => {
    expect(buildSlotModelOptions('chat', [openai, claude], 'claude').options.every((o) => !o.disabled)).toBe(true);
    expect(buildSlotModelOptions('vision', [openai], 'gone').selectedIncompatible).toBe(false);
  });
});
