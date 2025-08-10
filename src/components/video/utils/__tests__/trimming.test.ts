/**
 * 测试视频裁剪功能
 */

import { VideoSequenceItem } from '../../types/videoEditingTypes';
import { TimelineItem, TimelineState, Track } from '@/types';

describe('Video Trimming Functionality', () => {
  describe('Time mapping calculations', () => {
    test('should correctly map timeline time to actual video time with trimming', () => {
      // 模拟一个裁剪的视频序列
      const sequence: VideoSequenceItem = {
        id: 'test-video-1',
        name: 'Test Video',
        url: 'https://example.com/video.mp4',
        startTime: 0,
        duration: 5, // timeline上5秒
        trackId: 'video-track-1',
        clipStart: 10, // 原始视频从10秒开始
        clipEnd: 20,   // 原始视频到20秒结束（原始10秒内容）
        originalDuration: 30 // 原始视频30秒
      };

      // 计算时间映射
      const timelineRelativeTime = 2.5; // timeline上的2.5秒位置
      const clipDuration = sequence.clipEnd! - sequence.clipStart!; // 10秒
      const actualVideoTime = sequence.clipStart! + (timelineRelativeTime * clipDuration / sequence.duration);
      
      // 期望: 10 + (2.5 * 10 / 5) = 10 + 5 = 15秒
      expect(actualVideoTime).toBe(15);
    });

    test('should handle non-trimmed video correctly', () => {
      const sequence: VideoSequenceItem = {
        id: 'test-video-2', 
        name: 'Non-trimmed Video',
        url: 'https://example.com/video2.mp4',
        startTime: 0,
        duration: 10,
        trackId: 'video-track-1',
        clipStart: 0,
        clipEnd: 10,
        originalDuration: 10
      };

      const timelineRelativeTime = 3;
      const clipDuration = sequence.clipEnd! - sequence.clipStart!;
      const actualVideoTime = sequence.clipStart! + (timelineRelativeTime * clipDuration / sequence.duration);
      
      // 期望: 0 + (3 * 10 / 10) = 3秒
      expect(actualVideoTime).toBe(3);
    });

    test('should handle time stretched trimmed video', () => {
      // 原始6秒内容拉伸到12秒
      const sequence: VideoSequenceItem = {
        id: 'test-video-3',
        name: 'Stretched Video', 
        url: 'https://example.com/video3.mp4',
        startTime: 0,
        duration: 12, // timeline上12秒
        trackId: 'video-track-1',
        clipStart: 2,  // 原始视频从2秒开始
        clipEnd: 8,    // 原始视频到8秒结束（原始6秒内容）
        originalDuration: 20
      };

      const timelineRelativeTime = 6; // timeline中点
      const clipDuration = sequence.clipEnd! - sequence.clipStart!; // 6秒
      const actualVideoTime = sequence.clipStart! + (timelineRelativeTime * clipDuration / sequence.duration);
      
      // 期望: 2 + (6 * 6 / 12) = 2 + 3 = 5秒
      expect(actualVideoTime).toBe(5);
    });
  });

  describe('Video sequence generation with trimming', () => {
    test('should extract trimming information from timeline items', () => {
      const mockTimelineItems: TimelineItem[] = [
        {
          id: 'item-1',
          name: 'Trimmed Video',
          type: 'video',
          startTime: 0,
          duration: 5,
          trackId: 'video-track-1',
          color: '#FF0000',
          materialId: 'material-1',
          clipStart: 3,
          clipEnd: 13,
          originalDuration: 20
        },
        {
          id: 'item-2', 
          name: 'Normal Video',
          type: 'video',
          startTime: 5,
          duration: 8,
          trackId: 'video-track-1',
          color: '#00FF00',
          materialId: 'material-2'
          // 没有裁剪信息
        }
      ];

      // 模拟从timeline items生成video sequences的逻辑
      const videoSequences: VideoSequenceItem[] = mockTimelineItems.map(item => ({
        id: item.id,
        name: item.name,
        url: `https://example.com/${item.materialId}.mp4`,
        startTime: item.startTime,
        duration: item.duration,
        trackId: item.trackId,
        materialId: item.materialId,
        clipStart: item.clipStart ?? 0,
        clipEnd: item.clipEnd ?? item.originalDuration ?? item.duration,
        originalDuration: item.originalDuration ?? item.duration
      }));

      // 验证第一个项目（有裁剪）
      expect(videoSequences[0]).toEqual({
        id: 'item-1',
        name: 'Trimmed Video',
        url: 'https://example.com/material-1.mp4',
        startTime: 0,
        duration: 5,
        trackId: 'video-track-1',
        materialId: 'material-1',
        clipStart: 3,
        clipEnd: 13,
        originalDuration: 20
      });

      // 验证第二个项目（无裁剪）
      expect(videoSequences[1]).toEqual({
        id: 'item-2',
        name: 'Normal Video', 
        url: 'https://example.com/material-2.mp4',
        startTime: 5,
        duration: 8,
        trackId: 'video-track-1',
        materialId: 'material-2',
        clipStart: 0,
        clipEnd: 8,
        originalDuration: 8
      });
    });
  });

  describe('Trimming validation', () => {
    test('should identify trimmed videos correctly', () => {
      const trimmedSequence: VideoSequenceItem = {
        id: 'trimmed',
        name: 'Trimmed',
        url: 'test.mp4',
        startTime: 0,
        duration: 5,
        trackId: 'track-1',
        clipStart: 2,
        clipEnd: 12,
        originalDuration: 15
      };

      const nonTrimmedSequence: VideoSequenceItem = {
        id: 'normal',
        name: 'Normal',
        url: 'test2.mp4', 
        startTime: 0,
        duration: 10,
        trackId: 'track-1',
        clipStart: 0,
        clipEnd: 10,
        originalDuration: 10
      };

      // 检查是否被裁剪
      const isTrimmed1 = (trimmedSequence.clipStart && trimmedSequence.clipStart > 0) || 
                        (trimmedSequence.clipEnd && trimmedSequence.originalDuration && 
                         trimmedSequence.clipEnd < trimmedSequence.originalDuration);
                         
      const isTrimmed2 = (nonTrimmedSequence.clipStart && nonTrimmedSequence.clipStart > 0) || 
                        (nonTrimmedSequence.clipEnd && nonTrimmedSequence.originalDuration && 
                         nonTrimmedSequence.clipEnd < nonTrimmedSequence.originalDuration);

      expect(isTrimmed1).toBe(true);
      expect(isTrimmed2).toBe(false);
    });
  });
}); 