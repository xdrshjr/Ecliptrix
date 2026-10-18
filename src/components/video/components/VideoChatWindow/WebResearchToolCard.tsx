'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { readResearchArtifact, researchScreenshotUrl }
  from '@/lib/api/webResearch';
import type { AgentToolCallRecord } from '@/types';
import type { Translations } from '@/lib/i18n';
import { resolveResearchStatus } from '@/lib/webResearchStatus';
import type { ResearchCoverage, ResearchModelStage } from '@/types/webResearch';

const NETWORK_TOOLS = new Set([
  'web_search', 'web_fetch', 'web_research', 'extract_web_images',
  'fetch_web_image', 'download_web_media', 'browser_open', 'browser_read',
  'browser_act', 'browser_close', 'read_research_artifact',
]);
const BUTTON = 'rounded border border-border px-2 py-1 text-xs ' +
  'hover:bg-accent focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-primary disabled:opacity-50';

export function isWebResearchTool(name: string) {
  return NETWORK_TOOLS.has(name);
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 展示边界再次拒绝执行协议、内嵌认证和签名下载地址。 */
export function safeResearchSourceUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f\\]/.test(value)) return;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) ||
      url.username || url.password) return;
    const secret = /token|signature|credential|password|secret|api.?key|auth|^key$|^sig$|^x-amz-|^x-goog-/i;
    if (Array.from(url.searchParams.keys()).some(key => secret.test(key))) return;
    const fragment = new URLSearchParams(url.hash.slice(1).replace(/.*\?/, ''));
    if (Array.from(fragment.keys()).some(key => secret.test(key))) return;
    return url.href;
  } catch { return; }
}

function safeLocalPreview(value: unknown) {
  if (typeof value !== 'string' ||
    !/^\/api\/storage\/files\/cached_materials\/web\/[a-zA-Z0-9_.-]+$/.test(value)) return;
  return value;
}

function resultDetails(toolCall: AgentToolCallRecord) {
  const result = object(toolCall.result);
  return { ...result, ...object(result.details),
    ...(result.success === false ? { success: false } : {}) };
}

