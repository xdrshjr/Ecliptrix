import { NextRequest, NextResponse } from 'next/server';
import { detectIntent } from '@/lib/intent-detection-service';

/**
 * 用户意图检测API
 * 调用共享的意图检测服务来检测用户意图，判断是否需要调用工作流
 */

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
    
    console.log('[Intent Detection API] 调用意图检测服务:', {
      messagePreview: user_message.substring(0, 100) + '...',
      messageLength: user_message.length,
      workflowsCount: enabled_workflows.length,
      workflows: enabled_workflows.map((wf: any) => wf.workflow_name).join(', '),
      hasHistory: !!conversation_history,
      historyLength: conversation_history?.length || 0
    });
    
    // 调用共享的意图检测服务
    const result = await detectIntent(
      user_message,
      enabled_workflows,
      conversation_history
    );
    
    console.log('[Intent Detection API] 意图检测服务响应:', {
      success: result.success,
      shouldCallWorkflow: result.data?.should_call_workflow || false,
      workflowName: result.data?.workflow_name || null,
      confidence: result.data?.confidence || 0,
      reasoning: result.data?.reasoning || '',
      error: result.error || null
    });
    
    // 如果检测失败，返回相应的HTTP状态码
    if (!result.success) {
      return NextResponse.json(result, { status: 500 });
    }
    
    return NextResponse.json(result);
    
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

