import { NextRequest, NextResponse } from 'next/server';

const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://localhost:8000';

export async function POST(request: NextRequest) {
  try {
    console.log('[API] POST /api/workflow-preferences/load - Loading workflow preferences');

    const body = await request.json();
    const { userId } = body;

    console.log('[API] Request body:', {
      userId,
      timestamp: new Date().toISOString()
    });

    // Validate request
    if (!userId) {
      console.log('[API] Missing required field: userId');
      return NextResponse.json(
        {
          success: false,
          message: 'User ID is required'
        },
        { status: 400 }
      );
    }

    // Forward request to Python backend
    const backendUrl = `${PYTHON_BACKEND_URL}/api/workflow-preferences/load`;
    console.log('[API] Forwarding to Python backend:', backendUrl);

    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: userId
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('[API] Backend error:', {
        status: response.status,
        error: errorData
      });
      return NextResponse.json(
        {
          success: false,
          message: errorData.message || 'Failed to load workflow preferences'
        },
        { status: response.status }
      );
    }

    const result = await response.json();
    console.log('[API] Workflow preferences loaded successfully:', {
      userId,
      preferencesCount: Object.keys(result.preferences || {}).length,
      timestamp: new Date().toISOString()
    });

    return NextResponse.json({
      success: true,
      message: result.message || 'Workflow preferences loaded successfully',
      preferences: result.preferences || {},
      timestamp: result.timestamp
    });

  } catch (error) {
    console.error('[API] Error loading workflow preferences:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'Internal server error'
      },
      { status: 500 }
    );
  }
}

