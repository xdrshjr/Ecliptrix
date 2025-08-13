# Subtitle Addition API

## Overview

The Subtitle Addition API allows you to add subtitles from an SRT file to an existing video with automatic edge detection and line wrapping. The API supports customizable font settings, positioning, and styling options.

## Endpoint

```
POST /video/add-subtitles
```

## Features

- **Automatic Edge Detection**: Automatically detects video dimensions and calculates optimal text positioning
- **Line Wrapping**: Automatically wraps long subtitle text to prevent overflow beyond video edges
- **Customizable Styling**: Support for font size, color, background, and border customization
- **Multiple Positions**: Support for top, center, and bottom subtitle positioning
- **SRT Format Support**: Parses standard SRT subtitle files with timing information
- **Detailed Logging**: Comprehensive logging for debugging and monitoring

## Request

### Request Body

```json
{
  "video_file_path": "string",
  "subtitle_file_path": "string",
  "font_size": 24,
  "font_color": "#FFFFFF",
  "background_color": "#000000",
  "border_width": 2,
  "border_color": "#000000",
  "position": "bottom",
  "margin_vertical": 50,
  "margin_horizontal": 50,
  "max_line_width": null
}
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `video_file_path` | string | Yes | - | Path to the input video file |
| `subtitle_file_path` | string | Yes | - | Path to the SRT subtitle file |
| `font_size` | integer | No | 24 | Font size in pixels (8-72) |
| `font_color` | string | No | "#FFFFFF" | Font color in hex format |
| `background_color` | string | No | null | Background color in hex format (optional) |
| `border_width` | integer | No | 2 | Text border width in pixels (0-10) |
| `border_color` | string | No | "#000000" | Text border color in hex format |
| `position` | string | No | "bottom" | Subtitle position: "top", "center", or "bottom" |
| `margin_vertical` | integer | No | 50 | Vertical margin from edge in pixels (10-200) |
| `margin_horizontal` | integer | No | 50 | Horizontal margin from edge in pixels (10-200) |
| `max_line_width` | integer | No | null | Maximum line width in characters (auto-calculated if not provided) |

### Example Request

```bash
curl -X POST "http://localhost:8000/video/add-subtitles" \
  -H "Content-Type: application/json" \
  -d '{
    "video_file_path": "datas/merge/video-1.mp4",
    "subtitle_file_path": "datas/merge/basic-01.srt",
    "font_size": 28,
    "font_color": "#FFFFFF",
    "background_color": "#000000",
    "border_width": 2,
    "border_color": "#000000",
    "position": "bottom",
    "margin_vertical": 60,
    "margin_horizontal": 40
  }'
