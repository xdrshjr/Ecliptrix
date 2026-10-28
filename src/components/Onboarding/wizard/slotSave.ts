import { saveAssignment, type WizardSlot } from '@/lib/api/modelSettings';

export type SlotStatus = 'idle' | 'saving' | 'ok' | 'error';

export interface SlotJob {
  slot: WizardSlot;
  model: string;
}

export interface SlotReport {
  (slot: WizardSlot, status: SlotStatus, message?: string): void;
}

const SLOT_CONCURRENCY = 3;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Persist one slot and report its lifecycle; returns whether it succeeded. */
export async function saveOneSlot(
  job: SlotJob,
  providerId: string,
  report: SlotReport,
): Promise<boolean> {
  report(job.slot, 'saving');
  try {
    await saveAssignment({
      function_type: job.slot,
      provider_id: providerId,
      model_name: job.model,
    });
    report(job.slot, 'ok');
    return true;
  } catch (error) {
    report(job.slot, 'error', errorText(error));
    return false;
  }
}

/** Run `worker` over `items` with at most `limit` in flight. */
async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const lanes = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      await worker(next);
    }
  });
  await Promise.all(lanes);
}

export interface SaveSlotsResult {
  /** True when chat failed, so no other slot was attempted (D6 / AC-7). */
  blockedByChat: boolean;
  failed: WizardSlot[];
}

/**
 * Save order (D6): chat first — the server connectivity-tests it, which is the
 * wizard's real key check — then the rest concurrently. A failed chat stops
 * everything; a failed other slot only marks that row and keeps the rest.
 */
export async function saveSlots(
  jobs: SlotJob[],
  providerId: string,
  report: SlotReport,
): Promise<SaveSlotsResult> {
  const chatJob = jobs.find((job) => job.slot === 'chat');
  if (chatJob && !(await saveOneSlot(chatJob, providerId, report))) {
    return { blockedByChat: true, failed: ['chat'] };
  }
  const failed: WizardSlot[] = [];
  const rest = jobs.filter((job) => job.slot !== 'chat');
  await runPool(rest, SLOT_CONCURRENCY, async (job) => {
    if (!(await saveOneSlot(job, providerId, report))) failed.push(job.slot);
  });
  return { blockedByChat: false, failed };
}
