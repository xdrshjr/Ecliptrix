import { NextRequest, NextResponse } from 'next/server';

const getConfig = () => {
  const apiUrl = process.env.LLM_API_URL || process.env.OPENAI_API_URL || 'https://api.openai.com/v1';
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  const model = process.env.LLM_MODEL || 'gpt-3.5-turbo';

  if (!apiKey) {
    throw new Error('API key not configured. Please set LLM_API_KEY or OPENAI_API_KEY in environment variables.');
  }

  return { apiUrl, apiKey, model };
};

interface OtherSegment {
  index: number;
  title: string;
  scriptText: string;
}

function detectLanguage(text: string): 'chinese' | 'english' | 'unknown' {
  if (!text || !text.trim()) return 'unknown';
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const englishChars = (text.match(/[a-zA-Z]/g) || []).length;
  if (chineseChars > 0 && chineseChars >= englishChars) return 'chinese';
  if (englishChars > 0) return 'english';
  return 'unknown';
}

function getLanguageInstruction(
  segmentText: string,
  otherSegments: OtherSegment[],
): string {
  const draftLang = detectLanguage(segmentText);
  if (draftLang === 'chinese') return '必须使用中文输出。The output MUST be in Chinese.';
  if (draftLang === 'english') return 'Must output in English. 输出必须使用英文。';

  const allOtherText = otherSegments.map(s => s.scriptText).join(' ');
  const otherLang = detectLanguage(allOtherText);
  if (otherLang === 'chinese') return '必须使用中文输出。The output MUST be in Chinese.';
  if (otherLang === 'english') return 'Must output in English. 输出必须使用英文。';

  return '必须使用中文输出。The output MUST be in Chinese.';
}

function buildExpandPrompt(
  segmentIndex: number,
  segmentTitle: string,
  segmentText: string,
  otherSegments: OtherSegment[],
  expandGoal?: string,
): string {
  const totalCount = otherSegments.length + 1;
  const hasDraft = segmentText && segmentText.trim().length > 0;
  const languageInstruction = getLanguageInstruction(segmentText, otherSegments);

  let contextSection = '';
  if (otherSegments.length > 0) {
    const contextLines = otherSegments.map(s => {
      const text = s.scriptText.length > 200 ? s.scriptText.slice(0, 200) + '…' : s.scriptText;
      return `Scene ${s.index + 1} "${s.title}": ${text}`;
    });
    contextSection = `You are working on a multi-scene video project. Below is the context of all other scenes so you understand the full narrative:\n\n${contextLines.join('\n')}\n\n---\n\n`;
  }

  const goalSection = expandGoal
    ? `\nUser's expansion goal: "${expandGoal}"\nFocus the expansion based on this goal while still following the other requirements.\n`
    : '';

  if (hasDraft) {
    return `${contextSection}Now expand the following scene (Scene ${segmentIndex + 1} of ${totalCount}: "${segmentTitle}") into a rich visual description:
${goalSection}
Draft: "${segmentText}"

Requirements:
1. Expand the draft into 2-4 sentences of vivid visual description
2. Describe characters, actions, environment, lighting, camera angles, and mood
3. Ensure this scene complements but does NOT repeat content from the other scenes listed above
4. Maintain narrative flow — this is scene ${segmentIndex + 1} of ${totalCount}
5. ${languageInstruction}
6. Output ONLY the expanded description text, no JSON, no scene title, no additional formatting`;
  }

  return `${contextSection}Create a vivid visual description for Scene ${segmentIndex + 1} of ${totalCount}, titled "${segmentTitle}".
${goalSection}
Requirements:
1. Write 2-4 sentences of vivid visual description suitable as a prompt for AI video generation
2. Describe characters, actions, environment, lighting, camera angles, and mood
3. Ensure this scene complements but does NOT repeat content from the other scenes listed above
4. Maintain narrative flow — this is scene ${segmentIndex + 1} of ${totalCount}
5. ${languageInstruction}
6. Output ONLY the scene description text, no JSON, no scene title, no additional formatting`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskId, segmentIndex, segmentTitle, segmentText, otherSegments, expandGoal } = body as {
      taskId: string;
      segmentIndex: number;
      segmentTitle: string;
      segmentText: string;
      otherSegments: OtherSegment[];
      expandGoal?: string;
    };

    if (!taskId || typeof taskId !== 'string') {
      return NextResponse.json({ error: 'Task ID is required' }, { status: 400 });
    }

    const config = getConfig();

    console.log(`[AI Script Expand API] ${new Date().toISOString()} - Expanding scene ${segmentIndex + 1} for task: ${taskId}${expandGoal ? ` with goal: "${expandGoal}"` : ''}`);

    const response = await fetch(`${config.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: 'system',
            content: 'You are an expert AI video script writer. You expand brief scene notes into vivid, detailed visual descriptions optimized for AI video generation. Always respond with ONLY the expanded description text. CRITICAL: You MUST output in the same language as the input text.'
          },
          {
            role: 'user',
            content: buildExpandPrompt(segmentIndex, segmentTitle, segmentText, otherSegments || [], expandGoal || '')
          }
        ],
        temperature: 0.7,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[AI Script Expand API] LLM API error: ${response.status} - ${errorText}`);
      return NextResponse.json({ error: `LLM API error: ${response.status}` }, { status: response.status });
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;

    if (!content) {
      return NextResponse.json({ error: 'No content received from LLM' }, { status: 500 });
    }

    const expandedText = content.trim();

    console.log(`[AI Script Expand API] Expanded scene ${segmentIndex + 1} for task: ${taskId} (${segmentText.length} → ${expandedText.length} chars)`);

    return NextResponse.json({
      success: true,
      expandedText,
    });
  } catch (error) {
    console.error('[AI Script Expand API] Request processing error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
