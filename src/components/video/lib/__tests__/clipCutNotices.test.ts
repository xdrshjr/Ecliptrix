/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { getTranslations } from '@/lib/i18n';
import { describeClipCutOutcome } from '../clipCutNotices';

const en = getTranslations('en').videoEditing.clipCut;
const zh = getTranslations('zh-CN').videoEditing.clipCut;

function partialFailed(messages: typeof en, failed: number, total: number): string {
  return messages.partialFailed
    .replace('{failed}', String(failed))
    .replace('{total}', String(total));
}

describe('describeClipCutOutcome', () => {
  it('every clip failing is reported as n of n failed, not the backend success text', () => {
    // The endpoint answers success: true with only the clips that were cut.
    const notices = describeClipCutOutcome(zh, {
      requestSucceeded: true,
      backendMessage: 'Successfully cut and saved 0 video clips locally',
      cutCount: 0,
      requestedCount: 3,
    });
    expect(notices).toEqual({ error: partialFailed(zh, 3, 3) });
  });

  it('a refused request shows the backend reason', () => {
    const notices = describeClipCutOutcome(en, {
      requestSucceeded: false,
      backendMessage: 'Source video not found',
      cutCount: 0,
      requestedCount: 2,
    });
    expect(notices).toEqual({ error: en.failed.replace('{message}', 'Source video not found') });
  });

  it('a refused request without a reason still names the failed clips', () => {
    const notices = describeClipCutOutcome(en, {
      requestSucceeded: false,
      backendMessage: '  ',
      cutCount: 0,
      requestedCount: 2,
    });
    expect(notices).toEqual({ error: partialFailed(en, 2, 2) });
  });

  it('a partial cut warns about the failed clips and confirms the saved ones', () => {
    const notices = describeClipCutOutcome(en, {
      requestSucceeded: true,
      backendMessage: 'Successfully cut and saved 2 video clips locally',
      cutCount: 2,
      requestedCount: 3,
    });
    expect(notices).toEqual({
      warning: partialFailed(en, 1, 3),
      success: en.done.replace('{count}', '2'),
    });
  });

  it('a complete cut only confirms', () => {
    const notices = describeClipCutOutcome(en, {
      requestSucceeded: true,
      backendMessage: 'Successfully cut and saved 3 video clips locally',
      cutCount: 3,
      requestedCount: 3,
    });
    expect({ warning: notices.warning, error: notices.error, success: notices.success })
      .toEqual({ warning: undefined, error: undefined, success: en.done.replace('{count}', '3') });
  });
});