```

## Response

### Success Response

```json
{
  "success": true,
  "message": "Subtitles added successfully",
  "output_video_path": "static/video/subtitled/video-1_subtitled_1703123456.mp4",
  "video_width": 1920,
  "video_height": 1080,
  "subtitle_count": 3,
  "processing_time": 12.34,
  "file_size": 5242880
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Whether the operation was successful |
| `message` | string | Success or error message |
| `output_video_path` | string | Path to the output video with subtitles |
| `video_width` | integer | Width of the processed video in pixels |
| `video_height` | integer | Height of the processed video in pixels |
| `subtitle_count` | integer | Number of subtitle entries processed |
| `processing_time` | float | Processing time in seconds |
| `file_size` | integer | Size of the output file in bytes |

### Error Response

```json
{
  "success": false,
  "message": "Video file not found: invalid/path.mp4",
  "processing_time": 0.12
}
```

## Status Codes

| Code | Description |
|------|-------------|
| 200 | Success - Subtitles added successfully |
| 400 | Bad Request - Invalid parameters or missing files |
| 500 | Internal Server Error - Processing failed |

## Error Handling

### Common Error Scenarios

1. **File Not Found**
   ```json
   {
     "success": false,
     "message": "Video file not found: path/to/video.mp4"
   }
   ```

2. **Invalid SRT Format**
   ```json
   {
     "success": false,
     "message": "No valid subtitles found in SRT file"
   }
   ```

3. **Video Processing Failed**
   ```json
   {
     "success": false,
     "message": "Video processing failed: ffmpeg error details"
   }
   ```

4. **Invalid Parameters**
   ```json
   {
     "detail": "Font size must be between 8 and 72 pixels"
   }
   ```

## SRT File Format

The API supports standard SRT (SubRip Subtitle) format:

```
1
00:00.20 --> 00:03.02
大家好欢迎来到今天的视频教程

2
00:03.24 --> 00:07.42
今天我们要学习如何使用这个强大的视频编辑工具

3
00:07.52 --> 00:11.90
这个工具可以帮助我们快速创建专业级的视频内容
```

### SRT Format Requirements

- Sequential numbering starting from 1
- Time format: `MM:SS.MS --> MM:SS.MS`
- Text content can span multiple lines
- Entries separated by blank lines

## Technical Details

### Video Processing

- Uses FFmpeg for video processing with `drawtext` filters
- Supports automatic text wrapping based on video dimensions
- Preserves original video quality and audio track
- Generates unique output filenames to prevent conflicts

### Text Rendering

- Character width estimation: `font_size * 0.6`
- Automatic line width calculation: `(video_width - 2 * margin_horizontal) / char_width`
- Word-based text wrapping to prevent mid-word breaks
- Multi-line subtitle support with proper vertical spacing

### Performance

- Processing time depends on video length and subtitle count
- Typical processing: 1-2 seconds per minute of video
- Memory usage scales with video resolution
- Timeout: 5 minutes for processing

## Usage Examples

### Basic Usage

```python
import httpx
import asyncio

async def add_subtitles():
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "http://localhost:8000/video/add-subtitles",
            json={
                "video_file_path": "input/video.mp4",
                "subtitle_file_path": "input/subtitles.srt"
            }
        )
        return response.json()

result = asyncio.run(add_subtitles())
print(f"Output video: {result['output_video_path']}")
```

### Advanced Styling

```python
request = {
    "video_file_path": "input/video.mp4",
    "subtitle_file_path": "input/subtitles.srt",
    "font_size": 32,
    "font_color": "#FFFF00",  # Yellow text
    "background_color": "#000000",  # Black background
    "border_width": 3,
    "border_color": "#FF0000",  # Red border
    "position": "top",
    "margin_vertical": 80,
    "margin_horizontal": 60
}
```

### Different Positions

```python
# Bottom subtitles (default)
{"position": "bottom", "margin_vertical": 50}

# Top subtitles
{"position": "top", "margin_vertical": 50}

# Center subtitles
{"position": "center"}
```

## Testing

### Test Files

The API includes test files in `datas/merge/`:
- `video-1.mp4`: Sample video file
- `basic-01.srt`: Sample Chinese subtitle file

### Running Tests

```bash
# Run pytest tests
cd backend-services/basic-service
pytest tests/test_subtitle_add.py -v

# Run standalone test
python tests/test_subtitle_add.py
```

### Test Coverage

- File validation
- SRT parsing
- Video property extraction
- Text wrapping algorithms
- Different font sizes and positions
- Error handling scenarios

## Dependencies

### Required Software

- **FFmpeg**: Video processing engine
- **OpenCV**: Video property extraction
- **Python packages**: See `requirements.txt`

### Installation

```bash
# Install FFmpeg (Ubuntu/Debian)
sudo apt update
sudo apt install ffmpeg

# Install Python dependencies
pip install -r requirements.txt
```

## Limitations

1. **File Format Support**: Currently supports MP4 input videos and SRT subtitles
2. **Font Support**: Uses system default font (no custom font file support yet)
3. **Language Support**: Optimized for Chinese text but supports other languages
4. **Processing Time**: Large videos may take several minutes to process
5. **Memory Usage**: High-resolution videos require significant memory

## Future Enhancements

- [ ] Custom font file support
- [ ] Multiple subtitle track support
- [ ] Real-time processing progress updates
- [ ] Additional subtitle formats (VTT, ASS)
- [ ] Subtitle styling templates
- [ ] Batch processing support

## Troubleshooting

### Common Issues

1. **FFmpeg Not Found**
   - Install FFmpeg and ensure it's in PATH
   - Check with: `ffmpeg -version`

2. **Video File Not Supported**
   - Ensure video is in MP4 format
   - Check file permissions and path

3. **SRT Parsing Errors**
   - Verify SRT file format
   - Check encoding (should be UTF-8)

4. **Memory Issues**
   - Reduce video resolution
   - Process shorter video segments

### Logging

Detailed logs are available in the application logs:
- Service initialization
- File validation
- Video processing steps
- Error details and stack traces

## Support

For issues and questions:
1. Check the logs for detailed error information
2. Verify input file formats and paths
3. Ensure FFmpeg is properly installed
4. Review the test cases for usage examples 