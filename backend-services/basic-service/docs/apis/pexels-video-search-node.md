# Pexels Video Search Node API Documentation

## Overview

The **Pexels Video Search Node** is a workflow node that enables users to search for high-quality free stock videos from Pexels directly within their workflow. This node can accept keywords from previous workflow nodes or use configured keywords to search for relevant video content.

## Node Type

`pexels-video-search`

## Features

- 🔍 **Keyword-based Search**: Search for videos using natural language keywords
- 🔗 **Dynamic Input Support**: Accept keywords from previous nodes in the workflow
- 📊 **Configurable Results**: Control the number of videos returned (1-50)
- 🔄 **Array Input Support**: Accept single string or array of strings as input
- 🎯 **Batch Processing**: Search multiple keywords and merge results automatically
- 📝 **Configurable Data Formats**: Set input/output formats (text/plain, application/json, array)
- 🎨 **Apple-style UI**: Clean, minimalist, and user-friendly interface
- 🐛 **Debug Support**: View input/output JSON in the workflow log panel
- ⚡ **Real-time Execution**: See node execution status (pending/executing/completed/error)

## Node Configuration

### Input Ports

- **Keywords Port (Input)**: Accepts search keywords as a string or from previous nodes
  - Type: `string` or `object` with text/keywords field
  - Optional if keywords are configured in the node settings

### Output Ports

- **Video URLs Port (Output)**: Outputs structured video data for use in subsequent workflow nodes
  - Type: `object` containing video metadata and URLs

### Configuration Panel

Double-click the node to open the configuration panel with the following settings:

#### 1. Search Keywords
- **Type**: Text area (multi-line)
- **Required**: Yes
- **Description**: Keywords to search for videos on Pexels
- **Examples**:
  - `nature sunset ocean waves`
  - `business meeting office`
  - `city traffic night lights`
  - `cooking food preparation`

#### 2. Number of Videos
- **Type**: Number (with slider)
- **Range**: 1-50
- **Default**: 5
- **Description**: Number of videos to retrieve per keyword search

#### 3. Input Format
- **Type**: Dropdown selection
- **Options**: `text/plain`, `application/json`, `array`
- **Default**: `application/json`
- **Description**: Format of data received from the previous node

#### 4. Output Format
- **Type**: Dropdown selection
- **Options**: `text/plain`, `application/json`, `array`
- **Default**: `application/json`
- **Description**: Format of data sent to the next node

## Workflow Execution

### Node Input

The node accepts input in multiple formats based on the configured `inputFormat`:

#### When inputFormat = 'array':
1. **String Array**: Array of keyword strings
   ```json
   ["nature sunset", "city skyline", "ocean waves"]
   ```
   Each keyword will be searched separately, and results are merged.

2. **Single String**: Converted to single-element array
   ```json
   "nature sunset"
   ```

#### When inputFormat = 'text/plain':
1. **Plain Text String**: Direct keyword string
   ```json
   "nature sunset"
   ```

#### When inputFormat = 'application/json' (Auto-detect):
1. **String Array**: Automatically detected and processed
   ```json
   ["business meeting", "office workspace"]
   ```

2. **String Input**: Direct keyword string
   ```json
   "nature sunset"
   ```

3. **Object with keywords field**:
   ```json
   {
     "keywords": "business meeting"
   }
   ```
   or array:
   ```json
   {
     "keywords": ["beach", "sunset", "tropical"]
   }
   ```

4. **Object with text field**:
   ```json
   {
     "text": "cooking food"
   }
   ```

5. **Configured Keywords**: Uses keywords from node configuration if no input provided

### Node Output

The node outputs data based on the configured `outputFormat`:

#### When outputFormat = 'array':
Returns a simple array of video URLs:
```json
[
  "https://player.vimeo.com/external/video1.mp4",
  "https://player.vimeo.com/external/video2.mp4",
  "https://player.vimeo.com/external/video3.mp4"
]
```

#### When outputFormat = 'text/plain':
Returns newline-separated video URLs:
```
https://player.vimeo.com/external/video1.mp4
https://player.vimeo.com/external/video2.mp4
https://player.vimeo.com/external/video3.mp4
```

#### When outputFormat = 'application/json':
Returns a structured object containing complete video information:
```json
{
  "videos": [
    {
      "id": 123456,
      "url": "https://www.pexels.com/video/...",
      "videoUrl": "https://player.vimeo.com/external/...",
      "thumbnail": "https://images.pexels.com/...",
      "width": 1920,
      "height": 1080,
      "duration": 15,
      "user": {
        "id": 789,
        "name": "John Doe",
        "url": "https://www.pexels.com/@johndoe"
      },
      "keyword": "nature sunset"
    }
  ],
  "videoUrls": [
    "https://player.vimeo.com/external/..."
  ],
  "totalFound": 150,
  "keywords": ["nature sunset", "ocean waves"],
  "keywordCount": 2,
  "count": 10
}
```

