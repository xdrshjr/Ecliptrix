import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

// PUT update a provider credential
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ providerId: string }> }
) {
  try {
    const { providerId } = await params;
    const body = await request.json();
    const response = await fetch(`${BACKEND_URL}/api/model-settings/providers/${providerId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[API] Error updating provider:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to update provider' },
      { status: 500 }
    );
  }
}

// DELETE a provider
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ providerId: string }> }
) {
  try {
    const { providerId } = await params;
    const response = await fetch(`${BACKEND_URL}/api/model-settings/providers/${providerId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[API] Error deleting provider:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to delete provider' },
      { status: 500 }
    );
  }
}
