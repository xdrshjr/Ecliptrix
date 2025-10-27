# Pexels Video Search Node API Documentation

## Overview

The **Pexels Video Search Node** is a workflow node that enables users to search for high-quality free stock videos from Pexels directly within their workflow. This node can accept keywords from previous workflow nodes or use configured keywords to search for relevant video content.

## Node Type

`pexels-video-search`

## Features

- 🔍 **Keyword-based Search**: Search for videos using natural language keywords
- 🔗 **Dynamic Input Support**: Accept keywords from previous nodes in the workflow
- 📊 **Configurable Results**: Control the number of videos returned (1-50)
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
- **Description**: Number of videos to retrieve from search results

## Workflow Execution

### Node Input

The node accepts input in multiple formats:

1. **String Input**: Direct keyword string
   ```json
   "nature sunset"
   ```

2. **Object with keywords field**:
   ```json
   {
     "keywords": "business meeting"
   }
   ```

3. **Object with text field**:
   ```json
   {
     "text": "cooking food"
   }
   ```

4. **Configured Keywords**: Uses keywords from node configuration if no input provided

### Node Output

The node outputs a structured object containing video information:

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
      }
    }
  ],
  "videoUrls": [
    "https://player.vimeo.com/external/..."
  ],
  "totalFound": 150,
  "keywords": "nature sunset",
  "count": 5
}
```

### Output Fields

- **videos**: Array of video objects with full metadata
  - `id`: Pexels video ID
  - `url`: Pexels video page URL
  - `videoUrl`: Direct video file URL (downloadable)
  - `thumbnail`: Video thumbnail image URL
  - `width`: Video width in pixels
  - `height`: Video height in pixels
  - `duration`: Video duration in seconds
  - `user`: Video author information
- **videoUrls**: Array of direct video URLs (for convenience)
- **totalFound**: Total number of videos found in search
- **keywords**: Keywords used for the search
- **count**: Number of videos returned

## Usage Examples

### Example 1: Simple Video Search

**Workflow**: `Start` → `Pexels Video Search` → `End`

**Configuration**:
- Keywords: `nature landscape mountains`
- Video Count: 10

**Output**: 10 nature landscape videos with metadata

### Example 2: Dynamic Keyword Input

**Workflow**: `Start` → `Chat LLM` → `Pexels Video Search` → `End`

**Flow**:
1. User inputs: "Find videos about coffee"
2. Chat LLM extracts keywords: "coffee brewing barista"
3. Pexels Video Search finds coffee-related videos
4. End node receives video URLs

### Example 3: Content Generation Pipeline

**Workflow**: `Start` → `Text Input` → `Chat LLM` → `Pexels Video Search` → `End`

**Flow**:
1. Text Input provides: "Create a travel vlog about beaches"
2. Chat LLM generates keywords: "beach sunset tropical waves"
3. Pexels Video Search retrieves beach videos
4. End node outputs video list for video editing

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

### Info Logs
```
Searching Pexels for videos: "nature sunset"
- keywords: "nature sunset"
- videoCount: 5
- orientation: "mixed"
```

### Success Logs
```
Found 5 videos from Pexels
- totalFound: 150
- returned: 5
- keywords: "nature sunset"
```

### Output Display
The log panel shows the complete JSON output structure for debugging.

## Best Practices

1. **Use Specific Keywords**: More specific keywords yield better results
   - ✅ Good: "coffee brewing espresso machine"
   - ❌ Poor: "video"

2. **Reasonable Video Count**: Balance between variety and performance
   - Recommended: 5-15 videos
   - Maximum: 50 videos

3. **Chain with LLM Nodes**: Use LLM to generate optimized search keywords

4. **Handle Empty Results**: Add error handling for workflows that may get no results

5. **Cache Results**: Consider storing video URLs for reuse in subsequent executions

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

