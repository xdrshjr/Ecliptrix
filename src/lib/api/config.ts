/**
 * Configuration API service
 * Handles fetching application configuration from the backend
 */

import { http } from '@/lib/api/http-client';

export interface YoutubeDownloadConfig {
  max_concurrent_downloads: number;
  download_timeout: number;
  max_retries: number;
  retry_delay: number;
}

export interface YoutubeUploadConfig {
  upload_timeout: number;
  max_retries: number;
  retry_delay: number;
}

export interface YoutubeQualityConfig {
  default_video_quality: string;
  default_audio_quality: string;
  default_format: string;
}

export interface YoutubeFileManagementConfig {
  auto_cleanup: boolean;
  temp_file_retention_hours: number;
  generate_thumbnail: boolean;
}

export interface YoutubeLoggingConfig {
  enable_detailed_logging: boolean;
  log_download_progress: boolean;
  progress_log_interval: number;
}

export interface YoutubeConfig {
  download: YoutubeDownloadConfig;
  upload: YoutubeUploadConfig;
  quality: YoutubeQualityConfig;
  file_management: YoutubeFileManagementConfig;
  logging: YoutubeLoggingConfig;
}

export interface AppConfig {
  app_name: string;
  app_version: string;
  log_level: string;
  debug: boolean;
  llm_api_url: string;
  host: string;
  port: number;
  youtube: YoutubeConfig;
}

export interface ConfigResponse {
  success: boolean;
  message: string;
  data: AppConfig;
  error?: string;
}

/**
 * Fetch application configuration from the backend.
 *
 * `/api/config` is NOT in the backend allowlist (T01) — every caller must be
 * authenticated. The wrapper auto-injects the session token.
 */
export async function fetchConfig(): Promise<ConfigResponse> {
  const data = await http.get<ConfigResponse>('/api/config');

  if (!data.success) {
    throw new Error(data.error || data.message || 'Configuration fetch failed');
  }

  return data;
}

/**
 * Get YouTube configuration specifically.
 *
 * Falls back to a hard-coded default config when the backend call fails so
 * downstream YouTube features keep working without throwing in the UI.
 * The fallback is intentional per spec §9 — failure of an optional config
 * fetch is non-fatal.
 */
export async function fetchYoutubeConfig(): Promise<YoutubeConfig> {
  try {
    const configResponse = await fetchConfig();
    return configResponse.data.youtube;
  } catch {
    // Optional feature; failure is non-fatal — return safe defaults so the
    // YouTube panel can still render with sensible limits.
    return {
      download: {
        max_concurrent_downloads: 3,
        download_timeout: 300,
        max_retries: 3,
        retry_delay: 5,
      },
      upload: {
        upload_timeout: 600,
        max_retries: 3,
        retry_delay: 10,
      },
      quality: {
        default_video_quality: '720p',
        default_audio_quality: 'best',
        default_format: 'mp4',
      },
      file_management: {
        auto_cleanup: true,
        temp_file_retention_hours: 24,
        generate_thumbnail: true,
      },
      logging: {
        enable_detailed_logging: true,
        log_download_progress: true,
        progress_log_interval: 10,
      },
    };
  }
}

/**
 * Get the maximum concurrent downloads setting.
 */
export async function getMaxConcurrentDownloads(): Promise<number> {
  try {
    const youtubeConfig = await fetchYoutubeConfig();
    return youtubeConfig.download.max_concurrent_downloads;
  } catch {
    // Optional feature; failure is non-fatal — fall back to a safe default.
    return 3;
  }
}
