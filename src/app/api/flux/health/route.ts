import { NextResponse } from 'next/server';

const BACKEND_BASE_URL = process.env.BACKEND_URL || 'http://localhost:8000';

export async function GET() {
  try {
    // Forward the request to the backend service
    const response = await fetch(`${BACKEND_BASE_URL}/api/flux/health`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    
    return NextResponse.json(data, { 
      status: response.status,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  } catch (error) {
    console.error('FLUX health check proxy error:', error);
    return NextResponse.json(
      { 
        status: 'unhealthy', 
        message: 'Backend service unavailable',
        error: String(error)
      },
      { status: 503 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}