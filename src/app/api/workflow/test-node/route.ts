/**
 * API Route: /api/workflow/test-node
 * 
 * Test a single workflow node independently
 * Allows debugging and testing individual nodes before running full workflow
 * Supports data format conversion for input/output
 */

import { NextRequest, NextResponse } from 'next/server';

// Type definitions for data formats
type DataFormat = 'text/plain' | 'application/json' | 'array';

/**
 * Detect the format of data
 */
function detectFormat(data: any): DataFormat {
  if (data === null || data === undefined) {
    return 'text/plain';
  }
  if (typeof data === 'string') {
    try {
      JSON.parse(data);
      return 'application/json';
    } catch {
      return 'text/plain';
    }
  }
  if (Array.isArray(data)) {
    return 'array';
  }
  if (typeof data === 'object') {
    return 'application/json';
  }
  return 'text/plain';
}

/**
 * Convert data from one format to another
 */
function convertFormat(from: DataFormat, to: DataFormat, data: any): any {
  if (from === to) return data;
  
  // Convert FROM text/plain
  if (from === 'text/plain') {
    const text = String(data || '');
    if (to === 'application/json') {
      try {
        return JSON.parse(text);
      } catch {
        return { text };
      }
    } else if (to === 'array') {
      return text.split('\n').filter(line => line.trim().length > 0);
    }
  }
  // Convert FROM application/json
  else if (from === 'application/json') {
    if (to === 'text/plain') {
      if (typeof data === 'string') return data;
      if (data?.text) return String(data.text);
      if (data?.message) return String(data.message);
      if (data?.content) return String(data.content);
      return JSON.stringify(data, null, 2);
    } else if (to === 'array') {
      if (Array.isArray(data)) return data;
      if (data?.items && Array.isArray(data.items)) return data.items;
      if (data?.results && Array.isArray(data.results)) return data.results;
      return [data];
    }
  }
  // Convert FROM array
  else if (from === 'array') {
    const arr = Array.isArray(data) ? data : [data];
    if (to === 'text/plain') {
      return arr.map(item => {
        if (typeof item === 'string') return item;
        if (item?.text) return String(item.text);
        if (item?.message) return String(item.message);
        return JSON.stringify(item);
      }).join('\n');
    } else if (to === 'application/json') {
      return arr;
    }
  }
  
  return data;
}

/**
 * POST /api/workflow/test-node
 * Test a single workflow node with provided input
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    console.log('[API] POST /api/workflow/test-node - Request received');
    
    const body = await request.json();
    const { node_id, node_type, node_label, node_config, input } = body;

    console.log('[API] Test node request:', {
      node_id,
      node_type,
      node_label,
      hasConfig: !!node_config,
      hasInput: !!input,
      inputFormat: node_config?.inputFormat,
      outputFormat: node_config?.outputFormat
    });

    // Validate required fields
    if (!node_id || !node_type) {
      console.error('[API] Missing required fields:', { node_id, node_type });
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields: node_id and node_type are required',
        },
        { status: 400 }
      );
    }

    // Convert input format if specified
    let convertedInput = input;
    if (node_config?.inputFormat) {
      const currentFormat = detectFormat(input);
      console.log('[API] Converting input format:', {
        from: currentFormat,
        to: node_config.inputFormat
      });
      convertedInput = convertFormat(currentFormat, node_config.inputFormat, input);
    }

    // Execute node based on type
    let output: any = null;

    switch (node_type) {
      case 'start':
        output = await executeStartNode(node_config, convertedInput);
        break;

      case 'text-input':
        output = await executeTextInputNode(node_config, convertedInput);
        break;

      case 'chat-llm':
        output = await executeChatLLMNode(node_config, convertedInput);
        break;

      case 'pexels-video-search':
        output = await executePexelsVideoSearchNode(node_config, convertedInput);
        break;

      case 'tavily-search':
        output = await executeTavilySearchNode(node_config, convertedInput);
        break;

      case 'volcano-tts':
        output = await executeVolcanoTTSNode(node_config, convertedInput, node_id);
        break;

      case 'to-array':
        output = await executeToArrayNode(node_config, convertedInput);
        break;

      case 'end':
        output = await executeEndNode(node_config, convertedInput);
        break;

      default:
        console.error('[API] Unknown node type:', node_type);
        return NextResponse.json(
          {
            success: false,
            error: `Unknown node type: ${node_type}`,
          },
          { status: 400 }
        );
    }

    // Convert output format if specified
    if (node_config?.outputFormat) {
      const currentFormat = detectFormat(output);
      console.log('[API] Converting output format:', {
        from: currentFormat,
        to: node_config.outputFormat
      });
      output = convertFormat(currentFormat, node_config.outputFormat, output);
    }

    const duration = Date.now() - startTime;

    console.log('[API] Node test completed successfully:', {
      node_id,
      node_type,
      duration: `${duration}ms`,
      hasOutput: !!output
    });

    return NextResponse.json({
      success: true,
      message: 'Node test completed successfully',
      output,
      execution_time_ms: duration,
      node_id,
      node_type,
    });

  } catch (error: any) {
    const duration = Date.now() - startTime;
    
    console.error('[API] Node test failed:', {
      error: error.message,
      stack: error.stack,
      duration: `${duration}ms`
    });

    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Node test execution failed',
        execution_time_ms: duration,
      },
      { status: 500 }
    );
  }
}

/**
 * Execute Start node
 */
