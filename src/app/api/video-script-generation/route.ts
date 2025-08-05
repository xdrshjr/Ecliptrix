import { NextRequest, NextResponse } from 'next/server';
import { ScriptSegment } from '@/types';

// 获取环境变量配置
const getConfig = () => {
  const apiUrl = process.env.LLM_API_URL || process.env.OPENAI_API_URL || 'https://api.openai.com/v1';
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  const model = process.env.LLM_MODEL || 'gpt-3.5-turbo';

  if (!apiKey) {
    throw new Error('API key not configured. Please set LLM_API_KEY or OPENAI_API_KEY in environment variables.');
  }

  return { apiUrl, apiKey, model };
};

// 构建脚本生成的提示词
const buildScriptPrompt = (markdownContent: string) => {
  return `You are an expert video script writer. Based on the following markdown content, generate a professional video script.

Markdown Content:
${markdownContent}

Please analyze the content and create a video script with the following requirements:

1. Divide the content into logical segments (typically 3-8 segments)
2. Each segment should represent a coherent part of the video (like introduction, main points, conclusion)
3. Each segment should contain 2-6 sentences that flow naturally
4. Estimate appropriate duration for each segment (in seconds)
5. Create engaging, conversational language suitable for video narration

Return the result as a JSON object with this exact structure:
{
  "segments": [
    {
      "id": "segment-1",
      "title": "Segment Title",
      "duration": 15,
      "sentences": [
        {
          "id": "sentence-1-1",
          "text": "First sentence of the segment.",
          "startTime": 0,
          "endTime": 3
        },
        {
          "id": "sentence-1-2", 
          "text": "Second sentence of the segment.",
          "startTime": 3,
          "endTime": 8
        }
      ]
    }
  ]
}

Important: 
- Return ONLY the JSON object, no additional text or explanation
- Ensure all IDs are unique
- Make sure sentence timings add up to the segment duration
- Use clear, engaging language suitable for video narration
- Keep segments focused and coherent`;
};

// 日志记录函数
const logRequest = (markdownContent: string, taskId: string, config: any) => {
  console.log(`[Video Script Generation API] ${new Date().toISOString()} - Incoming script generation request`);
  console.log(`[Video Script Generation API] Task ID: ${taskId}`);
  console.log(`[Video Script Generation API] Model: ${config.model}`);
  console.log(`[Video Script Generation API] Markdown content length: ${markdownContent.length} characters`);
  console.log(`[Video Script Generation API] Markdown preview: ${markdownContent.slice(0, 200)}...`);
};

