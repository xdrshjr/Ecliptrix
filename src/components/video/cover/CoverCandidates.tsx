'use client';
import React, { useEffect, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { CoverAsset, CoverJob } from '@/types/videoCover';
import { isCoverJobActive } from './useCoverJobs';
export function CoverCandidates({ jobs, value, onSelect, onCancel }: {
  jobs: CoverJob[]; value: string | null; onSelect: (asset: CoverAsset) => void;
  onCancel: (id: string) => void;
}) {
  const { t } = useLocale(); const c = t.coverStudio;
  const [now, setNow] = useState(Date.now);
  const hasActiveJob = jobs.some(isCoverJobActive);
  useEffect(() => {
    if (!hasActiveJob) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasActiveJob]);
  const elapsed = (job: CoverJob) => {
    if (!isCoverJobActive(job) || !job.createdAt) return null;
    // SQLite timestamps are UTC even when their ISO string has no zone suffix.
    const timestamp = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(job.createdAt)
      ? job.createdAt : `${job.createdAt}Z`;
    const started = Date.parse(timestamp);
    if (!Number.isFinite(started)) return null;
    return c.elapsed.replace('{seconds}',
      String(Math.max(0, Math.floor((now - started) / 1000))));
  };
  const assets = jobs.flatMap(job => job.assets ?? []);
  return <div className="cover-candidates">
    <div aria-live="polite">{jobs.slice(0, 3).map(job => <div key={job.jobId}>
      <span>{job.status === 'running' && job.phase === 'downloading'
        ? c.downloading : c[job.status]}</span>
      <span aria-live="off" className="cover-muted">{elapsed(job)}</span>
      {isCoverJobActive(job) && <button onClick={() => onCancel(job.jobId)}>{c.cancel}</button>}
      {!!job.errorCode && <p role="alert">{c.errors[job.errorCode] ?? c.error}</p>}
      {!!job.warnings?.length && <p>{job.warnings.join(' · ')}</p>}
    </div>)}</div>
    <div role="radiogroup" aria-label={c.candidate} className="cover-candidate-strip">
      {assets.map((asset, index) => <button key={asset.assetId} role="radio"
        aria-checked={value === asset.assetId} aria-label={`${c.candidate} ${index + 1}`}
        onClick={() => onSelect(asset)} onKeyDown={e => {
          const direction = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
          if (!direction) return; e.preventDefault();
          const i = (index + direction + assets.length) % assets.length;
          onSelect(assets[i]); (e.currentTarget.parentElement?.children[i] as HTMLElement)?.focus();
        }}><img src={asset.url} alt="" /><span>{value === asset.assetId ? `✓ ${c.selected}` : `${c.candidate} ${index + 1}`}</span></button>)}
    </div>
  </div>;
}
