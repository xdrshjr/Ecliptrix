'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { EffectComposition } from '@/lib/effects/compositions/EffectComposition';
import { EFFECT_FONT_URLS } from '@/lib/effects/fonts';
import { resolveEffectAssets } from '@/lib/effects/assetResolver';
import type { EffectAsset, EffectDocument } from '@/types/effects';
import { useLocale } from '@/contexts/LocaleContext';

export default function EffectsPreview(options: {
  document: EffectDocument; assets: EffectAsset[];
}) {
  const { t } = useLocale();
  const { document } = options;
  const [hasError, setHasError] = useState(false);
  const [playerEpoch, setPlayerEpoch] = useState(0);
  const previous = useRef(document);
  const reportError = useCallback(() => setHasError(true), []);
  useEffect(() => {
    if (hasError && previous.current !== document) {
      setHasError(false); setPlayerEpoch(epoch => epoch + 1);
    }
    previous.current = document;
  }, [document, hasError]);
  let assets: Record<string, string> | undefined;
  try { assets = resolveEffectAssets(document, options.assets); }
  catch { assets = undefined; }
  const playback = usePreviewPlayback(playerEpoch,
    document.durationFrames, Boolean(assets));
  if (!assets) return <p role="alert" className="p-4 text-sm">{t.effects.labels.missing}</p>;
  return <div className="flex h-full min-h-0 flex-col items-center justify-center gap-4 p-4">
    <Player key={playerEpoch} ref={playback.player} component={EffectComposition}
      inputProps={{ document, assets, fontUrls: EFFECT_FONT_URLS }}
      durationInFrames={document.durationFrames} fps={30}
      compositionWidth={document.canvas.width}
      compositionHeight={document.canvas.height}
      initialFrame={Math.floor(document.durationFrames * 0.3)}
      controls={false}
      style={{ width: '100%', maxHeight: '100%',
        aspectRatio: `${document.canvas.width}/${document.canvas.height}` }}
      errorFallback={({ error }) => <PreviewError onError={reportError}
        message={t.effects.errors[error.message] ?? t.effects.labels.failed} />} />
    <div className="w-full space-y-2">
      <input type="range" min={0} max={document.durationFrames - 1}
        aria-label={t.effects.labels.seek} value={Math.min(playback.frame,
          document.durationFrames - 1)} className="w-full h-1 accent-primary"
        onChange={event => playback.player.current?.seekTo(event.target.valueAsNumber)} />
      <div className="flex items-center justify-center gap-4 text-xs">
        <button type="button" aria-label={t.effects.labels.previousFrame}
          onClick={() => playback.player.current?.seekTo(Math.max(0,
            playback.frame - 1))}>◀</button>
        <button type="button" onClick={() => playback.player.current?.toggle()}>
          {playback.isPlaying ? t.effects.labels.pause : t.effects.labels.play}
        </button>
        <button type="button" aria-label={t.effects.labels.nextFrame}
          onClick={() => playback.player.current?.seekTo(Math.min(
            document.durationFrames - 1, playback.frame + 1))}>▶</button>
        <button type="button" aria-pressed={playback.isMuted}
          onClick={() => playback.isMuted ? playback.player.current?.unmute()
            : playback.player.current?.mute()}>{t.effects.labels.mute}</button>
        <output className="tabular-nums text-muted-foreground">
          {String(Math.floor(playback.frame / 1800)).padStart(2, '0')}:
          {String(Math.floor(playback.frame / 30) % 60).padStart(2, '0')}:
          {String(playback.frame % 30).padStart(2, '0')}
        </output>
      </div>
    </div>
    <p className="text-xs tabular-nums text-muted-foreground">
      {document.canvas.width} × {document.canvas.height} · 30 fps ·
      {' '}{(document.durationFrames / 30).toFixed(2)} s
    </p>
  </div>;
}

function usePreviewPlayback(epoch: number, frames: number, isReady: boolean) {
  const player = useRef<PlayerRef>(null);
  const [frame, setFrame] = useState(Math.floor(frames * 0.3));
  const [isPlaying, setPlaying] = useState(false);
  const [isMuted, setMuted] = useState(false);
  useEffect(() => {
    const current = player.current;
    if (!current || !isReady) return;
    const update = (event: { detail: { frame: number } }) => setFrame(event.detail.frame);
    const play = () => setPlaying(true), pause = () => setPlaying(false);
    const mute = (event: { detail: { isMuted: boolean } }) => setMuted(event.detail.isMuted);
    setFrame(current.getCurrentFrame());
    current.addEventListener('frameupdate', update);
    current.addEventListener('play', play); current.addEventListener('pause', pause);
    current.addEventListener('ended', pause); current.addEventListener('mutechange', mute);
    return () => {
      current.removeEventListener('frameupdate', update);
      current.removeEventListener('play', play); current.removeEventListener('pause', pause);
      current.removeEventListener('ended', pause); current.removeEventListener('mutechange', mute);
    };
  }, [epoch, isReady]);
  return { player, frame, isPlaying, isMuted };
}

function PreviewError(options: { message: string; onError: () => void }) {
  useEffect(options.onError, [options.onError]);
  return <p role="alert" className="p-4 text-sm">{options.message}</p>;
}
