/**
 * User Materials API
 * 用户素材查询API客户端
 */

import { ApiError, http } from '@/lib/api/http-client';

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
 * Get user's uploaded materials from storage
 * 获取用户上传的所有素材
 *
 * Preserves the legacy "always returns a UserMaterialsResponse" contract
 * (failures yield `success:false` with an empty materials array) so the
 * existing material gallery UI does not need to add try/catch.
 */
export async function getUserMaterials(
  userId: string,
  page: number = 1,
  pageSize: number = 20,
  materialType?: 'video' | 'audio' | 'image'
): Promise<UserMaterialsResponse> {
  const params = new URLSearchParams({
    user_id: userId,
    page: String(page),
    page_size: String(pageSize),
  });

  if (materialType) {
    params.append('material_type', materialType);
  }

  try {
    return await http.get<UserMaterialsResponse>(
      `/api/storage/user-materials?${params}`,
    );
  } catch (error) {
    // Map any wrapper error to the legacy envelope so callers can keep
    // rendering an empty grid instead of crashing.
    const message =
      error instanceof ApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    return {
      success: false,
      message: `查询素材失败: ${message}`,
      materials: [],
      total: 0,
      page,
      page_size: pageSize,
      total_pages: 0,
    };
  }
}
