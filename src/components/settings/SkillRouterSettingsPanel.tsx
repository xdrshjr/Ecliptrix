'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import ConfirmationDialog from '@/components/ui/ConfirmationDialog';
import RouterConnectCard from '@/components/skillrouter/RouterConnectCard';
import RouterConnectionCard from '@/components/skillrouter/RouterConnectionCard';
import RouterCoverageList from '@/components/skillrouter/RouterCoverageList';
import RouterModelSlots from '@/components/skillrouter/RouterModelSlots';
import SourceModeChooser from '@/components/skillrouter/SourceModeChooser';
import { useSkillRouter, type UseSkillRouter } from '@/components/skillrouter/useSkillRouter';
import {
  describeRouterFailure,
  type RouterMode,
  type SkillRouterStatus,
  type SkillRouterVerifyResult,
} from '@/lib/api/skillrouter';

const PANEL_SHELL = 'sr-scope h-full min-w-0 overflow-y-auto';

const PanelSkeleton: React.FC = () => (
  <div className={PANEL_SHELL} style={{ background: 'var(--sr-bg)' }} aria-busy="true">
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-8">
      <div className="sr-skeleton h-7 w-40" />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sr-skeleton h-28" />
        <div className="sr-skeleton h-28" />
      </div>
      <div className="sr-skeleton h-36" />
    </div>
  </div>
);

interface SectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({ title, description, children }) => (
  <section className="sr-card">
    <h3 className="sr-heading">{title}</h3>
    {description && <p className="sr-text-sm sr-muted mt-1">{description}</p>}
    <div className="mt-4">{children}</div>
  </section>
);

interface SourceControllerOptions {
  router: UseSkillRouter;
  status: SkillRouterStatus;
}

/** Re-verify / clear-key state of the saved key. */
function useKeyActions({ router }: Pick<SourceControllerOptions, 'router'>) {
  const { t } = useLocale();
  const { showSuccess, showError } = useNotification();
  const [confirmClear, setConfirmClear] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<SkillRouterVerifyResult | null>(null);

  const reportFailure = useCallback(
    (error: unknown) => showError(describeRouterFailure(error, t).title),
    [showError, t],
  );

  const reverify = useCallback(async () => {
    setVerifying(true);
    try {
      setVerifyResult(await router.verify());
    } catch (error) {
      reportFailure(error);
    } finally {
      setVerifying(false);
    }
  }, [reportFailure, router]);

  const clearKey = useCallback(async () => {
    setConfirmClear(false);
    setVerifyResult(null);
    const result = await router.clearKey();
    if (!result.ok) return reportFailure(result.error);
    showSuccess(t.skillrouter.panel.keyCleared);
  }, [reportFailure, router, showSuccess, t]);

  return {
    confirmClear,
    setConfirmClear,
    verifying,
    verifyResult,
    resetVerifyResult: () => setVerifyResult(null),
    reverify,
    clearKey,
    reportFailure,
  };
}

/** Mode switching rules (spec §7.3): no key yet means "connect", not "switch". */
function useSourceController({ router, status }: SourceControllerOptions) {
  const { t } = useLocale();
  const { showSuccess } = useNotification();
  const copy = t.skillrouter.panel;
  const [showConnect, setShowConnect] = useState(false);
  const keys = useKeyActions({ router });
  const { reportFailure, resetVerifyResult } = keys;

  const switchMode = useCallback(
    async (mode: RouterMode) => {
      if (mode === status.mode && status.modeState !== 'unset') return;
      if (mode === 'router' && !status.keyConfigured) {
        setShowConnect(true);
        return;
      }
      const result = await router.save({ mode });
      if (!result.ok) return reportFailure(result.error);
      showSuccess(mode === 'router' ? copy.switchedToRouter : copy.switchedToManual);
    },
    [copy, reportFailure, router, showSuccess, status.keyConfigured, status.mode, status.modeState],
  );

  const onConnected = useCallback(() => {
    setShowConnect(false);
    resetVerifyResult();
    void router.reload();
    showSuccess(status.mode === 'router' ? copy.keyReplaced : copy.switchedToRouter);
  }, [copy, resetVerifyResult, router, showSuccess, status.mode]);

  return { ...keys, showConnect, setShowConnect, switchMode, onConnected };
}

