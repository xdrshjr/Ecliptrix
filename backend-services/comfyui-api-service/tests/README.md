# ComfyUI API Service Test Suite

This test suite provides comprehensive testing for the ComfyUI API Service, ensuring all endpoints function correctly and handle edge cases properly.

## Overview

The test suite covers:
- **Health Check Endpoint** (`/api/v1/health`)
- **Image Generation Endpoint** (`/api/v1/generate-image`) 
- **Status Check Endpoint** (`/api/v1/status/{prompt_id}`)
- **Image Download Endpoint** (`/api/v1/download/{prompt_id}`)
- **Integration Tests** (End-to-end workflows)

## Test Files

| File | Purpose | Focus |
|------|---------|-------|
| `test_health_endpoint.py` | Health check functionality | Service availability, ComfyUI connection |
| `test_image_generation_endpoint.py` | Image generation requests | Parameter validation, workflow submission |
| `test_status_endpoint.py` | Status monitoring | Task tracking, completion detection |
| `test_download_endpoint.py` | Image download | File serving, error handling |
| `test_integration.py` | End-to-end workflows | Complete generation cycles |
| `conftest.py` | Test configuration | Fixtures, mocks, setup |
| `test_runner.py` | Test execution | Comprehensive test runner |

## Running Tests

### Prerequisites

```bash
# Install dependencies
pip install -r requirements.txt

# Ensure you're in the ComfyUI API service directory
cd backend-services/comfyui-api-service
```

### Run All Tests

```bash
# Using the comprehensive test runner (recommended)
python tests/test_runner.py

# Using pytest directly
pytest tests/ -v
```

### Run Specific Test Categories

```bash
# Health check tests
python tests/test_runner.py health

# Image generation tests (main focus)
python tests/test_runner.py generate

# Status check tests
python tests/test_runner.py status

# Download tests
python tests/test_runner.py download

# Integration tests
python tests/test_runner.py integration
```

### Run Individual Test Files

```bash
# Run specific test file
pytest tests/test_image_generation_endpoint.py -v

# Run specific test method
pytest tests/test_image_generation_endpoint.py::TestImageGenerationEndpoint::test_generate_image_success -v
```

## Test Features

### Comprehensive Coverage

- ✅ **Success scenarios** - Normal operation paths
- ✅ **Error handling** - Service failures, invalid inputs
- ✅ **Edge cases** - Boundary conditions, special characters
- ✅ **Validation** - Input parameter validation
- ✅ **Concurrency** - Multiple simultaneous requests
- ✅ **Performance** - Response time monitoring
- ✅ **Logging** - Detailed log message verification

### Mocking Strategy

The tests use comprehensive mocking to avoid external dependencies:

- **ComfyUI Service**: Mocked to simulate various response scenarios
- **File System**: Temporary directories for image file testing
- **HTTP Requests**: Mocked external API calls
- **Logging**: Custom test logger for verification

### Test Data

- **Sample Requests**: Realistic image generation parameters
- **Mock Images**: Temporary test files for download testing
- **Error Scenarios**: Various failure conditions
- **Edge Cases**: Boundary value testing

## Key Test Scenarios

### Image Generation Endpoint (Main Focus)

The image generation endpoint is the core functionality and receives extensive testing:

#### Success Cases
- Minimal request (only required parameters)
- Full request (all optional parameters)
- Custom parameters (non-default values)
- Edge case parameters (min/max values)

#### Validation Tests
- Empty positive prompt
- Prompt too long (>5000 characters)
- Invalid dimensions (not multiple of 8)
- Out-of-range parameters
- Invalid data types

#### Error Handling
- ComfyUI service unavailable
- Network timeouts
- Invalid JSON
- Missing content type

#### Concurrency
- Multiple simultaneous requests
- Unique prompt ID generation
- Thread safety verification

### Integration Tests

End-to-end workflow testing covers:

