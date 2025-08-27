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

### 2. Portrait Video Multi-Line Centering (NEW)

**NEW FEATURE**: Enhanced subtitle rendering for portrait/vertical videos ensures each line of multi-line subtitles is individually centered horizontally.

#### Problem Solved
- **Issue**: In portrait videos, subtitles often wrap to multiple lines due to limited horizontal space
- **Previous behavior**: Multi-line subtitles were left-aligned, creating uneven visual appearance
- **Solution**: Each line is now individually centered using separate FFmpeg drawtext filters

#### Technical Implementation
- **Aspect Ratio Detection**: Automatically detects portrait videos (aspect ratio < 1.0)
- **Individual Line Filters**: Creates separate drawtext filter for each wrapped line
- **Perfect Centering**: Each line uses `x=(w-text_w)/2` for individual horizontal centering
- **Proper Spacing**: Maintains consistent line height and vertical positioning

#### Enhanced Logging for Portrait Videos
```
[Subtitle Service] Video aspect ratio: 0.56 (1080x1920)
[Subtitle Service] Portrait video detected - using multi-line centered subtitle rendering for optimal display
[Subtitle Service] Portrait video max line width: 6 characters
[Subtitle Service] Portrait subtitle 'This is a long subtitle text...' wrapped into 3 lines
[Subtitle Service] Portrait subtitle positioning: start_y=1620, total_height=165, lines=3
[Subtitle Service] Portrait line 1/3: 'This is' at y=1620
[Subtitle Service] Portrait line 2/3: 'a long' at y=1675
[Subtitle Service] Portrait line 3/3: 'subtitle' at y=1730
[Subtitle Service] Generated 9 individual line filters for portrait video multi-line centering
```

### 3. Aspect Ratio Adaptation

The subtitle service automatically adapts character width based on video aspect ratio:

- **Horizontal Videos (16:9, 21:9)**: Standard character width, uses standard multi-line rendering
- **Vertical Videos (9:16)**: Reduced character width + **individual line centering**
- **Square Videos (1:1)**: Balanced character width, uses standard rendering

### 4. Enhanced Logging

Detailed logging throughout the subtitle processing pipeline:

```
[Video Compose] Using enhanced subtitle parameters based on test_subtitle_aspect_ratio.py
[Video Compose] Subtitle request configuration (enhanced): 
  font_family=default, font_size=50, font_color=#FFFFFF, 
  background_color=#000000@0.5, position=bottom, 
  border_width=2, border_color=#000000, 
  margin_vertical=50, margin_horizontal=50
[Video Compose] Portrait video detected - using multi-line centered subtitle rendering
[Video Compose] Processed 5 subtitles in 3.45s
[Video Compose] Video dimensions: 1080x1920
[Video Compose] Output file size: 15728640 bytes
```

## API Changes

### Request Format

The subtitle_items array in video composition requests now supports enhanced styling with automatic portrait video detection:

```json
{
  "subtitle_items": [
    {
      "id": "subtitle_1",
      "name": "Opening subtitle",
      "text": "This is a long subtitle that will be wrapped across multiple lines in portrait videos",
      "start_time": 0.0,
      "duration": 3.0,
      "track_id": "subtitle_track_1",
      "font_size": 50,
      "font_color": "#FFFFFF",
      "background_color": "#000000@0.5",
      "position": "bottom"
    }
  ]
}
```

### Response Enhancements

Enhanced logging provides detailed information about portrait video subtitle processing:

- **Aspect ratio detection**: Logs detected video orientation
- **Line wrapping details**: Shows how many lines each subtitle was wrapped into
- **Positioning information**: Detailed Y-coordinate calculations for each line
- **Filter generation**: Count of individual drawtext filters created

## Technical Details

### Portrait Video Detection

```python
aspect_ratio = video_width / video_height
is_portrait = aspect_ratio < 1.0
```

### Multi-Line Centering Algorithm

1. **Text Wrapping**: Subtitle text is wrapped based on calculated max line width
2. **Line Height Calculation**: `line_height = font_size + 5`
3. **Total Height**: `total_height = num_lines * line_height`
4. **Starting Position**: Calculated based on position parameter (top/center/bottom)
5. **Individual Lines**: Each line gets its own drawtext filter with `x=(w-text_w)/2`

### Performance Impact

- **Portrait Videos**: Slight increase in processing time due to multiple drawtext filters
- **Landscape Videos**: No performance impact (uses standard processing)
- **Filter Count**: Portrait videos may generate 3-5x more filters depending on text length

## Migration Notes

- **Backward Compatibility**: Existing landscape video processing unchanged
- **Automatic Detection**: No API changes required - detection is automatic
- **Consistent Quality**: Portrait videos now have significantly improved subtitle readability 