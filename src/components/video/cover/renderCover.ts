import { toBlob } from 'html-to-image';
import { CoverError } from '@/types/videoCover';
import { findCoverCanvas, measureCoverText } from './coverValidation';

export function coverAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}
export async function coverDeadline<T>(promise: Promise<T>, ms: number,
  signal?: AbortSignal): Promise<T> {
  try { coverAbort(signal); }
  catch (error) { void promise.catch(() => undefined); throw error; }
  let timer: ReturnType<typeof setTimeout>;
  let abort: () => void;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CoverError('COVER_RENDER_FAILED',
      'COVER_RENDER_FAILED: timeout')), ms);
    abort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([promise, deadline]); }
  finally { clearTimeout(timer!); signal?.removeEventListener('abort', abort!); }
}

export interface CoverRenderScope {
  signal: AbortSignal;
  check(): void;
  wait<T>(promise: Promise<T>): Promise<T>;
  dispose(): void;
}

/** One absolute budget follows a job from asset fetch through PNG validation. */
export function createCoverRenderScope(signal?: AbortSignal): CoverRenderScope {
  coverAbort(signal);
  const local = new AbortController();
  const deadlineAt = Date.now() + 15000;
  let expired = false;
  const abort = () => local.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { expired = true; local.abort(); }, 15000);
  const check = () => {
    coverAbort(signal);
    if (expired || Date.now() >= deadlineAt) {
      throw new CoverError('COVER_RENDER_FAILED', 'COVER_RENDER_FAILED: timeout');
    }
    coverAbort(local.signal);
  };
  return {
    signal: local.signal, check,
    async wait<T>(promise: Promise<T>) {
      // The work may have synchronously crossed the deadline before returning
      // its Promise. Always observe that Promise even when already invalid.
      try { check(); }
      catch (error) { void promise.catch(() => undefined); throw error; }
      try {
        const result = await coverDeadline(promise,
          Math.max(0, deadlineAt - Date.now()), local.signal);
        check(); return result;
      } catch (error) { check(); throw error; }
    },
    dispose() {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      local.abort();
    },
  };
}

export async function waitCoverResource<T>(scope: CoverRenderScope,
  operation: () => Promise<T>, code:
  'COVER_FONT_UNAVAILABLE' | 'COVER_BACKGROUND_UNREADABLE'): Promise<T> {
  scope.check();
  try {
    const result = await scope.wait(
      coverDeadline(operation(), 10000, scope.signal));
    scope.check(); return result;
  } catch (error) {
    // Caller cancellation and the overall budget outrank a resource failure.
    scope.check();
    throw new CoverError(code, `${code}: ${String(error)}`);
  }
}

interface RenderOptions {
  width: number; height: number; signal?: AbortSignal;
  scope?: CoverRenderScope;
}

async function validateBitmap(blob: Blob, options: RenderOptions,
  scope: CoverRenderScope) {
  scope.check();
  const bitmap = await createImageBitmap(blob);
  // This continuation owns the bitmap even if its caller already timed out.
  try {
    scope.check();
    if (bitmap.width !== options.width || bitmap.height !== options.height) {
      throw new Error('incorrect PNG dimensions');
    }
  } finally { bitmap.close(); }
}

async function renderReadyNode(node: HTMLElement, options: RenderOptions,
  scope: CoverRenderScope): Promise<Blob> {
  scope.check();
  const canvas = findCoverCanvas(node);
  if (!canvas) throw new CoverError('COVER_RENDER_FAILED', 'COVER_RENDER_FAILED');
  // Both deadlines start together; AI has no text dependency at all.
  const images = waitCoverResource(scope, () => Promise.all(
    Array.from(canvas.querySelectorAll('img')).map(image => image.decode())),
  'COVER_BACKGROUND_UNREADABLE');
  const fonts = canvas.dataset.coverMode === 'ai' ? Promise.resolve() :
    waitCoverResource(scope, () => node.ownerDocument.fonts?.ready ??
      Promise.resolve(), 'COVER_FONT_UNAVAILABLE');
  await scope.wait(Promise.all([images, fonts]));
  scope.check();
  const measurement = measureCoverText(canvas);
  if (!measurement.measurable) {
    throw new CoverError('COVER_RENDER_FAILED', 'COVER_RENDER_FAILED: no layout');
  }
  if (measurement.overflowFields.length) {
    throw new CoverError('COVER_TEXT_OVERFLOW', 'COVER_TEXT_OVERFLOW');
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    scope.check();
    try {
      const blob = await scope.wait(toBlob(canvas, {
        width: options.width, height: options.height,
        canvasWidth: options.width, canvasHeight: options.height, pixelRatio: 1,
        skipFonts: true, filter: n => !(n.nodeType === 1 &&
          (n as Element).hasAttribute('data-cover-guide')) }));
      scope.check();
      if (!blob?.size) throw new Error('empty PNG');
      await scope.wait(validateBitmap(blob, options, scope));
      scope.check();
      return blob;
    } catch (error) { scope.check(); lastError = error; }
  }
  throw new CoverError('COVER_RENDER_FAILED', `COVER_RENDER_FAILED: ${String(lastError)}`);
}
export async function renderCover(node: HTMLElement,
  options: RenderOptions): Promise<Blob> {
  coverAbort(options.signal);
  const scope = options.scope ?? createCoverRenderScope(options.signal);
  try {
    scope.check();
    const result = await scope.wait(renderReadyNode(node, options, scope));
    scope.check(); return result;
  } finally { if (!options.scope) scope.dispose(); }
}
