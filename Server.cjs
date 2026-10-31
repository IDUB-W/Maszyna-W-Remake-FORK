
const http = require('node:http');
const WebSocket = require('ws');

const forwardedTypes = new Set([
  'signal-toggle',
  'reg-update',
  'mem-update',
  'color-update',
  'button_press',
]);

const allowedOrigins = new Set(
  (process.env.ALLOWED_WS_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
);

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  res.writeHead(404);
  res.end();
});

const wss = new WebSocket.WebSocketServer({
  noServer: true,
  maxPayload: 64 * 1024,
  perMessageDeflate: false,
});

server.on('upgrade', async (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname !== '/ws') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  const origin = req.headers.origin;

  // Validate browser origins when supplied.
  // Authentication is still required for native clients.
  if (origin && !allowedOrigins.has(origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }

  try {
    // TODO: Validate and consume a short-lived, single-use
    // authentication ticket here.
    const authenticatedUser = null;

    if (!authenticatedUser) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, ws => {
      ws.user = authenticatedUser;
      wss.emit('connection', ws, req);
    });
  } catch {
    socket.destroy();
  }
});

wss.on('connection', socket => {
  socket.on('message', raw => {
    let message;

    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return;
    }

    if (!forwardedTypes.has(message.type)) {
      return;
    }

    // TODO: Verify that this user is authorized to publish
    // this message to the selected session/room.
  });
});

server.listen(
  Number(process.env.WS_PORT || 8080),
  process.env.WS_HOST || '0.0.0.0'
);

