import { describe, expect, it, vi } from 'vitest';
import type { SteerOutcome } from '@/lib/api/agentSteer';
import { SteeringMachine, mergeTexts, type SteeringHost } from '../steeringMachine';

/** Test double host: `postSteer` outcomes are scripted, ids/timestamps deterministic. */
function setup(outcomes: SteerOutcome[] = []) {
  let counter = 0;
  const host = {
    postSteer: vi.fn(async () => outcomes.shift() ?? { kind: 'accepted', position: 1 } as SteerOutcome),
    persistApplied: vi.fn(),
    sendFollowUp: vi.fn(),
    restoreDraft: vi.fn(),
    notify: vi.fn(),
    cancelTurn: vi.fn(),
    newId: () => `id-${++counter}`,
    now: () => counter,
  } satisfies SteeringHost;
  const machine = new SteeringMachine(host);
  machine.startTurn();
  return { machine, host };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const statuses = (machine: SteeringMachine) => machine.getSnapshot().notes.map(note => note.status);

describe('submit', () => {
  it('keeps a steer local until run_started, then sends it', async () => {
    const { machine, host } = setup();
    machine.submit('改成竖版', 'steer');
    expect(statuses(machine)).toEqual(['local']);
    expect(host.postSteer).not.toHaveBeenCalled();
    machine.onRunStarted('run-1');
    expect(host.postSteer).toHaveBeenCalledWith({ runId: 'run-1', steerId: 'id-1', text: '改成竖版' });
    expect(statuses(machine)).toEqual(['sent']);
  });

  it('sends immediately when the run id is known', () => {
    const { machine, host } = setup();
    machine.onRunStarted('run-1');
    machine.submit('x', 'steer');
    expect(host.postSteer).toHaveBeenCalledTimes(1);
  });

  it('puts Alt+Enter text only in the client queue, never on the server (AC-A6)', () => {
    const { machine, host } = setup();
    machine.onRunStarted('run-1');
    machine.submit('later', 'queue');
    expect(host.postSteer).not.toHaveBeenCalled();
    expect(machine.getSnapshot().queued.map(item => item.text)).toEqual(['later']);
  });

  it('ignores empty text and refuses a 4th pending item (AC-A4)', () => {
    const { machine, host } = setup();
    expect(machine.submit('   ', 'steer')).toBe('empty');
    machine.submit('a', 'queue');
    machine.submit('b', 'queue');
    machine.submit('c', 'steer');
    expect(machine.submit('d', 'steer')).toBe('full');
    expect(host.notify).toHaveBeenCalledWith('queue_full');
    expect(machine.getSnapshot().notes).toHaveLength(1);
  });
});

describe('server responses', () => {
  it('moves a steer to the queue on 404/run_closed (AC-A7)', async () => {
    const { machine } = setup([{ kind: 'run_gone' }]);
    machine.onRunStarted('run-1');
    machine.submit('x', 'steer');
    await flush();
    expect(machine.getSnapshot().notes).toEqual([]);
    expect(machine.getSnapshot().queued.map(item => item.text)).toEqual(['x']);
  });

  it('on 429 puts the text back in the input and tells the user', async () => {
    const { machine, host } = setup([{ kind: 'queue_full' }]);
    machine.onRunStarted('run-1');
    machine.submit('x', 'steer');
    await flush();
    expect(host.restoreDraft).toHaveBeenCalledWith('x');
    expect(host.notify).toHaveBeenCalledWith('queue_full');
    expect(machine.getSnapshot().notes).toEqual([]);
  });

  it('treats any other failure as queued rather than losing the text', async () => {
    const { machine } = setup([{ kind: 'failed', message: 'boom' }]);
    machine.onRunStarted('run-1');
    machine.submit('x', 'steer');
    await flush();
    expect(machine.getSnapshot().queued.map(item => item.text)).toEqual(['x']);
  });

  it('marks a steer applied and persists it with its position', () => {
    const { machine, host } = setup();
    machine.onRunStarted('run-1');
    machine.submit('x', 'steer');
    machine.onSteerApplied({ steerId: 'id-1', afterToolCallId: 'call-9' });
    expect(statuses(machine)).toEqual(['applied']);
    expect(host.persistApplied).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'id-1', status: 'applied', afterToolCallId: 'call-9' })]);
  });

  it('turns dropped steers into queued follow-ups', () => {
    const { machine } = setup();
    machine.onRunStarted('run-1');
    machine.submit('x', 'steer');
    machine.onSteerDropped({ steerIds: ['id-1'] });
    expect(machine.getSnapshot().queued).toHaveLength(1);
    expect(machine.getSnapshot().notes).toEqual([]);
  });
});

