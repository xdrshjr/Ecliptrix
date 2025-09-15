import { NextRequest, NextResponse } from 'next/server';

interface VideoUnderstandingScriptRequest {
  selectedVideos: Array<{
    id: string;
    name: string;
    type: string;
    url?: string;
    thumbnailUrl?: string;
    duration?: number;
  }>;
  referenceText: string;
  parameters: {
    language: 'chinese' | 'english' | 'mixed';
    segmentCount: number;
    analysisDepth: 'basic' | 'detailed' | 'comprehensive';
    includeVisualElements: boolean;
    includeAudioAnalysis: boolean;
  };
  taskId: string;
}

interface ScriptSegment {
  id: string;
  title: string;
  sentences: Array<{
    id: string;
    text: string;
  }>;
  duration?: number;
  videos?: Array<{
    id: string;
    name: string;
    type: string;
    url?: string;
    thumbnailUrl?: string;
  }>;
  keywords?: string[];
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const body: VideoUnderstandingScriptRequest = await request.json();
    const { selectedVideos, referenceText, parameters, taskId } = body;

    // 日志记录请求开始
    console.log('[VideoUnderstandingScript] 请求开始', {
      taskId,
      timestamp: new Date().toISOString(),
      videoCount: selectedVideos.length,
      referenceTextLength: referenceText.length,
      parameters,
      requestId: `req_${Date.now()}`
    });

    // 验证请求参数
    if (!selectedVideos || selectedVideos.length === 0) {
      console.warn('[VideoUnderstandingScript] 请求参数验证失败', {
        taskId,
        error: '未选择视频',
        timestamp: new Date().toISOString()
      });
      
      return NextResponse.json(
        { 
          success: false, 
          error: '请至少选择一个视频' 
        },
        { status: 400 }
      );
    }

    if (!parameters || typeof parameters.segmentCount !== 'number') {
      console.warn('[VideoUnderstandingScript] 请求参数验证失败', {
        taskId,
        error: '参数配置不正确',
        timestamp: new Date().toISOString()
      });
      
      return NextResponse.json(
        { 
          success: false, 
          error: '参数配置不正确' 
        },
        { status: 400 }
      );
    }

    // Mock 视频分析和脚本生成
    // 在实际实现中，这里会调用AI服务进行视频内容分析
    const analysisResults = await mockVideoAnalysis(selectedVideos, parameters);
    
    console.log('[VideoUnderstandingScript] 视频分析完成', {
      taskId,
      analysisResultsCount: analysisResults.length,
      timestamp: new Date().toISOString()
    });

    // 基于分析结果生成脚本段落
    const scriptSegments = await generateScriptFromAnalysis(
      analysisResults,
      referenceText,
      parameters,
      selectedVideos
    );

    console.log('[VideoUnderstandingScript] 脚本生成完成', {
      taskId,
      generatedSegmentCount: scriptSegments.length,
      totalDuration: scriptSegments.reduce((acc, seg) => acc + (seg.duration || 0), 0),
      processingTimeMs: Date.now() - startTime,
      timestamp: new Date().toISOString()
    });

