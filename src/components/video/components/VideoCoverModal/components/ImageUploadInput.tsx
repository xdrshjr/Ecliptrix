'use client';

import React, { useRef, useState } from 'react';

import { useLocale } from '@/contexts/LocaleContext';

interface ImageUploadInputProps {
  /** Project id is required so the uploader writes to the per-project slot. */
  projectId: string;
  currentUrl: string | null;
  onUploaded: (url: string) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * File picker + uploader for the "Upload" image source. Calls the existing
 * storage API (``/api/storage/upload``). On success, the resolved URL is
 * passed back via ``onUploaded`` and persisted into ``CoverState``.
 *
 * Note: the back-of-envelope path for cover backgrounds is a per-project
 * well-known slot, NOT a date-bucketed one. We delegate to the generic
 * upload endpoint and trust the backend to place the file under
 * ``STORAGE_ROOT`` — the URL returned is what we persist.
 */
export const ImageUploadInput: React.FC<ImageUploadInputProps> = ({
  projectId: _projectId,
  currentUrl,
  onUploaded,
  onError,
  disabled,
}) => {
  const { t } = useLocale();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  const labels = t.videoCoverModal?.upload ?? {
    hint: 'PNG / JPG up to 10 MB',
    drop: 'Drop an image here',
    browse: 'Browse',
    tooLarge: 'File too large',
    wrongType: 'Unsupported file type',
  };

  const handleSelect = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      onError(labels.wrongType);
      return;
    }
    if (file.size > MAX_BYTES) {
      onError(labels.tooLarge);
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('folder', 'images');
      const resp = await fetch('/api/storage/upload', {
        method: 'POST',
        body: form,
      });
      if (!resp.ok) {
        throw new Error(`Upload failed: HTTP ${resp.status}`);
      }
      const json = (await resp.json()) as {
        success?: boolean;
        data?: { file_url?: string; url?: string };
        file_url?: string;
        url?: string;
      };
      const url =
        json?.data?.file_url ?? json?.data?.url ?? json?.file_url ?? json?.url ?? null;
      if (!url) throw new Error('Upload response missing URL');
      onUploaded(url);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleSelect(f);
        }}
        disabled={disabled || busy}
      />

      <div
        className={[
          'p-3 rounded-md border border-dashed border-border',
          'flex items-center justify-between gap-2 text-xs',
          disabled ? 'opacity-50' : '',
        ].join(' ')}
      >
        <div className="text-muted-foreground">
          {currentUrl ? (
            <span className="block truncate max-w-[200px]" title={currentUrl}>
              ✓ {currentUrl.split('/').pop()}
            </span>
          ) : (
            <>
              <p>{labels.drop}</p>
              <p className="opacity-70">{labels.hint}</p>
            </>
          )}
        </div>
        <button
          type="button"
          className="px-2 py-1 rounded-sm border border-border bg-background hover:border-primary/60 disabled:opacity-50"
          disabled={disabled || busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? '…' : labels.browse}
        </button>
      </div>
    </div>
  );
};

export default ImageUploadInput;
