import { defineConfig } from 'vite';
import path from 'node:path';
const root = process.cwd();
export default defineConfig({
  root: path.join(root, 'docs/plans/agent-chat-tabs-and-composer/verification'),
  resolve: { alias: { '@': path.join(root, 'src') } },
  oxc: { jsx: { runtime: 'automatic' } },
  server: { host: '127.0.0.1', port: 4178, strictPort: true,
    watch: { ignored: ['**/browser-*.mjs', '**/*.png', '**/*.json', '**/*.log'] },
    fs: { allow: [root] } },
  plugins: [{ name: 'local-verification-api', configureServer(server) {
    server.middlewares.use('/api', (_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ success: true, documents: {
        enabled: true, available: true, formats: ['.txt'],
      }, limits: { max_file_mb: 10 }, skills: [] }));
    });
  } }],
});
