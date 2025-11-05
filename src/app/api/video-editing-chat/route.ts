import { NextRequest, NextResponse } from 'next/server';
import { ChatMessage } from '@/types';

// 工作流配置接口
interface WorkflowConfig {
  workflowId: string;
  workflowName: string;
  enabled: boolean;
  toolDescription: string;
}

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

// 转换消息格式，添加视频编辑系统提示
const formatMessages = (messages: ChatMessage[]) => {
  // 添加系统提示，指导 AI 作为视频编辑助手
  const systemMessage = {
    role: 'system',
    content: `你是一个专业的视频编辑 AI 助手。你的任务是帮助用户进行视频编辑相关的工作，包括：

1. 脚本编写与优化：帮助用户创作和改进视频脚本
2. 创意建议：提供视频创意、拍摄角度、剪辑手法等建议
3. 技术指导：解答视频剪辑、特效、转场等技术问题
4. 素材推荐：根据脚本内容推荐合适的视频素材、音乐、图片等
5. 时间轴规划：帮助用户规划视频时间轴和节奏
6. 文案润色：优化视频文案、字幕、标题等文本内容

请保持专业、友好、简洁的沟通风格，提供实用的建议和具体的操作步骤。`
  };

  // 将系统消息和用户消息组合
  return [
    systemMessage,
    ...messages.map(msg => ({
      role: msg.role,
      content: msg.content,
    }))
  ];
};

// 日志记录函数
const logRequest = (taskId: string, messages: ChatMessage[], config: any) => {
  console.log(`[Video Editing Chat API] ${new Date().toISOString()} - 收到视频编辑聊天请求`);
  console.log(`[Video Editing Chat API] Task ID: ${taskId}`);
  console.log(`[Video Editing Chat API] Model: ${config.model}`);
  console.log(`[Video Editing Chat API] Messages count: ${messages.length}`);
  if (messages.length > 0) {
    const lastMessage = messages[messages.length - 1];
    console.log(`[Video Editing Chat API] Last message role: ${lastMessage.role}`);
    console.log(`[Video Editing Chat API] Last message preview: ${lastMessage.content.slice(0, 100)}${lastMessage.content.length > 100 ? '...' : ''}`);
  }
};

const logResponse = (taskId: string, success: boolean, error?: string) => {
  if (success) {
    console.log(`[Video Editing Chat API] ${new Date().toISOString()} - Task ${taskId} 响应成功完成`);
  } else {
    console.error(`[Video Editing Chat API] ${new Date().toISOString()} - Task ${taskId} 响应失败: ${error}`);
  }
};