async function executeStartNode(config: any, input: any): Promise<any> {
  console.log('[API] Executing Start node');
  
  // Start node uses configured input or provided input
  const inputContent = config?.input || input?.text || input || '';
  
  return {
    text: inputContent,
    message: 'Start node executed',
    source: 'test'
  };
}

/**
 * Execute Text Input node
 */
async function executeTextInputNode(config: any, input: any): Promise<any> {
  console.log('[API] Executing Text Input node');
  
  if (!config?.content) {
    throw new Error('Text Input node requires content configuration');
  }

  return {
    text: config.content,
    previousInput: input,
  };
}

/**
 * Execute Chat LLM node
 */
async function executeChatLLMNode(config: any, input: any): Promise<any> {
  console.log('[API] Executing Chat LLM node');
  
  if (!config?.model || !config?.systemPrompt) {
    throw new Error('Chat LLM node requires model and systemPrompt configuration');
  }

  // Extract user message from input
  let userMessage = '';
  if (typeof input === 'string') {
    userMessage = input;
  } else if (input?.text) {
    userMessage = input.text;
  } else if (input?.message) {
    userMessage = input.message;
  } else {
    userMessage = JSON.stringify(input);
  }

  console.log('[API] Calling LLM API:', {
    model: config.model,
    systemPromptLength: config.systemPrompt.length,
    userMessageLength: userMessage.length
  });

  // Call the chat API (internal API call)
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [
        {
          role: 'system',
          content: config.systemPrompt,
        },
        {
          role: 'user',
          content: userMessage,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `LLM API request failed with status ${response.status}`);
  }

  // Read the streaming response
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body from LLM API');
  }

  let accumulatedContent = '';
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          if (parsed.content) {
            accumulatedContent += parsed.content;
          } else if (parsed.choices?.[0]?.delta?.content) {
            accumulatedContent += parsed.choices[0].delta.content;
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }
  }

  console.log('[API] LLM response received:', {
    responseLength: accumulatedContent.length
  });

  return {
    text: accumulatedContent,
    llmResponse: accumulatedContent,
    previousInput: input,
    model: config.model,
  };
}

/**
 * Execute Pexels Video Search node
 */
async function executePexelsVideoSearchNode(config: any, input: any): Promise<any> {
  console.log('[API] Executing Pexels Video Search node');
  
  // Get keywords from config or input
  let keywords = config?.keywords || '';
  
  if (input) {
    if (typeof input === 'string') {
      keywords = input;
    } else if (input?.keywords) {
      keywords = input.keywords;
    } else if (input?.text) {
      keywords = input.text;
    } else if (input?.message) {
      keywords = input.message;
    }
  }
  
  if (!keywords || keywords.trim().length === 0) {
    throw new Error('Pexels Video Search node requires keywords');
  }
  
  const videoCount = config?.count || 5;
  
  console.log('[API] Searching Pexels:', {
    keywords,
    videoCount
  });

  // Call the video search API (internal API call)
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/video-search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: keywords.trim(),
      max_videos: videoCount,
      orientation: 'mixed',
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || errorData.message || `Video search failed with status ${response.status}`);
  }

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.message || 'Video search failed');
  }

  const videos = data.videos || [];
  const videoUrls = videos.map((video: any) => ({
    id: video.id,
    url: video.url,
    videoUrl: video.video_url,
    thumbnail: video.image,
    width: video.width,
    height: video.height,
    duration: video.duration,
    user: video.user,
  }));

  console.log('[API] Pexels search completed:', {
    totalFound: data.total_found,
    returned: videoUrls.length
  });

  return {
    videos: videoUrls,
    videoUrls: videoUrls.map((v: any) => v.videoUrl),
    totalFound: data.total_found,
    keywords,
    count: videoUrls.length,
  };
}

/**
 * Execute Tavily Search node
 */
async function executeTavilySearchNode(config: any, input: any): Promise<any> {
  console.log('[API] Executing Tavily Search node');
  
  // Get keywords from config or input
  let keywords = config?.keywords || '';
  
  if (input) {
    if (typeof input === 'string') {
      keywords = input;
    } else if (input?.keywords) {
      keywords = input.keywords;
    } else if (input?.text) {
      keywords = input.text;
    } else if (input?.message) {
      keywords = input.message;
    }
  }
  
  if (!keywords || keywords.trim().length === 0) {
    throw new Error('Tavily Search node requires keywords');
  }
  
  const searchCount = config?.count || 5;
  
  console.log('[API] Searching Tavily:', {
    keywords,
    searchCount
  });

  // Call the Tavily search API (internal API call)
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/workflow/tavily-search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      keywords: keywords.trim(),
      count: searchCount,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `Tavily search failed with status ${response.status}`);
  }

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.message || 'Tavily search failed');
  }

  const results = data.results || [];

  console.log('[API] Tavily search completed:', {
    totalResults: data.total_results,
    returned: results.length
  });

  return {
    results: results,
    count: data.total_results,
    keywords: keywords.trim(),
  };
}

