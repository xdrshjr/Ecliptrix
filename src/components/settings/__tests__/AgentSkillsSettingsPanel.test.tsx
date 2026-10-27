import React from 'react';
import {
  act, cleanup, fireEvent, render, screen, waitFor, within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import type { SkillSummary } from '@/types/agentSkills';
import AgentSkillsSettingsPanel from '../AgentSkillsSettingsPanel';

const copy = translations.en.agentCollab;

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations.en, locale: 'en' }),
}));
const notify = vi.hoisted(() => ({ showSuccess: vi.fn() }));
vi.mock('@/contexts/NotificationContext', () => ({ useNotification: () => notify }));

const api = vi.hoisted(() => ({
  listSkills: vi.fn(), getSkill: vi.fn(), createSkill: vi.fn(), updateSkill: vi.fn(),
  deleteSkill: vi.fn(), setSkillEnabled: vi.fn(), duplicateSkill: vi.fn(), validateSkill: vi.fn(),
}));
vi.mock('@/lib/api/agentSkills', () => api);

function skill(id: string, patch: Partial<SkillSummary> = {}): SkillSummary {
  return {
    id, name: `Skill ${id}`, description: `about ${id}`, version: 1, tools: [], requires: [],
    builtin: false, enabled: true, valid: true, shadowed: false, problem: null,
    body_chars: 12, updated_at: '', ...patch,
  };
}

const VALID_PREVIEW = {
  valid: true, id: 'my-skill', name: 'Mine', description: 'desc', version: 1,
  tools: ['search_video'], requires: ['web'], body: 'FULL BODY TEXT', body_chars: 14,
  body_bytes: 14, warnings: ['a warning'],
};

beforeEach(() => {
  vi.clearAllMocks();
  api.listSkills.mockResolvedValue([
    skill('explainer-video', { builtin: true }), skill('my-skill'),
    skill('broken-one', { valid: false, enabled: false, name: 'broken-one', description: '',
      problem: { error_code: 'invalid_skill', message: 'frontmatter is not valid YAML' } }),
  ]);
  api.validateSkill.mockResolvedValue(VALID_PREVIEW);
});
afterEach(cleanup);

async function renderPanel() {
  render(<AgentSkillsSettingsPanel />);
  await screen.findAllByTestId('skill-row');
}

describe('AgentSkillsSettingsPanel', () => {
  it('shows only a status while loading, then the rows with their badges', async () => {
    api.listSkills.mockReturnValue(new Promise(() => undefined));
    render(<AgentSkillsSettingsPanel />);
    expect(screen.getByRole('status').textContent).toBe(copy.skillsLoading);
    expect(screen.queryByTestId('skill-row')).toBeNull();
  });

  it('lists built-in, mine and invalid skills with the right actions', async () => {
    await renderPanel();
    const rows = screen.getAllByTestId('skill-row');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText(copy.skillBuiltinBadge)).toBeTruthy();
    expect(within(rows[0]).queryByRole('button', { name: copy.skillsDelete })).toBeNull();
    expect(within(rows[0]).getByRole('button', { name: copy.skillsView })).toBeTruthy();
    expect(within(rows[1]).getByRole('button', { name: copy.skillsDelete })).toBeTruthy();
    expect(within(rows[2]).getByText(copy.skillsBadgeInvalid)).toBeTruthy();
    expect(within(rows[2]).getByText('frontmatter is not valid YAML')).toBeTruthy();
    const invalidSwitch = within(rows[2]).getByRole('switch') as HTMLButtonElement;
    expect(invalidSwitch.disabled).toBe(true);
  });

  it('reports a load failure with role=alert and no list, and retries', async () => {
    api.listSkills.mockRejectedValueOnce(new Error('backend down'));
    render(<AgentSkillsSettingsPanel />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('backend down');
    expect(screen.queryByTestId('skill-row')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: copy.skillsRetry }));
    await screen.findAllByTestId('skill-row');
  });

  it('toggles a skill through the switch and refreshes', async () => {
    api.setSkillEnabled.mockResolvedValue({ id: 'my-skill', enabled: false });
    await renderPanel();
    const toggle = screen.getByRole('switch', { name: 'Enable skill Skill my-skill' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    await act(async () => { fireEvent.click(toggle); });
    expect(api.setSkillEnabled).toHaveBeenCalledWith('my-skill', false);
    expect(api.listSkills).toHaveBeenCalledTimes(2);
  });

  it('surfaces an action failure as an alert', async () => {
    api.setSkillEnabled.mockRejectedValue(new Error('disk full'));
    await renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'Enable skill Skill my-skill' }));
    });
    expect((await screen.findByRole('alert')).textContent).toContain('disk full');
  });

  it('opens a built-in skill read-only and offers no save', async () => {
    api.getSkill.mockResolvedValue({ markdown: '---\nid: explainer-video\n---\nbody' });
    await renderPanel();
    await act(async () => {
      fireEvent.click(within(screen.getAllByTestId('skill-row')[0])
        .getByRole('button', { name: copy.skillsView }));
    });
    const editor = await screen.findByTestId('skill-editor');
    expect(within(editor).getByText(copy.skillsBuiltinReadonly)).toBeTruthy();
    expect((within(editor).getByLabelText(copy.skillsMarkdownLabel) as HTMLTextAreaElement).readOnly).toBe(true);
    expect(within(editor).queryByRole('button', { name: copy.skillsSave })).toBeNull();
  });

  it('copies a skill as mine and opens the copy for editing', async () => {
    api.duplicateSkill.mockResolvedValue({ id: 'explainer-video-copy', markdown: 'MD' });
    await renderPanel();
    await act(async () => {
      fireEvent.click(within(screen.getAllByTestId('skill-row')[0])
        .getByRole('button', { name: copy.skillsDuplicate }));
    });
    expect(api.duplicateSkill).toHaveBeenCalledWith('explainer-video', 'explainer-video-copy');
    expect(await screen.findByRole('heading', { name: copy.skillsEditorTitleEdit })).toBeTruthy();
  });

  it('deletes only after a confirmation', async () => {
    api.deleteSkill.mockResolvedValue({ id: 'my-skill', deleted: true });
    await renderPanel();
    fireEvent.click(within(screen.getAllByTestId('skill-row')[1])
      .getByRole('button', { name: copy.skillsDelete }));
    expect(api.deleteSkill).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: copy.skillsDelete }));
    });
    expect(api.deleteSkill).toHaveBeenCalledWith('my-skill');
  });
});