1. **Complete Workflow**: Submit → Check Status → Download
2. **Error Recovery**: Service failure and recovery scenarios
3. **Concurrent Workflows**: Multiple parallel generation processes
4. **Performance Testing**: Response time and throughput
5. **Edge Case Workflows**: Unusual parameter combinations

## Test Configuration

### Environment Variables

Tests use the same configuration as the main application:

```bash
# Optional: Override for testing
export COMFYUI_BASE_URL="http://test-comfyui:8188"
export LOG_LEVEL="DEBUG"
export DEBUG="true"
```

### Fixtures

Key pytest fixtures available:

- `test_client`: FastAPI test client
- `mock_comfyui_service`: Mocked ComfyUI service
- `temp_static_dir`: Temporary file storage
- `sample_image_request`: Example request data
- `test_logger`: Custom logger for verification

## Expected Test Results

### Successful Run Output

```
🚀 Starting ComfyUI API Service Test Suite
================================================================================

============================================================
Running test_health_endpoint.py
============================================================
✅ test_health_endpoint.py: 8 passed in 0.15s

============================================================
Running test_image_generation_endpoint.py
============================================================
✅ test_image_generation_endpoint.py: 15 passed in 0.45s

... (more test files) ...

📊 COMPREHENSIVE TEST REPORT
================================================================================
📈 Overall Statistics:
   • Test Files: 5/5 successful
   • Total Tests: 65
   • Passed: 65 ✅
   • Failed: 0 ❌
   • Errors: 0 🚨
   • Duration: 2.35s
   • Success Rate: 100.0%

🎉 ALL TESTS PASSED! ComfyUI API Service is ready for deployment.
```

## Troubleshooting

### Common Issues

#### Import Errors
```bash
# Ensure you're in the correct directory
cd backend-services/comfyui-api-service

# Install missing dependencies
pip install pytest pytest-asyncio httpx
```

#### Mock Setup Failures
```bash
# Clear pytest cache
pytest --cache-clear

# Run with verbose output
pytest tests/ -v -s
```

#### Temporary File Issues
```bash
# Clean up test artifacts
rm -rf tests/__pycache__
rm -rf tests/.pytest_cache
```

### Test Debugging

```bash
# Run with maximum verbosity
pytest tests/ -vv -s --tb=long

# Run specific failing test with debugging
pytest tests/test_image_generation_endpoint.py::test_generate_image_success -vv -s --pdb
```

## Performance Expectations

### Typical Performance
- **Individual test files**: 0.1-0.5 seconds each
- **Full test suite**: 2-5 seconds total
- **Image generation tests**: ~0.5 seconds (heaviest)
- **Integration tests**: ~0.8 seconds (most comprehensive)

### Performance Monitoring
- Each test measures execution time
- Test runner reports performance metrics
- Response time headers verified in tests

## Continuous Integration

### CI/CD Integration

```yaml
# Example GitHub Actions workflow
name: ComfyUI API Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-python@v2
        with:
          python-version: '3.9'
      - run: pip install -r requirements.txt
      - run: python tests/test_runner.py
```

### Quality Gates
- All tests must pass before deployment
- Minimum 95% success rate required
- No error-level issues allowed
- Response times under acceptable thresholds

## Contributing

### Adding New Tests

1. Follow existing test file patterns
2. Include comprehensive logging verification
3. Test both success and failure scenarios
4. Add edge cases and boundary conditions
5. Update test_runner.py if adding new categories

### Test Guidelines

- Use descriptive test method names
- Include docstrings explaining test purpose
- Mock external dependencies
- Verify logging output
- Test error conditions
- Include performance assertions where relevant

## Documentation

- **API Documentation**: `docs/apis/`
- **Test Coverage**: This README
- **Configuration**: `conftest.py`
- **Examples**: Individual test files

For questions or issues with the test suite, refer to the comprehensive test output and logging for detailed debugging information. 