describe('SSE auto-reconnect (AC-A10)', () => {
  it('returns sent steers to local, clears the run id and re-sends after the new run_started', async () => {
    const { machine, host } = setup();
    machine.onRunStarted('run-old');
    machine.submit('x', 'steer');
    machine.onRestart();
    expect(statuses(machine)).toEqual(['local']);
    expect(machine.getSnapshot().runId).toBeNull();
    machine.onRunStarted('run-new');
    expect(host.postSteer).toHaveBeenCalledTimes(2);
    expect(host.postSteer).toHaveBeenLastCalledWith({ runId: 'run-new', steerId: 'id-1', text: 'x' });
  });

  it('ignores a late response that belongs to the superseded run', async () => {
    let finish: (outcome: SteerOutcome) => void = () => undefined;
    const { machine, host } = setup();
    host.postSteer.mockImplementationOnce(() => new Promise<SteerOutcome>(resolve => { finish = resolve; }));
    machine.onRunStarted('run-old');
    machine.submit('x', 'steer');
    machine.onRestart();
    finish({ kind: 'run_gone' });
    await flush();
    expect(statuses(machine)).toEqual(['local']);
    expect(machine.getSnapshot().queued).toEqual([]);
  });
});

describe('cancelNote', () => {
  it('removes local and queued notes but refuses a sent one', () => {
    const { machine } = setup();
    machine.submit('local', 'steer');
    machine.submit('later', 'queue');
    expect(machine.cancelNote('id-1')).toBe(true);
    expect(machine.cancelNote('id-2')).toBe(true);
    machine.onRunStarted('run-1');
    machine.submit('sent', 'steer');
    expect(machine.cancelNote('id-3')).toBe(false);
    expect(statuses(machine)).toEqual(['sent']);
  });
});

describe('turn end', () => {
  it('merges everything undelivered into ONE follow-up when the turn completed', () => {
    const { machine, host } = setup();
    machine.onRunStarted('run-1');
    machine.submit('first', 'steer');
    machine.submit('second', 'queue');
    machine.onTurnEnd({ reason: 'completed', endedWithAskUser: false });
    expect(host.sendFollowUp).toHaveBeenCalledTimes(1);
    expect(host.sendFollowUp).toHaveBeenCalledWith('first\n\nsecond');
    expect(machine.getSnapshot().queued).toEqual([]);
  });

  it('does not resend an applied steer', () => {
    const { machine, host } = setup();
    machine.onRunStarted('run-1');
    machine.submit('applied', 'steer');
    machine.onSteerApplied({ steerId: 'id-1', afterToolCallId: null });
    machine.onTurnEnd({ reason: 'completed', endedWithAskUser: false });
    expect(host.sendFollowUp).not.toHaveBeenCalled();
    expect(host.restoreDraft).not.toHaveBeenCalled();
  });

  it('puts everything back in the input after a stop or an error (AC-A5, AC-A11)', () => {
    for (const reason of ['cancelled', 'error'] as const) {
      const { machine, host } = setup();
      machine.onRunStarted('run-1');
      machine.submit('a', 'steer');
      machine.submit('b', 'queue');
      machine.onTurnEnd({ reason, endedWithAskUser: false });
      expect(host.sendFollowUp).not.toHaveBeenCalled();
      expect(host.restoreDraft).toHaveBeenCalledWith('a\n\nb');
      expect(host.notify).toHaveBeenCalledWith('restored_after_stop');
    }
  });

  it('does NOT auto-send when the turn ended on an unanswered ask_user (AC-A5 / R-08)', () => {
    const { machine, host } = setup();
    machine.submit('queued text', 'queue');
    machine.onTurnEnd({ reason: 'completed', endedWithAskUser: true });
    expect(host.sendFollowUp).not.toHaveBeenCalled();
    expect(host.restoreDraft).toHaveBeenCalledWith('queued text');
    expect(host.notify).toHaveBeenCalledWith('restored_after_question');
  });

  it('local steers that never got a run id are not lost on turn end', () => {
    const { machine, host } = setup();
    machine.submit('early', 'steer');
    machine.onTurnEnd({ reason: 'completed', endedWithAskUser: false });
    expect(host.sendFollowUp).toHaveBeenCalledWith('early');
  });
});

describe('promoteToStop', () => {
  it('stops the turn, then resends the text as a new turn instead of restoring it', () => {
    const { machine, host } = setup();
    machine.onRunStarted('run-1');
    machine.submit('change course', 'steer');
    machine.promoteToStop('id-1');
    expect(host.cancelTurn).toHaveBeenCalledTimes(1);
    machine.onTurnEnd({ reason: 'cancelled', endedWithAskUser: false });
    expect(host.sendFollowUp).toHaveBeenCalledWith('change course');
    expect(host.restoreDraft).not.toHaveBeenCalled();
  });
});

describe('mergeTexts', () => {
  it('joins with a blank line and skips empties', () => {
    expect(mergeTexts([' a ', '', 'b'])).toBe('a\n\nb');
  });
});