    return NextResponse.json({
      success: true,
      segments: scriptSegments,
      metadata: {
        processedVideoCount: selectedVideos.length,
        generatedSegmentCount: scriptSegments.length,
        processingTimeMs: Date.now() - startTime,
        analysisDepth: parameters.analysisDepth,
        language: parameters.language
      }
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    
    console.error('[VideoUnderstandingScript] 处理失败', {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      processingTimeMs: Date.now() - startTime,
      timestamp: new Date().toISOString()
    });

    return NextResponse.json(
      {
        success: false,
        error: `视频理解生成脚本失败: ${errorMessage}`
      },
      { status: 500 }
    );
  }
}

// Mock 视频分析函数
async function mockVideoAnalysis(
  videos: VideoUnderstandingScriptRequest['selectedVideos'],
  parameters: VideoUnderstandingScriptRequest['parameters']
): Promise<Array<{
  videoId: string;
  videoName: string;
  visualElements: string[];
  audioElements: string[];
  keyTopics: string[];
  estimatedDuration: number;
}>> {
  // 模拟分析延迟
  await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

  return videos.map(video => ({
    videoId: video.id,
    videoName: video.name,
    visualElements: parameters.includeVisualElements ? [
      '精美的画面构图',
      '丰富的色彩层次',
      '流畅的镜头运动',
      '专业的光影处理'
    ] : [],
    audioElements: parameters.includeAudioAnalysis ? [
      '清晰的语音表达',
      '恰当的背景音乐',
      '专业的音效设计',
      '良好的音频质量'
    ] : [],
    keyTopics: [
      '创意表达',
      '视觉呈现',
      '内容传达',
      '技术实现'
    ],
    estimatedDuration: video.duration || (15 + Math.random() * 10)
  }));
}

// 基于分析结果生成脚本
async function generateScriptFromAnalysis(
  analysisResults: Array<{
    videoId: string;
    videoName: string;
    visualElements: string[];
    audioElements: string[];
    keyTopics: string[];
    estimatedDuration: number;
  }>,
  referenceText: string,
  parameters: VideoUnderstandingScriptRequest['parameters'],
  selectedVideos: VideoUnderstandingScriptRequest['selectedVideos']
): Promise<ScriptSegment[]> {
  const segments: ScriptSegment[] = [];
  
  // 根据参数决定脚本段落数量
  const segmentCount = Math.min(parameters.segmentCount, analysisResults.length * 2);
  
  for (let i = 0; i < segmentCount; i++) {
    const analysisIndex = i % analysisResults.length;
    const analysis = analysisResults[analysisIndex];
    const video = selectedVideos.find(v => v.id === analysis.videoId);
    
    const segmentId = `video-understanding-${Date.now()}-${i}`;
    
    // 生成段落标题
    const title = generateSegmentTitle(analysis, i, parameters.language);
    
    // 生成句子内容
    const sentences = generateSegmentSentences(
      analysis,
      referenceText,
      parameters,
      segmentId,
      i
    );
    
    // 生成关键词
    const keywords = generateSegmentKeywords(analysis, parameters);
    
    segments.push({
      id: segmentId,
      title,
      sentences,
      duration: analysis.estimatedDuration,
      videos: video ? [video] : [],
      keywords
    });
  }
  
  return segments;
}

function generateSegmentTitle(
  analysis: { videoName: string; keyTopics: string[] },
  index: number,
  language: 'chinese' | 'english' | 'mixed'
): string {
  const chineseTitles = [
    `${analysis.videoName} - 精彩片段 ${index + 1}`,
    `视频内容解析 ${index + 1}`,
    `创意表现 ${index + 1}`,
    `视觉呈现 ${index + 1}`,
    `核心内容 ${index + 1}`
  ];
  
  const englishTitles = [
    `${analysis.videoName} - Highlight ${index + 1}`,
    `Video Analysis ${index + 1}`,
    `Creative Expression ${index + 1}`,
    `Visual Presentation ${index + 1}`,
    `Core Content ${index + 1}`
  ];
  
  if (language === 'english') {
    return englishTitles[index % englishTitles.length];
  } else if (language === 'mixed') {
    return index % 2 === 0 
      ? chineseTitles[index % chineseTitles.length]
      : englishTitles[index % englishTitles.length];
  } else {
    return chineseTitles[index % chineseTitles.length];
  }
}

function generateSegmentSentences(
  analysis: {
    videoName: string;
    visualElements: string[];
    audioElements: string[];
    keyTopics: string[];
  },
  referenceText: string,
  parameters: VideoUnderstandingScriptRequest['parameters'],
  segmentId: string,
  index: number
): Array<{ id: string; text: string }> {
  const sentences: Array<{ id: string; text: string }> = [];
  
  // 第一句：基于视频分析的主要内容
  const mainContent = generateMainContentSentence(analysis, referenceText, parameters, index);
  sentences.push({
    id: `${segmentId}-sentence-1`,
    text: mainContent
  });
  
  // 第二句：详细描述或补充信息
  const detailContent = generateDetailSentence(analysis, parameters, index);
  sentences.push({
    id: `${segmentId}-sentence-2`,
    text: detailContent
  });
  
  // 如果是深度分析，添加第三句
  if (parameters.analysisDepth === 'comprehensive') {
    const comprehensiveContent = generateComprehensiveSentence(analysis, parameters);
    sentences.push({
      id: `${segmentId}-sentence-3`,
      text: comprehensiveContent
    });
  }
  
  return sentences;
}

function generateMainContentSentence(
  analysis: {
    videoName: string;
    visualElements: string[];
    audioElements: string[];
    keyTopics: string[];
  },
  referenceText: string,
  parameters: VideoUnderstandingScriptRequest['parameters'],
  index: number
): string {
  const baseTemplates = [
    `这段视频展现了${analysis.keyTopics[0] || '精彩内容'}`,
    `通过对视频的深度分析，我们可以看到${analysis.keyTopics[1] || '独特的表现'}`,
    `视频中的${analysis.keyTopics[2] || '核心元素'}体现了创作者的用心`,
    `从整体表现来看，这个视频在${analysis.keyTopics[0] || '各个方面'}都有出色的呈现`
  ];
  
  let sentence = baseTemplates[index % baseTemplates.length];
  
  // 添加视觉元素描述
  if (parameters.includeVisualElements && analysis.visualElements.length > 0) {
    sentence += `，${analysis.visualElements[0]}`;
  }
  
  // 添加音频元素描述
  if (parameters.includeAudioAnalysis && analysis.audioElements.length > 0) {
    sentence += `，配合${analysis.audioElements[0]}`;
  }
  
  // 结合参考文本
  if (referenceText.length > 0) {
    sentence += `，符合预期的创作理念`;
  }
  
  return sentence + '。';
}

function generateDetailSentence(
  analysis: {
    visualElements: string[];
    audioElements: string[];
    keyTopics: string[];
  },
  parameters: VideoUnderstandingScriptRequest['parameters'],
  index: number
): string {
  const detailTemplates = [
    '整体制作水准体现了专业性',
    '创意表达富有层次感',
    '技术实现达到了预期效果',
    '内容呈现具有很强的感染力'
  ];
  
  let sentence = detailTemplates[index % detailTemplates.length];
  
  // 添加具体的视觉或音频细节
  if (parameters.includeVisualElements && analysis.visualElements.length > 1) {
    sentence += `，特别是${analysis.visualElements[1]}的运用`;
  }
  
  if (parameters.includeAudioAnalysis && analysis.audioElements.length > 1) {
    sentence += `，${analysis.audioElements[1]}为整体效果加分不少`;
  }
  
  return sentence + '。';
}

function generateComprehensiveSentence(
  analysis: {
    keyTopics: string[];
    visualElements: string[];
    audioElements: string[];
  },
  parameters: VideoUnderstandingScriptRequest['parameters']
): string {
  const comprehensiveTemplates = [
    '从综合角度来看，这个视频在创意构思、技术实现和艺术表现等方面都达到了较高水准',
    '整体而言，视频成功地将创意理念转化为了具体的视觉呈现',
    '通过多维度的分析可以看出，这个作品在各个层面都体现了制作团队的专业水准',
    '综合评价显示，该视频在内容表达和技术呈现上都具有很强的完成度'
  ];
  
  return comprehensiveTemplates[Math.floor(Math.random() * comprehensiveTemplates.length)] + '。';
}

function generateSegmentKeywords(
  analysis: {
    keyTopics: string[];
    visualElements: string[];
    audioElements: string[];
  },
  parameters: VideoUnderstandingScriptRequest['parameters']
): string[] {
  const keywords = [...analysis.keyTopics];
  
  if (parameters.includeVisualElements) {
    keywords.push('视觉设计', '画面构图', '色彩运用');
  }
  
  if (parameters.includeAudioAnalysis) {
    keywords.push('音频设计', '声音效果', '音乐配置');
  }
  
  // 根据分析深度添加更多关键词
  if (parameters.analysisDepth === 'detailed') {
    keywords.push('创意表达', '技术实现');
  } else if (parameters.analysisDepth === 'comprehensive') {
    keywords.push('创意表达', '技术实现', '艺术呈现', '用户体验');
  }
  
  return keywords.slice(0, 8); // 限制关键词数量
} 