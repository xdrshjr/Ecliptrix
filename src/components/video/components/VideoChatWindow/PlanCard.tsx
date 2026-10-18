'use client';

/**
 * PlanCard — 只读执行计划卡片（`update_plan` 的工具结果）。
 *
 * 设计基线：docs/plans/agent-general-toolkit/spec.md §6.2。
 *
 * 三条纪律：
 *   1. **只读**：卡片里没有编辑控件。工具记录是唯一真相，允许在卡片里改状态
 *      会立刻产生第二份计划；
 *   2. 状态永远「图标 + 非颜色差异」：`completed` 勾选 + 删除线、
 *      `in_progress` 脉冲点、`blocked` 琥珀徽标（带文字），不靠颜色单独表达；
 *   3. 容器 `aria-live="polite"`：活跃步骤变化时读屏会播报，无需用户主动聚焦。
 */

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { AgentPlan, PlanStep, PlanStepStatus } from '@/types/agentToolkit';

export interface PlanCardProps {
  plan: AgentPlan;
}

/** 非颜色标记：勾选 / 脉冲点 / 琥珀文字徽标 / 空心圈。 */
function StepMarker({ status }: { status: PlanStepStatus }) {
  const { t } = useLocale();
  if (status === 'completed') {
    return (
      <span aria-hidden="true"
        className="mt-0.5 w-3 shrink-0 font-mono text-green-600 dark:text-green-400">
        ✓
      </span>
    );
  }
  if (status === 'in_progress') {
    return (
      <span aria-hidden="true"
        className="mt-1 h-2 w-2 shrink-0 animate-pulse rounded-full bg-primary" />
    );
  }
  if (status === 'blocked') {
    return (
      <span className="shrink-0 rounded bg-amber-100 px-1.5 text-[10px] font-medium
        text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
        {t.agentToolkit.planStepBlocked}
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="mt-0.5 w-3 shrink-0 text-muted-foreground">○</span>
  );
}

export default function PlanCard({ plan }: PlanCardProps) {
  const { t } = useLocale();
  const steps: readonly PlanStep[] = plan.steps;
  // 空计划不渲染：`ToolkitToolCard` 会给出「暂无计划」的中性状态。
  if (steps.length === 0) return null;
  const doneCount = steps.filter(step => step.status === 'completed').length;
  const header = `${t.agentToolkit.planTitle} (${doneCount}/${steps.length})`;
  return (
    <section aria-live="polite"
      className="min-w-0 max-w-full overflow-hidden rounded-md border border-border
        bg-muted/40 p-3 text-xs text-foreground">
      <p className="font-medium">{header}</p>
      {plan.note && (
        <p className="mt-1 break-words text-muted-foreground">{plan.note}</p>
      )}
      <ol className="mt-2 max-h-64 space-y-1 overflow-y-auto">
        {steps.map((step, index) => (
          <li key={`${index}-${step.title}`}
            aria-current={step.status === 'in_progress' ? 'step' : undefined}
            className="flex items-start gap-2">
            <StepMarker status={step.status} />
            <span className={`min-w-0 break-words ${step.status === 'completed'
              ? 'text-muted-foreground line-through' : ''}`}>
              {step.title}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
