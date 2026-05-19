/**
 * API Route: /api/workflow/test-node
 * 
 * Test a single workflow node independently
 * Allows debugging and testing individual nodes before running full workflow
 * Supports data format conversion for input/output
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySessionFromRequest } from '@/lib/auth/sessionGuard';

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

    // V01-B (spec/01): require an authenticated session before executing
    // any workflow node. Without this, anonymous callers can burn LLM /
    // Tavily / Pexels / TTS quota and leak workflow context. We verify by
    // delegating to the backend's `/api/auth/validate-session` endpoint
    // so the token check uses the canonical DB state.
    const session = await verifySessionFromRequest(request);
    if (!session.valid) {
      console.warn('[API] test-node rejected unauthenticated request:', session.reason);
      return NextResponse.json(
        {
          success: false,
          error: 'unauthorized',
          message: '未提供有效的认证凭证',
        },
        { status: 401 },
      );
    }

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
    let llmDetails: any = null; // Store LLM execution details separately

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
        const toArrayResult = await executeToArrayNode(node_config, convertedInput);
        output = toArrayResult.output;
        llmDetails = toArrayResult.llmDetails;
        break;

      case 'results-combine':
        const combinedResult = await executeResultsCombineNode(node_config, convertedInput);
        output = combinedResult.output;
        llmDetails = combinedResult.llmDetails;
        break;

      case 'results-combine-item':
        // Special case: transform a single item from Results Combine node
        const itemResult = await executeResultsCombineItemTransformation(node_config, convertedInput);
        output = itemResult.output;
        llmDetails = itemResult.llmDetails;
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
      // LLM execution details (if node uses LLM)
      llm_details: llmDetails,
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
 * Supports both single string input and string array input
 */
