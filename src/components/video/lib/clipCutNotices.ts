/**
 * clipCutNotices — the notifications a finished clip cut shows.
 *
 * The cut endpoint skips clips whose ffmpeg cut failed and still answers
 * `success: true` when none survived, with the message "Successfully cut and
 * saved 0 video clips locally". Showing that text as the failure reason read
 * as a contradiction (and as English in the Chinese UI), so a request that was
 * accepted but produced nothing is reported as "n of n clips failed".
 */

import type { Translations } from '@/lib/i18n';

type ClipCutMessages = Translations['videoEditing']['clipCut'];

export interface ClipCutOutcome {
  /** `VideoCutResponse.success`: the request itself was processed. */
  requestSucceeded: boolean;
  backendMessage: string;
  cutCount: number;
  requestedCount: number;
}

export interface ClipCutNotices {
  error?: string;
  warning?: string;
  success?: string;
}

export function describeClipCutOutcome(
  messages: ClipCutMessages,
  outcome: ClipCutOutcome,
): ClipCutNotices {
  const { requestSucceeded, backendMessage, cutCount, requestedCount } = outcome;
  const failedCount = requestedCount - cutCount;
  const partialFailed = messages.partialFailed
    .replace('{failed}', String(failedCount))
    .replace('{total}', String(requestedCount));
  if (cutCount === 0) {
    const reason = backendMessage.trim();
    return {
      error: requestSucceeded || !reason
        ? partialFailed
        : messages.failed.replace('{message}', reason),
    };
  }
  return {
    warning: failedCount > 0 ? partialFailed : undefined,
    success: messages.done.replace('{count}', String(cutCount)),
  };
}
