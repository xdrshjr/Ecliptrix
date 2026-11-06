import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import AiVideoModal from '../AiVideoModal';
import * as api from '@/lib/api/arkVideo';
import { ApiError } from '@/lib/api/http-client';

vi.mock('@/contexts/LocaleContext', () => ({ useLocale: () => ({ t: translations.en, locale: 'en' }) }));
vi.mock('../../AIVideoScriptTab/ImagePickerSlot', () => ({ default: ({ label, imageUrl, onSelect, onRemove }: {
  label: string; imageUrl?: string; onSelect: (url: string, name: string) => void; onRemove: () => void;
}) => <div><span>{label}</span><button onClick={() => onSelect('https://example.com/frame.png', 'frame')}>select {label}</button>
  {imageUrl && <button onClick={onRemove}>remove {label}</button>}</div> }));
const model: api.VideoModelSpec = { id: 'fast', display_name: 'Seedance Fast', profile: 'seedance_2_fast', modes: ['description', 'keyframe', 'reference'], resolutions: ['480p', '720p'], duration_min: 4, duration_max: 12, max_reference_images: 4, supports_last_frame: true, supports_camera_fixed: false };
beforeEach(() => { vi.spyOn(api, 'getVideoModelConfiguration').mockResolvedValue({ configured: true, default_model: 'fast', config_revision: 'revision', models: [model] }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('展示默认模型，提交修订，禁用不支持的分辨率', async () => {
  const confirm = vi.fn();
  render(<AiVideoModal isOpen onClose={vi.fn()} onConfirm={confirm} initialPrompt="纸船" />);
  await screen.findByText(/Seedance Fast/);
  fireEvent.click(screen.getByText(translations.en.scriptPanel.aiVideoScript.advancedOptions));
  expect(screen.getByRole('button', { name: '1080p' })).toBeDisabled();
  expect(screen.queryByText(translations.en.scriptPanel.aiVideoScript.fixedCamera)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: translations.en.scriptPanel.aiVideoScript.startGenerate }));
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ expected_config_revision: 'revision' }));
});

it('配置读取失败时保留草稿并禁止收费提交', async () => {
  vi.mocked(api.getVideoModelConfiguration).mockRejectedValue(new Error('offline'));
  render(<AiVideoModal isOpen onClose={vi.fn()} onConfirm={vi.fn()} initialPrompt="纸船" />);
  await screen.findByRole('alert');
  expect(screen.getByRole('textbox')).toHaveValue('纸船');
  expect(screen.getByRole('button', { name: translations.en.scriptPanel.aiVideoScript.startGenerate })).toBeDisabled();
});

it('配置更新后不偷偷修改不支持的草稿', async () => {
  render(<AiVideoModal isOpen onClose={vi.fn()} onConfirm={vi.fn()} initialPrompt="纸船" initialMode="keyframe" initialImageUrl="https://example.com/a.png" />);
  await screen.findByText(/Seedance Fast/);
  vi.mocked(api.getVideoModelConfiguration).mockResolvedValue({ configured: true, default_model: 'text', config_revision: 'next', models: [{ ...model, id: 'text', display_name: 'Text', modes: ['description'] }] });
  await act(async () => { window.dispatchEvent(new Event('ecliptrix-llm-config-updated')); });
  await waitFor(() => expect(screen.getByRole('button', { name: translations.en.scriptPanel.aiVideoScript.startGenerate })).toBeDisabled());
});

it('配置竞争保留草稿，只刷新目录且不自动重发', async () => {
  const confirm = vi.fn().mockRejectedValue(new ApiError(409, 'video_configuration_changed', 'changed'));
  render(<AiVideoModal isOpen onClose={vi.fn()} onConfirm={confirm} initialPrompt="纸船" />);
  await screen.findByText(/Seedance Fast/);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: translations.en.scriptPanel.aiVideoScript.startGenerate })); });
  expect(screen.getByRole('textbox')).toHaveValue('纸船');
  expect(screen.getByRole('alert')).toHaveTextContent(translations.en.integrations.videoGeneration.configurationChanged);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(api.getVideoModelConfiguration).toHaveBeenCalledTimes(2);
});

it('模型不再支持尾帧时保留可移除的尾帧槽，删除后允许提交', async () => {
  render(<AiVideoModal isOpen onClose={vi.fn()} onConfirm={vi.fn()}
    initialPrompt="纸船" initialImageUrl="https://example.com/start.png" />);
  await screen.findByText(/Seedance Fast/);
  const lastFrameLabel = `${translations.en.scriptPanel.aiVideoScript.lastFrameImage} ${translations.en.scriptPanel.aiVideoScript.lastFrameOptional}`;
  fireEvent.click(screen.getByRole('button', { name: `select ${lastFrameLabel}` }));
  vi.mocked(api.getVideoModelConfiguration).mockResolvedValue({ configured: true, default_model: 'first', config_revision: 'next',
    models: [{ ...model, id: 'first', display_name: 'First frame', supports_last_frame: false }] });
  await act(async () => { window.dispatchEvent(new Event('ecliptrix-llm-config-updated')); });
  expect(screen.getByRole('button', { name: translations.en.scriptPanel.aiVideoScript.startGenerate })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: `remove ${lastFrameLabel}` }));
  expect(screen.getByRole('button', { name: translations.en.scriptPanel.aiVideoScript.startGenerate })).toBeEnabled();
});
