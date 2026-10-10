import { createServer } from 'http';
import { PROTOCOL_VERSION } from '@quickdrop/protocol';

const PORT = parseInt(process.env.PORT ?? '3001', 10);

/**
 * Minimal HTTP server for Phase 1 scaffold.
 * Phase 2 will add WebSocket upgrade and the full signaling protocol.
 */
const server = createServer((_req, res) => {
  // Health endpoint — required by TECH_STACK.md §5
  if (_req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', protocol: PROTOCOL_VERSION }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, () => {
  console.log(`[signaling] listening on http://localhost:${PORT}`);
  console.log(`[signaling] protocol v${PROTOCOL_VERSION}`);
  console.log(`[signaling] health check: http://localhost:${PORT}/health`);
});
