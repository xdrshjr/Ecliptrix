import type { EffectDocument } from '../../src/types/effects';

export interface RuntimeInput {
  assetId: string;
  fileName: string;
  sha256: string;
  bytes: number;
}

export interface RuntimeSubmission {
  projectId: string;
  jobId: string;
  requestHash: string;
  document: EffectDocument;
  inputs: RuntimeInput[];
  output: { profile: 'mp4-1080p' | 'mp4-720p' };
}

export interface RuntimeManifest {
  protocolVersion: number;
  engineVersion: string;
  runtimeFingerprint: string;
  catalogHash: string;
  browserExecutable: string;
  binariesDirectory: string;
  supportedTemplates: number;
  files: { path: string; bytes: number; sha256: string }[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;

/** Reject unknown keys so internal messages cannot select code or paths. */
function requireKeys(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('EFFECT_INVALID_ARGUMENT: object required');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !keys.includes(key))) {
    throw new Error('EFFECT_INVALID_ARGUMENT: unknown field');
  }
  return record;
}

function requireInteger(value: unknown, min: number, max: number): void {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    throw new Error('EFFECT_INVALID_ARGUMENT: integer outside limits');
  }
}

function validateDocument(value: unknown): void {
  const document = requireKeys(value, [
    'schemaVersion', 'templateId', 'templateVersion', 'canvas',
    'durationFrames', 'seed', 'content', 'palette', 'typography',
    'motion', 'params', 'inputs',
  ]);
  if (document.schemaVersion !== 1 || document.templateVersion !== 1
      || !/^[a-z][a-z0-9-]{1,63}$/.test(String(document.templateId))) {
    throw new Error('EFFECT_TEMPLATE_INCOMPATIBLE');
  }
  const canvas = requireKeys(document.canvas, ['width', 'height', 'fps']);
  requireInteger(canvas.width, 64, 1920);
  requireInteger(canvas.height, 64, 1920);
  if (Number(canvas.width) % 2 || Number(canvas.height) % 2
      || canvas.fps !== 30) throw new Error('EFFECT_INVALID_ARGUMENT: canvas');
  requireInteger(document.durationFrames, 15, 1800);
  requireInteger(document.seed, 0, 2147483647);
  if (!Array.isArray(document.inputs) || document.inputs.length > 9) {
    throw new Error('EFFECT_INVALID_ARGUMENT: inputs');
  }
}

function validateInput(value: unknown): RuntimeInput {
  const input = requireKeys(value, ['assetId', 'fileName', 'sha256', 'bytes']);
  if (!UUID.test(String(input.assetId)) || !HASH.test(String(input.sha256))
      || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,150}$/.test(String(input.fileName))) {
    throw new Error('EFFECT_INVALID_ARGUMENT: input identity');
  }
  requireInteger(input.bytes, 1, 512 * 1024 * 1024);
  return input as unknown as RuntimeInput;
}

/** Validate one bounded, local-only render submission. */
export function validateSubmission(value: unknown): RuntimeSubmission {
  const request = requireKeys(value, [
    'projectId', 'jobId', 'requestHash', 'document', 'inputs', 'output',
  ]);
  if (!UUID.test(String(request.projectId)) || !UUID.test(String(request.jobId))
      || !HASH.test(String(request.requestHash))) {
    throw new Error('EFFECT_INVALID_ARGUMENT: request identity');
  }
  validateDocument(request.document);
  if (!Array.isArray(request.inputs) || request.inputs.length > 9) {
    throw new Error('EFFECT_INVALID_ARGUMENT: input manifest');
  }
  const inputs = request.inputs.map(validateInput);
  const identifiers = new Set(inputs.map((input) => input.assetId));
  if (identifiers.size !== inputs.length
      || new Set(inputs.map((input) => input.fileName)).size !== inputs.length) {
    throw new Error('EFFECT_INVALID_ARGUMENT: duplicate input');
  }
  const document = request.document as EffectDocument;
  if (document.inputs.some((binding) => !identifiers.has(binding.assetId))) {
    throw new Error('EFFECT_INVALID_ARGUMENT: unresolved input');
  }
  const output = requireKeys(request.output, ['profile']);
  if (!['mp4-1080p', 'mp4-720p'].includes(String(output.profile))) {
    throw new Error('EFFECT_INVALID_ARGUMENT: output profile');
  }
  return request as unknown as RuntimeSubmission;
}
