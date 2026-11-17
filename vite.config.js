import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { handleRoute } from './api/_handler.js';

// В режиме разработки отвечаем на /api/route так же, как Vercel в продакшене.
function devApi(env) {
  return {
    name: 'dev-api',
    configureServer(server) {
      server.middlewares.use('/api/route', async (req, res) => {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        let body = null;
        try {
          body = raw ? JSON.parse(raw) : null;
        } catch {
          body = null;
        }
        const result = await handleRoute({ method: req.method, headers: req.headers, body }, env.DGIS_KEY);
        res.statusCode = result.status;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(result.body));
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), devApi(env)],
    server: { host: true },
  };
});
