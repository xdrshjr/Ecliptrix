import { useState, useCallback, useMemo } from 'react';
import { MaterialItem, MaterialType } from '@/types';
import { UseMaterialManagementReturn } from '../types';
import { VideoEditingLogger } from '../utils';

/**
 * useMaterialManagement Hook
 * 管理素材库操作
 * 
 * @param taskId - 任务ID，用于日志记录
 * @returns 素材管理相关的状态和方法
 */
export const useMaterialManagement = (taskId: string): UseMaterialManagementReturn => {
  // 初始化日志器
  const logger = useMemo(() => new VideoEditingLogger({
    taskId,
    component: 'useMaterialManagement'
  }), [taskId]);

  // 素材管理状态
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [selectedMaterialType, setSelectedMaterialType] = useState<MaterialType | 'all'>('all');
  const [selectedMaterials, setSelectedMaterials] = useState<Set<string>>(new Set());
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // 处理素材类型筛选
  const handleMaterialTypeFilter = useCallback((type: MaterialType | 'all') => {
    logger.userAction('素材类型筛选', 'filterTabs', {
      previousType: selectedMaterialType,
      newType: type,
      materialCount: materials.filter(material => type === 'all' || material.type === type).length
    });
    
    setSelectedMaterialType(type);
    
    // 清除当前选中的素材（因为筛选后可能不可见）
    setSelectedMaterials(new Set());
  }, [selectedMaterialType, materials, logger]);

  // 处理素材选择/取消选择
  const handleMaterialSelect = useCallback((materialId: string, isSelected: boolean) => {
    const material = materials.find(m => m.id === materialId);
    
    logger.userAction('素材选择变更', 'materialCard', {
      materialId,
      materialName: material?.name,
      materialType: material?.type,
      isSelected,
      previousSelectionCount: selectedMaterials.size
    });

    const newSelection = new Set(selectedMaterials);
    if (isSelected) {
      newSelection.add(materialId);
    } else {
      newSelection.delete(materialId);
    }
    
    setSelectedMaterials(newSelection);
    
    logger.info('素材选择状态更新', {
      newSelectionCount: newSelection.size,
      selectedIds: Array.from(newSelection),
      selectionChange: isSelected ? 'added' : 'removed'
    });
  }, [selectedMaterials, materials, logger]);

  // 处理全选/取消全选
  const handleSelectAll = useCallback(() => {
    const filteredMaterials = selectedMaterialType === 'all' 
      ? materials 
      : materials.filter((material: MaterialItem) => material.type === selectedMaterialType);
    
    const isAllSelected = filteredMaterials.every(material => selectedMaterials.has(material.id));
    
    logger.userAction('全选操作', 'selectAllButton', {
      isAllSelected,
      filteredCount: filteredMaterials.length,
      previousSelectionCount: selectedMaterials.size,
      filterType: selectedMaterialType
    });

    if (isAllSelected) {
      // 取消选择当前筛选的所有素材
      const newSelection = new Set(selectedMaterials);
      filteredMaterials.forEach(material => newSelection.delete(material.id));
      setSelectedMaterials(newSelection);
    } else {
      // 选择当前筛选的所有素材
      const newSelection = new Set(selectedMaterials);
      filteredMaterials.forEach(material => newSelection.add(material.id));
      setSelectedMaterials(newSelection);
    }
  }, [selectedMaterialType, selectedMaterials, materials, logger]);

  // 处理素材播放/预览
  const handleMaterialPlay = useCallback((material: MaterialItem) => {
    logger.userAction('素材播放/预览', 'playButton', {
      materialId: material.id,
      materialName: material.name,
      materialType: material.type,
      materialFormat: material.format,
      materialSize: material.size,
      materialDuration: material.duration
    });

    // Mock播放功能 - 显示提示
    const actionText = material.type === 'image' ? '预览' : '播放';
    alert(`${actionText}素材: ${material.name}\n类型: ${material.type}\n格式: ${material.format}\n大小: ${(material.size / 1024 / 1024).toFixed(2)}MB`);
  }, [logger]);

  // 处理素材下载
  const handleMaterialDownload = useCallback((material: MaterialItem) => {
    logger.userAction('素材下载', 'downloadButton', {
      materialId: material.id,
      materialName: material.name,
      materialType: material.type,
      materialUrl: material.url,
      materialSize: material.size
    });

    // Mock下载功能 - 显示提示
    alert(`下载素材: ${material.name}\nURL: ${material.url}\n大小: ${(material.size / 1024 / 1024).toFixed(2)}MB`);
  }, [logger]);

  // 处理素材删除
  const handleMaterialDelete = useCallback((materialIds: string[]) => {
    const materialNames = materialIds.map(id => {
      const material = materials.find((m: MaterialItem) => m.id === id);
      return material ? material.name : id;
    });

    logger.userAction('素材删除请求', 'deleteButton', {
      materialIds,
      materialNames,
      deleteCount: materialIds.length
    });

    const confirmDelete = confirm(`确认删除以下素材吗？\n${materialNames.join('\n')}`);
    
    if (confirmDelete) {
      // 从素材库中移除
      setMaterials(prevMaterials => 
        prevMaterials.filter(material => !materialIds.includes(material.id))
      );
      
      // 清除选中状态
      const newSelection = new Set(selectedMaterials);
      materialIds.forEach(id => newSelection.delete(id));
      setSelectedMaterials(newSelection);
      
      logger.info('素材删除确认', {
        deletedIds: materialIds,
        deletedNames: materialNames,
        remainingMaterialCount: materials.length - materialIds.length,
        remainingSelectionCount: newSelection.size
      });
      
      alert(`已删除 ${materialIds.length} 个素材`);
    } else {
      logger.info('素材删除取消', {
        cancelledIds: materialIds
      });
    }
  }, [selectedMaterials, materials, logger]);

  // 处理素材上传
  const handleMaterialUpload = useCallback(() => {
    logger.userAction('素材上传触发', 'uploadButton');

    if (isUploading) {
      logger.warn('上传正在进行中，忽略新的上传请求', {
        currentProgress: uploadProgress
      });
      return;
    }

    // Mock上传功能 - 模拟文件选择和上传过程
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'video/*,audio/*,image/*';
    
    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement)?.files;
      if (!files || files.length === 0) return;

      logger.info('开始模拟上传', {
        fileCount: files.length,
        fileNames: Array.from(files).map(f => f.name),
        totalSize: Array.from(files).reduce((sum, f) => sum + f.size, 0)
      });

      setIsUploading(true);
      setUploadProgress(0);

      // 模拟上传进度
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          const newProgress = prev + Math.random() * 20;
          if (newProgress >= 100) {
            clearInterval(progressInterval);
            setIsUploading(false);
            setUploadProgress(0);
            
            // 创建模拟的素材项目
            const newMaterials: MaterialItem[] = Array.from(files).map((file, index) => {
              const type: MaterialType = file.type.startsWith('video/') ? 'video' :
                                       file.type.startsWith('audio/') ? 'audio' : 'image';
              return {
                id: `uploaded-${Date.now()}-${index}`,
                name: file.name,
                type,
                format: file.name.split('.').pop() || 'unknown',
                size: file.size,
                duration: type === 'video' ? Math.floor(Math.random() * 300) + 30 : undefined,
                width: type !== 'audio' ? Math.floor(Math.random() * 1000) + 500 : undefined,
                height: type !== 'audio' ? Math.floor(Math.random() * 1000) + 500 : undefined,
                thumbnailUrl: undefined,
                url: URL.createObjectURL(file),
                createdAt: new Date(),
                tags: ['用户上传'],
                description: `用户上传的${type === 'video' ? '视频' : type === 'audio' ? '音频' : '图片'}文件`
              };
            });

            // 添加到素材库
            setMaterials(prevMaterials => [...prevMaterials, ...newMaterials]);
            
            logger.info('模拟上传完成', {
              fileCount: files.length,
              newMaterialIds: newMaterials.map(m => m.id),
              totalMaterialCount: materials.length + newMaterials.length
            });
            
            alert(`成功上传 ${files.length} 个文件`);
            return 100;
          }
          return newProgress;
        });
      }, 200);
    };

    input.click();
  }, [isUploading, uploadProgress, materials.length, logger]);

  // Add materials function for external use (e.g., from video search)
  const addMaterials = useCallback((newMaterials: MaterialItem[]) => {
    logger.info('接收到新素材添加请求', {
      receivedCount: newMaterials.length,
      currentMaterialsCount: materials.length,
      receivedMaterials: newMaterials.map(m => ({
        id: m.id,
        name: m.name,
        type: m.type,
        hasUrl: !!m.url
      }))
    });

    const existingIds = new Set(materials.map(m => m.id));
    const uniqueNewMaterials = newMaterials.filter(material => !existingIds.has(material.id));

    logger.info('素材去重处理完成', {
      originalCount: newMaterials.length,
      uniqueCount: uniqueNewMaterials.length,
      duplicateCount: newMaterials.length - uniqueNewMaterials.length,
      existingIds: Array.from(existingIds),
      uniqueMaterialIds: uniqueNewMaterials.map(m => m.id)
    });

    if (uniqueNewMaterials.length > 0) {
      setMaterials(prevMaterials => {
        const updatedMaterials = [...prevMaterials, ...uniqueNewMaterials];
        logger.info('素材状态更新', {
          previousCount: prevMaterials.length,
          newCount: updatedMaterials.length,
          addedMaterials: uniqueNewMaterials.map(m => ({
            id: m.id,
            name: m.name
          }))
        });
        return updatedMaterials;
      });
      
      logger.info('新素材成功添加到库中', {
        addedCount: uniqueNewMaterials.length,
        skippedCount: newMaterials.length - uniqueNewMaterials.length,
        newMaterialIds: uniqueNewMaterials.map(m => m.id),
        totalMaterialsAfterAdd: materials.length + uniqueNewMaterials.length
      });
    } else {
      logger.warn('没有新素材被添加', {
        reason: 'all_materials_already_exist',
        attemptedCount: newMaterials.length
      });
    }

    return uniqueNewMaterials.length;
  }, [materials, logger]);

  return {
    materials,
    selectedMaterialType,
    selectedMaterials,
    isUploading,
    uploadProgress,
    handleMaterialTypeFilter,
    handleMaterialSelect,
    handleSelectAll,
    handleMaterialPlay,
    handleMaterialDownload,
    handleMaterialDelete,
    handleMaterialUpload,
    addMaterials
  };
};