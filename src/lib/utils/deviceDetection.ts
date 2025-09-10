/**
 * Device Detection Utilities
 * Provides functions to detect mobile devices and screen sizes
 */

/**
 * Detects if the current device is a mobile device
 * Uses multiple detection methods for better accuracy
 */
export const isMobileDevice = (): boolean => {
  // Server-side rendering check
  if (typeof window === 'undefined') {
    return false;
  }

  // Check user agent for mobile indicators
  const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera;
  const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i;
  const isMobileUserAgent = mobileRegex.test(userAgent);

  // Check screen size (mobile-like dimensions)
  const screenWidth = window.screen.width;
  const screenHeight = window.screen.height;
  const isMobileScreen = screenWidth <= 768 || screenHeight <= 768;

  // Check viewport size
  const viewportWidth = window.innerWidth;
  const isMobileViewport = viewportWidth <= 768;

  // Check for touch capability (additional indicator)
  const hasTouchScreen = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  // Combine multiple detection methods
  const isMobile = isMobileUserAgent || (isMobileScreen && hasTouchScreen) || isMobileViewport;

  // Log detection details for debugging
  console.log('[DeviceDetection] Mobile device detection:', {
    userAgent: userAgent.substring(0, 100) + '...', // Truncate for readability
    isMobileUserAgent,
    screenDimensions: { width: screenWidth, height: screenHeight },
    isMobileScreen,
    viewportWidth,
    isMobileViewport,
    hasTouchScreen,
    finalResult: isMobile,
    timestamp: new Date().toISOString()
  });

  return isMobile;
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

  // Check for tablet-like screen dimensions
  const screenWidth = window.screen.width;
  const screenHeight = window.screen.height;
  const minDimension = Math.min(screenWidth, screenHeight);
  const maxDimension = Math.max(screenWidth, screenHeight);
  
  // Typical tablet dimensions: 768px+ in portrait, 1024px+ in landscape
  const isTabletScreen = (minDimension >= 768 && maxDimension >= 1024) && 
                         (minDimension <= 1024 && maxDimension <= 1366);

  const hasTouchScreen = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const isTablet = isTabletUserAgent || (isTabletScreen && hasTouchScreen);

  console.log('[DeviceDetection] Tablet device detection:', {
    userAgent: userAgent.substring(0, 100) + '...',
    isTabletUserAgent,
    screenDimensions: { width: screenWidth, height: screenHeight },
    isTabletScreen,
    hasTouchScreen,
    finalResult: isTablet,
    timestamp: new Date().toISOString()
  });

  return isTablet;
};

/**
 * Comprehensive mobile/tablet detection for video editing restrictions
 * Returns true if the device should be restricted from video editing
 */
export const shouldRestrictVideoEditing = (): boolean => {
  const isMobile = isMobileDevice();
  const isTablet = isTabletDevice();
  const shouldRestrict = isMobile || isTablet;

  console.log('[DeviceDetection] Video editing restriction check:', {
    isMobile,
    isTablet,
    shouldRestrict,
    reason: shouldRestrict ? (isMobile ? 'Mobile device detected' : 'Tablet device detected') : 'Desktop device - no restriction',
    timestamp: new Date().toISOString()
  });

  return shouldRestrict;
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
      type: 'unknown',
      userAgent: 'server-side',
      screenDimensions: { width: 0, height: 0 },
      viewportDimensions: { width: 0, height: 0 },
      hasTouchScreen: false,
      timestamp: new Date().toISOString()
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
    timestamp: new Date().toISOString()
  };
};