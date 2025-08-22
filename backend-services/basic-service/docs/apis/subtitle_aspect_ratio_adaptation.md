# Subtitle Aspect Ratio Adaptation API

## Overview

The Subtitle Aspect Ratio Adaptation feature enhances the video composition API's subtitle rendering capabilities by automatically adjusting subtitle character width based on video aspect ratio and font size. This ensures optimal readability across different video formats, particularly for portrait/vertical videos where traditional subtitle rendering may exceed screen boundaries.

## Key Features

### Automatic Aspect Ratio Detection
- **Landscape Videos (width ≥ height)**: Uses standard character width calculations
- **Portrait Videos (width < height)**: Applies stricter character limits to prevent overflow
- **Square Videos (aspect ratio ≈ 1:1)**: Uses moderate character restrictions

### Font Size Adaptation
The system adjusts character limits based on font size for portrait videos:
- **Large fonts (≥72px)**: Very strict limits (40% of calculated width)
- **Medium fonts (50-71px)**: Moderate limits (50% of calculated width)  
- **Small fonts (<50px)**: Less strict limits (60% of calculated width)

### Intelligent Line Wrapping
- Automatic text wrapping prevents subtitles from exceeding video boundaries
- Maintains readability while respecting aspect ratio constraints
- Supports both Chinese and Latin character sets

## Technical Implementation

### Enhanced Width Calculation

The subtitle service now uses an improved `_calculate_max_line_width` method that considers:

```python
def _calculate_max_line_width(self, video_width: int, font_size: int, 
                            margin_horizontal: int, video_height: int = None) -> int
```

**Parameters:**
- `video_width`: Video width in pixels
- `font_size`: Font size in pixels
- `margin_horizontal`: Horizontal margin in pixels
- `video_height`: Video height in pixels (for aspect ratio calculation)

**Logic:**
1. Calculate base character width: `char_width = font_size * 0.6`
2. Determine available width: `available_width = video_width - (2 * margin_horizontal)`
3. Calculate aspect ratio: `aspect_ratio = video_width / video_height`
4. Apply aspect ratio adjustments:
   - Portrait (< 1.0): Apply font-size-based reduction factors
   - Nearly square (1.0-1.5): Apply 80% reduction
   - Landscape (≥ 1.5): Use standard calculation

### Aspect Ratio Factors

| Video Type | Aspect Ratio | Font Size | Reduction Factor |
|------------|-------------|-----------|------------------|
| Portrait   | < 1.0       | ≥72px     | 40%             |
| Portrait   | < 1.0       | 50-71px   | 50%             |
| Portrait   | < 1.0       | <50px     | 60%             |
| Square     | 1.0-1.5     | Any       | 80%             |
| Landscape  | ≥ 1.5       | Any       | 100% (standard) |

## API Integration

### Video Composition Endpoint

**POST** `/api/video/compose`

The subtitle aspect ratio adaptation is automatically applied when processing subtitle items in video composition requests. No additional parameters are required.

#### Example Request with Subtitles

```json
{
  "task_id": "composition_123",
  "aspect_ratio": "9:16",
  "video_items": [...],
  "audio_items": [...],
  "subtitle_items": [
    {
      "id": "subtitle_1",
      "name": "Main Subtitle",
      "url": "/path/to/subtitle.srt",
      "start_time": 0.0,
      "duration": 30.0,
      "track_id": "subtitle_track_1",
      "font_size": 50,
      "font_color": "#FFFFFF",
      "background_color": "#000000@0.5",
      "position": "bottom"
    }
  ],
  "total_duration": 30.0,
  "output_resolution": {
    "width": 1080,
    "height": 1920
  }
}
```

### Subtitle Addition Endpoint

**POST** `/api/video/add-subtitles`

Direct subtitle addition also benefits from aspect ratio adaptation.

#### Enhanced Request Parameters

```json
{
  "video_file_path": "/path/to/video.mp4",
  "subtitle_file_path": "/path/to/subtitles.srt",
  "font_family": "default",
  "font_size": 50,
  "font_color": "#FFFFFF",
  "background_color": "#000000@0.5",
  "border_width": 2,
  "border_color": "#000000",
  "position": "bottom",
  "margin_vertical": 50,
  "margin_horizontal": 50
}
```

## Testing and Validation

### Test Script

A comprehensive test script is available at:
```
backend-services/basic-service/tests/test-subtitle-style/scripts/test_subtitle_aspect_ratio.py
```

### Test Coverage

The test script validates:
- **Font sizes**: 35px, 50px, 72px
- **Video types**: Horizontal (landscape) and vertical (portrait)
- **Character width limits**: Ensures subtitles don't exceed video boundaries
- **Output quality**: Generates test videos for visual verification

### Running Tests

```bash
cd backend-services/basic-service
conda activate ecliptrix
python tests/test-subtitle-style/scripts/test_subtitle_aspect_ratio.py
```

## Benefits

### Improved User Experience
- **Portrait Videos**: Subtitles no longer overflow screen boundaries
- **Consistent Readability**: Optimal character limits across all video formats
- **Font Flexibility**: Supports various font sizes with appropriate adjustments

### Technical Advantages
- **Automatic Detection**: No manual configuration required
- **Backward Compatible**: Existing functionality remains unchanged
- **Performance Optimized**: Minimal computational overhead
- **Robust Error Handling**: Graceful fallbacks for edge cases

## Logging and Monitoring

The system provides detailed logging for subtitle processing:

```
INFO - Video aspect ratio: 0.56 (1080x1920)
INFO - Portrait video detected - applying stricter character limits
INFO - Applied portrait factor 0.5 for font size 50
INFO - Calculated max line width: 18 characters for video 1080x1920px, font size 50
```

## Error Handling

### Common Issues and Solutions

1. **Missing Video Dimensions**: Falls back to standard calculation
2. **Invalid Aspect Ratios**: Uses safe default values
3. **Extreme Font Sizes**: Applies reasonable min/max limits
4. **Processing Failures**: Continues without subtitles, logs errors

### Fallback Behavior

If aspect ratio calculation fails, the system:
1. Logs the error with context
2. Falls back to original width calculation method
3. Continues processing with standard subtitle rendering
4. Ensures video composition completes successfully

## Future Enhancements

### Planned Improvements
- Dynamic font size adjustment based on video resolution
- Advanced text layout algorithms for complex subtitle positioning
- Multi-language character width optimization
- Real-time preview capabilities for subtitle positioning

### Configuration Options
Future versions may include:
- Custom aspect ratio thresholds
- User-defined reduction factors
- Advanced typography controls
- Subtitle positioning presets 