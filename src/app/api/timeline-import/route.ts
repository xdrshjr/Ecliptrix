import { NextRequest, NextResponse } from 'next/server';

// 获取后端服务配置
const getBackendConfig = () => {
  const backendUrl = process.env.BACKEND_SERVICE_URL || 'http://localhost:8000';
  return { backendUrl };
};

// 日志记录函数
const logRequest = (taskId: string, fileSize: number, mergeMode: string) => {
  console.log(`[Timeline Import API] ${new Date().toISOString()} - Incoming timeline import request`);
  console.log(`[Timeline Import API] Task ID: ${taskId}`);
  console.log(`[Timeline Import API] File size: ${fileSize} bytes`);
  console.log(`[Timeline Import API] Merge mode: ${mergeMode}`);
};

const logResponse = (success: boolean, error?: string, statistics?: any) => {
  if (success) {
    console.log(`[Timeline Import API] ${new Date().toISOString()} - Import completed successfully`);
    if (statistics) {
      console.log(`[Timeline Import API] Import statistics:`, statistics);
    }
  } else {
    console.error(`[Timeline Import API] ${new Date().toISOString()} - Import failed: ${error}`);
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskId, fileContent, fileName, mergeMode = 'replace', preserveIds = true } = body;

    // 验证必需参数
    if (!taskId || typeof taskId !== 'string') {
      console.error('[Timeline Import API] Invalid request: taskId is required');
      return NextResponse.json(
        { error: 'Task ID is required' },
        { status: 400 }
      );
    }

    if (!fileContent || typeof fileContent !== 'string') {
      console.error('[Timeline Import API] Invalid request: fileContent is required');
      return NextResponse.json(
        { error: 'File content is required' },
        { status: 400 }
      );
    }

    // 验证合并模式
    if (!['replace', 'append'].includes(mergeMode)) {
      console.error('[Timeline Import API] Invalid merge mode:', mergeMode);
      return NextResponse.json(
        { error: 'Merge mode must be either "replace" or "append"' },
        { status: 400 }
      );
    }

    const config = getBackendConfig();
    logRequest(taskId, fileContent.length, mergeMode);

    // 准备发送给后端的请求数据
    const requestData = {
      taskId: taskId,
      fileContent: fileContent,
      fileName: fileName,
      mergeMode: mergeMode,
      preserveIds: preserveIds
    };

    console.log(`[Timeline Import API] Calling backend: ${config.backendUrl}/api/timeline/import/upload`);

    // 调用后端API
    const response = await fetch(`${config.backendUrl}/api/timeline/import/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Timeline Import API] Backend error: ${response.status} - ${errorText}`);
      logResponse(false, `Backend error: ${response.status}`);
      
      // 尝试解析错误响应
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch (e) {
        errorData = { message: errorText };
      }
      
      return NextResponse.json(
        { 
          error: `Backend service error: ${response.status}`,
          details: errorData 
        },
        { status: response.status }
      );
    }

    const result = await response.json();

    // 验证后端响应
    if (!result.success) {
      console.error('[Timeline Import API] Backend returned failure:', result.message);
      logResponse(false, result.message);
      
      return NextResponse.json(
        { 
          error: result.message || 'Import failed',
          validationResult: result.validation_result || result.validationResult,
          details: result.details 
        },
        { status: 400 }
      );
    }

    logResponse(true, undefined, result.statistics);

    // 返回成功响应，保持字段命名一致性
    return NextResponse.json({
      success: true,
      message: result.message || 'Timeline imported successfully',
      validationResult: result.validation_result || result.validationResult,
      importedData: result.imported_data || result.importedData,
      statistics: result.statistics,
      data: result.data
    });

  } catch (error) {
    console.error('[Timeline Import API] Request processing error:', error);
    logResponse(false, String(error));
    
    // 检查是否是JSON解析错误
    if (error instanceof SyntaxError && error.message.includes('JSON')) {
      return NextResponse.json(
        { error: 'Invalid JSON format in request body' },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// 添加文件验证端点
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskId, fileContent, fileName } = body;

    // 验证必需参数
    if (!taskId || typeof taskId !== 'string') {
      console.error('[Timeline Import Validation API] Invalid request: taskId is required');
      return NextResponse.json(
        { error: 'Task ID is required' },
        { status: 400 }
      );
    }

    if (!fileContent || typeof fileContent !== 'string') {
      console.error('[Timeline Import Validation API] Invalid request: fileContent is required');
      return NextResponse.json(
        { error: 'File content is required' },
        { status: 400 }
      );
    }

    const config = getBackendConfig();
    console.log(`[Timeline Import Validation API] ${new Date().toISOString()} - Validating import file`);
    console.log(`[Timeline Import Validation API] Task ID: ${taskId}`);
    console.log(`[Timeline Import Validation API] File name: ${fileName}`);
    console.log(`[Timeline Import Validation API] File size: ${fileContent.length} bytes`);

    // 准备发送给后端的请求数据
    const requestData = {
      taskId: taskId,
      fileContent: fileContent,
      fileName: fileName,
      mergeMode: 'replace', // 验证时使用默认值
      preserveIds: true
    };

    console.log(`[Timeline Import Validation API] Calling backend: ${config.backendUrl}/api/timeline/validate`);

    // 调用后端验证API
    const response = await fetch(`${config.backendUrl}/api/timeline/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Timeline Import Validation API] Backend error: ${response.status} - ${errorText}`);
      
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch (e) {
        errorData = { message: errorText };
      }
      
      return NextResponse.json(
        { 
          error: `Validation service error: ${response.status}`,
          details: errorData 
        },
        { status: response.status }
      );
    }

    const result = await response.json();

    console.log(`[Timeline Import Validation API] ${new Date().toISOString()} - Validation completed`);
    console.log(`[Timeline Import Validation API] Validation result:`, result.validation_result);

    // 返回验证结果
    return NextResponse.json({
      success: result.success,
      message: result.message || 'File validation completed',
      validationResult: result.validation_result || result.validationResult
    });

  } catch (error) {
    console.error('[Timeline Import Validation API] Request processing error:', error);
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}