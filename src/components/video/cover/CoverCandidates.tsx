'use client';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { CoverAsset, CoverJob, CoverJobConnection } from '@/types/videoCover';
import { isCoverJobActive } from './useCoverJobs';

// The clock is separate from the polite phase announcements on purpose.
function JobElapsed({ job }: { job: CoverJob }) {
  const { t } = useLocale();
  const [now, setNow] = useState(Date.now);
  const active = isCoverJobActive(job);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  if (!active || !job.createdAt) return null;
  const timestamp = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(job.createdAt)
    ? job.createdAt : `${job.createdAt}Z`;
  const started = Date.parse(timestamp);
  if (!Number.isFinite(started)) return null;
  return <span className="cover-muted">{t.coverStudio.elapsed.replace(
    '{seconds}', String(Math.max(0, Math.floor((now - started) / 1000))))}</span>;
}

export function CoverCandidates({ jobs, assets: suppliedAssets, value,
  onSelect, onCancel, connection, onRefresh, onRegenerate }: {
  jobs: CoverJob[]; assets?: CoverAsset[]; value: string | null;
  onSelect: (asset: CoverAsset) => void; onCancel: (id: string) => void;
  connection?: CoverJobConnection; onRefresh?: () => void;
  onRegenerate?: () => void;
}) {
  const { t } = useLocale(); const c = t.coverStudio;
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<string | undefined>(undefined);
  const assets = suppliedAssets ?? jobs.flatMap(job => job.assets ?? []);
  const tabbable = assets.some(asset => asset.assetId === value)
    ? value : assets[0]?.assetId;
  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    refs.current.get(pendingFocus.current)?.focus();
    pendingFocus.current = undefined;
  }, [assets, value]);
  const selectByKey = (event: React.KeyboardEvent, index: number) => {
    const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1
      : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 0;
    if (!direction && event.key !== ' ') return;
    event.preventDefault();
    const asset = assets[(index + direction + assets.length) % assets.length];
    pendingFocus.current = asset.assetId;
    onSelect(asset);
    refs.current.get(asset.assetId)?.focus();
  };
  return <div className="cover-candidates">
    {connection && (connection.status === 'retrying' ||
      connection.unavailableJobIds.length > 0) && <div role="status">
      {connection.failedJobIds.length > 0 && <p>{c.connectionRetrying}</p>}
      {connection.unavailableJobIds.length > 0 && <p>{c.jobUnavailable}</p>}
      <button onClick={onRefresh}>{c.refreshStatus}</button>
    </div>}
    <div className="cover-job-list">{jobs.filter(job =>
      isCoverJobActive(job) || job.status === 'failed' ||
      job.status === 'interrupted' || job.status === 'cancelled' ||
      !!job.warnings?.length).map(job =>
      <div key={job.jobId} className="cover-job">
        <span aria-live="polite">{job.status === 'running' &&
          job.phase === 'downloading' ? c.downloading : c[job.status]}</span>
        <JobElapsed job={job} />
        {isCoverJobActive(job) && <button onClick={() =>
          onCancel(job.jobId)}>{c.cancel}</button>}
        {!!job.errorCode && <span role="status">
          {c.errors[job.errorCode] ?? c.error}</span>}
        {!!job.warnings?.length && <span role="status">
          {c.partialGeneration}</span>}
        {(job.status === 'failed' || job.status === 'interrupted') &&
          onRegenerate && <><button onClick={onRegenerate}>
            {c.regenerate}</button><small>{c.regenerateNotice}</small></>}
      </div>)}</div>
    {!assets.length && <p className="cover-muted">{c.emptyImages}</p>}
    <div role="radiogroup" aria-label={c.candidate}
      className="cover-candidate-strip">
      {assets.map((asset, index) => <button key={asset.assetId} role="radio"
        ref={node => { if (node) refs.current.set(asset.assetId, node);
          else refs.current.delete(asset.assetId); }}
        aria-checked={value === asset.assetId}
        tabIndex={asset.assetId === tabbable ? 0 : -1}
        aria-label={`${c.candidate} ${index + 1}`}
        onClick={() => onSelect(asset)}
        onKeyDown={event => selectByKey(event, index)}>
        <img src={asset.url} alt="" loading="lazy" />
        <span>{value === asset.assetId ? `✓ ${c.selected}`
          : `${c.candidate} ${index + 1}`}</span>
      </button>)}
    </div>
  </div>;
}