### Output Fields (when outputFormat = 'application/json')

- **videos**: Array of video objects with full metadata
  - `id`: Pexels video ID
  - `url`: Pexels video page URL
  - `videoUrl`: Direct video file URL (downloadable)
  - `thumbnail`: Video thumbnail image URL
  - `width`: Video width in pixels
  - `height`: Video height in pixels
  - `duration`: Video duration in seconds
  - `user`: Video author information
  - `keyword`: Search keyword that found this video (for batch searches)
- **videoUrls**: Array of direct video URLs (for convenience)
- **totalFound**: Total number of videos found across all searches
- **keywords**: Array of keywords used for the search
- **keywordCount**: Number of keywords searched
- **count**: Total number of videos returned

## Usage Examples

### Example 1: Simple Video Search

**Workflow**: `Start` → `Pexels Video Search` → `End`

**Configuration**:
- Keywords: `nature landscape mountains`
- Video Count: 10
- Input Format: `application/json`
- Output Format: `application/json`

**Output**: 10 nature landscape videos with complete metadata

### Example 2: Dynamic Keyword Input

**Workflow**: `Start` → `Chat LLM` → `Pexels Video Search` → `End`

**Flow**:
1. User inputs: "Find videos about coffee"
2. Chat LLM extracts keywords: "coffee brewing barista"
3. Pexels Video Search finds coffee-related videos
4. End node receives video URLs

### Example 3: Batch Search with Array Input

**Workflow**: `Start` → `To Array` → `Pexels Video Search` → `End`

**Configuration**:
- Input Format: `array`
- Output Format: `array`
- Video Count: 5 (per keyword)

**To Array Output**:
```json
["coffee shop", "barista", "espresso machine"]
```

**Flow**:
1. To Array node outputs: `["coffee shop", "barista", "espresso machine"]`
2. Pexels Video Search processes each keyword:
   - Searches "coffee shop" → finds 5 videos
   - Searches "barista" → finds 5 videos
   - Searches "espresso machine" → finds 5 videos
3. Merges all results into single array: 15 video URLs total

**Output** (array format):
```json
[
  "https://player.vimeo.com/external/video1.mp4",
  "https://player.vimeo.com/external/video2.mp4",
  ...
]
```

### Example 4: Content Generation Pipeline with Multiple Keywords

**Workflow**: `Start` → `Text Input` → `Chat LLM` → `Pexels Video Search` → `End`

**Configuration**:
- Chat LLM Output Format: `array`
- Pexels Input Format: `array`
- Pexels Output Format: `application/json`
- Video Count: 3

**Flow**:
1. Text Input provides: "Create a travel vlog about beaches"
2. Chat LLM generates keyword array: `["beach sunset", "tropical paradise", "ocean waves", "palm trees"]`
3. Pexels Video Search retrieves 3 videos per keyword (12 total)
4. End node outputs complete video list with metadata for video editing

### Example 5: Simple URL Output

**Workflow**: `Start` → `Pexels Video Search` → `Video Compose` → `End`

**Configuration**:
- Keywords: `city timelapse`
- Video Count: 5
- Output Format: `array`

**Output**: Simple array of 5 video URLs ready for video composition

## API Integration

### Backend Endpoint

The node uses the existing Pexels video search API:

**Endpoint**: `/api/video-search`

**Method**: `POST`

**Request Body**:
```json
{
  "query": "nature sunset",
  "max_videos": 5,
  "orientation": "mixed"
}
```

**Response**:
```json
{
  "success": true,
  "videos": [...],
  "total_found": 150,
  "query": "nature sunset"
}
```

### Backend Service

The backend uses the `VideoSearchService` which integrates with the Pexels API:

**File**: `backend-services/basic-service/app/services/video_search_service.py`

**API Keys**: Configured via `PEXELS_API_KEYS` environment variable

## Error Handling

### Common Errors

1. **No Keywords Provided**
   - Error: "Pexels Video Search node requires keywords"
   - Solution: Configure keywords or provide them as input

2. **API Request Failed**
   - Error: "API request failed with status XXX"
   - Solution: Check Pexels API status and API keys

3. **No Results Found**
   - Output: Empty videos array
   - totalFound: 0

### Node Execution States

- **Pending** (Gray): Node waiting to execute
- **Executing** (Yellow, animated): Node currently searching Pexels
- **Completed** (Green): Search successful, results available
- **Error** (Red): Search failed, check logs for details

## Debug Panel

The Workflow Log Panel displays detailed execution information:

