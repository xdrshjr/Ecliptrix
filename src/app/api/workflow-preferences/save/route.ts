import { NextRequest, NextResponse } from 'next/server';

const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://localhost:8000';

export async function POST(request: NextRequest) {
  try {
    console.log('[API] POST /api/workflow-preferences/save - Saving workflow preferences');

    const body = await request.json();
    const { userId, preferences } = body;

    console.log('[API] Request body:', {
      userId,
      preferencesCount: Object.keys(preferences || {}).length,
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

    if (!preferences || typeof preferences !== 'object') {
      console.log('[API] Invalid preferences data');
      return NextResponse.json(
        {
          success: false,
          message: 'Preferences must be a valid object'
        },
        { status: 400 }
      );
    }

    // Forward request to Python backend
    const backendUrl = `${PYTHON_BACKEND_URL}/api/workflow-preferences/save`;
    console.log('[API] Forwarding to Python backend:', backendUrl);

    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: userId,
        preferences: preferences
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
          message: errorData.message || 'Failed to save workflow preferences'
        },
        { status: response.status }
      );
    }

    const result = await response.json();
    console.log('[API] Workflow preferences saved successfully:', {
      userId,
      savedCount: result.saved_count,
      timestamp: new Date().toISOString()
    });

    return NextResponse.json({
      success: true,
      message: result.message || 'Workflow preferences saved successfully',
      savedCount: result.saved_count,
      timestamp: result.timestamp
    });

  } catch (error) {
    console.error('[API] Error saving workflow preferences:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'Internal server error'
      },
      { status: 500 }
    );
  }
}

