'use strict'

const path = require('path')

/**
 * Set an env key without creating case-variant duplicates — on Windows
 * `process.env` spreads as e.g. `Path`, and adding a second `PATH` key would
 * leave CreateProcess with two conflicting entries.
 */
function setEnvCaseInsensitive(env, key, value) {
  const existing = Object.keys(env).find((k) => k.toUpperCase() === key.toUpperCase())
  env[existing || key] = value
}

/**
 * Spawn descriptor for the FastAPI backend child (spec §2.1 / §4.2).
 *
 * `userEnv` is the parsed userData/.env. The hard overrides are spread last
 * on purpose: python-dotenv never overwrites variables that already exist in
 * the process environment, so the values injected here always win over
 * same-name keys the user put in .env.
 */
function createBackendDescriptor({ resourcesPath, userDataPath, backendPort, frontendPort, userEnv }) {
  const pythonExe = path.join(resourcesPath, 'python', 'python.exe')
  const backendCwd = path.join(resourcesPath, 'backend')
  const ffmpegDir = path.join(resourcesPath, 'ffmpeg')
  // sqlite+aiosqlite URLs use forward slashes even on Windows.
  const dbFile = path.join(userDataPath, 'data', 'ecliptrix.db').split(path.sep).join('/')

  const env = {
    ...process.env,
    ...userEnv,
    DATABASE_URL: `sqlite+aiosqlite:///${dbFile}`,
    STORAGE_ROOT: path.join(userDataPath, 'storage'),
    HOST: '127.0.0.1',
    PORT: String(backendPort),
    CORS_ALLOWED_ORIGINS: `http://127.0.0.1:${frontendPort}`,
    DEBUG: 'false',
    // Chinese-locale Windows defaults to GBK; backend logs/paths are UTF-8.
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    // A user's own Python 3.11 user site-packages (%APPDATA%\Python) would
    // otherwise shadow the bundled runtime's packages (spec §7 risk 2).
    PYTHONNOUSERSITE: '1',
  }
  // Bundled FFmpeg first on PATH so the backend's ffmpeg/ffprobe subprocess
  // calls resolve to our binaries without touching backend code (spec §2.1).
  setEnvCaseInsensitive(env, 'PATH', `${ffmpegDir}${path.delimiter}${process.env.PATH || ''}`)

  return {
    name: 'backend',
    command: pythonExe,
    args: ['run.py'],
    cwd: backendCwd,
    env,
    healthUrl: `http://127.0.0.1:${backendPort}/api/health`,
    // Cold start does create_all + settings seeding — allow up to 120s.
    healthTimeoutMs: 120000,
  }
}

module.exports = { createBackendDescriptor }
