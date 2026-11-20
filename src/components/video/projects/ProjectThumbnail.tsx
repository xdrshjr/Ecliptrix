'use client';

import React, { useEffect, useRef, useState } from 'react';

interface ProjectThumbnailProps {
  projectId: string;
  coverUrl?: string | null;
  updatedAt: string;
}

interface ThumbnailState {
  phase: 'explicit' | 'automatic' | 'placeholder';
  attempt: number;
  loaded: boolean;
}

function gradientFromId(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index++) {
    hash = (hash * 31 + id.charCodeAt(index)) & 0x7fffffff;
  }
  const hue = hash % 360;
  return `linear-gradient(135deg, hsl(${hue} 60% 55%) 0%, hsl(${(hue + 60) % 360} 60% 45%) 100%)`;
}

function useThumbnailState(coverUrl: ProjectThumbnailProps['coverUrl']) {
  const [state, setState] = useState<ThumbnailState>(() => ({
    phase: coverUrl?.trim() ? 'explicit' : 'automatic', attempt: 0, loaded: false,
  }));
  const current = useRef(state);
  const mounted = useRef(true);
  const changeState = (next: ThumbnailState) => {
    current.current = next;
    setState(next);
  };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (state.phase !== 'placeholder' || state.attempt !== 0) return;
    const timer = setTimeout(() => {
      if (mounted.current && current.current === state) {
        const next: ThumbnailState = { phase: 'automatic', attempt: 1, loaded: false };
        current.current = next;
        setState(next);
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [state]);

  const isCurrent = () => mounted.current && current.current.phase === state.phase
    && current.current.attempt === state.attempt && !current.current.loaded;
  const onError = () => {
    if (!isCurrent()) return;
    changeState({ phase: state.phase === 'explicit' ? 'automatic' : 'placeholder',
      attempt: state.attempt, loaded: false });
  };
  const onLoad = () => {
    if (isCurrent()) changeState({ ...state, loaded: true });
  };
  return { state, onError, onLoad };
}

export default function ProjectThumbnail({ projectId, coverUrl, updatedAt }: ProjectThumbnailProps) {
  const { state, onError, onLoad } = useThumbnailState(coverUrl);
  const automaticUrl = `/api/video-projects/${encodeURIComponent(projectId)}/thumbnail?v=${encodeURIComponent(updatedAt)}`;
  const src = state.phase === 'explicit' ? coverUrl! : `${automaticUrl}${state.attempt ? '&retry=1' : ''}`;

  return (
    <div className="absolute inset-0" style={{ backgroundImage: gradientFromId(projectId) }} aria-hidden="true">
      <div className="absolute inset-0 flex items-center justify-center text-white/80">
        <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      </div>
      {state.phase !== 'placeholder' && (
        // 原生 img 保留同源接口的 no-store 和有界错误回退语义。
        // eslint-disable-next-line @next/next/no-img-element
        <img key={`${state.phase}:${state.attempt}`} src={src} alt="" aria-hidden="true"
          width={640} height={360} loading="lazy" decoding="async"
          className={`absolute inset-0 w-full h-full object-cover ${state.loaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={onLoad}
          onError={onError}
        />
      )}
    </div>
  );
}
