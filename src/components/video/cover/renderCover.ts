import { toBlob } from 'html-to-image';
import { CoverError } from '@/types/videoCover';
import { measureCoverCanvas } from './CoverCanvas';

export function coverAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}
export async function coverDeadline<T>(promise: Promise<T>, ms: number,
  signal?: AbortSignal): Promise<T> {
  coverAbort(signal);
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

async function renderReadyNode(node: HTMLElement, options: {
  width: number; height: number; signal?: AbortSignal;
}): Promise<Blob> {
  await coverDeadline(Promise.all([
    document.fonts?.ready ?? Promise.resolve(),
    ...Array.from(node.querySelectorAll('img')).map(image => image.decode()),
  ]), 10000, options.signal);
  if (!measureCoverCanvas(node)) {
    throw new CoverError('COVER_RENDER_FAILED', 'COVER_RENDER_FAILED: text overflow');
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    coverAbort(options.signal);
    try {
      const blob = await toBlob(node, { width: options.width, height: options.height,
        canvasWidth: options.width, canvasHeight: options.height, pixelRatio: 1,
        skipFonts: true, filter: n => !(n instanceof HTMLElement && n.hasAttribute('data-cover-guide')) });
      if (!blob?.size) throw new Error('empty PNG');
      const bitmap = await createImageBitmap(blob);
      const valid = bitmap.width === options.width && bitmap.height === options.height;
      bitmap.close(); coverAbort(options.signal);
      if (!valid) throw new Error('incorrect PNG dimensions');
      return blob;
    } catch (error) { lastError = error; }
  }
  throw new CoverError('COVER_RENDER_FAILED', `COVER_RENDER_FAILED: ${String(lastError)}`);
}
export async function renderCover(node: HTMLElement, options: {
  width: number; height: number; signal?: AbortSignal;
}): Promise<Blob> {
  coverAbort(options.signal);
  return coverDeadline(renderReadyNode(node, options), 15000, options.signal);
}
