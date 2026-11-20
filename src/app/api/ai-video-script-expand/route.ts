import { NextRequest, NextResponse } from 'next/server';

import { streamLlmChat } from '@/lib/llm/streamLlmChat';
import { resolveScriptConfig, ScriptLlmError, scriptFailure } from '@/lib/llm/scriptConfig';

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

    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(55_000)]);
    const config = await resolveScriptConfig(signal);

    console.log(`[AI Script Expand API] ${new Date().toISOString()} - Expanding scene ${segmentIndex + 1} for task: ${taskId}${expandGoal ? ` with goal: "${expandGoal}"` : ''}`);

    let content = '';
    for await (const event of streamLlmChat({
      config, signal, temperature: 0.7, maxTokens: 500,
      messages: [
        { role: 'system', content: 'Expand scene notes into visual descriptions. Output only the description, in the same language as the input.' },
        { role: 'user', content: buildExpandPrompt(segmentIndex, segmentTitle, segmentText, otherSegments || [], expandGoal || '') },
      ],
    })) {
      if (event.kind === 'error') throw new ScriptLlmError(event.code ?? 'LLM_UPSTREAM_ERROR', event.status >= 400 && event.status <= 599 ? event.status : 502);
      if (event.kind === 'content') content += event.text;
    }
    if (!content.trim()) throw new ScriptLlmError('LLM_EMPTY_OUTPUT', 502);

    const expandedText = content.trim();

    console.log(`[AI Script Expand API] Expanded scene ${segmentIndex + 1} for task: ${taskId} (${(segmentText ?? "").length} → ${expandedText.length} chars)`);

    return NextResponse.json({
      success: true,
      expandedText,
    });
  } catch (error) {
    return NextResponse.json(scriptFailure(error), { status: error instanceof ScriptLlmError ? error.status : 502 });
  }
}
