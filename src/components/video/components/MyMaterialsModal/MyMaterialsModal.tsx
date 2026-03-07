'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { getUserMaterials, UserMaterial } from '@/lib/api/userMaterials';
import { useAuth } from '@/contexts/AuthContext';
import { useLocale } from '@/contexts/LocaleContext';
import { VideoEditingLogger } from '../../utils/logger';

interface MyMaterialsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddMaterials: (materials: UserMaterial[]) => void;
  taskId: string;
}

const MyMaterialsModal: React.FC<MyMaterialsModalProps> = ({
  isOpen,
  onClose,
  onAddMaterials,
  taskId
}) => {
  const { user } = useAuth();
  const { t } = useLocale();
  const [logger] = useState(() => new VideoEditingLogger({ taskId, component: 'MyMaterialsModal' }));

  const [materials, setMaterials] = useState<UserMaterial[]>([]);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<'all' | 'video' | 'audio' | 'image'>('all');

  const pageSize = 20;

  // Load materials
  const loadMaterials = useCallback(async () => {
    if (!user?.id) {
      logger.error('用户未登录，无法加载素材', {});
      return;
    }

    setIsLoading(true);
    setError(null);

    logger.info('加载用户素材', {
      userId: user.id,
      page,
      pageSize,
      filterType
    });

    try {
      const response = await getUserMaterials(
        user.id,
        page,
        pageSize,
        filterType === 'all' ? undefined : filterType
      );

      if (response.success) {
        setMaterials(response.materials);
        setTotal(response.total);
        setTotalPages(response.total_pages);

        logger.info('素材加载成功', {
          total: response.total,
          page: response.page,
          loaded: response.materials.length
        });
      } else {
        setError(response.message || '加载素材失败');
        logger.error('素材加载失败', {
          error: response.message
        });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
      logger.error('素材加载异常', {
        error: errorMsg
      });
    } finally {
      setIsLoading(false);
    }
  }, [user, page, pageSize, filterType, logger]);

  // Load materials when modal opens or page/filter changes
  useEffect(() => {
    if (isOpen) {
      loadMaterials();
    }
  }, [isOpen, loadMaterials]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedMaterialIds(new Set());
      setPage(1);
      setFilterType('all');
      setError(null);
    }
  }, [isOpen]);

  // Handle material selection
  const handleMaterialClick = useCallback((material: UserMaterial) => {
    setSelectedMaterialIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(material.id)) {
        newSet.delete(material.id);
        logger.userAction('取消选择素材', 'materialDeselect', {
          materialId: material.id,
          materialName: material.name
        });
      } else {
        newSet.add(material.id);
        logger.userAction('选择素材', 'materialSelect', {
          materialId: material.id,
          materialName: material.name
        });
      }
      return newSet;
    });
  }, [logger]);

  // Handle select all
  const handleSelectAll = useCallback(() => {
    if (selectedMaterialIds.size === materials.length) {
      // Deselect all
      setSelectedMaterialIds(new Set());
      logger.userAction('取消全选素材', 'deselectAll', {
        count: materials.length
      });
    } else {
      // Select all
      setSelectedMaterialIds(new Set(materials.map(m => m.id)));
      logger.userAction('全选素材', 'selectAll', {
        count: materials.length
      });
    }
  }, [materials, selectedMaterialIds.size, logger]);

  // Handle add to materials panel
  const handleAddToPanel = useCallback(() => {
    const selectedMaterials = materials.filter(m => selectedMaterialIds.has(m.id));

    logger.userAction('添加素材到素材管理', 'addToPanel', {
      count: selectedMaterials.length,
      materialIds: selectedMaterials.map(m => m.id)
    });

    onAddMaterials(selectedMaterials);
    onClose();
  }, [materials, selectedMaterialIds, onAddMaterials, onClose, logger]);

  // Handle page change
  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage);
    logger.userAction('切换页码', 'pageChange', {
      fromPage: page,
      toPage: newPage
    });
  }, [page, logger]);

  // Handle filter change
  const handleFilterChange = useCallback((type: 'all' | 'video' | 'audio' | 'image') => {
    setFilterType(type);
    setPage(1); // Reset to first page
    setSelectedMaterialIds(new Set()); // Clear selection
    logger.userAction('切换素材类型筛选', 'filterChange', {
      fromType: filterType,
      toType: type
    });
  }, [filterType, logger]);

  // Format file size
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  // Format date
  const formatDate = (dateString: string): string => {
    try {
      const date = new Date(dateString);
      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateString;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[1100] p-4">
      <div className="bg-card rounded-md border border-border w-full max-w-6xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-8 py-6 border-b border-border flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-foreground">{t.materialsPanel.myMaterials}</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {t.materialsPanel.myMaterialsDescription}
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-md bg-muted hover:bg-accent flex items-center justify-center transition-colors"
              aria-label="Close"
            >
              <svg className="w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="px-8 py-4 border-b border-border flex-shrink-0">
          <div className="flex space-x-2">
            {(['all', 'video', 'audio', 'image'] as const).map((type) => (
              <button
                key={type}
                onClick={() => handleFilterChange(type)}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  filterType === type
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-accent'
                }`}
              >
                {type === 'all' ? t.materialsPanel.filterAll :
                 type === 'video' ? t.materialsPanel.filterVideo :
                 type === 'audio' ? t.materialsPanel.filterAudio :
                 t.materialsPanel.filterImage}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <svg className="w-12 h-12 text-primary animate-spin mx-auto" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <p className="text-muted-foreground mt-4">{t.materialsPanel.loadingMaterials}</p>
              </div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <svg className="w-12 h-12 text-destructive mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-foreground font-medium mt-4">{t.materialsPanel.loadError}</p>
                <p className="text-muted-foreground mt-2">{error}</p>
                <button
                  onClick={loadMaterials}
                  className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
                >
                  {t.materialsPanel.retry}
                </button>
              </div>
            </div>
          ) : materials.length === 0 ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <svg className="w-12 h-12 text-muted-foreground mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                </svg>
                <p className="text-muted-foreground mt-4">{t.materialsPanel.noMaterialsFound}</p>
              </div>
            </div>
          ) : (
            <>
              {/* Select All Button */}
              <div className="mb-4 flex items-center justify-between">
                <button
                  onClick={handleSelectAll}
                  className="text-sm text-primary hover:text-primary/80 font-medium"
                >
                  {selectedMaterialIds.size === materials.length
                    ? t.materialsPanel.deselectAll
                    : t.materialsPanel.selectAll}
                </button>
                <span className="text-sm text-muted-foreground">
                  {t.materialsPanel.selectedCount.replace('{count}', String(selectedMaterialIds.size))}
                </span>
              </div>

              {/* Materials Grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {materials.map((material) => {
                  const isSelected = selectedMaterialIds.has(material.id);
                  return (
                    <div
                      key={material.id}
                      onClick={() => handleMaterialClick(material)}
                      className={`relative rounded-md overflow-hidden cursor-pointer transition-colors border-2 ${
                        isSelected
                          ? 'border-primary scale-[1.02]'
                          : 'border-border hover:border-primary/30'
                      }`}
                    >
                      {/* Preview */}
                      <div className="aspect-video bg-muted flex items-center justify-center relative">
                        {material.type === 'video' ? (
                          material.thumbnail_url ? (
                            <img
                              src={material.thumbnail_url}
                              alt={material.name}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                // Fallback to video element if thumbnail fails to load
                                const target = e.target as HTMLImageElement;
                                target.style.display = 'none';
                                const video = document.createElement('video');
                                video.src = material.url;
                                video.className = 'w-full h-full object-cover';
                                video.muted = true;
                                video.playsInline = true;
                                target.parentElement?.appendChild(video);
                              }}
                            />
                          ) : (
                            <video
                              src={material.url}
                              className="w-full h-full object-cover"
                              muted
                              playsInline
                            />
                          )
                        ) : material.type === 'image' ? (
                          <img
                            src={material.thumbnail_url || material.url}
                            alt={material.name}
                            className="w-full h-full object-cover"
                          />
                        ) : material.type === 'audio' ? (
                          <svg className="w-12 h-12 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                          </svg>
                        ) : (
                          <svg className="w-12 h-12 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                        )}

                        {/* Selection Indicator */}
                        <div className={`absolute top-2 right-2 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                          isSelected
                            ? 'bg-primary border-primary'
                            : 'bg-card border-border'
                        }`}>
                          {isSelected && (
                            <svg className="w-4 h-4 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>

                        {/* Type Badge */}
                        <div className="absolute top-2 left-2">
                          <span className={`px-2 py-1 text-xs font-medium rounded ${
                            material.type === 'video' ? 'bg-primary/10 text-primary' :
                            material.type === 'audio' ? 'bg-accent text-accent-foreground' :
                            material.type === 'image' ? 'bg-secondary text-secondary-foreground' :
                            'bg-muted text-foreground'
                          }`}>
                            {material.type === 'video' ? t.materialsPanel.typeVideo :
                             material.type === 'audio' ? t.materialsPanel.typeAudio :
                             material.type === 'image' ? t.materialsPanel.typeImage :
                             'File'}
                          </span>
                        </div>
                      </div>

                      {/* Info */}
                      <div className="p-3 bg-card">
                        <p className="text-sm font-medium text-foreground truncate" title={material.name}>
                          {material.name}
                        </p>
                        <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                          <span>{formatFileSize(material.size)}</span>
                          <span>{formatDate(material.created_at)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="mt-8 flex items-center justify-center space-x-2">
                  <button
                    onClick={() => handlePageChange(page - 1)}
                    disabled={page === 1}
                    className="px-3 py-2 rounded-md border border-border text-foreground hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>

                  {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                    let pageNum: number;
                    if (totalPages <= 7) {
                      pageNum = i + 1;
                    } else if (page <= 4) {
                      pageNum = i + 1;
                    } else if (page >= totalPages - 3) {
                      pageNum = totalPages - 6 + i;
                    } else {
                      pageNum = page - 3 + i;
                    }

                    return (
                      <button
                        key={pageNum}
                        onClick={() => handlePageChange(pageNum)}
                        className={`px-4 py-2 rounded-md ${
                          page === pageNum
                            ? 'bg-primary text-primary-foreground'
                            : 'border border-border text-foreground hover:bg-accent'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}

                  <button
                    onClick={() => handlePageChange(page + 1)}
                    disabled={page === totalPages}
                    className="px-3 py-2 rounded-md border border-border text-foreground hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-8 py-6 border-t border-border flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {t.materialsPanel.totalMaterials.replace('{count}', String(total))}
            </div>
            <div className="flex space-x-3">
              <button
                onClick={onClose}
                className="px-6 py-2.5 border border-border text-secondary-foreground bg-secondary rounded-md hover:bg-accent font-medium transition-colors"
              >
                {t.common.cancel}
              </button>
              <button
                onClick={handleAddToPanel}
                disabled={selectedMaterialIds.size === 0}
                className="px-6 py-2.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
              >
                {t.materialsPanel.addToMaterialManagement} ({selectedMaterialIds.size})
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MyMaterialsModal;

