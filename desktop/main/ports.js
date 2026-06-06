'use strict'

const net = require('net')

function isPortFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const probe = net.createServer()
    probe.unref()
    probe.once('error', () => resolve(false))
    probe.listen({ port, host, exclusive: true }, () => {
      probe.close(() => resolve(true))
    })
  })
}

/**
 * Return `preferred` when free, otherwise probe upwards in steps of 2
 * (spec §2.2 step 5 — even/odd parity keeps the frontend and backend
 * fallback series disjoint). Returns { port, changed }.
 */
async function pickPort(preferred, { step = 2, attempts = 20 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const candidate = preferred + i * step
    if (candidate > 65535) break
    if (await isPortFree(candidate)) {
      return { port: candidate, changed: candidate !== preferred }
    }
  }
  throw new Error(`No free port found from ${preferred} (step ${step}, ${attempts} attempts)`)
}

module.exports = { isPortFree, pickPort }
