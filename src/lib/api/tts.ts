/**
 * Text-to-Speech (TTS) API client
 */

export interface VoiceType {
  id: string;
  name: string;
  language: string;
  gender: string;
  description: string;
}

export interface TTSRequest {
  text: string;
  voice_type?: string;
  speed_ratio?: number;
  segment_id?: string;
  task_id?: string;
}

export interface TTSResponse {
  success: boolean;
  message: string;
  data: {
    audio_url: string;
    file_name: string;
    file_size: number;
    voice_type: string;
    text_length: number;
    speed_ratio: number;
    request_id: string;
    created_at: string;
    segment_id?: string;
    task_id?: string;
  };
}

export interface VoiceTypesResponse {
  success: boolean;
  message: string;
  data: Record<string, VoiceType>;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';

/**
 * Convert text to speech
 */
export async function convertTextToSpeech(request: TTSRequest): Promise<TTSResponse> {
  try {
    console.log('[TTS API] 发送语音转换请求', {
      text_length: request.text.length,
      voice_type: request.voice_type,
      speed_ratio: request.speed_ratio,
      segment_id: request.segment_id,
      task_id: request.task_id
    });

    const response = await fetch(`${API_BASE_URL}/api/tts/convert`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result: TTSResponse = await response.json();

    console.log('[TTS API] 语音转换响应', {
      success: result.success,
      audio_url: result.success ? result.data.audio_url : null,
      file_size: result.success ? result.data.file_size : null,
      message: result.message
    });

    return result;
  } catch (error) {
    console.error('[TTS API] 语音转换请求失败', {
      error: error instanceof Error ? error.message : String(error),
      request
    });
    throw error;
  }
}

/**
 * Get available voice types
 */
export async function getVoiceTypes(): Promise<VoiceTypesResponse> {
  try {
    console.log('[TTS API] 获取音色列表');

    const response = await fetch(`${API_BASE_URL}/api/tts/voice-types`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result: VoiceTypesResponse = await response.json();

    console.log('[TTS API] 音色列表响应', {
      success: result.success,
      voice_types_count: result.success ? Object.keys(result.data).length : 0
    });

    return result;
  } catch (error) {
    console.error('[TTS API] 获取音色列表失败', {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

/**
 * Check TTS service health
 */
export async function checkTTSHealth(): Promise<any> {
  try {
    console.log('[TTS API] 检查TTS服务健康状态');

    const response = await fetch(`${API_BASE_URL}/api/tts/health`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const result = await response.json();

    console.log('[TTS API] TTS健康检查响应', {
      status_code: response.status,
      service_status: result.status,
      config_valid: result.config_valid
    });

    return result;
  } catch (error) {
    console.error('[TTS API] TTS健康检查失败', {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
} 