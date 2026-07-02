'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { Modal } from '@/components/ui/Modal';
import type { UseNarrationDirectScriptReturn } from '../../types/videoEditingTypes';
import ComposeStep from './ComposeStep';
import SplitStep from './SplitStep';

interface NarrationDirectScriptModalProps {
  /** 解说直接生成编排控制器（open/close/step/draftText/complete 等）。 */
  controller: UseNarrationDirectScriptReturn;
}

/**
 * 解说直接生成两步式弹窗主体（Stepper + 左右分栏 + footer 导航）。
 *
 * 第 1 步撰写、第 2 步逐句拆分精修；第 2 步「追加」/「替换」由 controller.complete(mode)
 * 组装新解说 segment 并经父级 onComplete 按 mode 写入下方解说脚本面板。
 */
const NarrationDirectScriptModal: React.FC<NarrationDirectScriptModalProps> = ({ controller }) => {
  const { t } = useLocale();
  const {
    isOpen,
    step,
    draftText,
    isStreaming,
    isSplitting,
    splitSentences,
    error,
    chatMessages,
    close,
    setDraftText,
    sendChatMessage,
    abortChat,
    goToSplitStep,
    backToCompose,
    updateSplitSentences,
    complete,
  } = controller;

  if (!isOpen) return null;

  const steps = [
    { key: 'compose', label: t.narrationDirectScript.stepComposeLabel },
    { key: 'split', label: t.narrationDirectScript.stepSplitLabel },
  ];
  const activeStepIndex = step === 'compose' ? 0 : 1;

  const canGoNext = draftText.trim().length > 0 && !isStreaming && !isSplitting;
  const canComplete = splitSentences.some((s) => s.text.trim().length > 0) && !isSplitting;

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      labelledBy="narration-direct-title"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4"
      contentClassName="flex h-[88vh] max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-md border border-border bg-card shadow-xl"
      closeOnBackdrop={false}
    >
      {/* Header */}
      <div className="flex flex-shrink-0 items-center justify-between rounded-t-md border-b border-border bg-primary/10 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
            <svg className="h-5 w-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <h3 id="narration-direct-title" className="text-lg font-semibold text-foreground">
              {t.narrationDirectScript.title}
            </h3>
            {/* Stepper */}
            <div className="mt-1 flex items-center gap-2">
              {steps.map((s, index) => (
                <React.Fragment key={s.key}>
                  <span
                    className={`flex items-center gap-1.5 text-xs font-medium ${
                      index === activeStepIndex ? 'text-primary' : 'text-muted-foreground'
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                        index === activeStepIndex
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {index + 1}
                    </span>
                    {s.label}
                  </span>
                  {index < steps.length - 1 && <span className="h-px w-6 bg-border" />}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={close}
          className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors hover:bg-accent"
          title={t.narrationDirectScript.close}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex-shrink-0 border-b border-destructive/20 bg-destructive/10 px-6 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden p-6 min-h-0">
        {step === 'compose' ? (
          <ComposeStep
            draftText={draftText}
            setDraftText={setDraftText}
            isStreaming={isStreaming}
            chatMessages={chatMessages}
            onSend={sendChatMessage}
            onAbort={abortChat}
          />
        ) : (
          <SplitStep
            splitSentences={splitSentences}
            onUpdate={updateSplitSentences}
            isSplitting={isSplitting}
          />
        )}
      </div>

      {/* Footer */}
      <div className="flex flex-shrink-0 items-center justify-between rounded-b-md border-t border-border bg-muted px-6 py-4">
        <div className="text-xs text-muted-foreground">
          {step === 'compose'
            ? canGoNext
              ? t.narrationDirectScript.composeReadyHint
              : t.narrationDirectScript.emptyDraftHint
            : t.narrationDirectScript.splitFooterHint}
        </div>
        <div className="flex items-center gap-3">
          {step === 'compose' ? (
            <>
              <button
                type="button"
                onClick={close}
                className="rounded-md border border-border bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:bg-accent"
              >
                {t.narrationDirectScript.close}
              </button>
              <button
                type="button"
                onClick={goToSplitStep}
                disabled={!canGoNext}
                className="flex items-center gap-2 rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSplitting && (
                  <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                <span>{t.narrationDirectScript.next}</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={backToCompose}
                className="rounded-md border border-border bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:bg-accent"
              >
                {t.narrationDirectScript.back}
              </button>
              {/* 「替换」为破坏性动作 —— 次级样式且置于「追加」左侧，降低误触覆盖真实解说的概率。 */}
              <button
                type="button"
                onClick={() => complete('replace')}
                disabled={!canComplete}
                className="rounded-md border border-border bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t.narrationDirectScript.replaceButton}
              </button>
              {/* 「追加」为非破坏、高频的默认动作 —— 主按钮样式且置于最右默认位。 */}
              <button
                type="button"
                onClick={() => complete('append')}
                disabled={!canComplete}
                className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t.narrationDirectScript.appendButton}
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default NarrationDirectScriptModal;
