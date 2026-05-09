import { describe, it, expect } from 'vitest';
import { sanitizeErrorMessage } from '../sanitizeError';

describe('sanitizeErrorMessage', () => {
  const fallback = 'Failed to save workflow';

  it('returns fallback for SQLAlchemy URL leak', () => {
    const raw = 'Background task failed; (Background on this error at: https://sqlalche.me/e/20/xd2s)';
    expect(sanitizeErrorMessage(raw, fallback)).toBe(fallback);
  });

  it('returns fallback for greenlet_spawn diagnostic', () => {
    const raw = 'greenlet_spawn has not been called; can\'t call await_only() here.';
    expect(sanitizeErrorMessage(raw, fallback)).toBe(fallback);
  });

  it('returns fallback for asyncpg trace', () => {
    const raw = 'asyncpg.exceptions.UniqueViolationError at 0x7f9d8c0';
    expect(sanitizeErrorMessage(raw, fallback)).toBe(fallback);
  });

  it('returns fallback for python tracebacks', () => {
    const raw = 'Traceback (most recent call last):\n  File "x.py", line 1, in <module>';
    expect(sanitizeErrorMessage(raw, fallback)).toBe(fallback);
  });

  it('returns fallback when message is too long (>240 chars)', () => {
    const raw = 'a'.repeat(300);
    expect(sanitizeErrorMessage(raw, fallback)).toBe(fallback);
  });

  it('returns fallback for empty/null/undefined input', () => {
    expect(sanitizeErrorMessage('', fallback)).toBe(fallback);
    expect(sanitizeErrorMessage(null, fallback)).toBe(fallback);
    expect(sanitizeErrorMessage(undefined, fallback)).toBe(fallback);
  });

  it('lets through short benign messages', () => {
    expect(sanitizeErrorMessage('Workflow not found', fallback)).toBe('Workflow not found');
    expect(sanitizeErrorMessage('Network error', fallback)).toBe('Network error');
  });

  it('extracts message from Error instances', () => {
    const err = new Error('Workflow not found');
    expect(sanitizeErrorMessage(err, fallback)).toBe('Workflow not found');
  });

  it('redacts Error instances with sensitive content', () => {
    const err = new Error('asyncpg.exceptions.UniqueViolationError');
    expect(sanitizeErrorMessage(err, fallback)).toBe(fallback);
  });
});
