'use client';

/**
 * WorkspaceFileCard — 工作区 / 文档 / 分析 / 记忆类工具结果的紧凑卡片。
 *
 * 设计基线：docs/plans/agent-general-toolkit/spec.md §6.2。
 *
 * 三条纪律：
 *   1. 只展示**结构化字段**，永远不直接渲染后端/供应商原文报错；错误码一律经
 *      `resolveAgentToolkitStatus` 映射成本地白名单文案（`role="alert"`）；
 *   2. 结果信封可能是扁平的 `details`，也可能是旧的 `{content, details}` 形态，
 *      两种都要读（与 `WebResearchToolCard` 同一处理）；
 *   3. 工具参数并入结果底座：`workspace_read` 的结果里没有文件名，只有参数有。
 */

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { formatBytes, resolveAgentToolkitStatus } from '@/lib/agentToolkitStatus';
import type { AgentToolCallRecord } from '@/types';

export interface WorkspaceFileCardProps {
  toolCall: AgentToolCallRecord;
}

const MAX_STDOUT_LINES = 20;
const MAX_LISTED = 5;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function listOf(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}

/** 参数 + 结果（含旧形态的 `details`）合成一份可读字典。 */
function detailsOf(toolCall: AgentToolCallRecord): Record<string, unknown> {
  const result = record(toolCall.result);
  const merged = { ...record(toolCall.params), ...result, ...record(result.details) };
  return result.success === false ? { ...merged, success: false } : merged;
}

function firstLines(value: string, max: number): string {
  return value.split(/\r?\n/).slice(0, max).join('\n');
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-muted-foreground">{children}</p>;
}

