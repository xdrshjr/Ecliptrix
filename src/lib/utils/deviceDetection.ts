/**
 * Device Detection Utilities
 * Provides functions to detect mobile devices and screen sizes
 */

/**
 * Detects if the current device is a mobile device
 * Uses multiple detection methods for better accuracy
 */
export const isMobileDevice = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }

  const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera;
  const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i;
  const isMobileUserAgent = mobileRegex.test(userAgent);

  const screenWidth = window.screen.width;
  const screenHeight = window.screen.height;
  const isMobileScreen = screenWidth <= 768 || screenHeight <= 768;

  const viewportWidth = window.innerWidth;
  const isMobileViewport = viewportWidth <= 768;

  const hasTouchScreen = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  return isMobileUserAgent || (isMobileScreen && hasTouchScreen) || isMobileViewport;
};

/**
 * Detects if the current device is a tablet
 * Tablets are considered mobile for video editing restrictions
 */
export const isTabletDevice = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }

  const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera;
  const tabletRegex = /iPad|Android(?!.*Mobile)|Tablet|PlayBook|Silk/i;
  const isTabletUserAgent = tabletRegex.test(userAgent);

  const screenWidth = window.screen.width;
  const screenHeight = window.screen.height;
  const minDimension = Math.min(screenWidth, screenHeight);
  const maxDimension = Math.max(screenWidth, screenHeight);

  const isTabletScreen = (minDimension >= 768 && maxDimension >= 1024) &&
                         (minDimension <= 1024 && maxDimension <= 1366);

  const hasTouchScreen = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  return isTabletUserAgent || (isTabletScreen && hasTouchScreen);
};

/**
 * Comprehensive mobile/tablet detection for video editing restrictions
 * Returns true if the device should be restricted from video editing
 */
export const shouldRestrictVideoEditing = (): boolean => {
  return isMobileDevice() || isTabletDevice();
};

/**
 * Gets device type as a string for logging and analytics
 */
export const getDeviceType = (): 'mobile' | 'tablet' | 'desktop' => {
  if (isMobileDevice()) return 'mobile';
  if (isTabletDevice()) return 'tablet';
  return 'desktop';
};

/**
 * Gets detailed device information for logging
 */
export const getDeviceInfo = () => {
  if (typeof window === 'undefined') {
    return {
      type: 'unknown' as const,
      userAgent: 'server-side',
      screenDimensions: { width: 0, height: 0 },
      viewportDimensions: { width: 0, height: 0 },
      hasTouchScreen: false,
    };
  }

  return {
    type: getDeviceType(),
    userAgent: navigator.userAgent,
    screenDimensions: {
      width: window.screen.width,
      height: window.screen.height
    },
    viewportDimensions: {
      width: window.innerWidth,
      height: window.innerHeight
    },
    hasTouchScreen: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
  };
};
