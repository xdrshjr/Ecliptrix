import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import type { AgentPlan } from '@/types/agentToolkit';
import PlanCard from '../PlanCard';

let locale = 'en';
vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations[locale], locale }),
}));
afterEach(() => { locale = 'en'; });

const copy = translations.en.agentToolkit;

const plan: AgentPlan = {
  planId: 'plan-0123abcd',
  steps: [
    { index: 0, title: 'Read the script', status: 'completed' },
    { index: 1, title: 'Cut the B-roll', status: 'in_progress' },
    { index: 2, title: 'Render the export', status: 'pending' },
  ],
  activeStep: 1,
  doneCount: 1,
  total: 3,
};

describe('PlanCard', () => {
  it('表头显示完成数与总数', () => {
    render(<PlanCard plan={plan} />);
    expect(screen.getByText(`${copy.planTitle} (1/3)`)).toBeInTheDocument();
  });

  it('completed 步骤带勾选与删除线，且卡片没有任何编辑控件', () => {
    render(<PlanCard plan={plan} />);
    expect(screen.getByText('Read the script')).toHaveClass('line-through');
    expect(screen.getByText('Cut the B-roll')).not.toHaveClass('line-through');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('用 aria-live 播报当前步骤并标记 aria-current', () => {
    const { container } = render(<PlanCard plan={plan} />);
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live?.textContent).toContain('Cut the B-roll');
    expect(container.querySelector('[aria-current="step"]')?.textContent)
      .toContain('Cut the B-roll');
    // in_progress 用脉冲点，不靠颜色单独表达。
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('blocked 步骤显示带文字的琥珀徽标', () => {
    render(<PlanCard plan={{
      ...plan,
      steps: [{ index: 0, title: 'Needs the API key', status: 'blocked' }],
      activeStep: null, doneCount: 0, total: 1,
    }} />);
    expect(screen.getByText('blocked')).toBeInTheDocument();
    expect(screen.getByText('Needs the API key')).toBeInTheDocument();
  });

  it('步骤为空时不渲染任何内容', () => {
    const { container } = render(<PlanCard plan={{
      planId: 'plan-empty', steps: [], activeStep: null, doneCount: 0, total: 0,
    }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
