import express from 'express';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { router } from './routes/session.js';
import { schedulePurge, RETENTION_DAYS } from './retention.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));

  app.get('/health', (_req, res) => res.json({ ok: true, retencion_dias: RETENTION_DAYS }));
  app.use(router);

  app.use((_req, res) => res.status(404).json({ error: 'no_encontrado' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'json_invalido' });
    console.error('[error]', err);
    res.status(500).json({ error: 'error_interno' });
  });

  return app;
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const port = Number(process.env.PORT ?? 3000);
  schedulePurge();
  createApp().listen(port, () => {
    console.log(`arcana escuchando en http://localhost:${port}`);
  });
}
