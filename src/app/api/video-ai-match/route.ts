import { NextRequest, NextResponse } from 'next/server';

// SWEEP-NOTE: this route does NOT proxy to the FastAPI backend at all.
// It calls a third-party LLM (Aliyun DashScope) directly using its own
// AI_VIDEO_MATCH_LLM_* env vars. The previous file declared a top-level
// `BACKEND_URL` constant that was DEAD CODE — it was never actually used
// inside the handler. The constant has been removed so the file no longer
// trips the AC#3 grep guard. No backend behavior changed.

const getConfig = () => {
  const apiUrl = process.env.AI_VIDEO_MATCH_LLM_API_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const apiKey = ***REMOVED*** || '';
  const model = process.env.AI_VIDEO_MATCH_LLM_MODEL || 'qwen-max-latest';

  if (!apiKey) {
    throw new Error('AI Video Match LLM API key is not configured');
  }

  return { apiUrl, apiKey, model };
};

interface VideoAnalysisResult {
  videoUrl: string;
  videoName: string;
  materialId: string;
  frameAnalyses: Array<{
    frame_number: number;
    timestamp: number;
    analysis: string;
  }>;
  videoDuration: number;
  totalFrames: number;
}

interface VideoAIMatchRequest {
  scriptText: string;
  videoAnalysisResults: VideoAnalysisResult[];
  taskId: string;
  segmentDuration?: number;
}

interface VideoMatchResult {
  materialId: string;
  videoUrl: string;
  videoName: string;
  matchScore: number;
  matchReason: string;
}

interface VideoAIMatchResponse {
  success: boolean;
  message: string;
  matches: VideoMatchResult[];
  totalAnalyzed: number;
  processingTime: number;
}

const logRequest = (scriptText: string, videoCount: number, taskId: string) => {
  console.log(`[Video AI Match API] ${new Date().toISOString()} - AI video matching request`);
  console.log(`[Video AI Match API] Task ID: ${taskId}`);
  console.log(`[Video AI Match API] Script text length: ${scriptText.length}`);
  console.log(`[Video AI Match API] Video analysis count: ${videoCount}`);
  console.log(`[Video AI Match API] Script preview: "${scriptText.substring(0, 100)}..."`);
};

const logResponse = (success: boolean, matchCount?: number, error?: string) => {
  if (success) {
    console.log(`[Video AI Match API] ${new Date().toISOString()} - AI matching completed successfully`);
    console.log(`[Video AI Match API] Matches found: ${matchCount}`);
  } else {
    console.error(`[Video AI Match API] ${new Date().toISOString()} - AI matching failed: ${error}`);
  }
};

const formatMessages = (scriptText: string, videoAnalysisResults: VideoAnalysisResult[], segmentDuration?: number) => {
  const systemPrompt = `你是一个专业的视频内容匹配专家。你的任务是根据给定的脚本文本，从提供的视频分析结果中找出最匹配的视频，并确保视频总时长与段落语音时长接近。

请仔细分析脚本内容的主题、情感、场景和关键词，然后与视频分析结果进行匹配。同时，你需要考虑视频时长，选择合适的视频组合以匹配目标时长。

你必须返回有效的JSON格式，严格按照以下结构：
{
  "matches": [
    {
      "materialId": "视频素材ID",
      "videoUrl": "视频URL",
      "videoName": "视频名称",
      "matchScore": 0.85,
      "matchReason": "匹配原因的详细说明，包括内容匹配和时长考虑"
    }
  ]
}

匹配评分标准：
- 0.9-1.0: 完美匹配，内容高度相关且时长合适
- 0.7-0.89: 很好匹配，内容相关性强，时长基本合适
- 0.5-0.69: 一般匹配，有一定相关性，时长可接受
- 0.3-0.49: 较弱匹配，相关性较低或时长不太合适
- 0.0-0.29: 不匹配，基本无关或时长差异过大

时长匹配要求：
1. 优先选择总时长接近目标时长的视频组合
2. 可以选择多个视频片段组合以达到合适的总时长
3. 总时长应在目标时长的80%-120%范围内为最佳
4. 如果单个视频过长，可以考虑截取使用
5. 时长匹配度会影响最终评分

重要要求：
1. 只返回评分在0.5以上的匹配结果
2. 按评分从高到低排序，优先考虑时长匹配度
3. 必须返回有效的JSON格式，不要包含任何其他文本
4. matchScore必须是数字类型，保留2位小数
5. matchReason中要说明时长匹配情况`;

  const videoAnalysisText = videoAnalysisResults.map(video => {
    const analysisText = video.frameAnalyses
      .map(frame => `[${frame.timestamp.toFixed(1)}s] ${frame.analysis}`)
      .join('\n');

    return `视频: ${video.videoName} (ID: ${video.materialId})
URL: ${video.videoUrl}
时长: ${video.videoDuration.toFixed(1)}秒
帧数: ${video.totalFrames}
分析内容:
${analysisText}
---`;
  }).join('\n\n');

  const userPrompt = `请为以下脚本文本匹配最合适的视频：

脚本文本：
"${scriptText}"
${segmentDuration ? `\n目标时长：${segmentDuration.toFixed(2)}秒` : ''}

可选视频及其AI分析结果：
${videoAnalysisText}

${segmentDuration ? `
时长匹配要求：
- 请选择视频组合，使总时长尽可能接近 ${segmentDuration.toFixed(2)} 秒
- 理想范围：${(segmentDuration * 0.8).toFixed(2)} - ${(segmentDuration * 1.2).toFixed(2)} 秒
- 可以选择多个视频片段组合
- 时长匹配度将影响评分
` : ''}

请严格按照系统提示中的JSON格式返回匹配结果，不要包含任何其他文本或说明。`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];
};