interface SourceBodyProps {
  router: UseSkillRouter;
  status: SkillRouterStatus;
}

const SourceBody: React.FC<SourceBodyProps> = ({ router, status }) => {
  const { t } = useLocale();
  const copy = t.skillrouter.panel;
  const control = useSourceController({ router, status });
  const connectRef = useRef<HTMLDivElement>(null);
  const isRouter = status.mode === 'router';
  const connectVisible = control.showConnect || (isRouter && !status.keyConfigured);

  useEffect(() => {
    if (control.showConnect) connectRef.current?.querySelector('input')?.focus();
  }, [control.showConnect]);

  return (
    <div className="space-y-5">
      <SourceModeChooser
        value={status.modeState === 'unset' ? null : status.mode}
        onChange={(mode) => void control.switchMode(mode)}
      />

      {connectVisible && (
        <div ref={connectRef}>
          <RouterConnectCard status={status} onSaved={control.onConnected} />
        </div>
      )}
      {!connectVisible && status.keyConfigured && (
        <RouterConnectionCard
          status={status}
          verifying={control.verifying}
          verifyResult={control.verifyResult}
          onReverify={() => void control.reverify()}
          onReplaceKey={() => control.setShowConnect(true)}
          onClearKey={() => control.setConfirmClear(true)}
        />
      )}

      {isRouter && status.keyConfigured && (
        <>
          <Section title={copy.coverageTitle} description={copy.coverageDesc}>
            <RouterCoverageList
              status={status}
              capabilities={router.catalog?.capabilities ?? []}
              onSave={router.save}
            />
          </Section>
          <Section title={copy.slotsTitle} description={copy.slotsDesc}>
            <RouterModelSlots
              status={status}
              catalog={router.catalog}
              catalogState={router.catalogState}
              onSave={router.save}
              onRefreshCatalog={router.refreshCatalog}
            />
          </Section>
          <p className="sr-text-xs sr-muted">{t.skillrouter.connect.privacy}</p>
        </>
      )}

      <ConfirmationDialog
        isOpen={control.confirmClear}
        title={copy.clearConfirmTitle}
        message={copy.clearConfirmBody}
        confirmText={copy.clearConfirmAction}
        onConfirm={() => void control.clearKey()}
        onCancel={() => control.setConfirmClear(false)}
      />
    </div>
  );
};

/**
 * Settings → AI source. One place to choose between the AI relay and the
 * user's own provider keys, see what the relay covers, and keep the key.
 * Switching never deletes either side's configuration.
 */
const SkillRouterSettingsPanel: React.FC = () => {
  const { t } = useLocale();
  const copy = t.skillrouter.panel;
  const router = useSkillRouter({ withCatalog: true });
  const { status, loadState, reload } = router;

  if (loadState === 'loading' && !status) return <PanelSkeleton />;

  return (
    <div className={PANEL_SHELL} style={{ background: 'var(--sr-bg)' }}>
      <div className="mx-auto min-w-0 max-w-3xl space-y-5 p-4 sm:p-8 motion-reduce:[&_*]:!transition-none">
        <header>
          <h2 className="text-xl font-semibold">{t.skillrouter.title}</h2>
          <p className="sr-text-sm sr-muted mt-1">{t.skillrouter.description}</p>
        </header>
        {!status ? (
          <div role="alert" className="sr-card flex items-center justify-between gap-3">
            <span className="sr-text-sm">{copy.loadFailed}</span>
            <button type="button" className="sr-btn" onClick={() => void reload()}>
              {copy.retry}
            </button>
          </div>
        ) : (
          <SourceBody router={router} status={status} />
        )}
      </div>
    </div>
  );
};

export default SkillRouterSettingsPanel;
