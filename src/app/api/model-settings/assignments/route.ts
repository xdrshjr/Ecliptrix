import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

// GET all feature model assignments
export async function GET() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/model-settings/assignments`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[API] Error fetching assignments:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch assignments', assignments: [] },
      { status: 500 }
    );
  }
}

// PUT save/update a feature model assignment
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const response = await fetch(`${BACKEND_URL}/api/model-settings/assignments`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[API] Error saving assignment:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to save assignment' },
      { status: 500 }
    );
  }
}
