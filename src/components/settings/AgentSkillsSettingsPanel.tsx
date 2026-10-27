'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import {
  deleteSkill, duplicateSkill, getSkill, listSkills, setSkillEnabled,
} from '@/lib/api/agentSkills';
import type { SkillSummary } from '@/types/agentSkills';
import ConfirmationDialog from '@/components/ui/ConfirmationDialog';
import SettingsSectionCard from './components/SettingsSectionCard';
import AgentSkillEditor, { type EditorMode } from './AgentSkillEditor';

/**
 * 设置中心「Agent 技能」面板：列表、启停、查看/编辑、复制为我的技能、删除、
 * 新建与导入。
 *
 * 设计基线：docs/plans/agent-steering-and-skills/spec.md §3.3.6。结构与其它设置
 * 面板一致：加载中只有 `role="status"`；加载失败只有 `role="alert"` + 重试；
 * 操作失败用 `role="alert"`，成功走 `NotificationContext`。
 */

interface EditorState {
  mode: EditorMode;
  skillId?: string;
  markdown: string;
}

type LoadState = { status: 'loading' } | { status: 'error'; message: string }
  | { status: 'ready'; skills: SkillSummary[] };

function suggestCopyId(id: string, taken: ReadonlySet<string>): string {
  const base = `${id}-copy`.slice(0, 36);
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now() % 1000}`;
}

const Badge: React.FC<{ tone?: 'default' | 'warn'; children: React.ReactNode }> = ({
  tone = 'default', children,
}) => (
  <span className={`rounded border px-1.5 py-0.5 text-[10px] ${
    tone === 'warn'
      ? 'border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300'
      : 'border-border text-muted-foreground'}`}>
    {children}
  </span>
);

interface RowProps {
  skill: SkillSummary;
  busy: boolean;
  onToggle: (skill: SkillSummary) => void;
  onOpen: (skill: SkillSummary) => void;
  onDuplicate: (skill: SkillSummary) => void;
  onDelete: (skill: SkillSummary) => void;
}

const SkillRow: React.FC<RowProps> = ({
  skill, busy, onToggle, onOpen, onDuplicate, onDelete,
}) => {
  const { t } = useLocale();
  const copy = t.agentCollab;
  const buttonClass = 'rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-accent disabled:opacity-50';
  return (
    <li className="rounded-md border border-border p-3" data-testid="skill-row">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium text-foreground">{skill.name}</span>
            <code className="text-xs text-muted-foreground">{skill.id}</code>
            <Badge>{skill.builtin ? copy.skillBuiltinBadge : copy.skillMineBadge}</Badge>
            {!skill.enabled && <Badge>{copy.skillsBadgeDisabled}</Badge>}
            {!skill.valid && <Badge tone="warn">{copy.skillsBadgeInvalid}</Badge>}
            {skill.shadowed && <Badge tone="warn">{copy.skillsBadgeShadowed}</Badge>}
          </div>
          <p className="mt-0.5 break-words text-xs text-muted-foreground">
            {skill.valid ? skill.description : skill.problem?.message}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={skill.enabled}
          aria-label={copy.skillsEnabledLabel.replace('{name}', skill.name)}
          disabled={busy || !skill.valid}
          onClick={() => onToggle(skill)}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 ${
            skill.enabled ? 'bg-primary' : 'bg-border'}`}
        >
          <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
            skill.enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={buttonClass} disabled={busy} onClick={() => onOpen(skill)}>
          {skill.builtin ? copy.skillsView : copy.skillsEdit}
        </button>
        <button type="button" className={buttonClass} disabled={busy || !skill.valid}
          onClick={() => onDuplicate(skill)}>
          {copy.skillsDuplicate}
        </button>
        {!skill.builtin && (
          <button type="button" className={buttonClass} disabled={busy} onClick={() => onDelete(skill)}>
            {copy.skillsDelete}
          </button>
        )}
      </div>
    </li>
  );
};