export async function POST(request: NextRequest) {
  let taskId = 'unknown';
  
  try {
    const body = await request.json();
    const { 
      taskId: reqTaskId, 
      messages, 
      workflowConfigs 
    } = body as { 
      taskId: string; 
      messages: ChatMessage[]; 
      workflowConfigs?: WorkflowConfig[];
    };
    taskId = reqTaskId || 'unknown';

    // 验证请求参数
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      console.error(`[Video Editing Chat API] Task ${taskId} - 无效请求：需要 messages 数组`);
      return NextResponse.json(
        { error: 'Messages array is required' },
        { status: 400 }
      );
    }

    const config = getConfig();
    logRequest(taskId, messages, config);
    
    // 步骤1: 如果有启用的工作流，先进行意图检测（使用Fast LLM）
    let workflowIntention: any = null;
    if (workflowConfigs && workflowConfigs.length > 0) {
      const enabledWorkflows = workflowConfigs.filter(wf => wf.enabled);
      
      if (enabledWorkflows.length > 0) {
        console.log(`[Video Editing Chat API] Task ${taskId} - 检测到 ${enabledWorkflows.length} 个启用的工作流，准备调用Fast LLM进行意图检测`);
        console.log(`[Video Editing Chat API] Task ${taskId} - 启用的工作流:`, enabledWorkflows.map(wf => wf.workflowName).join(', '));
        
        try {
          // 获取最后一条用户消息
          const lastUserMessage = messages.filter(m => m.role === 'user').pop();
          if (lastUserMessage) {
            console.log(`[Video Editing Chat API] Task ${taskId} - 开始调用意图检测API，用户消息: ${lastUserMessage.content.substring(0, 100)}...`);
            
            const intentResponse = await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/intent-detection`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                user_message: lastUserMessage.content,
                enabled_workflows: enabledWorkflows.map(wf => ({
                  workflow_id: wf.workflowId,
                  workflow_name: wf.workflowName,
                  tool_description: wf.toolDescription,
                  enabled: wf.enabled
                })),
                conversation_history: messages.slice(-5).map(m => ({ role: m.role, content: m.content }))
              }),
            });
            
            console.log(`[Video Editing Chat API] Task ${taskId} - 意图检测API响应状态: ${intentResponse.status}`);
            
            if (intentResponse.ok) {
              const intentData = await intentResponse.json();
              console.log(`[Video Editing Chat API] Task ${taskId} - 意图检测API返回数据:`, {
                success: intentData.success,
                hasData: !!intentData.data,
                error: intentData.error
              });
              
              if (intentData.success && intentData.data) {
                workflowIntention = intentData.data;
                console.log(`[Video Editing Chat API] Task ${taskId} - Fast LLM意图检测成功:`, {
                  shouldCallWorkflow: workflowIntention.should_call_workflow,
                  workflowName: workflowIntention.workflow_name,
                  confidence: workflowIntention.confidence,
                  reasoning: workflowIntention.reasoning
                });
              } else if (!intentData.success) {
                console.error(`[Video Editing Chat API] Task ${taskId} - Fast LLM意图检测失败: ${intentData.error || 'Unknown error'}`);
              }
            } else {
              const errorText = await intentResponse.text();
              console.error(`[Video Editing Chat API] Task ${taskId} - 意图检测API调用失败 (${intentResponse.status}): ${errorText}`);
            }
          } else {
            console.warn(`[Video Editing Chat API] Task ${taskId} - 未找到用户消息，跳过意图检测`);
          }
        } catch (intentError) {
          console.error(`[Video Editing Chat API] Task ${taskId} - 意图检测异常:`, intentError);
          console.error(`[Video Editing Chat API] Task ${taskId} - 意图检测错误详情:`, {
            message: intentError instanceof Error ? intentError.message : String(intentError),
            stack: intentError instanceof Error ? intentError.stack : undefined
          });
          // 继续正常聊天流程
        }
      } else {
        console.log(`[Video Editing Chat API] Task ${taskId} - 没有启用的工作流，跳过意图检测`);
      }
    } else {
      console.log(`[Video Editing Chat API] Task ${taskId} - 未提供工作流配置，跳过意图检测`);
    }

    // 创建流式响应
    const encoder = new TextEncoder();
    
    // 如果检测到需要调用工作流，直接返回意图信息，不调用LLM
    if (workflowIntention && workflowIntention.should_call_workflow) {
      console.log(`[Video Editing Chat API] Task ${taskId} - 检测到需要调用工作流，跳过普通LLM回复`);
      
      const stream = new ReadableStream({
        start(controller) {
          try {
            console.log(`[Video Editing Chat API] Task ${taskId} - 发送工作流意图信息并结束`);
            
            // 发送流建立信号
            controller.enqueue(encoder.encode(`: stream-start\n\n`));
            
            // 发送工作流意图信息
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ 
                type: 'workflow_intention',
                intention: workflowIntention 
              })}\n\n`)
            );
            
            // 发送完成信号
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
            
            logResponse(taskId, true);
            controller.close();
          } catch (error) {
            console.error(`[Video Editing Chat API] Task ${taskId} - 发送工作流意图错误:`, error);
            logResponse(taskId, false, String(error));
            controller.error(error);
          }
        }
      });
      
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
          'X-Content-Type-Options': 'nosniff',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // 准备请求数据（只在不需要调用工作流时执行）
    const requestData = {
      model: config.model,
      messages: formatMessages(messages),
      stream: true,
      temperature: 0.7,
      max_tokens: 2000,
    };

    console.log(`[Video Editing Chat API] Task ${taskId} - 调用 LLM API: ${config.apiUrl}/chat/completions`);

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
      console.error(`[Video Editing Chat API] Task ${taskId} - LLM API 错误: ${response.status} - ${errorText}`);
      logResponse(taskId, false, `LLM API error: ${response.status}`);
      
      return NextResponse.json(
        { error: `LLM API error: ${response.status}`, details: errorText },
        { status: response.status }
      );
    }

    // 创建流式响应（普通对话模式）
    const stream = new ReadableStream({
      async start(controller) {
        try {
          console.log(`[Video Editing Chat API] Task ${taskId} - 开始初始化流式传输连接`);
          
          // 立即发送一个初始注释以建立流连接，防止代理服务器缓冲
          // 这对于生产环境中的 nginx/Apache 等反向代理至关重要
          controller.enqueue(encoder.encode(`: stream-start\n\n`));
          console.log(`[Video Editing Chat API] Task ${taskId} - 已发送流建立信号`);
          
          // 如果有工作流意图但不需要调用（普通对话），也发送意图信息
          if (workflowIntention && !workflowIntention.should_call_workflow) {
            console.log(`[Video Editing Chat API] Task ${taskId} - 发送普通对话意图信息`);
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ 
                type: 'workflow_intention',
                intention: workflowIntention 
              })}\n\n`)
            );
          }
          
          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error('No reader available from LLM API');
          }

          let buffer = '';
          let totalChunks = 0;
          let lastChunkTime = Date.now();
          const startTime = Date.now();
          
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              const totalTime = Date.now() - startTime;
              console.log(`[Video Editing Chat API] Task ${taskId} - 流式传输完成，总计 ${totalChunks} 个数据块，耗时 ${totalTime}ms，平均 ${totalChunks > 0 ? Math.round(totalTime / totalChunks) : 0}ms/块`);
              break;
            }

            buffer += new TextDecoder().decode(value);
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmedLine = line.trim();
              if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue;

              const data = trimmedLine.slice(6);
              if (data === '[DONE]') {
                controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
                console.log(`[Video Editing Chat API] Task ${taskId} - 收到完成信号 [DONE]`);
                continue;
              }

              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content;
                
                if (content) {
                  totalChunks++;
                  const currentTime = Date.now();
                  const timeSinceLastChunk = currentTime - lastChunkTime;
                  lastChunkTime = currentTime;
                  
                  const responseData = { content };
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify(responseData)}\n\n`)
                  );
                  
                  // 每10个数据块记录一次详细日志，避免日志过多
                  if (totalChunks % 10 === 0 || totalChunks <= 3) {
                    console.log(`[Video Editing Chat API] Task ${taskId} - 已发送第 ${totalChunks} 个数据块 (间隔 ${timeSinceLastChunk}ms, 内容长度: ${content.length})`);
                  }
                }
              } catch (e) {
                console.error(`[Video Editing Chat API] Task ${taskId} - SSE 数据解析错误:`, e);
              }
            }
          }

          logResponse(taskId, true);
          controller.close();
        } catch (error) {
          console.error(`[Video Editing Chat API] Task ${taskId} - 流式传输错误:`, error);
          logResponse(taskId, false, String(error));
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        // SSE 标准头
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        
        // 防止反向代理（如 nginx）缓冲响应 - 这是生产环境流式传输的关键
        'X-Accel-Buffering': 'no',
        
        // 安全头
        'X-Content-Type-Options': 'nosniff',
        
        // CORS 头
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });

  } catch (error) {
    console.error(`[Video Editing Chat API] Task ${taskId} - 意外错误:`, error);
    logResponse(taskId, false, String(error));
    
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