/** `run_analysis`：状态、耗时、stdout 前 20 行、产物文件。 */
function AnalysisDetail({ details }: { details: Record<string, unknown> }) {
  const { t } = useLocale();
  const status = text(details.status);
  const stdout = text(details.stdout);
  const duration = numberOf(details.duration_ms) ?? numberOf(details.durationMs);
  const files = listOf(details.files);
  const errorCode = text(details.error_code);
  // 失败信封已经在卡片头部用白名单文案解释过，这里不重复同一句话。
  const explained = details.success === false;
  const timedOut = !explained && (status === 'timeout'
    || errorCode === 'analysis_timeout' || errorCode === 'upstream_timeout');
  if (!status && !stdout && files.length === 0) return null;
  return (
    <div className="mt-2 space-y-2">
      {(status || duration !== null) && (
        <p className="text-muted-foreground">
          {status}{duration !== null && <span>{` · ${duration} ms`}</span>}
        </p>
      )}
      {timedOut && <p role="status" className="text-destructive">{t.agentToolkit.timeout}</p>}
      {stdout && (
        <div>
          <Label>{t.agentToolkit.analysisOutput}</Label>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words
            rounded bg-background p-2 font-mono text-[11px]">
            {firstLines(stdout, MAX_STDOUT_LINES)}
          </pre>
        </div>
      )}
      {files.length > 0 && (
        <div>
          <Label>{t.agentToolkit.analysisFiles}</Label>
          <ul className="mt-1 list-inside list-disc">
            {files.slice(0, MAX_LISTED).map((file, index) => {
              const bytes = numberOf(file.bytes);
              return (
                <li key={`${index}-${text(file.name)}`} className="break-words">
                  {text(file.name)}{bytes !== null && <span className="text-muted-foreground">
                    {` · ${formatBytes(bytes)}`}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** `read_document`：名称、页码、续读提示。 */
function DocumentDetail({ details }: { details: Record<string, unknown> }) {
  const page = numberOf(details.page);
  const pages = numberOf(details.pages);
  const nextPage = numberOf(details.next_page);
  const nextOffset = numberOf(details.next_offset);
  const chars = numberOf(details.chars);
  return (
    <div className="mt-2 space-y-1 break-words">
      {text(details.name) && <p className="font-mono">{text(details.name)}</p>}
      <p className="flex flex-wrap items-center gap-2 text-muted-foreground">
        {page !== null && pages !== null && (
          <span className="rounded border border-border px-1.5 py-0.5">{`${page}/${pages}`}</span>
        )}
        {chars !== null && <span>{formatBytes(chars)}</span>}
        {nextPage !== null && <span>{`→ ${nextPage}`}</span>}
        {nextOffset !== null && <span>{`→ ${nextOffset}`}</span>}
      </p>
    </div>
  );
}

/** `workspace_list`：计数、前几个文件名与文档名。 */
function ListingDetail({ details }: { details: Record<string, unknown> }) {
  const { t } = useLocale();
  const files = listOf(details.files);
  const documents = listOf(details.documents);
  const totalFiles = numberOf(details.total_files) ?? files.length;
  const totalBytes = numberOf(details.total_bytes);
  return (
    <div className="mt-2 space-y-2 break-words">
      <p className="text-muted-foreground">
        {t.agentToolkit.used}
        {totalBytes !== null && <span>{` ${formatBytes(totalBytes)}`}</span>}
        <span>{` · ${totalFiles}`}</span>
        {` · ${documents.length}`}
      </p>
      {files.length === 0
        ? <p className="text-muted-foreground">{t.agentToolkit.emptyFiles}</p>
        : <ul className="list-inside list-disc">
          {files.slice(0, MAX_LISTED).map((file, index) => {
            const bytes = numberOf(file.bytes);
            return (
              <li key={`${index}-${text(file.name)}`} className="break-words">
                {text(file.name)}{bytes !== null && <span className="text-muted-foreground">
                  {` · ${formatBytes(bytes)}`}</span>}
              </li>
            );
          })}
        </ul>}
      {documents.length === 0
        ? <p className="text-muted-foreground">{t.agentToolkit.emptyDocuments}</p>
        : <ul className="list-inside list-disc">
          {documents.slice(0, MAX_LISTED).map((document, index) => (
            <li key={`${index}-${text(document.name)}`} className="break-words">
              {text(document.name)}
            </li>
          ))}
        </ul>}
    </div>
  );
}

/** `workspace_read` / `write` / `delete` / `import_material`：名称与体积。 */
function FileDetail({ details }: { details: Record<string, unknown> }) {
  const { t } = useLocale();
  const name = text(details.name);
  const bytes = numberOf(details.bytes) ?? numberOf(details.size);
  const nextOffset = numberOf(details.next_offset);
  const localUrl = text(details.local_url);
  return (
    <div className="mt-2 space-y-1 break-words">
      {name && <p className="font-mono">{name}</p>}
      <p className="flex flex-wrap items-center gap-2 text-muted-foreground">
        {bytes !== null && <span>{formatBytes(bytes)}</span>}
        {nextOffset !== null && <span>{`→ ${nextOffset}`}</span>}
        {localUrl && <span>{t.agentToolkit.importHint}</span>}
      </p>
    </div>
  );
}

/** `memory_*`：条目数或刚保存的文本片段。 */
function MemoryDetail({ details }: { details: Record<string, unknown> }) {
  const { t } = useLocale();
  const entries = listOf(details.entries);
  const total = numberOf(details.total) ?? entries.length;
  const snippet = text(details.text).slice(0, 160);
  if (entries.length > 0) {
    return (
      <div className="mt-2 space-y-1 break-words">
        <p className="text-muted-foreground">{`${total}`}</p>
        <ul className="list-inside list-disc">
          {entries.slice(0, MAX_LISTED).map((entry, index) => (
            <li key={`${index}-${text(entry.id)}`}>{text(entry.text).slice(0, 160)}</li>
          ))}
        </ul>
      </div>
    );
  }
  if (details.deleted === true) {
    return <p className="mt-2 text-muted-foreground">{t.agentToolkit.delete}</p>;
  }
  if (snippet) {
    return (
      <div className="mt-2 space-y-1 break-words">
        <p className="text-muted-foreground">{t.agentToolkit.saved}</p>
        <p>{snippet}</p>
      </div>
    );
  }
  return <p className="mt-2 text-muted-foreground">{t.agentToolkit.emptyMemories}</p>;
}

function detailFor(toolCall: AgentToolCallRecord, details: Record<string, unknown>) {
  if (toolCall.name === 'run_analysis') return <AnalysisDetail details={details} />;
  if (toolCall.name === 'read_document') return <DocumentDetail details={details} />;
  if (toolCall.name === 'workspace_list') return <ListingDetail details={details} />;
  if (toolCall.name.startsWith('memory_')) return <MemoryDetail details={details} />;
  return <FileDetail details={details} />;
}

export default function WorkspaceFileCard({ toolCall }: WorkspaceFileCardProps) {
  const { t } = useLocale();
  const details = detailsOf(toolCall);
  const busy = toolCall.status === 'executing';
  const failure = resolveAgentToolkitStatus({
    error_code: text(details.error_code) || text(details.code),
    failure_class: text(details.failure_class) || text(details.failureClass),
    status: toolCall.status === 'cancelled' ? 'cancelled' : undefined,
    success: details.success === false ? false : undefined,
  });
  const label = t.agentToolkit.tools[toolCall.name] ?? toolCall.name;
  const icon = failure ? (failure.role === 'alert' ? '!' : '·') : busy ? '◌' : '✓';
  return (
    <section className="min-w-0 max-w-full overflow-hidden rounded-md border border-border
      bg-muted/40 p-3 text-xs text-foreground">
      <p className="flex items-center gap-2 font-medium">
        <span aria-hidden="true" className="font-mono">{icon}</span>
        <span className="break-words">{label}</span>
      </p>
      {failure && (
        <p role={failure.role}
          className={failure.role === 'alert' ? 'mt-1 text-destructive' : 'mt-1 text-muted-foreground'}>
          {t.agentToolkit[failure.key]}
        </p>
      )}
      {!failure && busy && (
        <p role="status" className="mt-1 text-muted-foreground">{t.agentToolkit.loading}</p>
      )}
      {detailFor(toolCall, details)}
    </section>
  );
}