/**
 * Execute Volcano TTS node
 */
async function executeVolcanoTTSNode(config: any, input: any, nodeId: string): Promise<any> {
  console.log('[API] Executing Volcano TTS node');
  
  // Get text from config or input
  let text = config?.text || '';
  
  if (input) {
    if (typeof input === 'string') {
      text = input;
    } else if (input?.text) {
      text = input.text;
    } else if (input?.message) {
      text = input.message;
    } else if (input?.content) {
      text = input.content;
    }
  }
  
  if (!text || text.trim().length === 0) {
    throw new Error('Volcano TTS node requires text content');
  }
  
  const voiceType = config?.voiceType || 'zh_male_shaonianzixin_moon_bigtts';
  const speedRatio = config?.speedRatio || 1.0;
  
  console.log('[API] Converting text to speech:', {
    textLength: text.length,
    voiceType,
    speedRatio
  });

  // Call the TTS API
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/tts/convert-sentences`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      segment_id: nodeId,
      sentences: [
        {
          sentence_id: `${nodeId}-1`,
          text: text.trim(),
          order: 0
        }
      ],
      voice_type: voiceType,
      speed_ratio: speedRatio,
      task_id: `test-${Date.now()}`,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `TTS request failed with status ${response.status}`);
  }

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.message || 'TTS conversion failed');
  }

  console.log('[API] TTS conversion completed:', {
    audioUrl: data.concatenated_audio_url,
    duration: data.total_duration
  });

  return {
    text: text,
    audio_url: data.concatenated_audio_url,
    duration: data.total_duration,
    voice_type: voiceType,
    speed_ratio: speedRatio,
    sentence_results: data.sentence_results,
    success: true,
  };
}

/**
 * Execute To Array node
 * Converts any input data to array format using LLM
 */
async function executeToArrayNode(config: any, input: any): Promise<any> {
  console.log('[API] Executing To Array node');
  
  if (!config?.model || !config?.systemPrompt) {
    throw new Error('To Array node requires model and systemPrompt configuration');
  }

  // Extract user message from input
  let userMessage = '';
  if (typeof input === 'string') {
    userMessage = input;
  } else if (input?.text) {
    userMessage = input.text;
  } else if (input?.message) {
    userMessage = input.message;
  } else {
    userMessage = JSON.stringify(input);
  }

  console.log('[API] Calling LLM API for array conversion:', {
    model: config.model,
    systemPromptLength: config.systemPrompt.length,
    userMessageLength: userMessage.length
  });

  // Call the chat API (internal API call)
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [
        {
          role: 'system',
          content: config.systemPrompt,
        },
        {
          role: 'user',
          content: userMessage,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `LLM API request failed with status ${response.status}`);
  }

  // Read the streaming response
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body from LLM API');
  }

  let accumulatedContent = '';
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          if (parsed.content) {
            accumulatedContent += parsed.content;
          } else if (parsed.choices?.[0]?.delta?.content) {
            accumulatedContent += parsed.choices[0].delta.content;
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }
  }

  console.log('[API] LLM response received for array conversion:', {
    responseLength: accumulatedContent.length
  });

  // Parse the LLM response to extract the array
  let arrayResult: any[];
  
  try {
    // Try to parse as JSON
    const parsed = JSON.parse(accumulatedContent.trim());
    if (Array.isArray(parsed)) {
      arrayResult = parsed;
    } else if (parsed?.array && Array.isArray(parsed.array)) {
      arrayResult = parsed.array;
    } else if (parsed?.items && Array.isArray(parsed.items)) {
      arrayResult = parsed.items;
    } else if (parsed?.results && Array.isArray(parsed.results)) {
      arrayResult = parsed.results;
    } else {
      // If not an array, wrap it in an array
      arrayResult = [parsed];
    }
  } catch (e) {
    console.warn('[API] Failed to parse LLM response as JSON, attempting text extraction');
    
    // Try to find JSON array in the text
    const arrayMatch = accumulatedContent.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        arrayResult = JSON.parse(arrayMatch[0]);
      } catch (e2) {
        // If still fails, split by lines as fallback
        arrayResult = accumulatedContent
          .split('\n')
          .filter(line => line.trim().length > 0)
          .map(line => line.trim());
      }
    } else {
      // Fallback: split by lines
      arrayResult = accumulatedContent
        .split('\n')
        .filter(line => line.trim().length > 0)
        .map(line => line.trim());
    }
  }

  return arrayResult;
}

/**
 * Execute End node
 */
async function executeEndNode(config: any, input: any): Promise<any> {
  console.log('[API] Executing End node');
  
  return {
    finalResult: input,
    message: 'End node executed',
  };
}

