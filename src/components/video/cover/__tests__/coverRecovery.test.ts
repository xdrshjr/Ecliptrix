import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/http-client';
import { CoverError } from '@/types/videoCover';
import { isDraftConflict, normalizeCoverIssue } from '../coverRecovery';

describe('封面错误恢复动作', () => {
  it('只有服务端 CAS 冲突提供本地/服务器决议', () => {
    const error = new ApiError(409, 'COVER_VERSION_CONFLICT', 'private path');
    expect(isDraftConflict(error)).toBe(true);
    expect(normalizeCoverIssue(error, 'save', 'p')).toMatchObject({
      kind: 'draft-conflict', projectId: 'p', operation: 'save',
      actions: ['use-local', 'use-server', 'dismiss'],
    });
  });
  it('本地同名失效错误只重试原操作', () => {
    const error = new CoverError('COVER_VERSION_CONFLICT', 'local edit');
    expect(isDraftConflict(error)).toBe(false);
    expect(normalizeCoverIssue(error, 'render', 'p', {
      retryAction: 'download',
    })).toMatchObject({ kind: 'operation-stale', retryAction: 'download',
      actions: ['retry-operation', 'dismiss'] });
  });
  it('非 CAS 的409不允许覆盖草稿', () => {
    const issue = normalizeCoverIssue(new ApiError(409,
      'COVER_DRAFT_NOT_READY', 'not ready'), 'save', 'p');
    expect(issue.actions).toEqual(['retry-save', 'dismiss']);
    expect(issue.kind).toBe('other');
  });
  it.each([
    ['save', 'retry-save'], ['load', 'reload-initial'],
    ['resources', 'refresh-resources'], ['poll', 'refresh-status'],
    ['upload', 'choose-image'], ['copy', 'choose-image'],
    ['render', 'retry-operation'], ['apply', 'retry-operation'],
  ] as const)('%s 恢复只调用对应动作', (operation, action) => {
    const issue = normalizeCoverIssue(new Error('secret'), operation, 'p');
    expect(issue.actions).toEqual([action, 'dismiss']);
    expect(JSON.stringify(issue)).not.toContain('secret');
  });
  it('历史读取错误携带版本归属', () => {
    expect(normalizeCoverIssue(new ApiError(404, 'COVER_ASSET_MISSING',
      'missing'), 'resources', 'p', { revisionId: 'r' })).toMatchObject({
      revisionId: 'r', actions: ['retry-revision', 'dismiss'],
    });
  });
  it('网络未知生成只能恢复或取消同一次提交', () => {
    expect(normalizeCoverIssue(new TypeError('fetch failed'),
      'generate', 'p').actions).toEqual([
      'resume-submission', 'cancel-submission', 'dismiss',
    ]);
  });
  it('生成明确拒绝允许用户重新生成', () => {
    expect(normalizeCoverIssue(new ApiError(422, 'INVALID_REQUEST', ''),
      'generate', 'p').actions).toEqual(['regenerate', 'dismiss']);
  });
  it('时间轴冲突保留显式重建动作', () => {
    expect(normalizeCoverIssue(new CoverError('COVER_TIMELINE_CONFLICT', ''),
      'apply', 'p').actions).toEqual(['rebuild', 'dismiss']);
  });
});
