/**
 * User Materials API
 * 用户素材查询API客户端
 */

/**
 * User material interface
 */
export interface UserMaterial {
  id: string;
  name: string;
  path: string;
  url: string;
  size: number;
  type: 'video' | 'audio' | 'image' | 'file';
  content_type: string;
  created_at: string;
  updated_at: string;
  thumbnail_url?: string; // 缩略图URL（视频和图片）
}

/**
 * User materials response interface
 */
export interface UserMaterialsResponse {
  success: boolean;
  materials: UserMaterial[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  message?: string;
}

/**
 * Get user's uploaded materials from Supabase
 * 获取用户上传的所有素材
 * 
 * @param userId - User ID
 * @param page - Page number (1-indexed)
 * @param pageSize - Items per page
 * @param materialType - Filter by material type (video/audio/image)
 * @returns User materials response
 */
export async function getUserMaterials(
  userId: string,
  page: number = 1,
  pageSize: number = 20,
  materialType?: 'video' | 'audio' | 'image'
): Promise<UserMaterialsResponse> {
  try {
    console.log('[User Materials API] 发送查询请求', {
      userId,
      page,
      pageSize,
      materialType
    });

    const params = new URLSearchParams({
      user_id: userId,
      page: String(page),
      page_size: String(pageSize),
    });

    if (materialType) {
      params.append('material_type', materialType);
    }

    const response = await fetch(`/api/supabase/user-materials?${params}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();

    console.log('[User Materials API] 查询响应', {
      success: result.success,
      total: result.total,
      page: result.page,
      returned: result.materials?.length || 0
    });

    return result;
  } catch (error) {
    console.error('[User Materials API] 查询失败', {
      error: error instanceof Error ? error.message : String(error),
      userId,
      page,
      pageSize
    });

    // Return error response
    return {
      success: false,
      message: `查询素材失败: ${error instanceof Error ? error.message : String(error)}`,
      materials: [],
      total: 0,
      page,
      page_size: pageSize,
      total_pages: 0
    };
  }
}

