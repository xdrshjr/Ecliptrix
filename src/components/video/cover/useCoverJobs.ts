'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { videoCoverV2 } from '@/lib/api/videoCoverV2';
import type { CoverJob } from '@/types/videoCover';

export const isCoverJobActive = (job: CoverJob) =>
  job.status === 'queued' || job.status === 'running';

/** Subscriptions never submit generation; re-entry only displays saved results. */
export function useCoverJobs(projectId?: string) {
  const [jobs, setJobs] = useState<CoverJob[]>([]);
  const [error, setError] = useState<unknown>();
  const jobsRef = useRef(jobs); jobsRef.current = jobs;
  const putJob = useCallback((job: CoverJob) => setJobs(previous => [
    job, ...previous.filter(item => item.jobId !== job.jobId),
  ].slice(0, 20)), []);
  useEffect(() => {
    setJobs([]); setError(undefined);
    if (!projectId) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const poll = async () => {
      try {
        for (const job of jobsRef.current.filter(isCoverJobActive)) {
          const next = await videoCoverV2.getJob(projectId, job.jobId, abort.signal);
          if (abort.signal.aborted) return;
          putJob(next);
        }
        failures = 0; setError(undefined);
      } catch (error) {
        if (!abort.signal.aborted) { setError(error); failures++; }
      }
      if (!abort.signal.aborted) timer = setTimeout(poll,
        failures ? Math.min(10000, 1000 * 2 ** failures)
          : document.hidden ? 3000 : 1000);
    };
    timer = setTimeout(poll, 1000);
    return () => { abort.abort(); clearTimeout(timer); };
  }, [projectId, putJob]);
  return { jobs, setJobs, putJob, error };
}
