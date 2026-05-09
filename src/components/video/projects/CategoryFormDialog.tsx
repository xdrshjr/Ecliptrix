'use client';

import React, { useEffect, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { Modal } from '@/components/ui/Modal';
import type { VideoProjectCategory } from '@/types';

export interface CategoryFormValues {
  name: string;
  color?: string;
}

interface CategoryFormDialogProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  initial?: Partial<VideoProjectCategory> | null;
  onSubmit: (values: CategoryFormValues) => Promise<void> | void;
  onCancel: () => void;
}

const CategoryFormDialog: React.FC<CategoryFormDialogProps> = ({
  isOpen,
  mode,
  initial,
  onSubmit,
  onCancel,
}) => {
  const { t } = useLocale();
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName(initial?.name ?? '');
      setSubmitting(false);
    }
  }, [isOpen, initial]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit({ name: name.trim() });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onCancel} labelledBy="category-form-title">
      <form
        onSubmit={handleSubmit}
        className="bg-card rounded-md shadow-xl border border-border w-full max-w-sm"
      >
        <div className="px-6 pt-6 pb-2">
          <h3 id="category-form-title" className="text-lg font-semibold text-foreground">
            {mode === 'create' ? t.videoProjects.newCategory : t.videoProjects.rename}
          </h3>
        </div>

        <div className="px-6 py-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {t.videoProjects.categoryName}
            </label>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.videoProjects.categoryNamePlaceholder}
              maxLength={100}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/40"
              required
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-border">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="px-4 py-2 text-sm bg-secondary text-secondary-foreground rounded-md hover:bg-accent transition-colors disabled:opacity-50"
          >
            {t.videoProjects.cancel}
          </button>
          <button
            type="submit"
            disabled={!name.trim() || submitting}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {mode === 'create' ? t.videoProjects.create : t.videoProjects.save}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default CategoryFormDialog;
