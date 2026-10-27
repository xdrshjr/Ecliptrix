/**
 * Shapes shared by the research crew modules (crew spec §3.3.2 / §5.3).
 * Kept free of runtime code so every crew file can import them without cycles.
 */

export type CandidateKind = 'video' | 'image' | 'audio' | 'page';
export const CANDIDATE_KINDS: readonly CandidateKind[] = ['video', 'image', 'audio', 'page'];

/** Final outcome of one task, as the parent agent sees it. */
export type CrewTaskStatus = 'done' | 'partial' | 'failed' | 'timeout' | 'cancelled';

/** One validated `delegate_research` task (the schema is in `delegateResearch.ts`). */
export interface CrewTaskInput {
  id: string;
  goal: string;
  deliverable: 'candidates' | 'facts' | 'both';
  kind?: CandidateKind;
  max_candidates?: number;
  hints?: string[];
}

export interface CrewCandidate {
  candidate_id?: string;
  url: string;
  kind: CandidateKind;
  title: string;
  source_page_url?: string;
  license_hint?: string;
  why: string;
}

export interface CrewSource {
  url: string;
  title: string;
}

/** A member report after "seen or it does not count" validation. */
export interface VerifiedReport {
  summary: string;
  candidates: CrewCandidate[];
  sources: CrewSource[];
  gaps: string[];
  dropped_unverified: number;
}

export interface MemberUsage {
  model_calls: number;
  tool_calls: number;
  elapsed_ms: number;
}

export interface CrewTaskResult extends VerifiedReport {
  id: string;
  status: CrewTaskStatus;
  error_code?: string;
  usage: MemberUsage;
}

/** What a member hands back to the orchestrator; never throws. */
export interface MemberOutcome {
  status: CrewTaskStatus;
  report?: VerifiedReport;
  error_code?: string;
  usage: MemberUsage;
}

/** Live, sanitised progress of a running member (feeds `crew_member` events). */
export interface MemberSnapshot {
  activity?: string;
  toolCalls: number;
  modelCalls: number;
  elapsedMs: number;
}
