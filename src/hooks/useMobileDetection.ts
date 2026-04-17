'use client';

import { useState, useEffect } from 'react';
import { shouldRestrictVideoEditing, getDeviceType, getDeviceInfo } from '@/lib/utils/deviceDetection';

export interface MobileDetectionResult {
  isMobile: boolean;
  deviceType: 'mobile' | 'tablet' | 'desktop';
  deviceInfo: ReturnType<typeof getDeviceInfo>;
}

/**
 * Global mobile detection hook
 * Detects mobile devices and provides device information
 */
export function useMobileDetection(): MobileDetectionResult {
  const [detectionResult, setDetectionResult] = useState<MobileDetectionResult>(() => ({
    isMobile: false,
    deviceType: 'desktop',
    deviceInfo: {
      type: 'unknown',
      userAgent: 'server-side',
      screenDimensions: { width: 0, height: 0 },
      viewportDimensions: { width: 0, height: 0 },
      hasTouchScreen: false,
    }
  }));

  useEffect(() => {
    const isMobile = shouldRestrictVideoEditing();
    const deviceType = getDeviceType();
    const deviceInfo = getDeviceInfo();

    setDetectionResult({ isMobile, deviceType, deviceInfo });
  }, []);

  return detectionResult;
}
