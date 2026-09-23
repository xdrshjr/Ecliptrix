import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compileComponent, compileComponentModule, localeContextModule, reactModules,
} from '@/components/video/timeline/__tests__/test-utils/compileComponent';
import { getTranslations } from '@/lib/i18n';
import * as formatImpact from '../../../lib/segments/formatSegmentImpact';
// @ts-expect-error Vitest raw source loader for JSX-preserving projects.
import iconsSource from '../icons.tsx?raw';
// @ts-expect-error Vitest raw source loader for JSX-preserving projects.
import bannerSource from '../VoiceCandidateBanner.tsx?raw';
// @ts-expect-error Vitest raw source loader for JSX-preserving projects.
import errorSource from '../SegmentErrorRow.tsx?raw';
import type { VoiceCandidateBannerProps } from '../VoiceCandidateBanner';
import type { SegmentErrorRowProps } from '../SegmentErrorRow';

const copy = getTranslations('zh-CN').workbench.segmentCommands;
const base = { ...reactModules(), ...localeContextModule(() => 'zh-CN') };
const withIcons = { ...base, './icons': compileComponentModule(iconsSource, base) };
const Banner = compileComponent<VoiceCandidateBannerProps>(bannerSource, {
  ...withIcons, '../../lib/segments/formatSegmentImpact': formatImpact,
});
const ErrorRow = compileComponent<SegmentErrorRowProps>(errorSource, withIcons);

afterEach(cleanup);

function renderBanner(patch: Partial<VoiceCandidateBannerProps> = {}) {
  const props: VoiceCandidateBannerProps = {
    candidate: { materialId: 'v', duration: 10, deltaFromTimeline: 2, isStale: false },
    timelineSeconds: 8,
    isAuditioning: false,
    isVoiceBusy: false,
    onAudition: vi.fn(), onApply: vi.fn(), onDismiss: vi.fn(), onRegenerate: vi.fn(),
    ...patch,
  };
  render(React.createElement(Banner, props));
  return props;
}

const buttonNames = () => screen.getAllByRole('button').map((button) => button.textContent);

describe('VoiceCandidateBanner (T-UI-BANNER)', () => {
  it('shows old → new length and listen / apply / not now', () => {
    const props = renderBanner();
    fireEvent.click(screen.getByRole('button', { name: copy.applyToTimeline }));
    expect({
      text: screen.getByRole('status').textContent?.startsWith('新配音已生成 · 8.0s → 10.0s（+2.0s）'),
      buttons: buttonNames(),
      applied: (props.onApply as ReturnType<typeof vi.fn>).mock.calls.length,
    }).toEqual({ text: true, buttons: [copy.audition, copy.applyToTimeline, copy.notNow], applied: 1 });
  });

  it('a segment not on the timeline offers "place on timeline"', () => {
    renderBanner({ timelineSeconds: null });
    expect(buttonNames()).toEqual([copy.audition, copy.placeOnTimeline, copy.notNow]);
  });

  it('a stale candidate can only be auditioned or regenerated — never applied', () => {
    renderBanner({ candidate: { materialId: 'v', duration: 10, deltaFromTimeline: 2, isStale: true } });
    expect({ text: screen.getByRole('status').textContent?.includes(copy.candidateStale), buttons: buttonNames() })
      .toEqual({ text: true, buttons: [copy.auditionAnyway, copy.regenerate] });
  });
});

describe('SegmentErrorRow', () => {
  it('keeps the reason on the card and retries only this segment', () => {
    const onRetry = vi.fn();
    render(React.createElement(ErrorRow, { reason: '网络错误', isVoiceBusy: false, onRetry }));
    fireEvent.click(screen.getByRole('button', { name: copy.retrySegment }));
    expect({ text: screen.getByRole('alert').textContent?.includes('配音生成失败：网络错误'), retried: onRetry.mock.calls.length })
      .toEqual({ text: true, retried: 1 });
  });
});
