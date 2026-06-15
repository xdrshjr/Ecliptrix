'use strict'
// Minimal OpenAI-compatible SSE mock. Streams 3 content chunks with 400ms gaps
// so a buffering proxy is visible as "all chunks arrive at once at the end".
const http = require('http')

const server = http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(404).end('nope')
    return
  }
  let body = ''
  req.on('data', (d) => (body += d))
  req.on('end', () => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    const chunks = ['你好', '，这是', '逐块解说。']
    let i = 0
    const tick = () => {
      if (i < chunks.length) {
        const payload = { choices: [{ delta: { content: chunks[i] } }] }
        res.write(`data: ${JSON.stringify(payload)}\n\n`)
        i++
        setTimeout(tick, 400)
      } else {
        res.write('data: [DONE]\n\n')
        res.end()
      }
    }
    tick()
  })
})

server.listen(8899, '127.0.0.1', () => console.log('[mock-llm] listening :8899'))