### Info Logs (Single Keyword)
```
Searching Pexels for videos: "nature sunset"
- keywords: "nature sunset"
- videoCount: 5
- orientation: "mixed"
```

### Info Logs (Multiple Keywords)
```
Searching Pexels for videos with 3 queries
- keywordsCount: 3
- keywords: ["beach", "sunset", "ocean"]
- videoCountPerQuery: 5
- orientation: "mixed"

Searching: "beach" (1/3)
Searching: "sunset" (2/3)
Searching: "ocean" (3/3)
```

### Success Logs (Single Keyword)
```
Found 5 videos from Pexels
- totalFound: 150
- returned: 5
- keywords: "nature sunset"
```

### Success Logs (Multiple Keywords)
```
Found 5 videos for "beach"
- keyword: "beach"
- found: 5
- progress: "1/3"

Found 5 videos for "sunset"
- keyword: "sunset"
- found: 5
- progress: "2/3"

Found 5 videos for "ocean"
- keyword: "ocean"
- found: 5
- progress: "3/3"

Completed: Found 15 total videos from 3 searches
- totalVideos: 15
- totalSearches: 3
- totalFound: 450
```

### Output Display
The log panel shows the complete JSON output structure for debugging.

## Best Practices

1. **Use Specific Keywords**: More specific keywords yield better results
   - ✅ Good: "coffee brewing espresso machine"
   - ❌ Poor: "video"

2. **Reasonable Video Count**: Balance between variety and performance
   - Single keyword: 5-20 videos recommended
   - Multiple keywords: 3-10 videos per keyword
   - Maximum: 50 videos per keyword

3. **Choose Appropriate Formats**:
   - Use `array` input format when receiving multiple keywords from "To Array" node
   - Use `array` output format when feeding directly to video composition
   - Use `application/json` for debugging and detailed metadata

4. **Batch Processing Strategy**:
   - For diverse content, use array input with different keywords
   - Each keyword in the array is searched independently
   - Results are automatically merged into a single output

5. **Chain with LLM Nodes**: Use LLM to generate optimized search keywords
   - LLM can output keyword arrays for batch searching
   - Combine with "To Array" node for dynamic keyword lists

6. **Handle Empty Results**: Add error handling for workflows that may get no results
   - Individual keyword failures don't stop the entire search
   - Check log panel for warnings about failed searches

7. **Cache Results**: Consider storing video URLs for reuse in subsequent executions

8. **Performance Considerations**:
   - More keywords = longer execution time (sequential searches)
   - Balance between coverage and speed
   - Consider using fewer videos per keyword when searching many keywords

## UI Design

The node follows Apple's Human Interface Guidelines:

- **Minimalist Design**: Clean, uncluttered interface
- **Clear Visual Feedback**: Color-coded status indicators
- **Intuitive Interactions**: Double-click to configure
- **Consistent Styling**: Matches existing workflow nodes
- **Accessibility**: Clear labels and helpful tooltips

## Technical Implementation

### Frontend Components

1. **PexelsVideoSearchNode.tsx**: Node visual component
2. **PexelsVideoSearchConfigPanel.tsx**: Configuration panel
3. **WorkflowExecutor.ts**: Node execution logic

### Backend Integration

- Reuses existing `/api/video-search` endpoint
- No additional backend changes required
- Uses existing `VideoSearchService` and Pexels API integration

## Logging

### Frontend Logs
- Node creation and configuration
- Execution start/completion
- Input/output data

### Backend Logs
- API request details
- Search parameters
- Response data
- Error information

## Version History

### v2.0.0 (Array Support Update)
- **NEW**: Support for string array input
- **NEW**: Batch processing - search multiple keywords automatically
- **NEW**: Configurable input/output data formats (text/plain, application/json, array)
- **NEW**: Per-keyword video tagging in results
- **IMPROVED**: Enhanced logging for batch searches with progress tracking
- **IMPROVED**: Resilient error handling - continues on individual keyword failures
- Backward compatible with v1.0.0

### v1.0.0 (Initial Release)
- Basic Pexels video search functionality
- Configurable keywords and video count
- Dynamic input support from previous nodes
- Apple-style UI implementation
- Full workflow integration
- Debug panel support

## Related Documentation

- [Workflow API](./workflow_api.md)
- [Video Search API](./video-search.md)
- [Video Composition API](./video-compose-api.md)

## Support

For issues or questions:
1. Check the Workflow Log Panel for detailed error messages
2. Verify Pexels API keys are configured correctly
3. Ensure keywords are valid and not empty
4. Check backend logs for API-level issues

## License

This feature integrates with Pexels, which provides free stock videos. Please review Pexels' license terms: https://www.pexels.com/license/

