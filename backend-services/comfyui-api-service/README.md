# ComfyUI API Service

A FastAPI-based service that provides a RESTful API for generating images using ComfyUI.

## Features

- **Health Monitoring**: Check ComfyUI service availability
- **Image Generation**: Generate images with customizable parameters
- **Status Tracking**: Monitor generation progress and completion
- **File Management**: Download generated images
- **Comprehensive Logging**: Detailed request/response logging
- **Configuration Management**: Environment-based configuration
- **Error Handling**: Robust error handling and validation
- **Interactive Documentation**: Auto-generated API docs

## Quick Start

### Prerequisites

- Python 3.8+
- ComfyUI instance running and accessible
- Required Python packages (see requirements.txt)

### Installation

1. **Clone and navigate to the service directory:**
   ```bash
   cd backend-services/comfyui-api-service
   ```

2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Configure environment variables:**
   Create a `.env` file:
   ```env
   COMFYUI_BASE_URL=http://comfyui-tako.hk.cpolar.io
   LOG_LEVEL=DEBUG
   HOST=0.0.0.0
   PORT=8000
   DEBUG=false
   ```

4. **Start the service:**
   ```bash
   python run.py
   ```

5. **Access the service:**
   - API: http://localhost:8000
   - Documentation: http://localhost:8000/docs
   - Health check: http://localhost:8000/api/v1/health

## API Usage

### Basic Example

```python
import requests

# Generate an image
response = requests.post("http://localhost:8000/api/v1/generate-image", json={
    "positive_prompt": "A beautiful sunset over mountains",
    "width": 512,
    "height": 512
})

if response.status_code == 200:
    prompt_id = response.json()["prompt_id"]
    print(f"Generation started: {prompt_id}")
```

### Available Endpoints

- `GET /api/v1/health` - Health check
- `POST /api/v1/generate-image` - Start image generation
- `GET /api/v1/status/{prompt_id}` - Check generation status
- `GET /api/v1/download/{prompt_id}` - Download generated image

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `COMFYUI_BASE_URL` | - | **Required** - ComfyUI instance URL |
| `HOST` | 0.0.0.0 | Server host |
| `PORT` | 8000 | Server port |
| `LOG_LEVEL` | INFO | Logging level |
| `DEBUG` | false | Debug mode |
| `REQUEST_TIMEOUT` | 30 | Request timeout in seconds |
| `MAX_WAIT_TIME` | 300 | Max wait time for generation |
| `POLL_INTERVAL` | 5 | Status polling interval |

### Default Workflow Parameters

| Variable | Default | Description |
|----------|---------|-------------|
| `DEFAULT_WIDTH` | 1024 | Default image width |
| `DEFAULT_HEIGHT` | 1024 | Default image height |
| `DEFAULT_STEPS` | 20 | Default sampling steps |
| `DEFAULT_CFG` | 1.0 | Default CFG scale |
| `DEFAULT_GUIDANCE` | 3.5 | Default guidance scale |
| `DEFAULT_CHECKPOINT` | flux1-dev-fp8.safetensors | Default model |

## Testing

Run the test suite:

```bash
# Run all tests
pytest tests/ -v

# Run specific test file
pytest tests/test_basic.py -v

# Run with coverage
pytest tests/ --cov=app
```

## Project Structure

```
backend-services/comfyui-api-service/
├── app/
│   ├── models/          # Pydantic models
│   ├── routers/         # API route handlers
│   ├── services/        # Business logic
│   ├── config.py        # Configuration management
│   ├── logger.py        # Logging setup
│   └── main.py          # FastAPI application
├── tests/               # Test files
├── logs/                # Log files
├── static/              # Static files and generated images
├── docs/                # Documentation
├── requirements.txt     # Python dependencies
├── .env                # Environment configuration
├── run.py              # Application entry point
└── README.md           # This file
```

## Architecture

### Service Layer
- **ComfyUIService**: Handles all ComfyUI integration
- **Configuration**: Environment-based settings management
- **Logging**: Comprehensive request/response logging

### API Layer
- **FastAPI**: Modern Python web framework
- **Pydantic**: Data validation and serialization
- **Background Tasks**: Async image generation processing

### Data Flow
1. Client submits generation request
2. Service validates parameters and submits to ComfyUI
3. Background task monitors generation progress
4. Client polls status endpoint for updates
5. Upon completion, client downloads generated images

## Monitoring and Debugging

### Health Monitoring
- `/api/v1/health` endpoint checks ComfyUI connectivity
- Service logs include detailed request/response information
- Error responses include timestamps and detailed error messages

### Log Files
- Application logs: `logs/comfyui_api.log`
- Console output with color-coded log levels
- Request/response timing information

### Debug Mode
Enable debug mode for detailed logging:
```env
DEBUG=true
LOG_LEVEL=DEBUG
```

## Error Handling

The service provides comprehensive error handling:

- **Validation Errors**: Invalid request parameters return 422
- **ComfyUI Connectivity**: Service unavailable returns 503  
- **Not Found**: Missing resources return 404
- **Internal Errors**: Unexpected errors return 500

All errors include detailed messages and timestamps.

## Contributing

1. Follow existing code patterns and style
2. Add tests for new functionality
3. Update documentation for API changes
4. Ensure comprehensive logging

## Dependencies

Main dependencies:
- **FastAPI**: Web framework
- **Uvicorn**: ASGI server
- **Pydantic**: Data validation
- **Requests**: HTTP client for ComfyUI integration
- **Python-dotenv**: Environment variable management

See `requirements.txt` for complete list.

## License

This project is part of the Ecliptrix video editing platform. 