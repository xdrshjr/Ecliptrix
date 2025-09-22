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
  const [detectionResult, setDetectionResult] = useState<MobileDetectionResult>(() => {
    // Initialize with default values for SSR
    return {
      isMobile: false,
      deviceType: 'desktop',
      deviceInfo: {
        type: 'unknown',
        userAgent: 'server-side',
        screenDimensions: { width: 0, height: 0 },
        viewportDimensions: { width: 0, height: 0 },
        hasTouchScreen: false,
        timestamp: new Date().toISOString()
      }
    };
  });

  useEffect(() => {
    // Perform detection on client side
    const isMobile = shouldRestrictVideoEditing();
    const deviceType = getDeviceType();
    const deviceInfo = getDeviceInfo();

    const result = {
      isMobile,
      deviceType,
      deviceInfo
    };

    setDetectionResult(result);

    // Log detection result
    console.log('[useMobileDetection] Global mobile detection completed:', {
      ...result,
      timestamp: new Date().toISOString(),
      location: 'Global App Level'
    });

  }, []);

  return detectionResult;
} 