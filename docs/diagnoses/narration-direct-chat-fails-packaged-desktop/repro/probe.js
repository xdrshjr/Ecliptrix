'use strict'
// POST /api/chat to the running standalone server and timestamp each SSE chunk
// as it arrives, so we can tell streaming (incremental) from buffering (all at end).
const http = require('http')

const port = Number(process.argv[2] || 18399)
const start = Date.now()
const req = http.request(
  {
    host: '127.0.0.1',
    port,
    path: '/api/chat',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  },
  (res) => {
    console.log(`[probe] HTTP ${res.statusCode} content-type=${res.headers['content-type']}`)
    console.log(`[probe] content-encoding=${res.headers['content-encoding'] || '(none)'} transfer-encoding=${res.headers['transfer-encoding'] || '(none)'}`)
    res.setEncoding('utf8')
    res.on('data', (d) => {
      const t = Date.now() - start
      console.log(`[probe] +${t}ms chunk: ${JSON.stringify(d).slice(0, 160)}`)
    })
    res.on('end', () => {
      console.log(`[probe] stream ended at +${Date.now() - start}ms`)
      process.exit(0)
    })
  },
)
req.on('error', (e) => {
  console.log(`[probe] request error: ${e.message}`)
  process.exit(2)
})
req.end(JSON.stringify({ messages: [{ role: 'user', content: '写一句解说' }] }))
