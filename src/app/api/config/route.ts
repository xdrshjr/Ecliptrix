import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/config
 * 
 * Proxy endpoint to fetch configuration from the backend service
 * Returns application configuration including YouTube settings
 */
export async function GET(request: NextRequest) {
  try {
    // Get the backend service URL from environment or use default
    const backendUrl = process.env.BACKEND_SERVICE_URL || 'http://localhost:8000';
    
    // Forward the request to the backend service
    const response = await fetch(`${backendUrl}/api/config`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      // Add timeout to prevent hanging requests
      signal: AbortSignal.timeout(10000), // 10 seconds timeout
    });

    if (!response.ok) {
      console.error(`Backend config request failed: ${response.status} ${response.statusText}`);
      return NextResponse.json(
        {
          success: false,
          message: 'Failed to fetch configuration from backend service',
          error: `Backend service returned ${response.status}: ${response.statusText}`,
        },
        { status: response.status }
      );
    }

    const data = await response.json();

    // Log successful configuration fetch (without sensitive data)
    console.log('Configuration fetched successfully from backend service');

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching configuration:', error);

    // Handle different types of errors
    let errorMessage = 'Internal server error';
    let statusCode = 500;

    if (error instanceof TypeError && error.message.includes('fetch')) {
      errorMessage = 'Unable to connect to backend service';
      statusCode = 503; // Service Unavailable
    } else if (error instanceof Error && error.name === 'AbortError') {
      errorMessage = 'Request timeout - backend service did not respond in time';
      statusCode = 504; // Gateway Timeout
    }

    return NextResponse.json(
      {
        success: false,
        message: 'Failed to fetch configuration',
        error: errorMessage,
      },
      { status: statusCode }
    );
  }
} 