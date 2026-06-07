'use strict'

const path = require('path')
const { app, dialog } = require('electron')

const { initUserData, saveConfig } = require('./config')
const { loadUserEnv } = require('./envCheck')
const { pickPort } = require('./ports')
const { ManagedService } = require('./processManager')
const { createBackendDescriptor } = require('./backendService')
const { createFrontendDescriptor } = require('./frontendService')
const { Logger } = require('./logger')
const windows = require('./window')

// `npm run dev` — attach to manually started dev servers instead of spawning
// packaged children (spec §4.1).
const isDev = process.argv.includes('--dev')
const DEV_FRONTEND_URL = 'http://localhost:3000'

// Smoke tests isolate their state via --user-data-dir (spec §6.2). Must be
// set before any app.getPath('userData') consumer runs.
const userDataDirArg = process.argv.find((a) => a.startsWith('--user-data-dir='))
if (userDataDirArg) {
  app.setPath('userData', path.resolve(userDataDirArg.slice('--user-data-dir='.length)))
}

// Module-level state shared by lifecycle handlers.
const state = {
  logger: null,
  logsPath: '',
  userDataPath: '',
  config: null,
  userEnv: null,
  frontendPort: 0,
  backendPort: 0,
  backend: null,
  frontend: null,
  mainWindow: null,
  splash: null,
  quitting: false,
  cleanupDone: false,
}

// Double-starting would collide on ports and the SQLite WAL lock (spec §2.1).
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      if (state.mainWindow.isMinimized()) state.mainWindow.restore()
      state.mainWindow.focus()
    }
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('before-quit', (event) => {
    state.quitting = true
    if (state.cleanupDone) return
    event.preventDefault()
    stopChildren().finally(() => {
      state.cleanupDone = true
      if (state.logger) state.logger.close()
      app.quit()
    })
  })

  app
    .whenReady()
    .then(main)
    .catch((err) => {
      dialog.showErrorBox('Ecliptrix 启动失败', String((err && err.stack) || err))
      app.exit(1)
    })
}

async function main() {
  state.userDataPath = app.getPath('userData')
  const envTemplatePath = path.join(app.getAppPath(), 'scripts', 'env.template.desktop')
  const { config, envPath } = initUserData({
    userDataPath: state.userDataPath,
    appVersion: app.getVersion(),
    envTemplatePath,
  })
  state.config = config
  state.logsPath = path.join(state.userDataPath, 'logs')
  state.logger = new Logger(state.logsPath)
  state.logger.log('main', `Ecliptrix ${app.getVersion()} starting (userData=${state.userDataPath})`)

  if (isDev) {
    state.logger.log('main', `dev mode — attaching to ${DEV_FRONTEND_URL}`)
    createMainWindow(DEV_FRONTEND_URL)
    return
  }

  const { env: userEnv, missing } = loadUserEnv(envPath)
  if (missing.length > 0) {
    // Round 3: do NOT block — the renderer shows an in-app setup guide instead.
    state.logger.log('main', `config incomplete (${missing.join(', ')}) — starting anyway; in-app setup guide will prompt`)
  }
  state.userEnv = userEnv

  state.splash = windows.createSplashWindow()
  windows.setSplashStatus(state.splash, '正在准备本地服务…')

  try {
    await resolvePorts()
    await startServices()
    createMainWindow(`http://127.0.0.1:${state.frontendPort}`)
  } catch (err) {
    state.logger.log('main', `startup failed: ${(err && err.stack) || err}`)
    closeSplash()
    await stopChildren()
    windows.showErrorWindow({
      serviceName: (err && err.serviceName) || '',
      logsPath: state.logsPath,
      detail: String((err && err.message) || err),
    })
  }
}

