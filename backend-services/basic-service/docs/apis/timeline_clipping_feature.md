# Timeline Clipping Feature - Video Composition API

## Overview

The Timeline Clipping feature allows users to extract specific portions of video and audio files when resizing clips in the timeline interface. This addresses the requirement where users can drag the resize handles on timeline items to trim content, and the exported video should reflect these trimming operations.

## Problem Solved

**Before**: When users resized timeline items (e.g., trimming an 18-second video to 6.4 seconds), the export would still use the full original video duration.

**After**: The system now tracks which portion of the original media file should be used and applies proper clipping during video composition.

## Implementation Details

### Frontend Changes

1. **Enhanced TimelineItem Interface** (`src/types/index.ts`):
   ```typescript
   export interface TimelineItem {
     // ... existing fields ...
     clipStart?: number;      // Start time within original media (seconds)
     clipEnd?: number;        // End time within original media (seconds)  
     originalDuration?: number; // Original media duration (seconds)
   }
   ```

2. **Updated Timeline Logic**:
   - **Material Drop**: Initialize clipping properties when materials are added to timeline
   - **Resize Handling**: Update clipping bounds when users drag resize handles
   - **Export Process**: Send clipping data to backend API

3. **Resize Behavior**:
   - **End Resize**: Modifies `clipEnd` to trim from the end of the original media
   - **Start Resize**: Modifies `clipStart` to trim from the beginning of the original media
   - **Validation**: Ensures clipping bounds stay within original media duration

### Backend Changes

1. **Enhanced API Models** (`app/models/video_models.py`):
   ```python
   class VideoCompositionItem(BaseModel):
       # ... existing fields ...
       clip_start: float = Field(0.0, ge=0, description="Start time within source video (seconds)")
       clip_end: float = Field(..., gt=0, description="End time within source video (seconds)")
   
   class AudioCompositionItem(BaseModel):
       # ... existing fields ...
       clip_start: float = Field(0.0, ge=0, description="Start time within source audio (seconds)")
       clip_end: float = Field(..., gt=0, description="End time within source audio (seconds)")
   ```

2. **Updated Video Processing**:
   - Uses FFmpeg `-ss` parameter for start time seeking
   - Uses FFmpeg `-t` parameter for duration limiting
   - Validates clipping parameters against original media duration

3. **Updated Audio Processing**:
   - Applies clipping to both single and multiple audio track scenarios
   - Maintains proper timing and volume control with clipping

## API Usage

### Request Example

```json
{
  "task_id": "export_20240115_143022",
  "video_items": [
    {
      "id": "video_001",
      "name": "Trimmed Video Clip",
      "url": "static/video/original_18s_video.mp4",
      "start_time": 0.0,
      "duration": 6.4,
      "track_id": "video-track-1",
      "volume": 1.0,
      "opacity": 1.0,
      "clip_start": 5.0,
      "clip_end": 11.4
    }
  ],
  "audio_items": [
    {
      "id": "audio_001", 
      "name": "Trimmed Audio Clip",
      "url": "/api/audio/generated/original_audio.mp3",
      "start_time": 2.0,
      "duration": 8.0,
      "track_id": "audio-track-1",
      "volume": 0.8,
      "clip_start": 1.0,
      "clip_end": 9.0
    }
  ],
  "total_duration": 10.0,
  "output_resolution": {"width": 1920, "height": 1080},
  "output_fps": 30
}
```

### Processing Flow

1. **Frontend Timeline**:
   - User drags right resize handle on 18s video clip
   - Timeline item duration changes from 18s to 6.4s
   - `clipEnd` updates from 18.0 to 6.4
   - Export sends: `clip_start: 0.0, clip_end: 6.4`

2. **Backend Processing**:
   - FFmpeg command: `ffmpeg -y -ss 0.0 -i original_video.mp4 -t 6.4 ...`
   - Extracts seconds 0.0-6.4 from original video
   - Applies normalization and composition

## User Experience

1. **Timeline Interaction**:
   - Users can drag left/right resize handles on timeline items
   - Visual feedback shows the trimmed duration
   - Timeline cursor and playback respect trimmed bounds

2. **Export Behavior**:
   - Exported video uses only the trimmed portions of original media
   - Timeline order and positioning are preserved
   - Audio and video clipping work independently

## Technical Benefits

1. **Efficiency**: Uses FFmpeg's built-in seeking and duration limiting
2. **Accuracy**: Precise frame-level clipping based on timeline operations
3. **Flexibility**: Supports both video and audio clipping independently
4. **Validation**: Ensures clipping bounds are within original media limits

## Testing

The feature includes comprehensive tests in `test_video_composition_timeline.py`:

- **Video Clipping**: Verifies FFmpeg commands include proper `-ss` and `-t` parameters
- **Audio Clipping**: Tests audio processing with clipping bounds
- **Parameter Validation**: Ensures clipping parameters are correctly passed through the system
- **Edge Cases**: Tests boundary conditions and error handling

## Logging

Enhanced logging provides visibility into clipping operations:

```
[Thread 12345] Video 1 clipping: 5.00s - 11.40s
[Thread 12345] Clipping: start=5.00s, end=11.40s, duration=6.40s
[Thread 12345] Running FFmpeg command: ffmpeg -y -ss 5.0 -i video.mp4 -t 6.4 ...
```

This feature ensures that the video editing timeline's resize operations are accurately reflected in the final exported video, providing users with precise control over their content. 