export async function POST(request: NextRequest) {
  const startTime = performance.now();

  try {
    const body = await request.json();
    const { scriptText, videoAnalysisResults, taskId, segmentDuration } = body as VideoAIMatchRequest;

    if (!scriptText || typeof scriptText !== 'string' || scriptText.trim().length === 0) {
      console.error('[Video AI Match API] Invalid request: scriptText is required');
      return NextResponse.json(
        {
          success: false,
          message: 'Script text is required',
          matches: [],
          totalAnalyzed: 0,
          processingTime: 0
        },
        { status: 400 }
      );
    }

    if (!videoAnalysisResults || !Array.isArray(videoAnalysisResults) || videoAnalysisResults.length === 0) {
      console.error('[Video AI Match API] Invalid request: videoAnalysisResults is required');
      return NextResponse.json(
        {
          success: false,
          message: 'Video analysis results are required',
          matches: [],
          totalAnalyzed: 0,
          processingTime: 0
        },
        { status: 400 }
      );
    }

    if (!taskId || typeof taskId !== 'string') {
      console.error('[Video AI Match API] Invalid request: taskId is required');
      return NextResponse.json(
        {
          success: false,
          message: 'Task ID is required',
          matches: [],
          totalAnalyzed: 0,
          processingTime: 0
        },
        { status: 400 }
      );
    }

    const config = getConfig();
    logRequest(scriptText.trim(), videoAnalysisResults.length, taskId);

    const requestData = {
      model: config.model,
      messages: formatMessages(scriptText.trim(), videoAnalysisResults, segmentDuration),
      temperature: 0.3,
      max_tokens: 2000,
      response_format: { type: "json_object" },
    };

    console.log(`[Video AI Match API] Calling AI Video Match LLM API: ${config.apiUrl}/chat/completions for task: ${taskId}`);

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
      console.error(`[Video AI Match API] AI Video Match LLM API error: ${response.status} - ${errorText} for task: ${taskId}`);
      logResponse(false, undefined, `AI Video Match LLM API error: ${response.status}`);

      return NextResponse.json(
        {
          success: false,
          message: `AI Video Match LLM API error: ${response.status}`,
          matches: [],
          totalAnalyzed: videoAnalysisResults.length,
          processingTime: performance.now() - startTime
        },
        { status: response.status }
      );
    }

    const llmResponse = await response.json();
    const processingTime = performance.now() - startTime;

    let matchResults: VideoMatchResult[] = [];
    try {
      const content = llmResponse.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('No content in LLM response');
      }

      const parsedContent = JSON.parse(content);
      if (parsedContent.matches && Array.isArray(parsedContent.matches)) {
        matchResults = parsedContent.matches
          .filter((match: any) =>
            match.materialId &&
            match.videoUrl &&
            match.videoName &&
            typeof match.matchScore === 'number' &&
            match.matchScore >= 0.5
          )
          .sort((a: any, b: any) => b.matchScore - a.matchScore);
      }
    } catch (parseError) {
      console.error(`[Video AI Match API] Failed to parse AI Video Match LLM response for task: ${taskId}`, parseError);
      console.error(`[Video AI Match API] AI Video Match LLM response content:`, llmResponse.choices?.[0]?.message?.content);

      return NextResponse.json(
        {
          success: false,
          message: 'Failed to parse AI Video Match LLM response',
          matches: [],
          totalAnalyzed: videoAnalysisResults.length,
          processingTime
        },
        { status: 500 }
      );
    }

    console.log(`[Video AI Match API] AI matching completed for task: ${taskId}`);
    console.log(`[Video AI Match API] Found ${matchResults.length} matches with score >= 0.5`);
    console.log(`[Video AI Match API] Processing time: ${processingTime.toFixed(2)}ms`);

    logResponse(true, matchResults.length);

    const result: VideoAIMatchResponse = {
      success: true,
      message: `Found ${matchResults.length} matching videos`,
      matches: matchResults,
      totalAnalyzed: videoAnalysisResults.length,
      processingTime
    };

    return NextResponse.json(result);

  } catch (error) {
    const processingTime = performance.now() - startTime;
    console.error('[Video AI Match API] Request processing error:', error);
    logResponse(false, undefined, String(error));

    return NextResponse.json(
      {
        success: false,
        message: 'Internal server error',
        matches: [],
        totalAnalyzed: 0,
        processingTime
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const config = getConfig();
    return NextResponse.json({
      status: 'healthy',
      service: 'video-ai-match',
      timestamp: new Date().toISOString(),
      config: {
        apiUrl: config.apiUrl,
        model: config.model,
        hasApiKey: !!config.apiKey
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: 'unhealthy',
        service: 'video-ai-match',
        error: String(error),
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}
