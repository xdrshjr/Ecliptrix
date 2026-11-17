import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { EffectRenderJob } from '@/types/effects';
import type { EffectsController } from './useEffectsController';
import { isEffectJobActive } from './useEffectsJobs';

export function EffectsJobCard(options: { job: EffectRenderJob;
  controller: EffectsController; mode: 'insert' | 'replace' }) {
  const { t } = useLocale();
  const { job, controller } = options;
  return <article className="rounded border border-border bg-background px-3 py-2 text-xs space-y-2">
    <div className="flex justify-between gap-3" aria-live="polite">
      <span>{t.effects.labels.version} {job.draftVersion}</span>
      <span>{t.effects.labels[job.status]}</span>
    </div>
    {isEffectJobActive(job) && <>
      <progress max={1} value={job.progress}
        aria-label={t.effects.labels[job.status]} className="w-full h-1.5" />
      <button type="button" disabled={job.status === 'cancelling'}
        onClick={() => void controller.run(() => controller.jobs.cancel(job))}>
        {t.effects.labels.cancel}
      </button>
    </>}
    {job.errorCode && <p role="alert" className="text-destructive">
      {t.effects.errors[job.errorCode] ?? t.effects.labels.failed}
    </p>}
    {job.outputAsset && <div className="flex flex-wrap items-center gap-3">
      <span className="text-muted-foreground">
        {job.outputAsset.bytes < 1024 * 1024
          ? `${Math.ceil(job.outputAsset.bytes / 1024)} KB`
          : `${(job.outputAsset.bytes / 1024 / 1024).toFixed(1)} MB`}
      </span>
      <button type="button" onClick={() => controller.register(job.outputAsset!)}>
        {t.effects.labels.save}
      </button>
      <button type="button" className="text-primary"
        onClick={() => void controller.apply(job.outputAsset!, options.mode)}>
        {t.effects.labels[options.mode]}
      </button>
    </div>}
  </article>;
}
