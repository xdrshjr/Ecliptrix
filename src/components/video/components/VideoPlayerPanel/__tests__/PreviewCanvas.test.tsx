/**
 * @vitest-environment node
 *
 * PreviewCanvas — compositor host DOM contract (spec 02 §3, S3).
 *
 * Source-level regex assertions, matching the project pattern in
 * PreviewSurface.v2.test.tsx / VideoPlayerPanel.v2.smoke.test.tsx — vitest's
 * rolldown/vite transform cannot mount component JSX under this project's
 * `jsx: "preserve"` tsconfig (importing the component for render fails import
 * analysis). We therefore pin the DOM host contract at the source level.
 *
 * What we verify (the surface useCompositionPlayback / the engine consume):
 *  - renders the preview <canvas> + a hidden decode-source container;
 *  - the imperative handle exposes getCanvas / resolveTrackElements /
 *    resolveAudioElement (== MultiTrackAttachDeps inputs);
 *  - resolveTrackElements lazily creates ONE active + ONE prewarm <video> per
 *    track and caches per track id;
 *  - resolveAudioElement lazily creates + caches one media element per track;
 *  - the host NEVER assigns `src` on the decode <video>s (VideoSourcePool owns
 *    src — RC-B);
 *  - the host no longer measures subtitle text (EXO-09 lays out in output px);
 *  - DPR-aware ResizeObserver sizing.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(__dirname, '..', 'PreviewCanvas.tsx'), 'utf-8');

describe('PreviewCanvas — DOM host contract', () => {
  it('renders a <canvas> and a hidden aria-hidden decode-source container', () => {
    expect(src).toMatch(/<canvas[\s\n][\s\S]*?ref=\{canvasRef\}/);
    expect(src).toMatch(/<div\s+ref=\{sourceHostRef\}[\s\S]*?aria-hidden="true"/);
  });

  it('exposes the MultiTrackAttachDeps DOM surface via the imperative handle', () => {
    expect(src).toMatch(/useImperativeHandle\(ref,\s*\(\)\s*=>\s*handle/);
    expect(src).toMatch(/getCanvas:\s*\(\)\s*=>\s*canvasRef\.current/);
    expect(src).toMatch(/resolveTrackElements\b/);
    expect(src).toMatch(/resolveAudioElement\b/);
  });

  it('resolveTrackElements lazily creates one active + one prewarm <video> per track and caches it', () => {
    // Returns the cached pair for a known track id (no element churn).
    expect(src).toMatch(/const existing = pool\.get\(trackId\);/);
    expect(src).toMatch(/if \(existing\) return existing;/);
    // A pair = active + prewarm, both created via createHiddenVideo.
    expect(src).toMatch(/active:\s*createHiddenVideo\(\)/);
    expect(src).toMatch(/prewarm:\s*createHiddenVideo\(\)/);
    expect(src).toMatch(/pool\.set\(trackId,\s*pair\);/);
  });

  it('resolveAudioElement lazily creates + caches one media element per track', () => {
    expect(src).toMatch(/const el = createHiddenAudio\(\)/);
    expect(src).toMatch(/pool\.set\(trackId,\s*el\);/);
  });

  it('appends decode sources into the hidden source-host container', () => {
    expect(src).toMatch(/sourceHostRef\.current\?\.appendChild\(el\)/);
  });

  it('never assigns src on the decode <video>s (VideoSourcePool owns src — RC-B)', () => {
    // No `el.src =` / `.setAttribute('src'` anywhere in the host.
    expect(src).not.toMatch(/\.src\s*=/);
    expect(src).not.toMatch(/setAttribute\(\s*['"]src['"]/);
  });

  it('does not measure subtitle text: subtitles are laid out in output pixels (EXO-09)', () => {
    expect(src).not.toMatch(/measureText/);
    expect(src).not.toMatch(/getContext\('2d'\)/);
  });

  it('keeps the canvas DPR-sized via a ResizeObserver', () => {
    expect(src).toMatch(/devicePixelRatio/);
    expect(src).toMatch(/new ResizeObserver/);
    expect(src).toMatch(/observer\.observe\(wrapper\)/);
    expect(src).toMatch(/observer\?\.disconnect\(\)/);
  });

  it('releases the lazily-created decode pools on unmount', () => {
    expect(src).toMatch(/videoPool\.clear\(\)/);
    expect(src).toMatch(/audioPool\.clear\(\)/);
  });
});
