'use client';

import React from 'react';
import { useMobileDetection } from '@/hooks/useMobileDetection';
import { MobileWarningDialog } from '@/components/ui';

/**
 * Global Mobile Detection Component
 * Handles mobile device detection at application level
 * Shows persistent warning dialog for mobile users
 */
export function GlobalMobileDetection(): React.ReactElement | null {
  const { isMobile, deviceType } = useMobileDetection();

  // Show persistent mobile warning dialog if mobile device is detected
  if (isMobile) {
    return (
      <MobileWarningDialog
        isOpen={true}
        deviceType={deviceType}
      />
    );
  }

  return null;
} 