const logResponse = (success: boolean, taskId: string, segmentCount?: number, error?: string) => {
  if (success) {
    console.log(`[Video Script Generation API] ${new Date().toISOString()} - Script generation completed successfully for task: ${taskId}`);
    console.log(`[Video Script Generation API] Generated ${segmentCount} script segments`);
  } else {
    console.error(`[Video Script Generation API] ${new Date().toISOString()} - Script generation failed for task: ${taskId} - ${error}`);
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { markdownContent, taskId } = body as { 
      markdownContent: string; 
      taskId: string; 
    };

    // 验证请求参数
    if (!markdownContent || typeof markdownContent !== 'string' || markdownContent.trim().length === 0) {
      console.error('[Video Script Generation API] Invalid request: markdownContent string is required');
      return NextResponse.json(
        { error: 'Markdown content string is required' },
        { status: 400 }
      );
    }

    if (!taskId || typeof taskId !== 'string') {
      console.error('[Video Script Generation API] Invalid request: taskId is required');
      return NextResponse.json(
        { error: 'Task ID is required' },
        { status: 400 }
      );
    }

    const config = getConfig();
    logRequest(markdownContent, taskId, config);

    // 准备请求数据
    const requestData = {
      model: config.model,
      messages: [
        {
          role: 'system',
          content: 'You are an expert video script writer. You always return valid JSON responses exactly as requested.'
        },
        {
          role: 'user',
          content: buildScriptPrompt(markdownContent)
        }
      ],
      temperature: 0.7,
      max_tokens: 3000,
    };

    console.log(`[Video Script Generation API] Calling LLM API: ${config.apiUrl}/chat/completions for task: ${taskId}`);

    // 调用LLM API
    const response = await fetch(`${config.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(requestData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Video Script Generation API] LLM API error: ${response.status} - ${errorText} for task: ${taskId}`);
      logResponse(false, taskId, undefined, `LLM API error: ${response.status}`);
      
      return NextResponse.json(
        { error: `LLM API error: ${response.status}` },
        { status: response.status }
      );
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;

    if (!content) {
      console.error(`[Video Script Generation API] No content in LLM response for task: ${taskId}`);
      logResponse(false, taskId, undefined, 'No content in LLM response');
      
      return NextResponse.json(
        { error: 'No content received from LLM' },
        { status: 500 }
      );
    }

    console.log(`[Video Script Generation API] Raw LLM response for task: ${taskId}: ${content.slice(0, 200)}...`);

    // 解析JSON响应
    let scriptData;
    try {
      // 尝试提取JSON部分（处理可能的额外文本）
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const jsonString = jsonMatch ? jsonMatch[0] : content;
      scriptData = JSON.parse(jsonString);
    } catch (parseError) {
      console.error(`[Video Script Generation API] Failed to parse LLM response as JSON for task: ${taskId}:`, parseError);
      console.error(`[Video Script Generation API] Raw content: ${content}`);
      logResponse(false, taskId, undefined, 'Failed to parse JSON response');
      
      return NextResponse.json(
        { error: 'Failed to parse script data from LLM response' },
        { status: 500 }
      );
    }

    // 验证响应格式
    if (!scriptData.segments || !Array.isArray(scriptData.segments)) {
      console.error(`[Video Script Generation API] Invalid script format for task: ${taskId} - missing segments array`);
      logResponse(false, taskId, undefined, 'Invalid script format');
      
      return NextResponse.json(
        { error: 'Invalid script format received' },
        { status: 500 }
      );
    }

    // 验证每个segment的格式
    for (let i = 0; i < scriptData.segments.length; i++) {
      const segment = scriptData.segments[i];
      if (!segment.id || !segment.title || !segment.sentences || !Array.isArray(segment.sentences)) {
        console.error(`[Video Script Generation API] Invalid segment format at index ${i} for task: ${taskId}`);
        logResponse(false, taskId, undefined, `Invalid segment format at index ${i}`);
        
        return NextResponse.json(
          { error: `Invalid segment format at index ${i}` },
          { status: 500 }
        );
      }

      // 验证每个sentence的格式
      for (let j = 0; j < segment.sentences.length; j++) {
        const sentence = segment.sentences[j];
        if (!sentence.id || !sentence.text) {
          console.error(`[Video Script Generation API] Invalid sentence format at segment ${i}, sentence ${j} for task: ${taskId}`);
          logResponse(false, taskId, undefined, `Invalid sentence format at segment ${i}, sentence ${j}`);
          
          return NextResponse.json(
            { error: `Invalid sentence format at segment ${i}, sentence ${j}` },
            { status: 500 }
          );
        }
      }
    }

    const segmentCount = scriptData.segments.length;
    const totalSentences = scriptData.segments.reduce((sum: number, seg: any) => sum + seg.sentences.length, 0);
    
    console.log(`[Video Script Generation API] Successfully generated script for task: ${taskId} - ${segmentCount} segments, ${totalSentences} sentences`);
    logResponse(true, taskId, segmentCount);

    return NextResponse.json({
      success: true,
      segments: scriptData.segments as ScriptSegment[],
      metadata: {
        segmentCount,
        totalSentences,
        generatedAt: new Date().toISOString(),
        taskId
      }
    });

  } catch (error) {
    console.error('[Video Script Generation API] Request processing error:', error);
    const taskId = 'unknown';
    logResponse(false, taskId, undefined, String(error));
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 