async function resolvePorts() {
  const backendPick = await pickPort(state.config.backendPort)
  let frontendPick = await pickPort(state.config.frontendPort)
  if (frontendPick.port === backendPick.port) {
    // Only reachable if the user pinned same-parity ports in the config.
    frontendPick = await pickPort(frontendPick.port + 1)
  }
  state.backendPort = backendPick.port
  state.frontendPort = frontendPick.port

  if (backendPick.changed || frontendPick.changed) {
    state.logger.log(
      'main',
      `port fallback: frontend=${state.frontendPort} backend=${state.backendPort} ` +
        `(configured ${state.config.frontendPort}/${state.config.backendPort})`
    )
    if (frontendPick.changed) {
      // Frontend origin change moves localStorage (login state, local
      // preferences) — make it explicit instead of silently confusing the
      // user (spec §7 risk 5).
      dialog.showMessageBoxSync({
        type: 'warning',
        title: 'Ecliptrix 端口变更',
        message: `默认端口被占用,本次使用 ${state.frontendPort} 端口启动。`,
        detail:
          '由于浏览器存储按端口隔离,登录状态与本地偏好可能需要重新设置。\n' +
          `新端口已写入配置文件,后续启动将继续使用;如需固定其他端口,可编辑:\n` +
          `${path.join(state.userDataPath, 'desktop-config.json')}`,
        buttons: ['知道了'],
      })
    }
    // Persist the picked ports so the origin stays stable from now on.
    state.config.frontendPort = state.frontendPort
    state.config.backendPort = state.backendPort
    saveConfig(state.userDataPath, state.config)
  }
}

async function startServices() {
  const resourcesPath = process.resourcesPath

  windows.setSplashStatus(state.splash, '正在启动后端服务…')
  state.backend = new ManagedService(
    createBackendDescriptor({
      resourcesPath,
      userDataPath: state.userDataPath,
      backendPort: state.backendPort,
      frontendPort: state.frontendPort,
      userEnv: state.userEnv,
    }),
    { logger: state.logger, onUnexpectedExit: handleUnexpectedExit }
  )
  state.backend.start()
  await tagServiceError('后端服务 (backend)', () => state.backend.waitHealthy())

  windows.setSplashStatus(state.splash, '正在启动界面服务…')
  state.frontend = new ManagedService(
    createFrontendDescriptor({
      resourcesPath,
      frontendPort: state.frontendPort,
      backendPort: state.backendPort,
      userEnv: state.userEnv,
      electronExecPath: process.execPath,
    }),
    { logger: state.logger, onUnexpectedExit: handleUnexpectedExit }
  )
  state.frontend.start()
  await tagServiceError('界面服务 (frontend)', () => state.frontend.waitHealthy())

  windows.setSplashStatus(state.splash, '即将完成…')
}

async function tagServiceError(serviceName, fn) {
  try {
    await fn()
  } catch (err) {
    err.serviceName = serviceName
    throw err
  }
}

function createMainWindow(url) {
  state.mainWindow = windows.createMainWindow({
    url,
    bounds: state.config.windowBounds,
    onBoundsChange: (bounds) => {
      state.config.windowBounds = bounds
      saveConfig(state.userDataPath, state.config)
    },
    version: app.getVersion(),
    logsPath: state.logsPath,
  })
  state.mainWindow.once('show', closeSplash)
  state.mainWindow.on('closed', () => {
    state.mainWindow = null
  })
}

function closeSplash() {
  if (state.splash && !state.splash.isDestroyed()) {
    state.splash.destroy()
  }
  state.splash = null
}

function handleUnexpectedExit(name, code) {
  if (state.quitting) return
  state.logger.log('main', `service ${name} exited unexpectedly (code=${code})`)
  const choice = dialog.showMessageBoxSync({
    type: 'error',
    title: 'Ecliptrix 服务异常退出',
    message: `本地服务 ${name} 异常退出 (code=${code})。`,
    detail: `详细原因请查看日志:\n${state.logsPath}`,
    buttons: ['重启服务', '退出'],
    defaultId: 0,
    cancelId: 1,
  })
  if (choice === 0) {
    restartServices()
  } else {
    app.quit()
  }
}

async function restartServices() {
  try {
    await stopChildren()
    await startServices()
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.reload()
    } else {
      createMainWindow(`http://127.0.0.1:${state.frontendPort}`)
    }
  } catch (err) {
    state.logger.log('main', `service restart failed: ${(err && err.stack) || err}`)
    closeSplash()
    windows.showErrorWindow({
      serviceName: (err && err.serviceName) || '',
      logsPath: state.logsPath,
      detail: String((err && err.message) || err),
    })
  }
}

async function stopChildren() {
  const children = [state.frontend, state.backend].filter(Boolean)
  await Promise.all(
    children.map((service) =>
      service.stop().catch((err) => {
        if (state.logger) {
          state.logger.log('main', `stop failed: ${(err && err.message) || err}`)
        }
      })
    )
  )
}
