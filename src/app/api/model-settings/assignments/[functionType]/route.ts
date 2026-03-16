import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

// DELETE a feature assignment (revert to env defaults)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ functionType: string }> }
) {
  try {
    const { functionType } = await params;
    const response = await fetch(
      `${BACKEND_URL}/api/model-settings/assignments/${functionType}`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[API] Error deleting assignment:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to delete assignment' },
      { status: 500 }
    );
  }
}
