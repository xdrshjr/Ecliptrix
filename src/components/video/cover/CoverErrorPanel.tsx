'use client';
import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { Translations } from '@/lib/i18n';
import type { CoverIssue, CoverRecoveryAction } from '@/types/videoCover';

function issueMessage(issue: CoverIssue, c: Translations['coverStudio']) {
  if (issue.kind === 'draft-conflict') return c.draftConflict;
  if (issue.kind === 'operation-stale') return c.operationStale;
  if (issue.actions.includes('resume-submission')) return c.submissionUnknown;
  if (issue.code === 'COVER_SERVER_DRAFT_MISSING') return c.errors[issue.code];
  if (issue.operation === 'save') return c.saveFailed;
  if (issue.operation === 'resources') return c.resourceFailed;
  if (issue.operation === 'poll') return c.connectionRetrying;
  if (issue.operation === 'upload' || issue.operation === 'copy') return c.importFailed;
  return c.errors[issue.code] ?? c.unknownFailure;
}

export function CoverErrorPanel({ issue, onAction, busy = false }: {
  issue?: CoverIssue; onAction: (action: CoverRecoveryAction) => void;
  busy?: boolean;
}) {
  const { t } = useLocale(); const c = t.coverStudio;
  if (!issue) return null;
  const labels: Record<CoverRecoveryAction, string> = {
    'retry-save': c.retrySave, 'use-local': c.useLocal, 'use-server': c.useServer,
    'refresh-status': c.refreshStatus, regenerate: c.regenerate,
    'choose-image': c.chooseImage, 'retry-operation': c.retry,
    'refresh-resources': c.refreshResources, 'retry-revision': c.retryRevision,
    'resume-submission': c.resumeSubmission, 'cancel-submission': c.cancelSubmission,
    rebuild: c.rebuild, 'reload-initial': c.retry, dismiss: c.dismiss,
  };
  return <div className="cover-error" role="alert">
    <p>{issueMessage(issue, c)}</p>
    {issue.kind === 'draft-conflict' && <p>{c.replaceLocalWarning}</p>}
    <div className="cover-error-actions">{issue.actions.map(action =>
      <button key={action} disabled={busy && action !== 'dismiss'}
        onClick={() => onAction(action)}>{labels[action]}</button>)}</div>
    {issue.actions.includes('regenerate') && <small>{c.regenerateNotice}</small>}
  </div>;
}
