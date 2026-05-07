'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { MaterialItem, StoryboardPack } from '@/types';
import { useStoryboardChat } from '../../hooks/useStoryboardChat';
import { useBatchShotGenerate, ShotGenInput } from '../../hooks/useBatchShotGenerate';
import {
  createPackFromShots,
  CreatePackFromShotsShot,
} from '@/lib/api/storyboard';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (pack: StoryboardPack) => void;
  imageMaterials?: MaterialItem[];
  /** Owning project id — required by the backend to bind the new pack. */
  projectId?: string;
}

function isHttpUrl(url: string | undefined): boolean {
  if (!url) return false;
  return /^https?:\/\//i.test(url);
}

function pickMaterialRefUrl(m: MaterialItem): string | null {
  if (m.serverUrl && isHttpUrl(m.serverUrl)) return m.serverUrl;
  if (isHttpUrl(m.url)) return m.url;
  return null;
}

type StepId = 1 | 2;

interface EditableShot {
  shotId: string;
  script: string;
  visualPrompt: string;
  referenceImageUrl?: string;
}

function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `shot-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const CreateStoryboardPackModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onCreated,
  imageMaterials = [],
  projectId,
}) => {
  const { locale } = useLocale();
  const isZh = locale === 'zh-CN';
  const localeKey = isZh ? 'zh' : 'en';

  const [step, setStep] = useState<StepId>(1);
  const [title, setTitle] = useState('');
  const [shots, setShots] = useState<EditableShot[]>([]);
  const [userInput, setUserInput] = useState('');
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const chat = useStoryboardChat({ locale: localeKey });
  const batch = useBatchShotGenerate({ concurrency: 2, aspectRatio: '16:9' });

  // Reset state when the modal opens
  useEffect(() => {
    if (!isOpen) return;
    setStep(1);
    setTitle('');
    setShots([]);
    setUserInput('');
    setSaveError(null);
    setConfirmCloseOpen(false);
    chat.resetChat();
    batch.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Esc closes the modal
  useEffect(() => {
    if (!isOpen) return;
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'Escape') tryClose();
    };
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, shots, step]);

  const t = useMemo(
    () => ({
      title: isZh ? 'AI 创建分镜包' : 'AI Storyboard Pack',
      step1: isZh ? '第一步：剧本创作' : 'Step 1: Script',
      step2: isZh ? '第二步：参考图与生成' : 'Step 2: Generate',
      packTitle: isZh ? '分镜包标题' : 'Pack title',
      packTitlePh: isZh ? '可选，例如：开场片段' : 'Optional, e.g. Opening sequence',
      shotsHeader: isZh ? '分镜段落' : 'Shots',
      noShots: isZh
        ? '尚未生成分镜，向 AI 描述你的需求开始创建。'
        : 'No shots yet — describe your idea on the right to start.',
      addShot: isZh ? '+ 添加分镜' : '+ Add shot',
      removeShot: isZh ? '删除' : 'Remove',
      sendBtn: isZh ? '发送' : 'Send',
      sendingBtn: isZh ? '生成中...' : 'Streaming...',
      cancelGen: isZh ? '取消' : 'Cancel',
      placeholderInput: isZh
        ? '描述你想要的分镜内容，AI 会输出 JSON 分镜剧本'
        : 'Describe your scene; AI will output JSON shots',
      next: isZh ? '下一步' : 'Next',
      prev: isZh ? '上一步' : 'Back',
      save: isZh ? '确认保存' : 'Confirm & Save',
      saving: isZh ? '保存中...' : 'Saving...',
      cancel: isZh ? '取消' : 'Cancel',
      close: isZh ? '关闭' : 'Close',
      confirmCloseTitle: isZh ? '放弃当前草稿？' : 'Discard draft?',
      confirmCloseDesc: isZh
        ? '关闭后未保存的剧本和已生成的图片会丢失。'
        : 'Closing now will discard the script and generated images.',
      keep: isZh ? '继续编辑' : 'Keep editing',
      discard: isZh ? '放弃并关闭' : 'Discard & close',
      shotScript: isZh ? '剧本' : 'Script',
      shotPrompt: isZh ? '画面提示' : 'Visual prompt',
      shotRef: isZh ? '参考图' : 'Reference',
      shotRefPick: isZh ? '选择素材' : 'Pick material',
      shotRefClear: isZh ? '清除' : 'Clear',
      noImageMaterials: isZh
        ? '素材面板没有图片素材，请先上传或生成'
        : 'No image materials — upload or generate one first.',
      materialUploading: isZh ? '上传中，暂不可选' : 'Uploading — not selectable yet',
      thinking: isZh ? '思考中…' : 'Thinking…',
      thinkingLabel: isZh ? '思考过程' : 'Reasoning',
      generatingShots: isZh ? '正在生成分镜…' : 'Generating shots…',
      hideThinking: isZh ? '收起' : 'Hide',
      showThinking: isZh ? '展开' : 'Show',
      pickerTitle: isZh ? '选择参考图素材' : 'Pick reference image',
      pasteUrl: isZh ? '粘贴图片URL' : 'Paste image URL',
      generate: isZh ? '生成' : 'Generate',
      generating: isZh ? '生成中' : 'Generating',
      regen: isZh ? '重试' : 'Retry',
      genAll: isZh ? '批量生成（剩余）' : 'Generate all (remaining)',
      cancelAll: isZh ? '全部取消' : 'Cancel all',
      noScript: isZh ? '请先在第一步生成剧本' : 'Generate the script in step 1 first',
      progress: (done: number, total: number) =>
        isZh ? `已完成 ${done}/${total}` : `Completed ${done}/${total}`,
      saveFailed: isZh ? '保存失败' : 'Save failed',
      shotEmpty: isZh ? '请先生成此分镜的图片再保存' : 'Generate this shot before saving',
      hint: isZh
        ? '提示：每个分镜会绑定一段剧本，加载分镜包时会自动回填到 AI 分镜面板。'
        : 'Tip: each shot binds one script paragraph and auto-fills into the AI Storyboard panel.',
    }),
    [isZh],
  );

  const hasDraft = shots.length > 0 || chat.messages.length > 1;

  const tryClose = useCallback(() => {
    if (saving) return;
    if (hasDraft) {
      setConfirmCloseOpen(true);
      return;
    }
    forceClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasDraft, saving]);

  const forceClose = useCallback(() => {
    chat.abort();
    batch.cancelAll();
    onClose();
  }, [chat, batch, onClose]);

  const handleSend = useCallback(async () => {
    if (!userInput.trim() || chat.isStreaming) return;
    const input = userInput;
    setUserInput('');
    const result = await chat.sendMessage(input);
    if (result && result.shots.length > 0) {
      // Replace shots with parsed result, preserving any existing ref images by index
      setShots((prev) =>
        result.shots.map((s, i) => ({
          shotId: s.shotId,
          script: s.script,
          visualPrompt: s.visualPrompt,
          referenceImageUrl: prev[i]?.referenceImageUrl,
        })),
      );
    }
  }, [userInput, chat]);

  const updateShot = useCallback((shotId: string, patch: Partial<EditableShot>) => {
    setShots((prev) => prev.map((s) => (s.shotId === shotId ? { ...s, ...patch } : s)));
  }, []);

  const removeShot = useCallback((shotId: string) => {
    setShots((prev) => prev.filter((s) => s.shotId !== shotId));
  }, []);

  const addShot = useCallback(() => {
    setShots((prev) => [
      ...prev,
      { shotId: genId(), script: '', visualPrompt: '' },
    ]);
  }, []);

  const [pickerShotId, setPickerShotId] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!pickerShotId) return;
    const fn = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerShotId(null);
      }
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [pickerShotId]);

  const handlePickMaterial = useCallback(
    (shotId: string, m: MaterialItem) => {
      const refUrl = pickMaterialRefUrl(m);
      if (!refUrl) return;
      updateShot(shotId, { referenceImageUrl: refUrl });
      setPickerShotId(null);
    },
    [updateShot],
  );

  const handleGenerateOne = useCallback(
    async (shot: EditableShot) => {
      const input: ShotGenInput = {
        shotId: shot.shotId,
        visualPrompt: shot.visualPrompt || shot.script,
        referenceImageUrl: shot.referenceImageUrl,
      };
      await batch.runBatch([input]);
    },
    [batch],
  );

  const handleBatchGenerate = useCallback(async () => {
    const inputs: ShotGenInput[] = shots
      .filter((s) => batch.states[s.shotId]?.status !== 'succeeded')
      .map((s) => ({
        shotId: s.shotId,
        visualPrompt: s.visualPrompt || s.script,
        referenceImageUrl: s.referenceImageUrl,
      }));
    await batch.runBatch(inputs);
  }, [shots, batch]);

  const completedCount = shots.filter(
    (s) => batch.states[s.shotId]?.status === 'succeeded',
  ).length;
  const allDone = shots.length > 0 && completedCount === shots.length;

  const handleSave = useCallback(async () => {
    setSaveError(null);
    if (shots.length === 0) {
      setSaveError(t.noScript);
      return;
    }
    const incomplete = shots.find(
      (s) => batch.states[s.shotId]?.status !== 'succeeded',
    );
    if (incomplete) {
      setSaveError(t.shotEmpty);
      return;
    }
    if (!projectId) {
      setSaveError(isZh ? '缺少项目上下文，无法创建分镜包' : 'Missing project context — cannot create pack');
      return;
    }
    setSaving(true);
    try {
      const apiShots: CreatePackFromShotsShot[] = shots.map((s) => ({
        shotId: s.shotId,
        script: s.script,
        visualPrompt: s.visualPrompt,
        referenceImageUrl: s.referenceImageUrl,
        generatedImageUrl: batch.states[s.shotId]!.imageUrl!,
      }));
      const pack = await createPackFromShots({
        projectId,
        title: title || undefined,
        aspectRatio: '16:9',
        shots: apiShots,
        scriptHistory: chat.messages
          .filter((m) => m.role !== 'system')
          .map((m) => ({ role: m.role, content: m.content })),
      });
      onCreated(pack);
      forceClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [shots, batch, title, chat, onCreated, forceClose, projectId, isZh, t.noScript, t.shotEmpty]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-modal bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) tryClose();
      }}
    >
      <div className="bg-card text-foreground border border-border rounded-lg shadow-xl w-full max-w-6xl w-[min(1200px,95vw)] h-[min(820px,90vh)] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">{t.title}</h2>
            <div className="flex items-center text-xs text-muted-foreground">
              <span className={step === 1 ? 'text-foreground font-medium' : ''}>{t.step1}</span>
              <span className="mx-2">→</span>
              <span className={step === 2 ? 'text-foreground font-medium' : ''}>{t.step2}</span>
            </div>
          </div>
          <button
            onClick={tryClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label={t.close}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {step === 1 ? (
            <div className="flex-1 grid grid-cols-2 gap-4 p-4 overflow-hidden">
              {/* Left: shots */}
              <div className="flex flex-col min-h-0 border border-border rounded-md">
                <div className="flex items-center justify-between p-3 border-b border-border">
                  <h3 className="text-sm font-medium">{t.shotsHeader}</h3>
                  <button
                    onClick={addShot}
                    className="text-xs px-2 py-1 rounded border border-border hover:bg-accent"
                  >
                    {t.addShot}
                  </button>
                </div>
                <div className="flex-1 overflow-auto p-3 space-y-2">
                  {shots.length === 0 && (
                    <p className="text-xs text-muted-foreground">{t.noShots}</p>
                  )}
                  {shots.map((s, idx) => (
                    <div
                      key={s.shotId}
                      className="border border-border rounded p-2 space-y-1"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium">#{idx + 1}</span>
                        <button
                          onClick={() => removeShot(s.shotId)}
                          className="text-destructive hover:underline"
                        >
                          {t.removeShot}
                        </button>
                      </div>
                      <textarea
                        value={s.script}
                        onChange={(e) => updateShot(s.shotId, { script: e.target.value })}
                        className="w-full text-sm p-2 bg-background border border-border rounded resize-y min-h-[60px]"
                        placeholder={t.shotScript}
                      />
                      <input
                        value={s.visualPrompt}
                        onChange={(e) => updateShot(s.shotId, { visualPrompt: e.target.value })}
                        className="w-full text-xs p-2 bg-background border border-border rounded"
                        placeholder={t.shotPrompt}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Right: chat */}
              <div className="flex flex-col min-h-0 border border-border rounded-md">
                <div className="flex-1 overflow-auto p-3 space-y-2 min-h-0">
                  {chat.messages
                    .filter((m) => m.role !== 'system')
                    .map((m) => {
                      if (m.role === 'user') {
                        return (
                          <div key={m.id} className="text-sm rounded p-2 bg-primary/10 ml-6">
                            <div className="text-[10px] opacity-60 mb-1">user</div>
                            <div className="whitespace-pre-wrap break-words text-xs">{m.content}</div>
                          </div>
                        );
                      }
                      const isStreaming = !!m.isStreaming;
                      const reasoning = m.reasoningContent || '';
                      // Body: hide raw JSON stream; prefer summaryText after stream ends.
                      let body: string;
                      if (m.summaryText) {
                        body = m.summaryText;
                      } else if (isStreaming) {
                        body = reasoning ? '' : t.generatingShots;
                      } else {
                        body = m.content || '';
                      }
                      return (
                        <div key={m.id} className="text-sm rounded p-2 bg-muted mr-6">
                          <div className="text-[10px] opacity-60 mb-1">
                            assistant{isStreaming ? ' · …' : ''}
                          </div>
                          {(reasoning || isStreaming) && (
                            <details open className="mb-2 rounded border border-border/60 bg-background/50">
                              <summary className="cursor-pointer select-none px-2 py-1 text-[11px] text-muted-foreground">
                                {isStreaming && !reasoning ? t.thinking : t.thinkingLabel}
                              </summary>
                              <div className="px-2 py-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
                                {reasoning || (isStreaming ? t.thinking : '')}
                              </div>
                            </details>
                          )}
                          {body && (
                            <div className="whitespace-pre-wrap break-words text-xs">{body}</div>
                          )}
                          {!isStreaming && m.parseError && (
                            <p className="mt-1 text-[10px] text-destructive break-all">
                              {isZh ? '解析失败：' : 'Parse failed: '}
                              {m.parseError}
                            </p>
                          )}
                        </div>
                      );
                    })}
                </div>
                <div className="border-t border-border p-2 flex gap-2">
                  <textarea
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder={t.placeholderInput}
                    rows={2}
                    className="flex-1 text-sm p-2 bg-background border border-border rounded resize-none"
                  />
                  {chat.isStreaming ? (
                    <button
                      onClick={chat.abort}
                      className="px-3 py-1 text-xs rounded bg-destructive text-destructive-foreground"
                    >
                      {t.cancelGen}
                    </button>
                  ) : (
                    <button
                      onClick={handleSend}
                      disabled={!userInput.trim()}
                      className="px-3 py-1 text-xs rounded bg-primary text-primary-foreground disabled:opacity-50"
                    >
                      {t.sendBtn}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col p-4 gap-3 overflow-hidden min-h-0">
              <div className="flex items-center justify-between gap-3">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t.packTitlePh}
                  className="flex-1 text-sm p-2 bg-background border border-border rounded"
                />
                <div className="text-xs text-muted-foreground">
                  {t.progress(completedCount, shots.length)}
                </div>
                <button
                  onClick={handleBatchGenerate}
                  disabled={batch.isRunning || shots.length === 0}
                  className="px-3 py-1 text-xs rounded bg-primary text-primary-foreground disabled:opacity-50"
                >
                  {batch.isRunning ? t.generating : t.genAll}
                </button>
                {batch.isRunning && (
                  <button
                    onClick={batch.cancelAll}
                    className="px-3 py-1 text-xs rounded bg-destructive text-destructive-foreground"
                  >
                    {t.cancelAll}
                  </button>
                )}
              </div>
              <div className="flex-1 overflow-auto space-y-2">
                {shots.map((s, idx) => {
                  const st = batch.states[s.shotId];
                  return (
                    <div
                      key={s.shotId}
                      className="grid grid-cols-[80px_1fr_120px_120px_100px] gap-3 items-start border border-border rounded p-2"
                    >
                      <div className="text-xs">
                        <div className="font-medium">#{idx + 1}</div>
                        <div className="opacity-60 mt-1">{st?.status || 'idle'}</div>
                      </div>
                      <div className="space-y-1">
                        <textarea
                          value={s.script}
                          onChange={(e) => updateShot(s.shotId, { script: e.target.value })}
                          className="w-full text-xs p-1 bg-background border border-border rounded resize-y min-h-[44px]"
                          placeholder={t.shotScript}
                        />
                        <input
                          value={s.visualPrompt}
                          onChange={(e) => updateShot(s.shotId, { visualPrompt: e.target.value })}
                          className="w-full text-xs p-1 bg-background border border-border rounded"
                          placeholder={t.shotPrompt}
                        />
                        {st?.error && (
                          <p className="text-[10px] text-destructive break-all">{st.error}</p>
                        )}
                      </div>
                      <div className="relative flex flex-col items-stretch gap-1">
                        <label className="text-[10px] text-muted-foreground">{t.shotRef}</label>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              setPickerShotId((cur) => (cur === s.shotId ? null : s.shotId))
                            }
                            className="flex-1 text-[10px] px-2 py-1 rounded border border-border hover:bg-accent"
                          >
                            {t.shotRefPick}
                          </button>
                          {s.referenceImageUrl && (
                            <button
                              type="button"
                              onClick={() =>
                                updateShot(s.shotId, { referenceImageUrl: undefined })
                              }
                              className="text-[10px] px-2 py-1 rounded border border-border hover:bg-accent"
                            >
                              {t.shotRefClear}
                            </button>
                          )}
                        </div>
                        {s.referenceImageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={s.referenceImageUrl}
                            alt="ref"
                            className="w-full h-12 object-cover rounded border border-border"
                          />
                        )}
                        {pickerShotId === s.shotId && (
                          <div
                            ref={pickerRef}
                            className="absolute left-0 top-full z-30 mt-1 w-64 max-h-64 overflow-auto bg-popover text-popover-foreground border border-border rounded-md shadow-lg p-2"
                          >
                            <div className="text-[11px] font-medium mb-1">{t.pickerTitle}</div>
                            {imageMaterials.length === 0 ? (
                              <p className="text-[10px] text-muted-foreground py-4 text-center">
                                {t.noImageMaterials}
                              </p>
                            ) : (
                              <div className="grid grid-cols-3 gap-1">
                                {imageMaterials.map((m) => {
                                  const refUrl = pickMaterialRefUrl(m);
                                  const selectable = !!refUrl;
                                  return (
                                    <button
                                      type="button"
                                      key={m.id}
                                      onClick={() => selectable && handlePickMaterial(s.shotId, m)}
                                      disabled={!selectable}
                                      title={selectable ? m.name : t.materialUploading}
                                      className={`group relative border rounded overflow-hidden text-left ${
                                        selectable
                                          ? 'border-border hover:border-primary cursor-pointer'
                                          : 'border-border/40 opacity-50 cursor-not-allowed'
                                      }`}
                                    >
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img
                                        src={m.thumbnailUrl || m.url}
                                        alt={m.name}
                                        className="w-full h-14 object-cover"
                                      />
                                      <div className="px-1 py-0.5 text-[9px] truncate">{m.name}</div>
                                      {!selectable && (
                                        <div className="absolute inset-0 flex items-center justify-center text-[9px] text-destructive bg-background/60 px-1 text-center">
                                          {t.materialUploading}
                                        </div>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <div>
                        {st?.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={st.imageUrl}
                            alt="generated"
                            className="w-full h-20 object-cover rounded border border-border"
                          />
                        ) : (
                          <div className="w-full h-20 rounded border border-dashed border-border flex items-center justify-center text-[10px] text-muted-foreground">
                            {st?.status === 'generating'
                              ? t.generating
                              : st?.status === 'failed'
                                ? '✗'
                                : '—'}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-1">
                        <button
                          onClick={() => handleGenerateOne(s)}
                          disabled={st?.status === 'generating'}
                          className="text-[10px] px-2 py-1 rounded border border-border hover:bg-accent disabled:opacity-50"
                        >
                          {st?.status === 'succeeded' ? t.regen : t.generate}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground">{t.hint}</p>
              {saveError && (
                <p className="text-xs text-destructive">
                  {t.saveFailed}: {saveError}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-3 border-t border-border">
          <button
            onClick={tryClose}
            className="text-xs px-3 py-1 rounded border border-border hover:bg-accent"
          >
            {t.cancel}
          </button>
          <div className="flex items-center gap-2">
            {step === 2 && (
              <button
                onClick={() => setStep(1)}
                className="text-xs px-3 py-1 rounded border border-border hover:bg-accent"
              >
                {t.prev}
              </button>
            )}
            {step === 1 && (
              <button
                onClick={() => setStep(2)}
                disabled={shots.length === 0}
                className="text-xs px-3 py-1 rounded bg-primary text-primary-foreground disabled:opacity-50"
              >
                {t.next}
              </button>
            )}
            {step === 2 && (
              <button
                onClick={handleSave}
                disabled={!allDone || saving}
                className="text-xs px-3 py-1 rounded bg-primary text-primary-foreground disabled:opacity-50"
              >
                {saving ? t.saving : t.save}
              </button>
            )}
          </div>
        </div>
      </div>

      {confirmCloseOpen && (
        <div
          className="fixed inset-0 z-[210] bg-black/40 flex items-center justify-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirmCloseOpen(false);
          }}
        >
          <div className="bg-card border border-border rounded-md p-4 max-w-sm w-full">
            <h3 className="text-sm font-medium mb-2">{t.confirmCloseTitle}</h3>
            <p className="text-xs text-muted-foreground mb-4">{t.confirmCloseDesc}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmCloseOpen(false)}
                className="text-xs px-3 py-1 rounded border border-border hover:bg-accent"
              >
                {t.keep}
              </button>
              <button
                onClick={forceClose}
                className="text-xs px-3 py-1 rounded bg-destructive text-destructive-foreground"
              >
                {t.discard}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CreateStoryboardPackModal;
