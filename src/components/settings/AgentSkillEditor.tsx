'use client';

import React, { useEffect, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import { createSkill, updateSkill, validateSkill } from '@/lib/api/agentSkills';
import type { ValidateResult } from '@/types/agentSkills';

/**
 * 技能编辑器：左侧 SKILL.md 文本域，右侧「预览与校验」。
 *
 * 设计基线：docs/plans/agent-steering-and-skills/spec.md §3.3.6。
 * - 校验走 `POST /validate`（防抖 400ms，不落盘），未通过则「保存」禁用；
 * - 预览**始终展示完整正文**与「将预加载的工具」：导入的外来文本是提示词注入
 *   的潜在载体，用户必须先看到再创建（风险 R3）；
 * - 内置技能只读。
 */

const VALIDATE_DEBOUNCE_MS = 400;

export type EditorMode = 'create' | 'import' | 'edit' | 'view';

export interface AgentSkillEditorProps {
  mode: EditorMode;
  /** 编辑/查看的技能 id（create/import 为空）。 */
  skillId?: string;
  initialMarkdown: string;
  onClose: () => void;
  /** 保存成功后回调（面板据此刷新列表）。 */
  onSaved: () => void;
}

type Checked = { status: 'idle' } | { status: 'checking' }
  | { status: 'done'; result: ValidateResult };

function useDebouncedValidation(markdown: string, enabled: boolean): Checked {
  const [checked, setChecked] = useState<Checked>({ status: 'idle' });
  useEffect(() => {
    if (!enabled || !markdown.trim()) { setChecked({ status: 'idle' }); return; }
    let cancelled = false;
    setChecked({ status: 'checking' });
    const timer = setTimeout(() => {
      validateSkill(markdown)
        .then((result) => { if (!cancelled) setChecked({ status: 'done', result }); })
        .catch((error: unknown) => {
          if (cancelled) return;
          const message = error instanceof Error ? error.message : String(error);
          setChecked({ status: 'done', result: { valid: false, error_code: 'internal_error', message } });
        });
    }, VALIDATE_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [markdown, enabled]);
  return checked;
}

const Preview: React.FC<{ checked: Checked }> = ({ checked }) => {
  const { t } = useLocale();
  const copy = t.agentCollab;
  if (checked.status === 'idle') {
    return <p className="text-xs text-muted-foreground">{copy.skillsPreviewEmpty}</p>;
  }
  if (checked.status === 'checking') {
    return <p role="status" className="text-xs text-muted-foreground">{copy.skillsChecking}</p>;
  }
  const { result } = checked;
  if (!result.valid) {
    return (
      <p role="alert" className="text-xs text-red-600 dark:text-red-400" data-testid="skill-preview-invalid">
        {copy.skillsPreviewInvalid.replace('{message}', result.message)}
      </p>
    );
  }
  return (
    <div className="space-y-2 text-xs" data-testid="skill-preview-valid">
      <p className="font-medium text-foreground">{result.name} · {result.id}</p>
      <p className="text-muted-foreground">{result.description}</p>
      {result.tools.length > 0 && (
        <p className="text-foreground">
          {copy.skillsPreviewTools.replace('{tools}', result.tools.join(', '))}
        </p>
      )}
      {result.requires.length > 0 && (
        <p className="text-foreground">
          {copy.skillsPreviewRequires.replace('{requires}', result.requires.join(', '))}
        </p>
      )}
      {result.warnings.map(warning => (
        <p key={warning} className="text-amber-700 dark:text-amber-300">{warning}</p>
      ))}
      <p className="font-medium text-foreground">{copy.skillsPreviewBody}</p>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-muted/50 p-2 text-xs">
        {result.body}
      </pre>
    </div>
  );
};

const AgentSkillEditor: React.FC<AgentSkillEditorProps> = ({
  mode, skillId, initialMarkdown, onClose, onSaved,
}) => {
  const { t } = useLocale();
  const { showSuccess } = useNotification();
  const copy = t.agentCollab;
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readOnly = mode === 'view';
  const checked = useDebouncedValidation(markdown, true);
  const canSave = !readOnly && !saving && checked.status === 'done' && checked.result.valid;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (mode === 'edit' && skillId) await updateSkill(skillId, markdown);
      else await createSkill(markdown);
      showSuccess(mode === 'edit' ? copy.skillsSaved : copy.skillsCreated);
      onSaved();
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      setError(copy.skillsActionFailed.replace('{message}', message));
    } finally {
      setSaving(false);
    }
  };

  const title = mode === 'view' ? copy.skillsEditorTitleView
    : mode === 'edit' ? copy.skillsEditorTitleEdit
      : mode === 'import' ? copy.skillsEditorTitleImport : copy.skillsEditorTitleNew;

  return (
    <section aria-label={title} className="space-y-3" data-testid="skill-editor">
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      {readOnly && <p className="text-xs text-muted-foreground">{copy.skillsBuiltinReadonly}</p>}
      {mode === 'import' && (
        <p role="note" className="text-xs text-amber-700 dark:text-amber-300">
          {copy.skillsImportHint}
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block text-xs text-muted-foreground">
          {copy.skillsMarkdownLabel}
          <textarea
            value={markdown}
            onChange={event => setMarkdown(event.target.value)}
            readOnly={readOnly}
            spellCheck={false}
            placeholder={copy.skillsMarkdownPlaceholder}
            className="mt-1 h-72 w-full resize-y rounded-md border border-border bg-muted p-2 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </label>
        <div>
          <p className="mb-1 text-xs text-muted-foreground">{copy.skillsPreview}</p>
          <Preview checked={checked} />
        </div>
      </div>
      {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex gap-2">
        {!readOnly && (
          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {mode === 'edit' ? copy.skillsSave : copy.skillsCreate}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-accent"
        >
          {readOnly ? copy.skillsClose : copy.skillsCancel}
        </button>
      </div>
    </section>
  );
};

export default AgentSkillEditor;
