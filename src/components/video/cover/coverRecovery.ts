import { ApiError } from '@/lib/api/http-client';
import { CoverError, type CoverIssue, type CoverOperationSource,
  type CoverRecoveryAction } from '@/types/videoCover';

export function isDraftConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 &&
    error.code === 'COVER_VERSION_CONFLICT';
}

interface IssueContext {
  id?: string;
  revisionId?: string;
  retryAction?: CoverIssue['retryAction'];
}

function recoveryActions(error: unknown, issue: CoverIssue)
  : CoverRecoveryAction[] {
  if (issue.kind === 'draft-conflict') return ['use-local', 'use-server'];
  if (issue.kind === 'operation-stale') return ['retry-operation'];
  if (issue.code === 'COVER_TIMELINE_CONFLICT') return ['rebuild'];
  if (issue.revisionId) return ['retry-revision'];
  switch (issue.operation) {
    case 'save': return ['retry-save'];
    case 'load': return ['reload-initial'];
    case 'resources': return ['refresh-resources'];
    case 'poll': return ['refresh-status'];
    case 'upload': case 'copy': return ['choose-image'];
    case 'render': case 'apply': case 'restore': return ['retry-operation'];
    case 'generate':
      return error instanceof ApiError && error.status >= 400 &&
        error.status < 500 ? ['regenerate'] :
        ['resume-submission', 'cancel-submission'];
  }
}

/** Classify provenance, not messages: a local stale render is not a CAS. */
export function normalizeCoverIssue(error: unknown,
  operation: CoverOperationSource, projectId: string,
  context: IssueContext = {}): CoverIssue {
  const stale = error instanceof CoverError &&
    ['COVER_VERSION_CONFLICT', 'COVER_PROJECT_CHANGED'].includes(error.code);
  const conflict = isDraftConflict(error) &&
    ['save', 'render', 'apply', 'generate', 'restore'].includes(operation);
  const issue: CoverIssue = {
    id: context.id ?? crypto.randomUUID(), projectId, operation,
    kind: conflict ? 'draft-conflict' : stale ? 'operation-stale' : 'other',
    code: error instanceof ApiError || error instanceof CoverError ?
      error.code : 'COVER_UNKNOWN_ERROR',
    ...(context.revisionId ? { revisionId: context.revisionId } : {}),
    ...(context.retryAction ? { retryAction: context.retryAction } : {}),
    actions: [],
  };
  issue.actions = [...recoveryActions(error, issue), 'dismiss'];
  return issue;
}