const AgentSkillsSettingsPanel: React.FC = () => {
  const { t } = useLocale();
  const { showSuccess } = useNotification();
  const copy = t.agentCollab;
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SkillSummary | null>(null);

  const refresh = useCallback(async () => {
    setLoad({ status: 'loading' });
    try {
      setLoad({ status: 'ready', skills: await listSkills({ force: true }) });
    } catch (error) {
      setLoad({ status: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setActionError(copy.skillsActionFailed.replace('{message}', message));
    } finally {
      setBusy(false);
    }
  }, [copy]);

  const toggle = (skill: SkillSummary) => run(async () => {
    await setSkillEnabled(skill.id, !skill.enabled);
    await refresh();
  });

  const open = (skill: SkillSummary) => run(async () => {
    const detail = await getSkill(skill.id);
    setEditor({ mode: skill.builtin ? 'view' : 'edit', skillId: skill.id, markdown: detail.markdown });
  });

  const duplicate = (skill: SkillSummary) => run(async () => {
    const taken = new Set(load.status === 'ready' ? load.skills.map(item => item.id) : []);
    const created = await duplicateSkill(skill.id, suggestCopyId(skill.id, taken));
    showSuccess(copy.skillsCreated);
    await refresh();
    setEditor({ mode: 'edit', skillId: created.id, markdown: created.markdown });
  });

  const confirmDelete = () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    void run(async () => {
      await deleteSkill(target.id);
      showSuccess(copy.skillsDeleted);
      await refresh();
    });
  };

  const closeEditor = () => setEditor(null);
  const savedEditor = () => { setEditor(null); void refresh(); };

  return (
    <div className="space-y-4">
      <SettingsSectionCard title={copy.skillsTitle} description={copy.skillsDescription}>
        {load.status === 'loading' && (
          <p role="status" className="text-xs text-muted-foreground">{copy.skillsLoading}</p>
        )}
        {load.status === 'error' && (
          <div role="alert" className="space-y-2 text-xs text-red-600 dark:text-red-400">
            <p>{copy.skillsLoadFailed.replace('{message}', load.message)}</p>
            <button type="button" onClick={() => void refresh()}
              className="rounded-md border border-border px-2 py-1 text-foreground hover:bg-accent">
              {copy.skillsRetry}
            </button>
          </div>
        )}
        {load.status === 'ready' && (
          <>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy}
                onClick={() => setEditor({ mode: 'create', markdown: copy.skillsTemplate })}
                className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50">
                {copy.skillsNew}
              </button>
              <button type="button" disabled={busy}
                onClick={() => setEditor({ mode: 'import', markdown: '' })}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-accent disabled:opacity-50">
                {copy.skillsImport}
              </button>
            </div>
            {load.skills.length === 0 ? (
              <p className="text-xs text-muted-foreground">{copy.skillsEmpty}</p>
            ) : (
              <ul className="space-y-2" aria-label={copy.skillsTitle}>
                {load.skills.map(skill => (
                  <SkillRow
                    key={`${skill.builtin ? 'b' : 'u'}-${skill.id}`} skill={skill} busy={busy}
                    onToggle={toggle} onOpen={open} onDuplicate={duplicate}
                    onDelete={setPendingDelete}
                  />
                ))}
              </ul>
            )}
          </>
        )}
        {actionError && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">{actionError}</p>
        )}
      </SettingsSectionCard>

      {editor && (
        <SettingsSectionCard title={copy.skillsTitle}>
          <AgentSkillEditor
            key={`${editor.mode}-${editor.skillId ?? 'new'}`}
            mode={editor.mode} skillId={editor.skillId}
            initialMarkdown={editor.markdown}
            onClose={closeEditor} onSaved={savedEditor}
          />
        </SettingsSectionCard>
      )}

      <ConfirmationDialog
        isOpen={pendingDelete !== null}
        title={copy.skillsDeleteTitle}
        message={copy.skillsDeleteConfirm.replace('{name}', pendingDelete?.name ?? '')}
        type="danger"
        confirmText={copy.skillsDelete}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
};

export default AgentSkillsSettingsPanel;
