# Authentication API Documentation

## Overview

The Authentication API provides endpoints for user authentication in the Ecliptrix platform. This is a simple implementation with hardcoded admin credentials for demonstration purposes.

All authentication API calls are handled directly by the Next.js backend without requiring external services.

## Base URL

All endpoints are accessed through the Next.js frontend:
- Development: `http://localhost:3000`
- Production: `${NEXT_PUBLIC_FRONTEND_URL}`

## Endpoints

### 1. User Login

**Endpoint:** `POST /api/auth/login`

**Description:** Authenticates a user with username and password credentials.

**Request:**
```http
POST /api/auth/login
Content-Type: application/json
```

**Request Body:**
```json
{
  "username": "string",
  "password": "string"
}
```

**Parameters:**
- `username` (string, required): User's username
- `password` (string, required): User's password

**Response (Success):**
```json
{
  "success": true,
  "user": {
    "id": "string",
    "username": "string",
    "email": "string",
    "avatar": "string | null"
  },
  "message": "Login successful"
}
```

**Response (Error - Invalid Credentials):**
```json
{
  "success": false,
  "error": "Invalid username or password"
}
```

**Response (Error - Missing Fields):**
```json
{
  "success": false,
  "error": "Username and password are required"
}
```

**Response (Error - Server Error):**
```json
{
  "success": false,
  "error": "Internal server error"
}
```

**Status Codes:**
- `200 OK`: Login successful
- `400 Bad Request`: Missing required fields
- `401 Unauthorized`: Invalid credentials
- `500 Internal Server Error`: Server error

## Demo Credentials

For demonstration purposes, the following credentials are hardcoded:
- **Username:** `admin`
- **Password:** `admin`

## Frontend Integration

### AuthContext

The authentication state is managed through the `AuthContext` provider:

```typescript
import { useAuth } from '@/contexts/AuthContext';

const { user, isAuthenticated, login, logout } = useAuth();
```

### Login Flow

1. User enters credentials in the login form
2. Frontend calls `/api/auth/login` endpoint
3. If successful, user data is stored in localStorage and AuthContext
4. User is redirected to the main application
5. Authentication state persists across browser sessions

### Logout Flow

1. User clicks logout from the user dropdown menu
2. Frontend clears user data from localStorage and AuthContext
3. User is redirected to the login state

## Security Considerations

**Note:** This is a demo implementation with the following limitations:
- Hardcoded credentials (not suitable for production)
- No password hashing or encryption
- No session management or JWT tokens
- No rate limiting or brute force protection
- No user registration functionality

For production use, consider implementing:
- Proper user database with encrypted passwords
- JWT tokens or session-based authentication
- Rate limiting and security measures
- User registration and password reset functionality
- Role-based access control

## Error Handling

All API endpoints include comprehensive error handling with detailed logging:

```javascript
// Request logging
console.log('[Auth API] Login attempt:', {
  username,
  timestamp: new Date().toISOString(),
  userAgent: request.headers.get('user-agent'),
  ip: request.headers.get('x-forwarded-for') || 'unknown'
});

// Success logging
console.log('[Auth API] Login successful for user:', username);

// Error logging
console.warn('[Auth API] Invalid credentials for user:', username);
```

## API Testing

### Using curl

```bash
# Successful login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin"}'

# Invalid credentials
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "wrong", "password": "wrong"}'

# Missing fields
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin"}'
```

### Using JavaScript/TypeScript

```typescript
const loginUser = async (credentials: { username: string; password: string }) => {
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(credentials),
    });

    const data = await response.json();
    
    if (data.success) {
      console.log('Login successful:', data.user);
      return { success: true, user: data.user };
    } else {
      console.error('Login failed:', data.error);
      return { success: false, error: data.error };
    }
  } catch (error) {
    console.error('Network error:', error);
    return { success: false, error: 'Network error' };
  }
};
```

## Changelog

### Version 1.0.0
- Initial implementation of authentication API
- Hardcoded admin credentials for demo purposes
- Basic login functionality
- Frontend integration with React Context
- Comprehensive logging and error handling 