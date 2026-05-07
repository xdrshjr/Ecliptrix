'use client';

import React, { useEffect, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { VideoProjectCategory } from '@/types';

export interface ProjectFormValues {
  name: string;
  description: string;
  category_id: string | null;
}

interface ProjectFormDialogProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  initial?: Partial<ProjectFormValues> | null;
  categories: VideoProjectCategory[];
  onSubmit: (values: ProjectFormValues) => Promise<void> | void;
  onCancel: () => void;
}

const ProjectFormDialog: React.FC<ProjectFormDialogProps> = ({
  isOpen,
  mode,
  initial,
  categories,
  onSubmit,
  onCancel,
}) => {
  const { t } = useLocale();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName(initial?.name ?? '');
      setDescription(initial?.description ?? '');
      setCategoryId(initial?.category_id ?? '');
      setSubmitting(false);
    }
  }, [isOpen, initial]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim(),
        category_id: categoryId || null,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center p-4 bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="bg-card rounded-md shadow-xl border border-border w-full max-w-md"
      >
        <div className="px-6 pt-6 pb-2">
          <h3 className="text-lg font-semibold text-foreground">
            {mode === 'create' ? t.videoProjects.newProject : t.videoProjects.rename}
          </h3>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {t.videoProjects.projectName}
            </label>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.videoProjects.projectNamePlaceholder}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/40"
              maxLength={200}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {t.videoProjects.descriptionLabel}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t.videoProjects.descriptionPlaceholder}
              rows={3}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {t.videoProjects.categories}
            </label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="">{t.videoProjects.uncategorized}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
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
    </div>
  );
};

export default ProjectFormDialog;
