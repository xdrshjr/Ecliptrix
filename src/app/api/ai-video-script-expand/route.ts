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

function buildExpandPrompt(
  segmentIndex: number,
  segmentTitle: string,
  segmentText: string,
  otherSegments: OtherSegment[],
): string {
  const totalCount = otherSegments.length + 1;

  let contextSection = '';
  if (otherSegments.length > 0) {
    const contextLines = otherSegments.map(s => {
      const text = s.scriptText.length > 200 ? s.scriptText.slice(0, 200) + '…' : s.scriptText;
      return `Scene ${s.index + 1} "${s.title}": ${text}`;
    });
    contextSection = `You are working on a multi-scene video project. Below is the context of all other scenes so you understand the full narrative:\n\n${contextLines.join('\n')}\n\n---\n\n`;
  }

  return `${contextSection}Now expand the following scene (Scene ${segmentIndex + 1} of ${totalCount}: "${segmentTitle}") into a rich visual description:

Draft: "${segmentText}"

Requirements:
1. Expand the draft into 2-4 sentences of vivid visual description
2. Describe characters, actions, environment, lighting, camera angles, and mood
3. Ensure this scene complements but does NOT repeat content from the other scenes listed above
4. Maintain narrative flow — this is scene ${segmentIndex + 1} of ${totalCount}
5. Keep the same language as the draft text
6. Output ONLY the expanded description text, no JSON, no scene title, no additional formatting`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskId, segmentIndex, segmentTitle, segmentText, otherSegments } = body as {
      taskId: string;
      segmentIndex: number;
      segmentTitle: string;
      segmentText: string;
      otherSegments: OtherSegment[];
    };

    if (!taskId || typeof taskId !== 'string') {
      return NextResponse.json({ error: 'Task ID is required' }, { status: 400 });
    }

    if (!segmentText || typeof segmentText !== 'string' || !segmentText.trim()) {
      return NextResponse.json({ error: 'Segment text is required' }, { status: 400 });
    }

    const config = getConfig();

    console.log(`[AI Script Expand API] ${new Date().toISOString()} - Expanding scene ${segmentIndex + 1} for task: ${taskId}`);

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
            content: 'You are an expert AI video script writer. You expand brief scene notes into vivid, detailed visual descriptions optimized for AI video generation. Always respond with ONLY the expanded description text.'
          },
          {
            role: 'user',
            content: buildExpandPrompt(segmentIndex, segmentTitle, segmentText, otherSegments || [])
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