async function executePexelsVideoSearchNode(config: any, input: any): Promise<any> {
  console.log('[API] Executing Pexels Video Search node', {
    input,
    inputType: typeof input,
    isArray: Array.isArray(input)
  });
  
  const inputFormat = config?.inputFormat || 'application/json';
  const outputFormat = config?.outputFormat || 'application/json';
  const videoCount = config?.count || 5;
  
  // Parse input to extract keywords array based on input format
  let keywordsArray: string[] = [];
  
  console.log('[API] Parsing input with format:', { inputFormat, outputFormat });
  
  // Step 1: Extract keywords from input or config
  if (input) {
    if (inputFormat === 'array') {
      // Expect array input
      if (Array.isArray(input)) {
        keywordsArray = input.map(item => 
          typeof item === 'string' ? item : JSON.stringify(item)
        ).filter(k => k && k.trim().length > 0);
        console.log('[API] Parsed array input:', { count: keywordsArray.length });
      } else {
        // Convert single value to array
        const keyword = typeof input === 'string' ? input : 
                       input?.keywords || input?.text || input?.message || JSON.stringify(input);
        if (keyword && keyword.trim().length > 0) {
          keywordsArray = [keyword];
        }
        console.log('[API] Converted single input to array');
      }
    } else if (inputFormat === 'text/plain') {
      // Expect plain text input
      const keyword = typeof input === 'string' ? input : 
                     input?.keywords || input?.text || input?.message || JSON.stringify(input);
      if (keyword && keyword.trim().length > 0) {
        keywordsArray = [keyword];
      }
      console.log('[API] Parsed text/plain input:', { keyword });
    } else {
      // application/json - auto-detect input type
      if (Array.isArray(input)) {
        keywordsArray = input.map(item => 
          typeof item === 'string' ? item : JSON.stringify(item)
        ).filter(k => k && k.trim().length > 0);
        console.log('[API] Auto-detected array input:', { count: keywordsArray.length });
      } else if (typeof input === 'string') {
        keywordsArray = [input];
        console.log('[API] Auto-detected string input');
      } else if (input?.keywords) {
        const kw = input.keywords;
        keywordsArray = Array.isArray(kw) ? kw : [kw];
        console.log('[API] Extracted from input.keywords');
      } else if (input?.text) {
        keywordsArray = [input.text];
        console.log('[API] Extracted from input.text');
      } else if (input?.message) {
        keywordsArray = [input.message];
        console.log('[API] Extracted from input.message');
      } else {
        keywordsArray = [JSON.stringify(input)];
        console.log('[API] Stringified input object');
      }
    }
  }
  
  // Fallback to config keywords if no input keywords
  if (keywordsArray.length === 0 && config?.keywords) {
    keywordsArray = [config.keywords];
    console.log('[API] Using config keywords as fallback');
  }
  
  // Validate we have keywords
  if (keywordsArray.length === 0) {
    throw new Error('Pexels Video Search node requires keywords. Please configure keywords or provide them as input.');
  }
  
  console.log('[API] Processing keywords:', { 
    count: keywordsArray.length, 
    keywords: keywordsArray 
  });

  // Step 2: Execute searches for each keyword
  const allVideoResults: any[] = [];
  let totalFoundCount = 0;
  
  for (let i = 0; i < keywordsArray.length; i++) {
    const keyword = keywordsArray[i].trim();
    if (!keyword) continue;
    
    console.log(`[API] Searching for keyword ${i + 1}/${keywordsArray.length}: "${keyword}"`);
    
    // Call the video search API (internal API call)
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/video-search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: keyword,
        max_videos: videoCount,
        orientation: 'mixed',
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.warn(`[API] Search failed for "${keyword}":`, errorData);
      continue; // Continue with next keyword instead of failing completely
    }

    const data = await response.json();
    
    console.log(`[API] Search response for "${keyword}":`, {
      success: data.success,
      totalFound: data.total_found,
      videosCount: data.videos?.length || 0
    });

    if (!data.success) {
      console.warn(`[API] No results for "${keyword}":`, data.message);
      continue;
    }

    // Extract video URLs from the response
    const videos = data.videos || [];
    const videoResults = videos.map((video: any) => ({
      id: video.id,
      url: video.url,
      videoUrl: video.video_url,
      thumbnail: video.image,
      width: video.width,
      height: video.height,
      duration: video.duration,
      user: video.user,
      keyword: keyword, // Tag with search keyword
    }));
    
    allVideoResults.push(...videoResults);
    totalFoundCount += data.total_found || 0;
    
    console.log(`[API] Found ${videoResults.length} videos for "${keyword}"`);
  }

  console.log('[API] All searches completed:', {
    totalVideos: allVideoResults.length,
    searches: keywordsArray.length
  });

  // Step 3: Format output based on output format
  let formattedOutput: any;
  
  if (outputFormat === 'array') {
    // Return simple array of video URLs
    formattedOutput = allVideoResults.map((v: any) => v.videoUrl);
    console.log('[API] Output formatted as array:', { count: formattedOutput.length });
  } else if (outputFormat === 'text/plain') {
    // Return newline-separated URLs
    formattedOutput = allVideoResults.map((v: any) => v.videoUrl).join('\n');
    console.log('[API] Output formatted as text/plain');
  } else {
    // application/json - return detailed object
    formattedOutput = {
      videos: allVideoResults,
      videoUrls: allVideoResults.map((v: any) => v.videoUrl),
      totalFound: totalFoundCount,
      keywords: keywordsArray,
      keywordCount: keywordsArray.length,
      count: allVideoResults.length,
    };
    console.log('[API] Output formatted as JSON object');
  }

  return formattedOutput;
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
  
  const voiceType = config?.voiceType || 'zh_male_shaonianzixin_uranus_bigtts';
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
 * Generate schema description for To Array node
 * Creates detailed schema instructions based on element type and object schema
 */
function generateSchemaDescription(config: any): string {
  const elementType = config?.elementType || 'string';
  
  console.log('[API] Generating schema description for element type:', elementType);
  
  if (elementType === 'string') {
    return 'Convert the input data into a JSON array where each element is a string value.';
  } else if (elementType === 'number') {
    return 'Convert the input data into a JSON array where each element is a numeric value.';
  } else if (elementType === 'boolean') {
    return 'Convert the input data into a JSON array where each element is a boolean value (true or false).';
  } else if (elementType === 'object' && config?.objectSchema) {
    const schema = config.objectSchema;
    let schemaDescription = 'Convert the input data into a JSON array where each element is an object with the following structure:\n';
    
    // Recursively generate schema description
    const describeSchema = (fields: any[], indent: string = ''): string => {
      let desc = '';
      for (const field of fields) {
        const required = field.required ? 'required' : 'optional';
        const description = field.description ? ` - ${field.description}` : '';
        
        if (field.type === 'object' && field.objectSchema && field.objectSchema.length > 0) {
          desc += `${indent}- ${field.name} (object, ${required})${description}:\n`;
          desc += describeSchema(field.objectSchema, indent + '  ');
        } else {
          desc += `${indent}- ${field.name} (${field.type}, ${required})${description}\n`;
        }
      }
      return desc;
    };
    
    schemaDescription += describeSchema(schema);
    schemaDescription += '\nEnsure all required fields are present and use the correct data types.';
    
    console.log('[API] Generated object schema description:', schemaDescription);
    
    return schemaDescription;
  }
  
  // Default fallback
  return 'Convert the input data into a clean JSON array format.';
}