describe('import / create (AC-B2, spec 风险 R3)', () => {
  it('shows the FULL body and the tools to preload before the skill can be created', async () => {
    api.createSkill.mockResolvedValue({ id: 'my-skill' });
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: copy.skillsImport }));
    const editor = await screen.findByTestId('skill-editor');
    expect(within(editor).getByRole('note').textContent).toBe(copy.skillsImportHint);
    const create = within(editor).getByRole('button', { name: copy.skillsCreate }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);

    fireEvent.change(within(editor).getByLabelText(copy.skillsMarkdownLabel),
      { target: { value: '---\nid: my-skill\n---\nbody' } });
    const preview = await within(editor).findByTestId('skill-preview-valid');
    expect(preview.textContent).toContain('FULL BODY TEXT');
    expect(preview.textContent).toContain('This skill will preload these tools: search_video');
    expect(preview.textContent).toContain('a warning');
    expect(create.disabled).toBe(false);

    await act(async () => { fireEvent.click(create); });
    expect(api.createSkill).toHaveBeenCalledWith('---\nid: my-skill\n---\nbody');
    expect(notify.showSuccess).toHaveBeenCalledWith(copy.skillsCreated);
  });

  it('keeps Save disabled and explains why while the markdown is invalid', async () => {
    api.validateSkill.mockResolvedValue({
      valid: false, error_code: 'invalid_skill', message: 'description must be one line' });
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: copy.skillsNew }));
    const editor = await screen.findByTestId('skill-editor');
    const alert = await within(editor).findByTestId('skill-preview-invalid');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('description must be one line');
    expect((within(editor).getByRole('button', { name: copy.skillsCreate }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('reports a failed save with role=alert and stays open', async () => {
    api.createSkill.mockRejectedValue(new Error('skill_exists'));
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: copy.skillsNew }));
    const editor = await screen.findByTestId('skill-editor');
    await within(editor).findByTestId('skill-preview-valid');
    await act(async () => {
      fireEvent.click(within(editor).getByRole('button', { name: copy.skillsCreate }));
    });
    await waitFor(() => {
      expect(within(editor).getAllByRole('alert').some(node => node.textContent?.includes('skill_exists'))).toBe(true);
    });
    expect(screen.getByTestId('skill-editor')).toBeTruthy();
  });
});