/** Count only known, unique sources; historic or inconsistent data stays unknown. */
function reportCoverage(details: Record<string, unknown>): ResearchCoverage | undefined {
  const counts = object(details.coverage);
  const keys = ['page_text', 'search_snippet', 'unavailable'] as const;
  if (!['selected', ...keys].every(key => Number.isSafeInteger(counts[key]) &&
    Number(counts[key]) >= 0 && Number(counts[key]) <= 5)) return;
  if (counts.selected !== keys.reduce((sum, key) => sum + Number(counts[key]), 0)) return;
  if (!Array.isArray(details.sources) || details.sources.length !== counts.selected) return;
  const sources = details.sources.map(object);
  const ids = sources.map(source => source.id);
  if (ids.some(id => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== ids.length) return;
  if (keys.some(key => sources.filter(source => source.evidence_kind === key).length !== counts[key])) return;
  return counts as unknown as ResearchCoverage;
}

function coverageLabel(details: Record<string, unknown>, copy: Translations['webResearch']) {
  const counts = reportCoverage(details);
  return counts ? copy.coverageSummary.replace('{page_text}', String(counts.page_text))
    .replace('{search_snippet}', String(counts.search_snippet))
    .replace('{unavailable}', String(counts.unavailable)) : copy.sourceUnrecorded;
}

function qualityLabel(details: Record<string, unknown>, copy: Translations['webResearch']) {
  const counts = reportCoverage(details);
  if (!counts) return copy.sourceUnrecorded;
  const expected = counts.selected === counts.unavailable ? 'none' :
    counts.page_text === counts.selected ? 'full_text' :
      counts.page_text === 0 ? 'snippets_only' : 'mixed';
  if (details.quality !== expected) return copy.sourceUnrecorded;
  return { full_text: copy.qualityFullText, mixed: copy.qualityMixed,
    snippets_only: copy.qualitySnippetsOnly, none: copy.qualityNone }[expected];
}

function modelStage(value: unknown, maximum: number): ResearchModelStage | undefined {
  const stage = object(value);
  const attempts = Number(stage.attempts);
  if (typeof stage.attempts !== 'number' || !Number.isSafeInteger(attempts) ||
    attempts < 0 || attempts > maximum) return;
  const model = string(stage.model_name);
  if (attempts > 0 && (!model.trim() || /https?:|[\r\n]/i.test(model) ||
    new TextEncoder().encode(model).length > 256)) return;
  if (attempts === 0 && stage.model_name !== null) return;
  const clean = stage.error_code === null && stage.reason === null;
  if (stage.status === 'succeeded' && attempts > 0 && clean) return stage as unknown as ResearchModelStage;
  if (stage.status === 'disabled' && attempts === 0 && clean) return stage as unknown as ResearchModelStage;
  if (stage.status === 'skipped' && attempts === 0 && stage.error_code === null &&
    ['no_sources', 'insufficient_time', 'prior_stage_failed', 'context_budget'].includes(string(stage.reason))) {
    return stage as unknown as ResearchModelStage;
  }
  const preflight = maximum === 1 &&
    ['configuration_invalid', 'provider_not_configured'].includes(string(stage.error_code));
  if (stage.status === 'failed' && stage.reason === null &&
    typeof stage.error_code === 'string' && stage.error_code.trim() &&
    (attempts > 0 || preflight)) return stage as unknown as ResearchModelStage;
}

function modelErrorLabel(code: string, copy: Translations['webResearch']) {
  if (['configuration_invalid', 'provider_not_configured', 'research_model_rejected'].includes(code)) return copy.modelConfiguration;
  if (code === 'research_model_rate_limited') return copy.modelBusy;
  if (code === 'research_model_timeout') return copy.modelTimeout;
  if (['research_model_response_invalid', 'research_model_response_too_large',
    'research_model_output_incomplete', 'research_model_report_invalid'].includes(code)) return copy.modelInvalid;
  return copy.modelFailed;
}

function ModelSummary({ details }: { details: Record<string, unknown> }) {
  const { t: { webResearch: copy } } = useLocale();
  const counts = reportCoverage(details);
  if (!counts) return <p>{copy.modelUnknown}</p>;
  if (!counts.page_text && !counts.search_snippet) return <p role="status">{copy.qualityNone}</p>;
  const usage = object(details.model_usage);
  const query = modelStage(usage.query, 1);
  const synthesis = modelStage(usage.synthesis, 2);
  if (!query || !synthesis) return <p>{copy.modelUnknown}</p>;
  const label = synthesis.status === 'succeeded'
    ? copy.modelSynthesisSucceeded.replace('{model}', synthesis.model_name!)
    : synthesis.status === 'disabled' ? copy.modelDisabled
      : query.status === 'succeeded' && synthesis.status === 'skipped'
        ? copy.modelQueryOnly : copy.modelSynthesisFallback;
  const failed = synthesis.status === 'failed' ? synthesis : query.status === 'failed' ? query : null;
  return <div role="status" className="space-y-1 break-words">
    <p>{label}</p>{failed && <p>{modelErrorLabel(failed.error_code!, copy)}</p>}
  </div>;
}

function statusText(toolCall: AgentToolCallRecord,
  details: Record<string, unknown>, copy: Translations['webResearch']) {
  const resolved = researchStatus(toolCall, details);
  if (resolved) return copy[resolved.key];
  if (toolCall.status === 'executing') {
    if (['fetch_web_image', 'download_web_media'].includes(toolCall.name)) return copy.downloading;
    return ['web_search', 'web_research', 'extract_web_images'].includes(toolCall.name)
      ? copy.searching : copy.reading;
  }
  const reused = typeof details.already_in_library === 'boolean'
    ? details.already_in_library : details.reused;
  if (reused) return copy.reused;
  if (details.material || details.status === 'ready') return copy.imported;
  if (toolCall.name === 'web_research' && toolCall.status === 'completed') {
    return `${copy.completed} · ${coverageLabel(details, copy)}`;
  }
  if (details.degraded) return copy.partial;
  if (Array.isArray(details.results) && !details.results.length) return copy.noResults;
  return copy.completed;
}

function researchStatus(toolCall: AgentToolCallRecord, details: Record<string, unknown>) {
  if (toolCall.name === 'web_research' && toolCall.status === 'executing') return null;
  return resolveResearchStatus({
    error_code: string(details.error_code || details.code),
    failure_class: string(details.failureClass || details.failure_class ||
      object(details.error_details).failure_class),
    status: toolCall.status, success: details.success === false ? false : undefined,
  });
}

function SourceList({ entries, prefix, research }: {
  entries: unknown[]; prefix: string; research: boolean;
}) {
  const { t } = useLocale();
  return <ol aria-label={t.webResearch.sourceList} className="space-y-3">
    {entries.slice(0, 12).map((entry, index) => {
      const source = object(entry);
      const href = safeResearchSourceUrl(source.final_url || source.url ||
        source.source_page_url);
      const title = string(source.title || source.alt) ||
        (href ? new URL(href).hostname : t.webResearch.sourceList);
      const license = safeResearchSourceUrl(source.license_url);
      return <li key={index} id={`${prefix}-source-${index}`} tabIndex={-1}
        className="min-w-0 space-y-1 break-words rounded border border-border p-2 focus:outline focus:outline-2 focus:outline-primary">
        <p className="font-medium">[{index + 1}]{' '}
          {href ? <a href={href} target="_blank" rel="noopener noreferrer"
            className="text-primary underline underline-offset-2">{title}</a> : title}
        </p>
        {research && <p className="text-muted-foreground">{
          source.evidence_kind === 'page_text' ? t.webResearch.sourcePageText :
            source.evidence_kind === 'search_snippet' ? t.webResearch.sourceSnippet :
              source.evidence_kind === 'unavailable' ? t.webResearch.sourceUnavailable :
                t.webResearch.sourceUnrecorded}</p>}
        {href && <p className="text-muted-foreground">{new URL(href).hostname}</p>}
        {string(source.retrieved_at) && <p className="text-muted-foreground">
          {t.webResearch.retrieved}: <time>{string(source.retrieved_at)}</time>
        </p>}
        <p className="text-muted-foreground">{source.license_status === 'declared'
          ? license ? <a href={license} target="_blank" rel="noopener noreferrer"
            className="underline">{t.webResearch.licenseDeclared}</a>
            : t.webResearch.licenseDeclared : t.webResearch.licenseUnknown}</p>
        {string(source.snippet || source.content) && <details>
          <summary className="cursor-pointer">{t.webResearch.readMore}</summary>
          <p className="mt-1 whitespace-pre-wrap">{string(source.snippet || source.content).slice(0, 4000)}</p>
        </details>}
      </li>;
    })}
  </ol>;
}

function ResearchPreview({ details }: { details: Record<string, unknown> }) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const screenshot = string(details.screenshot_artifact_id);
  if (!screenshot) return null;
  const close = () => { setExpanded(false); trigger.current?.focus(); };
  return <div onKeyDown={event => {
    if (event.key === 'Escape' && expanded) {
      event.preventDefault(); event.stopPropagation(); close();
    }
  }}>
    <button ref={trigger} type="button" className={BUTTON}
      aria-expanded={expanded} disabled={unavailable}
      onClick={() => setExpanded(value => !value)}>{t.webResearch.preview}</button>
    {expanded && !unavailable && <div className="mt-2 space-y-2">
      <img src={researchScreenshotUrl(screenshot, string(details.project_id))}
        alt={t.webResearch.preview} className="max-h-72 max-w-full rounded border border-border object-contain"
        onError={() => { setUnavailable(true); setExpanded(false); }} />
      <button type="button" className={BUTTON} onClick={close}>
        {t.webResearch.closePreview}</button>
    </div>}
    {unavailable && <p role="status">{t.webResearch.expired}</p>}
  </div>;
}

