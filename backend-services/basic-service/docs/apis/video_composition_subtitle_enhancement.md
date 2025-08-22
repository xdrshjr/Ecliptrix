# Video Composition Subtitle Enhancement API

## Overview

This document describes the enhanced subtitle processing functionality in the video composition API, based on the verified test script `test_subtitle_aspect_ratio.py`.

## Enhanced Features

### 1. Consistent Parameter Usage

The video composition service now uses verified parameters from the test script for optimal subtitle rendering:

- **Font Size**: Default 50px (optimized for readability across different video sizes)
- **Background Color**: Default "#000000@0.5" (semi-transparent black for better visibility)
- **Font Family**: "default" (system default font)
- **Font Color**: "#FFFFFF" (white text)
- **Border**: 2px black border for text contrast
- **Margins**: 50px vertical and horizontal margins for proper positioning

### 2. Aspect Ratio Adaptation

The subtitle service automatically adapts character width based on video aspect ratio:

- **Horizontal Videos (16:9, 21:9)**: Standard character width
- **Vertical Videos (9:16)**: Reduced character width to prevent text overflow
- **Square Videos (1:1)**: Balanced character width

### 3. Enhanced Logging

Detailed logging throughout the subtitle processing pipeline:

```
[Video Compose] Using enhanced subtitle parameters based on test_subtitle_aspect_ratio.py
[Video Compose] Subtitle request configuration (enhanced): 
  font_family=default, font_size=50, font_color=#FFFFFF, 
  background_color=#000000@0.5, position=bottom, 
  border_width=2, border_color=#000000, 
  margin_vertical=50, margin_horizontal=50
[Video Compose] Processed 5 subtitles in 3.45s
[Video Compose] Video dimensions: 1920x1080
[Video Compose] Output file size: 15728640 bytes
```

## API Changes

### Request Format

The subtitle_items array in video composition requests now supports enhanced styling:

```json
{
  "subtitle_items": [
    {
      "id": "sub_001",
      "name": "Enhanced Subtitle",
      "text": "This subtitle uses optimized parameters",
      "start_time": 0.0,
      "duration": 3.0,
      "track_id": "subtitle-track-1",
      "font_family": "default",
      "font_size": 50,
      "font_color": "#FFFFFF",
      "background_color": "#000000@0.5",
      "position": "bottom"
    }
  ]
}
```

### Default Values

If any subtitle styling parameters are not provided, the system will use these optimized defaults:

| Parameter | Default Value | Description |
|-----------|---------------|-------------|
| font_family | "default" | System default font |
| font_size | 50 | Optimized for readability |
| font_color | "#FFFFFF" | White text |
| background_color | "#000000@0.5" | Semi-transparent black |
| position | "bottom" | Bottom positioning |
| border_width | 2 | Text border for contrast |
| border_color | "#000000" | Black border |
| margin_vertical | 50 | Top/bottom margins |
| margin_horizontal | 50 | Left/right margins |

## Test Verification

These parameters have been verified through comprehensive testing in `test_subtitle_aspect_ratio.py`:

- **Font Sizes Tested**: 35, 50, 72 pixels
- **Video Types Tested**: Horizontal (landscape) and vertical (portrait)
- **Validation**: Ensures subtitles don't exceed video width boundaries
- **Aspect Ratio Adaptation**: Automatic adjustment for different video orientations

## Integration

### Frontend Changes

The frontend now sends enhanced default values:

```javascript
const subtitleStyle = item.subtitleStyle || {
  fontFamily: 'default',
  fontSize: 50, // Updated from 24
  fontColor: '#FFFFFF',
  backgroundColor: '#000000@0.5', // Added semi-transparent background
  position: 'bottom'
};
```

### Backend Processing

The backend VideoCompositionService now:

1. Uses verified parameters from the test script
2. Provides sensible defaults for missing parameters
3. Logs detailed subtitle configuration
4. Reports processing results including video dimensions and file size

## Error Handling

Enhanced error handling and logging:

- Detailed parameter validation
- Comprehensive processing logs
- Clear error messages for debugging
- Fallback to default values for missing parameters

## Performance

The enhanced subtitle processing maintains high performance while providing better quality:

- Optimized font sizes for faster rendering
- Efficient aspect ratio calculations
- Minimal overhead for parameter validation
- Detailed timing logs for performance monitoring

## Migration Guide

### For Existing Applications

No breaking changes - existing subtitle items will automatically use the enhanced defaults if styling parameters are not provided.

### For New Applications

Consider using the new default values for optimal subtitle rendering:

```javascript
// Recommended subtitle styling
const optimalSubtitleStyle = {
  fontFamily: 'default',
  fontSize: 50,
  fontColor: '#FFFFFF',
  backgroundColor: '#000000@0.5',
  position: 'bottom'
};
```

## References

- Test Script: `backend-services/basic-service/tests/test-subtitle-style/scripts/test_subtitle_aspect_ratio.py`
- Video Composition API: `/api/video/compose`
- Subtitle Service: `app.services.subtitle_service.SubtitleService` 