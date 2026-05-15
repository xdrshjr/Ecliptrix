/**
 * Playback v2 — orchestration state machine.
 *
 * Spec: docs/plans/video-editor-playback-optimization/specs/01-architecture-refactor.md §4.2
 *       docs/plans/video-editor-playback-optimization/specs/02-playback-state-machine.md
 *
 * Round 1 ships the interface + a stub that holds onto wired-in collaborators
 * and emits phase transitions through a Set of listeners. Real state machine,
 * sequence resolution, and intent fan-out land in spec 02.
 */

import { AbBufferController } from './AbBufferController';
import { CanvasCompositor } from './CanvasCompositor';
import { PlaybackClock } from './PlaybackClock';
import { PlayheadController } from './PlayheadController';
import type {
  IPlaybackEngine,
  PlaybackIntent,
  PlaybackPhase,
} from './types';

export interface PlaybackEngineDeps {
  clock?: PlaybackClock;
  buffer?: AbBufferController;
  compositor?: CanvasCompositor;
  playhead?: PlayheadController;
}

export class PlaybackEngine implements IPlaybackEngine {
  private _phase: PlaybackPhase = 'idle';
  private readonly _listeners = new Set<(phase: PlaybackPhase) => void>();
  readonly clock: PlaybackClock;
  readonly buffer: AbBufferController;
  readonly compositor: CanvasCompositor;
  readonly playhead: PlayheadController;

  constructor(deps: PlaybackEngineDeps = {}) {
    this.clock = deps.clock ?? new PlaybackClock();
    this.buffer = deps.buffer ?? new AbBufferController();
    this.compositor = deps.compositor ?? new CanvasCompositor();
    this.playhead = deps.playhead ?? new PlayheadController();
  }

  /**
   * Process a UI / timeline intent.
   *
   * Spec 02 §4.3 owns the actual reducer table. The stub records the most
   * recent intent kind on `_lastIntent` for tests and is otherwise inert.
   */
  dispatch(intent: PlaybackIntent): void {
    this._lastIntent = intent;
    switch (intent.kind) {
      case 'play':
        this._setPhase('preparing');
        break;
      case 'pause':
        this._setPhase('paused');
        break;
      case 'seek':
        this._setPhase('seeking');
        break;
      case 'enterBackground':
        this.clock.stop();
        break;
      case 'returnToForeground':
        // Spec 02 §5.7 will compute wall-delta and decide whether to resume.
        break;
      case 'setRate':
      case 'setVolume':
        // Spec 02 §4.5 will route these to clock/active video element.
        break;
    }
  }

  getPhase(): PlaybackPhase {
    return this._phase;
  }

  subscribe(listener: (phase: PlaybackPhase) => void): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  /** Read the most recent intent; exposed for unit tests. */
  _peekLastIntent(): PlaybackIntent | null {
    return this._lastIntent;
  }

  private _setPhase(next: PlaybackPhase): void {
    if (this._phase === next) return;
    this._phase = next;
    this._listeners.forEach((l) => l(next));
  }

  private _lastIntent: PlaybackIntent | null = null;
}
