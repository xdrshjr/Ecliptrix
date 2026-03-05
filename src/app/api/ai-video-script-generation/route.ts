import { NextRequest, NextResponse } from 'next/server';
import { ScriptGenerationConfig, ChatMessage } from '@/types';

const getConfig = () => {
  const apiUrl = process.env.LLM_API_URL || process.env.OPENAI_API_URL || 'https://api.openai.com/v1';
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  const model = process.env.LLM_MODEL || 'gpt-3.5-turbo';

  if (!apiKey) {
    throw new Error('API key not configured. Please set LLM_API_KEY or OPENAI_API_KEY in environment variables.');
  }

  return { apiUrl, apiKey, model };
};

const buildAIVideoScriptPrompt = (chatMessages?: ChatMessage[], scriptConfig?: ScriptGenerationConfig) => {
  const config = scriptConfig || {
    language: 'chinese',
    consistency: 'moderate',
    segmentCount: 5,
    customRequirements: ''
  };

  let languageInstruction = '';
  switch (config.language) {
    case 'chinese':
      languageInstruction = 'Generate the script in Chinese. Use vivid, descriptive Chinese suitable for AI video generation prompts.';
      break;
    case 'english':
      languageInstruction = 'Generate the script in English. Use vivid, descriptive English suitable for AI video generation prompts.';
      break;
    case 'mixed':
      languageInstruction = 'Generate the script in a mix of Chinese and English as appropriate. Use vivid, descriptive language suitable for AI video generation prompts.';
      break;
  }

  let consistencyInstruction = '';
  switch (config.consistency) {
    case 'high':
      consistencyInstruction = 'Stay very close to the original conversation content. Preserve the exact topics and details discussed.';
      break;
    case 'moderate':
      consistencyInstruction = 'Adapt the conversation content for visual storytelling while keeping the core message and themes.';
      break;
    case 'low':
      consistencyInstruction = 'Freely reinterpret the conversation for maximum visual impact. Focus on creating compelling video scenes.';
      break;
  }

  const customInstructions = config.customRequirements ? `\nAdditional requirements: ${config.customRequirements}` : '';

  let contentSection = '';
  if (chatMessages && chatMessages.length > 0) {
    // Limit to last 30 messages and cap total content at 8000 chars to stay within LLM context
    const recentMessages = chatMessages.slice(-30);
    let chatContent = recentMessages
      .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n\n');
    if (chatContent.length > 8000) {
      chatContent = chatContent.slice(-8000);
    }
    contentSection = `Chat Conversation:\n${chatContent}\n\nAnalyze the chat conversation above and create AI video generation scenes based on the key points discussed.`;
  }

  return `You are an expert AI video script writer. Based on the following conversation content, create a series of video scene descriptions optimized for AI video generation.

${contentSection}

Requirements:
1. Create exactly ${config.segmentCount} scenes
2. Each scene needs a short descriptive title and a detailed script text
3. The script text for each scene should be a vivid visual description suitable as a prompt for AI video generation (describe what should appear in the video: characters, actions, environments, lighting, camera angles, mood)
4. ${languageInstruction}
5. ${consistencyInstruction}${customInstructions}

Return the result as a JSON object with this exact structure:
{
  "segments": [
    {
      "title": "Scene title describing the scene",
      "scriptText": "Detailed visual description for AI video generation. Describe the scene, characters, actions, environment, lighting, and mood."
    }
  ]
}

Important:
- Return ONLY the JSON object, no additional text
- Each scriptText should be 2-4 sentences of vivid visual description
- Titles should be concise (under 20 characters)
- Focus on visual elements that AI video generation can render well`;
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskId, scriptConfig, chatMessages } = body as {
      taskId: string;
      scriptConfig?: ScriptGenerationConfig;
      chatMessages?: ChatMessage[];
    };

    const hasChatMessages = chatMessages && Array.isArray(chatMessages) && chatMessages.length > 0;
    if (!hasChatMessages) {
      return NextResponse.json(
        { error: 'Chat messages are required for AI video script generation' },
        { status: 400 }
      );
    }

    if (chatMessages.length > 100) {
      return NextResponse.json(
        { error: 'Too many messages. Maximum 100 allowed.' },
        { status: 400 }
      );
    }

    if (!taskId || typeof taskId !== 'string') {
      return NextResponse.json(
        { error: 'Task ID is required' },
        { status: 400 }
      );
    }

    const config = getConfig();

    console.log(`[AI Video Script Generation API] ${new Date().toISOString()} - Request for task: ${taskId}, messages: ${chatMessages.length}`);

    const requestData = {
      model: config.model,
      messages: [
        {
          role: 'system',
          content: 'You are an expert AI video script writer. You create vivid scene descriptions for AI video generation. You always return valid JSON responses exactly as requested.'
        },
        {
          role: 'user',
          content: buildAIVideoScriptPrompt(chatMessages, scriptConfig)
        }
      ],
      temperature: 0.7,
      max_tokens: 3000,
    };

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
      console.error(`[AI Video Script Generation API] LLM API error: ${response.status} - ${errorText}`);
      return NextResponse.json(
        { error: `LLM API error: ${response.status}` },
        { status: response.status }
      );
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;

    if (!content) {
      return NextResponse.json(
        { error: 'No content received from LLM' },
        { status: 500 }
      );
    }

    let scriptData;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const jsonString = jsonMatch ? jsonMatch[0] : content;
      scriptData = JSON.parse(jsonString);
    } catch {
      console.error(`[AI Video Script Generation API] Failed to parse JSON for task: ${taskId}`);
      return NextResponse.json(
        { error: 'Failed to parse script data from LLM response' },
        { status: 500 }
      );
    }

    if (!scriptData.segments || !Array.isArray(scriptData.segments)) {
      return NextResponse.json(
        { error: 'Invalid script format received' },
        { status: 500 }
      );
    }

    // Validate and normalize segments
    const segments = scriptData.segments.map((seg: { title?: string; scriptText?: string }, index: number) => ({
      title: seg.title || `Scene ${index + 1}`,
      scriptText: seg.scriptText || '',
    }));

    console.log(`[AI Video Script Generation API] Generated ${segments.length} scenes for task: ${taskId}`);

    return NextResponse.json({
      success: true,
      segments,
      metadata: {
        segmentCount: segments.length,
        generatedAt: new Date().toISOString(),
        taskId
      }
    });

  } catch (error) {
    console.error('[AI Video Script Generation API] Request processing error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
