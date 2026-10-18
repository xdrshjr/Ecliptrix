// agentBrowserHost.js — 受控浏览器宿主子进程（spec §3.6）。
//
// 由 desktop/main/index.js 在 requestSingleInstanceLock 之前分流进来：
//   electron . --agent-browser-host --cdp-port=<p> --control-port=<q>
// 职责（spike 结论驱动的架构）：
//   - 不抢单实例锁、不建主窗口、不启动后端/前端；
//   - remote-debugging-port 绑定 127.0.0.1，供 FastAPI playwright
//     connect_over_cdp 附加（Electron 不支持 CDP createBrowserContext，
//     会话 = partition 隔离的隐藏窗口）；
//   - 会话窗口的创建/销毁由回环控制端点（127.0.0.1）管理；
//   - 宿主内建拒绝代理并指给每个会话分区：未被路由拦截的流量一律
//     失败关闭（含 Electron 重定向跟随这类绕过拦截的通道）。
const { app, BrowserWindow, session } = require('electron');
const http = require('http');
const net = require('net');

const argv = process.argv;
function argValue(name) {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : null;
}

const cdpPort = Number(argValue('cdp-port') || 0);
const controlPort = Number(argValue('control-port') || 0);
const validPort = (port) => Number.isInteger(port) && port > 0 && port < 65536;

if (!argv.includes('--agent-browser-host') || !validPort(cdpPort) ||
    !validPort(controlPort)) {
  app.exit(2);
}

app.commandLine.appendSwitch('remote-debugging-port', String(cdpPort));
app.commandLine.appendSwitch('proxy-bypass-list', '<-loopback>');
app.commandLine.appendSwitch('disable-quic');
app.commandLine.appendSwitch(
  'force-webrtc-ip-handling-policy',
  'disable_non_proxied_udp',
);
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-sync');
app.commandLine.appendSwitch('no-first-run');
app.commandLine.appendSwitch('disable-default-apps');
app.commandLine.appendSwitch('disable-features', 'MediaRouter,WebTransport,WebBluetooth');

const MAX_SESSIONS = 2;
const SESSION_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const sessions = new Map();
let denyHits = 0;
let denyServer = null;
let denyProxyUrl = '';

function startDenyProxy() {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      denyHits += 1;
      socket.end(
        'HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
      );
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ url: `http://127.0.0.1:${server.address().port}`, server });
    });
  });
}

async function createSession(sessionId) {
  const partition = `research-${sessionId}`;
  const partitionSession = session.fromPartition(partition, { cache: false });
  // proxyBypassRules: '<-loopback>' 移除 Chromium 对回环地址的隐式代理
  // 旁路；未拦截请求（含 127.0.0.1 目标）必须仍走拒绝代理（失败关闭）。
  await partitionSession.setProxy({
    mode: 'fixed_servers',
    proxyRules: denyProxyUrl,
    proxyBypassRules: '<-loopback>',
  });
  partitionSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  partitionSession.on('will-download', (event) => event.preventDefault());
  const win = new BrowserWindow({
    show: false,
    x: -32000,
    y: 0,
    width: 1280,
    height: 720,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      partition,
    },
  });
  // 页面不得自开窗口：一个可见/未受路由约束的窗口会绕过 §3.6 的全部网络
  // 控制（playwright 只路由它附加的页面）。
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // 会话窗口自行销毁（渲染进程崩溃/被页面关闭）时必须释放名额，否则两个
  // 死条目就能让宿主永久返回 429 busy。
  win.on('closed', () => {
    if (sessions.get(sessionId) === win) sessions.delete(sessionId);
  });
  // 自定义 scheme 会让 playwright 无法附加（spike 实测）；只加载 about:blank。
  win.loadURL('about:blank');
  sessions.set(sessionId, win);
}

function readBody(request, callback) {
  let body = '';
  request.on('data', (chunk) => {
    body += chunk;
    if (body.length > 4096) request.destroy();
  });
  request.on('end', () => callback(body));
}

app.whenReady().then(async () => {
  try {
    const deny = await startDenyProxy();
    denyProxyUrl = deny.url;
    denyServer = deny.server;
  } catch (error) {
    // 拒绝代理起不来就不能保证失败关闭：直接退出，后端能力探测降级。
    app.exit(3);
    return;
  }
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'PUT' && req.url === '/sessions') {
      readBody(req, (body) => {
        try {
          const { session_id: sessionId } = JSON.parse(body);
          if (!sessionId || !SESSION_ID_PATTERN.test(sessionId)) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false }));
            return;
          }
          if (sessions.has(sessionId)) {
            res.statusCode = 204;
            res.end(JSON.stringify({ ok: false, error: 'exists' }));
            return;
          }
          if (sessions.size >= MAX_SESSIONS) {
            res.statusCode = 429;
            res.end(JSON.stringify({ ok: false, error: 'busy' }));
            return;
          }
          createSession(sessionId)
            .then(() => res.end(JSON.stringify({ ok: true })))
            .catch(() => {
              res.statusCode = 500;
              res.end(JSON.stringify({ ok: false }));
            });
        } catch (error) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false }));
        }
      });
      return;
    }
    if (req.method === 'DELETE' && req.url.startsWith('/sessions/')) {
      const sessionId = decodeURIComponent(
        req.url.slice('/sessions/'.length),
      );
      const win = sessions.get(sessionId);
      if (win) {
        sessions.delete(sessionId);
        try {
          win.destroy();
        } catch (error) {
          /* window already gone */
        }
      }
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.method === 'GET' && req.url === '/health') {
      res.end(
        JSON.stringify({
          ok: true,
          sessions: [...sessions.keys()],
          deny_hits: denyHits,
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false }));
  });
  server.listen(controlPort, '127.0.0.1');
});

app.on('window-all-closed', () => {
  // 宿主常驻；生命周期由主进程/后端管理。
});
