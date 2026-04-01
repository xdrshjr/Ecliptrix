import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

// GET all settings categories
export async function GET(request: NextRequest) {
  try {
    const authorization = request.headers.get('authorization') || '';
    const response = await fetch(`${BACKEND_URL}/api/system-settings/categories`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authorization,
      },
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[API] Error fetching settings categories:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch settings categories', categories: [] },
      { status: 500 }
    );
  }
}
