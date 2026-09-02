'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const BUILD_DIR = path.resolve(__dirname, '..', 'build')

function run(command, args, options = {}) {
  console.log(`  $ ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status}`)
  }
}

/**
 * Build the Next.js standalone bundle and assemble it under build/frontend/
 * (spec §2.3 step 2): standalone output + .next/static + public/, with
 * traced-dependency and secret-stripping checks.
 */
function prepareFrontend() {
  console.log('[prepare-frontend] building Next.js standalone bundle...')
  // DESKTOP_BUILD is no longer what selects `output: 'standalone'` — Electron
  // is the only target now, so next.config.js sets it unconditionally. The
  // variable is still exported here for any code that branches on "this is a
  // packaging build" rather than "this is a desktop runtime".
  run('npm', ['run', 'build'], {
    cwd: REPO_ROOT,
    env: { ...process.env, DESKTOP_BUILD: '1' },
    shell: process.platform === 'win32',
  })

  const standaloneDir = path.join(REPO_ROOT, '.next', 'standalone')
  const serverJs = path.join(standaloneDir, 'server.js')
  if (!fs.existsSync(serverJs)) {
    throw new Error(
      `standalone output missing server.js at ${serverJs} — ` +
        "check that next.config.js still sets output: 'standalone'"
    )
  }

  const destDir = path.join(BUILD_DIR, 'frontend')
  console.log('[prepare-frontend] assembling build/frontend/ ...')
  fs.rmSync(destDir, { recursive: true, force: true })
  fs.mkdirSync(destDir, { recursive: true })
  fs.cpSync(standaloneDir, destDir, { recursive: true })

  // standalone does NOT include static assets nor public/ — copy them in.
  fs.cpSync(path.join(REPO_ROOT, '.next', 'static'), path.join(destDir, '.next', 'static'), {
    recursive: true,
  })
  const publicDir = path.join(REPO_ROOT, 'public')
  if (fs.existsSync(publicDir)) {
    fs.cpSync(publicDir, path.join(destDir, 'public'), { recursive: true })
  }

  // next build copies .env / .env.local into the standalone output for
  // runtime config. Shipping a developer's local secrets would be a leak —
  // the desktop shell injects everything at spawn time instead.
  for (const name of fs.readdirSync(destDir)) {
    if (name === '.env' || name.startsWith('.env.')) {
      fs.rmSync(path.join(destDir, name), { force: true })
      console.log(`[prepare-frontend] stripped ${name} from bundle (secrets must not ship)`)
    }
  }

  // serverExternalPackages are require()d at runtime — file tracing must
  // have collected them into the standalone node_modules (spec §7 risk 3).
  const externalPkgDir = path.join(destDir, 'node_modules', '@mariozechner')
  if (!fs.existsSync(externalPkgDir)) {
    throw new Error(
      'standalone bundle is missing node_modules/@mariozechner — ' +
        'serverExternalPackages were not traced; chat agent routes would crash at runtime'
    )
  }
  console.log('[prepare-frontend] done')
}

module.exports = { prepareFrontend }

if (require.main === module) {
  prepareFrontend()
}
