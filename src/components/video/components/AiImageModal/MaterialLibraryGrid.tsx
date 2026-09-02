'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getUserMaterials, UserMaterial } from '@/lib/api/userMaterials';
import { LOCAL_OWNER_ID } from '@/lib/localOwner';
import { useLocale } from '@/contexts/LocaleContext';

interface MaterialLibraryGridProps {
  onSelect: (material: UserMaterial) => void;
  selectedUrls?: string[];
  disabled?: boolean;
}

const PAGE_SIZE = 20;

type Status = 'idle' | 'loading' | 'success' | 'error';

const MaterialLibraryGrid: React.FC<MaterialLibraryGridProps> = ({
  onSelect,
  selectedUrls = [],
  disabled = false,
}) => {
  const { t } = useLocale();
  const mp = t.materialsPanel;

  const [materials, setMaterials] = useState<UserMaterial[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setStatus('loading');
    setErrorMsg(null);
    const res = await getUserMaterials(LOCAL_OWNER_ID, page, PAGE_SIZE, 'image');
    if (res.success) {
      setMaterials(res.materials);
      setTotal(res.total);
      setTotalPages(res.total_pages);
      setStatus('success');
    } else {
      setErrorMsg(res.message || 'Load failed');
      setStatus('error');
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [page, load]);

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    if (!kw) return materials;
    return materials.filter(m => m.name.toLowerCase().includes(kw));
  }, [materials, search]);

  const selectedSet = useMemo(() => new Set(selectedUrls), [selectedUrls]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={mp.materialLibrarySearchPlaceholder || 'Search materials'}
          className="flex-1 border border-border rounded px-2 py-1 text-[11px] bg-background focus:outline-none focus:ring-1 focus:ring-pink-500"
        />
      </div>

      {status === 'loading' && (
        <p className="text-xs text-muted-foreground text-center py-3">
          {mp.materialLibraryLoading || 'Loading...'}
        </p>
      )}

      {status === 'error' && (
        <div className="flex flex-col items-center gap-1 py-3">
          <p className="text-xs text-destructive">{errorMsg}</p>
          <button
            onClick={load}
            className="text-[10px] text-primary hover:underline"
          >
            {mp.materialLibraryError || 'Load failed - click to retry'}
          </button>
        </div>
      )}

      {status === 'success' && filtered.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-3">
          {mp.materialLibraryEmpty || 'No materials - please upload in Materials panel first'}
        </p>
      )}

      {status === 'success' && filtered.length > 0 && (
        <div className="grid grid-cols-4 gap-1.5">
          {filtered.map(m => {
            const selected = selectedSet.has(m.url);
            return (
              <button
                key={m.id}
                onClick={() => !disabled && !selected && onSelect(m)}
                disabled={disabled || selected}
                className={`relative rounded overflow-hidden border transition-colors ${
                  selected
                    ? 'border-primary opacity-70'
                    : 'border-border hover:border-primary/50'
                } ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                title={m.name}
                aria-label={(mp.materialLibraryReferenceLabel ?? '参考图：{name}').replace('{name}', m.name)}
                aria-pressed={selected}
              >
                <img
                  src={m.thumbnail_url || m.url}
                  alt=""
                  className="w-full aspect-square object-cover"
                />
                {selected && (
                  <span aria-hidden="true" className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[9px] flex items-center justify-center">
                    ✓
                  </span>
                )}
                <span aria-hidden="true" className="absolute bottom-0 inset-x-0 bg-foreground/70 text-background text-[8px] py-0.5 text-center truncate">
                  {m.name}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {status === 'success' && totalPages > 1 && (
        <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-2 py-0.5 border border-border rounded disabled:opacity-40"
          >
            ‹
          </button>
          <span>
            {(mp.materialLibraryPage || 'Page {page}/{total}')
              .replace('{page}', String(page))
              .replace('{total}', String(totalPages))}
            {total > 0 && ` (${total})`}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-2 py-0.5 border border-border rounded disabled:opacity-40"
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
};

export default MaterialLibraryGrid;