/**
 * Validate array elements against schema
 * Ensures the LLM output conforms to the defined schema
 */
function validateArraySchema(arrayResult: any[], config: any): void {
  const elementType = config?.elementType || 'string';
  
  console.log('[API] Validating array schema:', {
    elementType,
    arrayLength: arrayResult.length
  });
  
  // Validate each element
  for (let i = 0; i < arrayResult.length; i++) {
    const element = arrayResult[i];
    
    if (elementType === 'string' && typeof element !== 'string') {
      console.warn(`[API] Element ${i} is not a string:`, typeof element);
    } else if (elementType === 'number' && typeof element !== 'number') {
      console.warn(`[API] Element ${i} is not a number:`, typeof element);
    } else if (elementType === 'boolean' && typeof element !== 'boolean') {
      console.warn(`[API] Element ${i} is not a boolean:`, typeof element);
    } else if (elementType === 'object') {
      if (typeof element !== 'object' || element === null || Array.isArray(element)) {
        console.warn(`[API] Element ${i} is not an object:`, typeof element);
      } else if (config?.objectSchema) {
        // Validate object fields
        validateObjectFields(element, config.objectSchema, `Element ${i}`);
      }
    }
  }
  
  console.log('[API] Schema validation completed');
}

/**
 * Recursively validate object fields against schema
 */
function validateObjectFields(obj: any, schema: any[], path: string): void {
  for (const field of schema) {
    const fieldPath = `${path}.${field.name}`;
    const value = obj[field.name];
    
    // Check required fields
    if (field.required && (value === undefined || value === null)) {
      console.warn(`[API] Required field missing: ${fieldPath}`);
      continue;
    }
    
    // Skip validation if field is optional and not present
    if (!field.required && (value === undefined || value === null)) {
      continue;
    }
    
    // Validate field type
    if (field.type === 'string' && typeof value !== 'string') {
      console.warn(`[API] Field ${fieldPath} should be string but is ${typeof value}`);
    } else if (field.type === 'number' && typeof value !== 'number') {
      console.warn(`[API] Field ${fieldPath} should be number but is ${typeof value}`);
    } else if (field.type === 'boolean' && typeof value !== 'boolean') {
      console.warn(`[API] Field ${fieldPath} should be boolean but is ${typeof value}`);
    } else if (field.type === 'object') {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        console.warn(`[API] Field ${fieldPath} should be object but is ${typeof value}`);
      } else if (field.objectSchema && field.objectSchema.length > 0) {
        // Recursively validate nested object
        validateObjectFields(value, field.objectSchema, fieldPath);
      }
    }
  }
}

/**
 * Execute To Array node
 * Converts any input data to array format using LLM with schema support
 */
