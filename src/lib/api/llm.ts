/**
 * LLM API client for fetching available models
 */

import { LLMModelsResponse, LLMModel } from '@/types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';

/**
 * Fetch all available LLM models from backend
 * @returns Promise<LLMModel[]> List of available LLM models
 * @throws Error if the request fails
 */
export async function fetchLLMModels(): Promise<LLMModel[]> {
  console.log('[LLM API] Fetching available LLM models');
  
  try {
    const response = await fetch(`${API_BASE_URL}/api/llm/models`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[LLM API] Failed to fetch models:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      });
      throw new Error(`Failed to fetch LLM models: ${response.statusText}`);
    }

    const data: LLMModelsResponse = await response.json();
    
    console.log('[LLM API] Successfully fetched models:', {
      totalCount: data.total_count,
      models: data.models.map(m => m.display_name),
    });

    return data.models;
  } catch (error) {
    console.error('[LLM API] Error fetching LLM models:', error);
    throw error;
  }
}


