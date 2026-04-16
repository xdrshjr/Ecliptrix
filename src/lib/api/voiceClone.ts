import { http } from '@/lib/api/http-client';

export interface AIAudioSynthesizeRequest {
  text: string;
  voice_type: string;
  speed_ratio?: number;
  is_cloned_voice?: boolean;
}

export interface AIAudioSynthesizeResponse {
  success: boolean;
  message: string;
  data?: {
    audio_url?: string;
    duration?: number;
    file_size?: number;
    voice_type?: string;
    text_length?: number;
    request_id?: string;
    file_name?: string;
    file_path?: string;
    speed_ratio?: number;
  } | null;
}

export async function aiAudioSynthesize(request: AIAudioSynthesizeRequest): Promise<AIAudioSynthesizeResponse> {
  return http.post<AIAudioSynthesizeResponse>('/api/tts/ai-audio-synthesize', request, { timeoutMs: 180_000 });
}
