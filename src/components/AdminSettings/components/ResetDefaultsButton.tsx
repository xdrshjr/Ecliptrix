'use client';

import React, { useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import ConfirmationDialog from '@/components/ui/ConfirmationDialog';

interface ResetDefaultsButtonProps {
  onReset: () => void;
  loading?: boolean;
}

const ResetDefaultsButton: React.FC<ResetDefaultsButtonProps> = ({
  onReset,
  loading = false,
}) => {
  const { t } = useLocale();
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <>
      <button
        onClick={() => setShowConfirm(true)}
        disabled={loading}
        className="px-4 py-2 text-sm font-medium rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? t.adminSettings.settingsResetting : t.adminSettings.settingsRestoreDefaults}
      </button>

      <ConfirmationDialog
        isOpen={showConfirm}
        title={t.adminSettings.settingsResetConfirmTitle}
        message={t.adminSettings.settingsResetConfirmMessage}
        confirmText={t.adminSettings.settingsRestoreDefaults}
        cancelText={t.adminSettings.cancel}
        type="warning"
        onConfirm={() => {
          setShowConfirm(false);
          onReset();
        }}
        onCancel={() => setShowConfirm(false)}
      />
    </>
  );
};

export default ResetDefaultsButton;
