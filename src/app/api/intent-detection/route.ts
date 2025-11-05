import { NextRequest, NextResponse } from 'next/server';

/**
 * 用户意图检测API
 * 调用后端服务检测用户意图，判断是否需要调用工作流
 */

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

export async function POST(request: NextRequest) {
  try {
    console.log('[Intent Detection API] 收到Fast LLM意图检测请求');
    
    const body = await request.json();
    const { user_message, enabled_workflows, conversation_history } = body;
    
    // 验证请求参数
    if (!user_message) {
      console.error('[Intent Detection API] 缺少user_message参数');
      return NextResponse.json(
        { success: false, error: 'user_message is required' },
        { status: 400 }
      );
    }
    
    if (!enabled_workflows || !Array.isArray(enabled_workflows)) {
      console.error('[Intent Detection API] 缺少或无效的enabled_workflows参数');
      return NextResponse.json(
        { success: false, error: 'enabled_workflows array is required' },
        { status: 400 }
      );
    }
    
    console.log('[Intent Detection API] 转发到Python后端进行Fast LLM意图检测:', {
      messagePreview: user_message.substring(0, 100) + '...',
      messageLength: user_message.length,
      workflowsCount: enabled_workflows.length,
      workflows: enabled_workflows.map((wf: any) => wf.workflow_name).join(', '),
      hasHistory: !!conversation_history,
      historyLength: conversation_history?.length || 0,
      backendUrl: BACKEND_URL
    });
    
    // 调用后端服务
    const backendResponse = await fetch(`${BACKEND_URL}/api/intent-detection/detect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_message,
        enabled_workflows,
        conversation_history: conversation_history || null
      }),
    });
    
    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      console.error('[Intent Detection API] Python后端Fast LLM调用失败:', {
        status: backendResponse.status,
        error: errorText
      });
      return NextResponse.json(
        { 
          success: false, 
          error: `Backend Fast LLM error: ${backendResponse.status}`,
          details: errorText 
        },
        { status: backendResponse.status }
      );
    }
    
    const data = await backendResponse.json();
    
    console.log('[Intent Detection API] Python后端Fast LLM响应:', {
      success: data.success,
      shouldCallWorkflow: data.data?.should_call_workflow || false,
      workflowName: data.data?.workflow_name || null,
      confidence: data.data?.confidence || 0,
      reasoning: data.data?.reasoning || '',
      error: data.error || null
    });
    
    return NextResponse.json(data);
    
  } catch (error) {
    console.error('[Intent Detection API] Error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