async function executeToArrayNode(config: any, input: any): Promise<any> {
  console.log('[API] Executing To Array node with schema configuration:', {
    elementType: config?.elementType || 'string',
    hasObjectSchema: !!(config?.objectSchema && config.objectSchema.length > 0)
  });
  
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

  // Generate schema-enhanced system prompt
  const schemaDescription = generateSchemaDescription(config);
  const enhancedSystemPrompt = `${config.systemPrompt}\n\n${schemaDescription}\n\nRespond ONLY with a valid JSON array, no additional text or explanation.`;

  console.log('[API] Calling LLM API for array conversion:', {
    model: config.model,
    systemPromptLength: enhancedSystemPrompt.length,
    userMessageLength: userMessage.length,
    elementType: config?.elementType || 'string'
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
          content: enhancedSystemPrompt,
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

  // Validate array against schema
  if (arrayResult && arrayResult.length > 0) {
    validateArraySchema(arrayResult, config);
  }

  console.log('[API] To Array node execution completed:', {
    resultLength: arrayResult.length,
    elementType: config?.elementType || 'string'
  });

  // Return both output and LLM execution details
  return {
    output: arrayResult,
    llmDetails: {
      systemPrompt: enhancedSystemPrompt,
      userPrompt: userMessage,
      response: accumulatedContent,
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
    }
  };
}

/**
 * Execute Results Combine Item Transformation (single item)
 * Called internally by Results Combine node to transform each item
 */
async function executeResultsCombineItemTransformation(config: any, input: any): Promise<any> {
  console.log('[API] Executing Results Combine item transformation');
  
  if (!config?.model || !config?.systemPrompt) {
    throw new Error('Results Combine transformation requires model and systemPrompt configuration');
  }

  // Convert input to string for LLM
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

  // Enhance system prompt with schema if provided
  let enhancedSystemPrompt = config.systemPrompt;
  if (config.outputSchema) {
    try {
      const schema = typeof config.outputSchema === 'string' 
        ? JSON.parse(config.outputSchema) 
        : config.outputSchema;
      enhancedSystemPrompt += `\n\nOutput Schema:\n${JSON.stringify(schema, null, 2)}\n\nRespond ONLY with a valid JSON object matching this schema, no additional text or explanation.`;
    } catch (e) {
      console.warn('[API] Failed to parse output schema:', e);
    }
  }

  console.log('[API] Calling LLM API for item transformation:', {
    model: config.model,
    systemPromptLength: enhancedSystemPrompt.length,
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
          content: enhancedSystemPrompt,
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

  console.log('[API] LLM response received for item transformation:', {
    responseLength: accumulatedContent.length
  });

  // Parse the LLM response as JSON object
  let parsedOutput;
  try {
    parsedOutput = JSON.parse(accumulatedContent.trim());
  } catch (e) {
    console.warn('[API] Failed to parse LLM response as JSON, attempting extraction');
    
    // Try to find JSON object in the text
    const jsonMatch = accumulatedContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsedOutput = JSON.parse(jsonMatch[0]);
      } catch (e2) {
        // If still fails, return as plain object
        parsedOutput = { result: accumulatedContent.trim(), parseError: true };
      }
    } else {
      // Fallback: return as plain object
      parsedOutput = { result: accumulatedContent.trim(), parseError: true };
    }
  }

  // Return both output and LLM execution details
  return {
    output: parsedOutput,
    llmDetails: {
      systemPrompt: enhancedSystemPrompt,
      userPrompt: userMessage,
      response: accumulatedContent,
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
    }
  };
}

/**
 * Execute Results Combine node
 * Processes an array of inputs, transforms each via LLM, and combines results
 */
async function executeResultsCombineNode(config: any, input: any): Promise<any> {
  console.log('[API] Executing Results Combine node:', {
    hasConfig: !!config,
    inputType: typeof input,
    isArray: Array.isArray(input)
  });
  
  if (!config?.model || !config?.systemPrompt) {
    throw new Error('Results Combine node requires model and systemPrompt configuration');
  }

  // Extract array from input
  let inputArray: any[] = [];
  if (Array.isArray(input)) {
    inputArray = input;
  } else if (input?.array && Array.isArray(input.array)) {
    inputArray = input.array;
  } else if (input?.items && Array.isArray(input.items)) {
    inputArray = input.items;
  } else if (input?.results && Array.isArray(input.results)) {
    inputArray = input.results;
  } else if (typeof input === 'object' && input !== null) {
    // If input is a single object, wrap it in an array
    inputArray = [input];
  } else {
    throw new Error('Results Combine node requires an array input or object that can be converted to array');
  }

  if (inputArray.length === 0) {
    console.warn('[API] Input array is empty, returning empty array');
    return [];
  }

  console.log('[API] Processing array for Results Combine:', {
    arrayLength: inputArray.length,
    model: config.model,
    hasOutputSchema: !!config.outputSchema
  });

  const transformedResults: any[] = [];
  const allLlmDetails: any[] = []; // Collect LLM details from each item transformation
  let successCount = 0;
  let errorCount = 0;

  // Process each item
  for (let i = 0; i < inputArray.length; i++) {
    const item = inputArray[i];
    
    console.log(`[API] Transforming item ${i + 1}/${inputArray.length}`);

    try {
      const transformed = await executeResultsCombineItemTransformation(config, item);
      transformedResults.push(transformed.output);
      allLlmDetails.push({
        itemIndex: i,
        ...transformed.llmDetails
      });
      successCount++;
      
      console.log(`[API] Item ${i + 1} transformed successfully`);
    } catch (itemError: any) {
      errorCount++;
      console.error(`[API] Failed to transform item ${i + 1}:`, itemError.message);
      
      // Continue processing other items instead of failing completely
    }
  }

  console.log('[API] Results Combine completed:', {
    totalItems: inputArray.length,
    successCount,
    errorCount
  });

  // Return combined results with aggregated LLM details
  return {
    output: transformedResults,
    llmDetails: {
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      systemPrompt: config.systemPrompt,
      itemCount: inputArray.length,
      successCount,
      errorCount,
      // Include details for each item transformation
      items: allLlmDetails
    }
  };
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