function ArtifactReader({ details }: { details: Record<string, unknown> }) {
  const { t } = useLocale();
  const [content, setContent] = useState('');
  const [offset, setOffset] = useState<number | null>(0);
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const [readError, setReadError] = useState('');
  useEffect(() => () => controller.current?.abort(), []);
  const id = string(details.artifact_id || details.snapshot_artifact_id);
  if (!id) return null;
  const read = async () => {
    if (controller.current || offset === null) return;
    controller.current = new AbortController();
    setBusy(true);
    setReadError('');
    try {
      const result = await readResearchArtifact({ id,
        projectId: string(details.project_id), offset,
        signal: controller.current.signal });
      setContent(previous => previous + result.content);
      setOffset(result.next_offset);
    } catch (error) {
      if (!controller.current?.signal.aborted) {
        const status = object(error).status;
        const expired = status === 404 || status === 410;
        setUnavailable(expired);
        setReadError(expired ? t.webResearch.expired : t.webResearch.offline);
      }
    } finally { setBusy(false); controller.current = null; }
  };
  return <div className="space-y-2">
    <button type="button" className={BUTTON}
      disabled={busy || unavailable || offset === null}
      onClick={() => void read()}>{busy ? t.webResearch.loading : t.webResearch.readMore}</button>
    {readError && <p role="status">{readError}</p>}
    {content && <div className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded bg-background p-2">{content}</div>}
  </div>;
}

function FactCitation({ id, entries, prefix }: {
  id: unknown; entries: unknown[]; prefix: string;
}) {
  const { t } = useLocale();
  const matches = entries.flatMap((source, index) =>
    typeof id === 'string' && id && object(source).id === id ? [index] : []);
  const target = matches.length === 1 ? matches[0] : -1;
  if (target < 0 || object(entries[target]).evidence_kind === 'unavailable') {
    return <span>{t.webResearch.citationMissing} </span>;
  }
  const targetId = `${prefix}-source-${target}`;
  return <><a href={`#${targetId}`}
    className="rounded text-primary underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
    onClick={event => {
      event.preventDefault();
      const destination = document.getElementById(targetId);
      destination?.focus();
      destination?.scrollIntoView?.({ block: 'nearest' });
    }}>[{target + 1}]</a>{' '}</>;
}

function ResearchFacts({ facts, entries, prefix }: {
  facts: unknown[]; entries: unknown[]; prefix: string;
}) {
  const { t } = useLocale();
  if (!facts.length) return null;
  return <ul className="list-inside list-disc space-y-1">
    {facts.map((fact, index) => {
      const record = object(fact);
      const ids = Array.isArray(record.source_ids) ? record.source_ids : [];
      return <li key={index}>{string(record.text || record.claim) || string(fact)}{' '}
        {record.evidence_kind === 'includes_snippet' && <span className="text-muted-foreground">
          {t.webResearch.factIncludesSnippet}{' '}
        </span>}
        {ids.map((id, refIndex) => <FactCitation key={refIndex}
          id={id} entries={entries} prefix={prefix} />)}
      </li>;
    })}
  </ul>;
}

function ResultContent({ details, prefix, research }: {
  details: Record<string, unknown>; prefix: string; research: boolean;
}) {
  const { t } = useLocale();
  const results = Array.isArray(details.results) ? details.results : [];
  const sources = Array.isArray(details.sources) ? details.sources :
    Array.isArray(details.results) ? details.results :
      Array.isArray(details.images) ? details.images : [];
  const material = object(details.material);
  const provenance = object(material.provenance || object(material.metadata).provenance);
  const sourceEntries = (sources.length ? sources :
    Object.keys(provenance).length ? [provenance] : []).map(entry => {
    const source = object(entry);
    const hit = results.find(result => object(result).source_id === source.id);
    return { ...source, snippet: source.snippet || object(hit).snippet };
  });
  const preview = safeLocalPreview(material.thumbnail_url ||
    material.thumbnailUrl || (material.type === 'image' ? material.local_url || material.url : ''));
  const brief = string(details.brief || details.content || details.text);
  const facts = Array.isArray(details.facts) ? details.facts : [];
  const uncertainties = Array.isArray(details.uncertainties) ? details.uncertainties : [];
  return <div className="space-y-3 break-words border-t border-border p-3 text-xs">
    {research && <p role="status">{qualityLabel(details, t.webResearch)}</p>}
    {brief && <p className="whitespace-pre-wrap break-words">{brief.slice(0, 8000)}</p>}
    {!research && !!details.degraded && <p role="status">{t.webResearch.partial}</p>}
    <ResearchFacts facts={facts} entries={sourceEntries} prefix={prefix} />
    {uncertainties.length > 0 && <div>
      <p className="font-medium">{t.webResearch.uncertainties}</p>
      <ul className="list-inside list-disc">{uncertainties.map((item, index) =>
        <li key={index}>{string(item)}</li>)}</ul>
    </div>}
    {preview && <img src={preview} alt={t.webResearch.localPreview}
      loading="lazy" className="max-h-40 max-w-full rounded object-contain" />}
    {research && <ModelSummary details={details} />}
    <SourceList entries={sourceEntries} prefix={prefix} research={research} />
    <ResearchPreview details={details} />
    <ArtifactReader details={details} />
  </div>;
}

export default function WebResearchToolCard({ toolCall }: {
  toolCall: AgentToolCallRecord;
}) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const prefix = useId();
  const details = resultDetails(toolCall);
  const research = toolCall.name === 'web_research';
  const showResult = !research || (toolCall.status === 'completed' &&
    details.success !== false && !researchStatus(toolCall, details));
  const status = statusText(toolCall, details, t.webResearch);
  // Gate on the code-owned hint, never on a localised string comparison.
  const needsConfiguration =
    researchStatus(toolCall, details)?.hint === 'configuration';
  return <section className="min-w-0 max-w-full overflow-hidden rounded-md border border-border bg-muted/40 text-foreground motion-reduce:[&_*]:!transition-none">
    <button type="button" aria-expanded={expanded}
      onClick={() => setExpanded(value => !value)}
      className="flex w-full min-w-0 flex-wrap items-center gap-2 p-3 text-left text-xs hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
      <span aria-hidden="true">{expanded ? '−' : '+'}</span>
      <span className="font-medium">{t.webResearch.tools[toolCall.name] ?? toolCall.name}</span>
      <span className="text-muted-foreground" aria-live="polite"
        role={researchStatus(toolCall, details)?.role ?? 'status'}>
        {status}
      </span>
    </button>
    {expanded && <>
      {needsConfiguration && <p className="px-3 py-2 text-xs">
        {t.webResearch.configurationHint}
      </p>}
      {showResult && <ResultContent details={details} prefix={prefix} research={research} />}
    </>}
  </section>;
}
