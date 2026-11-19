'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import GetCredentialLink from '@/components/integrations/GetCredentialLink';
import {
  GATEWAY_CAPABILITY_OF,
  MANUAL_ONLY_CAPABILITIES,
  ROUTED_CAPABILITIES,
  fillTemplate,
  type RoutedCapabilityId,
  type SkillRouterVerifyResult,
} from '@/lib/api/skillrouter';
import type { CapabilityId } from '@/lib/api/setupStatus';
import RouterQuotaMeter from './RouterQuotaMeter';

interface RouterVerifyResultProps {
  result: SkillRouterVerifyResult;
}

type Tone = 'ok' | 'warn' | 'danger';

const OUTCOME_TONE: Record<SkillRouterVerifyResult['outcome'], Tone> = {
  ok: 'ok',
  invalid_credentials: 'danger',
  unreachable: 'danger',
  upstream_error: 'warn',
  unverifiable: 'warn',
};
const TONE_ICON: Record<Tone, string> = { ok: '✓', warn: '▲', danger: '✕' };

function isAvailable(result: SkillRouterVerifyResult, id: RoutedCapabilityId): boolean {
  const gatewayId = GATEWAY_CAPABILITY_OF[id];
  if (!gatewayId) return true;
  const entry = result.capabilities.find((capability) => capability.id === gatewayId);
  return entry ? entry.available : true;
}

const CoverageChips: React.FC<RouterVerifyResultProps> = ({ result }) => {
  const { t } = useLocale();
  const reported = result.coverage.routed.length
    ? result.coverage.routed
    : [...ROUTED_CAPABILITIES];
  const routed = reported.filter((id): id is RoutedCapabilityId =>
    ROUTED_CAPABILITIES.includes(id as RoutedCapabilityId),
  );
  return (
    <ul className="flex flex-wrap gap-2" aria-label={t.skillrouter.connect.coverageTitle}>
      {routed.map((id) => {
        const available = isAvailable(result, id);
        return (
          <li key={id} className={`sr-pill ${available ? 'sr-pill--ok' : 'sr-pill--warn'}`}>
            <span aria-hidden="true">{available ? '✓' : '▲'}</span>
            {t.setupWizard.cap[id].name}
            {!available && <span className="sr-only">{t.skillrouter.coverage.unavailable}</span>}
          </li>
        );
      })}
    </ul>
  );
};

const QuotaRows: React.FC<RouterVerifyResultProps> = ({ result }) => {
  const { t } = useLocale();
  const rows = ROUTED_CAPABILITIES.map((id) => {
    const gatewayId = GATEWAY_CAPABILITY_OF[id];
    const entry = gatewayId ? result.capabilities.find((c) => c.id === gatewayId) : undefined;
    return entry?.quota ? { id, quota: entry.quota } : null;
  }).filter((row): row is NonNullable<typeof row> => row !== null);
  if (rows.length === 0) return null;
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      {rows.map(({ id, quota }) => (
        <div key={id}>
          <p className="sr-text-xs mb-1 font-medium">{t.setupWizard.cap[id].name}</p>
          <RouterQuotaMeter quota={quota} />
        </div>
      ))}
    </div>
  );
};

/** Names of the capabilities that stay on the user's own configuration. */
function manualOnlyNames(
  result: SkillRouterVerifyResult,
  names: Record<CapabilityId, { name: string }>,
): string {
  const reported = result.coverage.manualOnly.length
    ? result.coverage.manualOnly
    : [...MANUAL_ONLY_CAPABILITIES];
  return reported
    .filter((id): id is CapabilityId => id in names)
    .map((id) => names[id].name)
    .join('、');
}

/**
 * Inline verdict of a key check. Colour is never the only signal: every state
 * carries an icon and a sentence. Announced politely so a screen reader hears
 * the result without losing its place.
 */
const RouterVerifyResult: React.FC<RouterVerifyResultProps> = ({ result }) => {
  const { t } = useLocale();
  const copy = t.skillrouter.connect.result;
  const tone = OUTCOME_TONE[result.outcome];
  const title =
    result.outcome === 'ok'
      ? fillTemplate(copy.ok, { ms: String(result.latencyMs) })
      : copy[result.outcome].title;
  const hint = result.outcome === 'ok' ? null : copy[result.outcome].hint;
  return (
    <div role="status" aria-live="polite" className="sr-card sr-fade-in" style={{ padding: 16 }}>
      <p className={`sr-pill sr-pill--${tone}`} data-testid="verify-verdict">
        <span aria-hidden="true">{TONE_ICON[tone]}</span>
        {title}
      </p>
      {hint && <p className="sr-text-sm sr-muted mt-2">{hint}</p>}
      {result.outcome === 'invalid_credentials' && (
        <GetCredentialLink id="skillrouter" showDocs={false} className="mt-2" />
      )}
      {result.outcome === 'ok' && (
        <div className="mt-3">
          <p className="sr-text-xs sr-muted mb-2">{t.skillrouter.connect.coverageTitle}</p>
          <CoverageChips result={result} />
          <QuotaRows result={result} />
          <p className="sr-text-sm mt-4">
            <span className="font-medium">{copy.stillManual}</span>{' '}
            <span className="sr-muted">{manualOnlyNames(result, t.setupWizard.cap)}</span>
          </p>
        </div>
      )}
    </div>
  );
};

export default RouterVerifyResult;
