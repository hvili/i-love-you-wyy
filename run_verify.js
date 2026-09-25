const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");
const { spawn, execFileSync } = require("node:child_process");

const root = __dirname;
const expectedMessages = [
  "今晚月色很好",
  "西安有月亮",
  "长沙也有月亮",
  "只是我的身边",
  "少了一个你",
  "那就先把思念",
  "藏进今晚的月光里",
  "让它替我去长沙看看你",
  "等下一次见面",
  "再慢慢告诉你",
  "我有多想你",
  "中秋快乐 ♡"
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findBrowser() {
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const candidates = [
    process.env.CHROME_BIN,
    process.env.EDGE_BIN,
    path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe")
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ({
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".mp3": "audio/mpeg"
  })[ext] || "application/octet-stream";
}

function startServer() {
  const server = http.createServer((request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    } catch {
      response.writeHead(400).end();
      return;
    }

    const relativePath = pathname.replace(/^[/\\]+/, "") || "index.html";
    const filePath = path.resolve(root, relativePath);
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
      response.writeHead(403).end();
      return;
    }

    fs.stat(filePath, (error, stat) => {
      if (error || !stat.isFile()) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        "Content-Type": contentType(filePath),
        "Content-Length": stat.size,
        "Cache-Control": "no-store"
      });
      if (request.method === "HEAD") response.end();
      else fs.createReadStream(filePath).pipe(response);
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForDevTools(baseUrl, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/json/version`);
      if (response.ok) return response.json();
    } catch {
      // Chrome is still starting.
    }
    await sleep(200);
  }
  throw new Error("Chromium did not open its DevTools endpoint in time.");
}

function connectCdp(webSocketUrl, errors, badResponses) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    let nextId = 1;
    const pending = new Map();

    socket.addEventListener("open", () => {
      function send(method, params = {}, timeoutMs = 8000) {
        return new Promise((resolveCommand, rejectCommand) => {
          const id = nextId++;
          const timeout = setTimeout(() => {
            pending.delete(id);
            rejectCommand(new Error(`CDP timed out: ${method}`));
          }, timeoutMs);
          pending.set(id, { resolve: resolveCommand, reject: rejectCommand, timeout });
          socket.send(JSON.stringify({ id, method, params }));
        });
      }

      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        if (message.id && pending.has(message.id)) {
          const command = pending.get(message.id);
          pending.delete(message.id);
          clearTimeout(command.timeout);
          if (message.error) command.reject(new Error(message.error.message));
          else command.resolve(message.result || {});
          return;
        }

        if (message.method === "Runtime.exceptionThrown") {
          errors.push(message.params.exceptionDetails?.text || "Runtime exception");
        } else if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
          errors.push(message.params.args?.map((arg) => arg.value || arg.description || "").join(" ") || "console.error");
        } else if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
          errors.push(message.params.entry.text || "Console error");
        } else if (message.method === "Network.responseReceived" && message.params.response.status >= 400) {
          const url = message.params.response.url;
          if (url.includes("music.mp3")) badResponses.optionalMusic = message.params.response.status;
          else badResponses.items.push(`${message.params.response.status} ${url}`);
        }
      });

      socket.addEventListener("error", () => reject(new Error("DevTools WebSocket failed.")), { once: true });
      resolve({ send, socket });
    }, { once: true });
    socket.addEventListener("error", () => reject(new Error("Could not connect to DevTools.")), { once: true });
  });
}

async function main() {
  const browserPath = findBrowser();
  if (!browserPath) throw new Error("Install Chrome or Edge, or set CHROME_BIN / EDGE_BIN.");

  const outputRoot = path.join(root, "test_output");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = path.join(outputRoot, `matrix-qa-${stamp}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const server = await startServer();
  const sitePort = server.address().port;
  const devToolsPort = await freePort();
  const siteUrl = `http://127.0.0.1:${sitePort}/`;
  const devToolsUrl = `http://127.0.0.1:${devToolsPort}`;
  const profileDir = path.join(outputDir, "browser-profile");
  fs.mkdirSync(profileDir, { recursive: true });

  const browser = spawn(browserPath, [
    "--headless=new",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--remote-allow-origins=*",
    `--remote-debugging-port=${devToolsPort}`,
    `--user-data-dir=${profileDir}`,
    "about:blank"
  ], { stdio: "ignore", windowsHide: true });

  let socket;
  let targetId;
  const consoleErrors = [];
  const badResponses = { optionalMusic: null, items: [] };
  const arrivals = [];

  try {
    const version = await waitForDevTools(devToolsUrl);
    const targetResponse = await fetch(`${devToolsUrl}/json/new?${siteUrl}`, { method: "PUT" });
    if (!targetResponse.ok) throw new Error(`Could not open browser tab: ${targetResponse.status}`);
    const target = await targetResponse.json();
    targetId = target.id;
    const cdp = await connectCdp(target.webSocketDebuggerUrl, consoleErrors, badResponses);
    socket = cdp.socket;

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");
    await cdp.send("Network.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true
    });
    await cdp.send("Page.navigate", { url: siteUrl });

    async function evaluate(expression, awaitPromise = false) {
      const result = await cdp.send("Runtime.evaluate", {
        expression,
        awaitPromise,
        returnByValue: true,
        userGesture: true
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text || "Page evaluation failed.");
      }
      return result.result?.value;
    }

    const domDeadline = Date.now() + 10000;
    let domReady = await evaluate("document.readyState === 'complete' && Boolean(document.getElementById('app'))");
    while (!domReady && Date.now() < domDeadline) {
      await sleep(100);
      domReady = await evaluate("document.readyState === 'complete' && Boolean(document.getElementById('app'))");
    }
    if (!domReady) throw new Error("The page did not finish loading.");

    async function snapshot() {
      return evaluate(`(() => ({
        text: document.getElementById('sr-status').textContent,
        index: Number(document.getElementById('app').dataset.messageIndex),
        phase: document.getElementById('app').dataset.phase,
        width: innerWidth,
        height: innerHeight,
        dpr: devicePixelRatio,
        docWidth: document.documentElement.scrollWidth,
        docHeight: document.documentElement.scrollHeight,
        scene: (() => { const r = document.getElementById('scene').getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; })(),
        rainCanvas: { width: document.getElementById('rain-canvas').width, height: document.getElementById('rain-canvas').height },
        musicHidden: document.getElementById('music-toggle').hidden
      }))()`);
    }

    async function capture(fileName) {
      const result = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      fs.writeFileSync(path.join(outputDir, fileName), Buffer.from(result.data, "base64"));
    }

    const pageDeadline = Date.now() + 10000;
    let mobile = await snapshot();
    while ((!mobile.text || mobile.text === "中秋祝福准备中") && Date.now() < pageDeadline) {
      await sleep(100);
      mobile = await snapshot();
    }
    if (!mobile.text || mobile.text === "中秋祝福准备中") throw new Error("The greeting page did not start.");
    if (mobile.width !== 390 || mobile.height !== 844) throw new Error(`Unexpected mobile viewport: ${mobile.width}×${mobile.height}`);
    if (mobile.docWidth !== mobile.width || mobile.docHeight !== mobile.height) {
      throw new Error(`Mobile page scrolls: document ${mobile.docWidth}×${mobile.docHeight}, viewport ${mobile.width}×${mobile.height}`);
    }
    if (Math.abs(mobile.scene.width / mobile.scene.height - 16 / 9) > 0.015) throw new Error("The scene is not 16:9.");
    if (mobile.rainCanvas.width !== Math.round(mobile.scene.width * Math.min(mobile.dpr, 2))) throw new Error("Rain canvas DPR is incorrect.");
    const startedAt = Date.now();
    arrivals.push({ index: 0, text: mobile.text, elapsedSeconds: 0 });
    console.log(`[0s] ${mobile.text}`);

    await sleep(900);
    await capture("01-mobile-code-rain-and-particles.png");
    const visualCounts = await evaluate(`(() => {
      function countPixels(id, mode) {
        const canvas = document.getElementById(id);
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let count = 0;
        for (let i = 0; i < data.length; i += 28) {
          if (mode === 'rain' && data[i + 3] > 35 && Math.max(data[i], data[i + 1], data[i + 2]) > 110) count++;
          if (mode === 'particles' && data[i + 3] > 90 && data[i] > 220 && data[i + 1] > 220 && data[i + 2] > 220) count++;
        }
        return count;
      }
      const particleCanvas = document.getElementById('particle-canvas');
      const particleContext = particleCanvas.getContext('2d');
      const corners = [
        [0.06, 0.08], [0.94, 0.08], [0.06, 0.92], [0.94, 0.92]
      ].map(([x, y]) => particleContext.getImageData(Math.floor(particleCanvas.width * x), Math.floor(particleCanvas.height * y), 1, 1).data[3]);
      return {
        rain: countPixels('rain-canvas', 'rain'),
        particles: countPixels('particle-canvas', 'particles'),
        particleCanvasCornerAlpha: Math.max(...corners)
      };
    })()`);
    if (visualCounts.rain < 20) throw new Error(`Code rain appears empty (${visualCounts.rain} bright samples).`);
    if (visualCounts.particles < 10) throw new Error(`Particle message appears empty (${visualCounts.particles} bright samples).`);
    if (visualCounts.particleCanvasCornerAlpha > 140) throw new Error("Particle trail layer is obscuring the code rain.");

    const fps = await evaluate(`new Promise(resolve => {
      let frames = 0;
      const start = performance.now();
      function sample(now) {
        frames++;
        if (now - start >= 1400) resolve({ frames, fps: Math.round(frames * 1000 / (now - start)) });
        else requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    })`, true);

    const checksumExpression = `(() => {
      const data = document.getElementById('rain-canvas').getContext('2d').getImageData(0, 0, document.getElementById('rain-canvas').width, document.getElementById('rain-canvas').height).data;
      let hash = 2166136261;
      for (let i = 0; i < data.length; i += 67) hash = Math.imul(hash ^ data[i], 16777619);
      return hash >>> 0;
    })()`;

    for (let index = 1; index < expectedMessages.length; index += 1) {
      const deadline = Date.now() + 12000;
      let current = await snapshot();
      while (current.text !== expectedMessages[index] && Date.now() < deadline) {
        if (current.index > index) throw new Error(`Skipped message ${expectedMessages[index]}; saw ${current.text}`);
        await sleep(90);
        current = await snapshot();
      }
      if (current.text !== expectedMessages[index]) throw new Error(`Timed out waiting for: ${expectedMessages[index]}`);
      arrivals.push({ index, text: current.text, elapsedSeconds: Math.round((Date.now() - startedAt) / 100) / 10 });
      console.log(`[${arrivals.at(-1).elapsedSeconds}s] ${current.text}`);

      if (index === 11) {
        const hiddenState = await evaluate(`(() => {
          const canvas = document.getElementById('rain-canvas');
          const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
          let beforeHash = 2166136261;
          for (let i = 0; i < data.length; i += 67) beforeHash = Math.imul(beforeHash ^ data[i], 16777619);
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__matrixQaHidden === true });
          window.__matrixQaHidden = true;
          document.dispatchEvent(new Event('visibilitychange'));
          return { hidden: document.hidden, phase: document.getElementById('app').dataset.phase, text: document.getElementById('sr-status').textContent, beforeHash: beforeHash >>> 0 };
        })()`);
        await sleep(1200);
        const pausedState = await snapshot();
        const after = await evaluate(checksumExpression);
        if (!hiddenState.hidden || pausedState.text !== hiddenState.text || pausedState.phase !== hiddenState.phase || hiddenState.beforeHash !== after) {
          throw new Error("Animation did not pause while the page was hidden.");
        }
        await evaluate(`(() => { window.__matrixQaHidden = false; document.dispatchEvent(new Event('visibilitychange')); return document.hidden; })()`);
        await sleep(250);
        const resumedChecksum = await evaluate(checksumExpression);
        if (resumedChecksum === after) throw new Error("Animation did not resume when the page became visible.");
        console.log("Visibility pause/resume: passed");
      }

      if ([4, 7, 10, 11].includes(index)) {
        const phaseDeadline = Date.now() + 4500;
        while (Date.now() < phaseDeadline) {
          current = await snapshot();
          if (current.index === index && (current.phase === "hold" || current.phase === "final")) break;
          await sleep(80);
        }
        const fileNames = {
          4: "02-less-one-you.png",
          7: "03-long-message.png",
          10: "04-how-much-i-miss-you.png",
          11: "05-final-mid-autumn.png"
        };
        await capture(fileNames[index]);
      }
    }
    const intervals = [];
    for (let i = 1; i < arrivals.length; i += 1) {
      intervals.push({
        from: arrivals[i - 1].index,
        to: arrivals[i].index,
        seconds: Number((arrivals[i].elapsedSeconds - arrivals[i - 1].elapsedSeconds).toFixed(1))
      });
    }
    for (const interval of intervals) {
      if ([1, 2, 3].includes(interval.from) && (interval.seconds < 2.2 || interval.seconds > 3.8)) {
        throw new Error(`Quick-sequence pacing out of range (${interval.from}→${interval.to}: ${interval.seconds}s).`);
      }
      if ([4, 7, 10].includes(interval.from) && (interval.seconds < 4 || interval.seconds > 5.8)) {
        throw new Error(`Emphasis pacing out of range (${interval.from}→${interval.to}: ${interval.seconds}s).`);
      }
    }

    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
    await sleep(350);
    const landscape = await snapshot();
    if (landscape.width !== 844 || landscape.height !== 390 || landscape.docWidth !== 844 || landscape.docHeight !== 390) {
      throw new Error(`Landscape viewport failed: ${JSON.stringify(landscape)}`);
    }
    if (Math.abs(landscape.scene.width / landscape.scene.height - 16 / 9) > 0.015) throw new Error("Landscape scene is not 16:9.");
    await capture("06-landscape-844x390.png");

    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(350);
    const desktop = await snapshot();
    if (desktop.width !== 1440 || desktop.height !== 900 || desktop.docWidth !== 1440 || desktop.docHeight !== 900) {
      throw new Error(`Desktop viewport failed: ${JSON.stringify(desktop)}`);
    }
    await capture("07-desktop-1440x900.png");

    if (badResponses.items.length) throw new Error(`Unexpected HTTP errors: ${badResponses.items.join(", ")}`);
    const uniqueConsoleErrors = [...new Set(consoleErrors)];
    if (uniqueConsoleErrors.length) throw new Error(`Browser console errors: ${uniqueConsoleErrors.join(" | ")}`);

    const report = {
      browser: version.Browser,
      url: siteUrl,
      mobileViewport: { width: mobile.width, height: mobile.height, dpr: mobile.dpr, document: `${mobile.docWidth}×${mobile.docHeight}`, scene: mobile.scene },
      visibleCanvasSamples: visualCounts,
      sampledAnimationFps: fps.fps,
      messageSequence: arrivals,
      messageIntervals: intervals,
      hiddenPagePauseResume: "passed",
      landscapeViewport: { width: landscape.width, height: landscape.height, scene: landscape.scene },
      desktopViewport: { width: desktop.width, height: desktop.height, scene: desktop.scene },
      consoleErrors: uniqueConsoleErrors,
      optionalMusic: badResponses.optionalMusic ? `HTTP ${badResponses.optionalMusic}` : "disabled; no request",
      screenshots: fs.readdirSync(outputDir).filter((file) => file.endsWith(".png"))
    };
    fs.writeFileSync(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Animation sample: ${fps.fps} fps; rain=${visualCounts.rain}, particles=${visualCounts.particles}`);
    console.log(`Console errors: ${uniqueConsoleErrors.length}; screenshots: ${report.screenshots.length}`);
    console.log(`QA report: ${path.join(outputDir, "report.json")}`);
  } finally {
    if (socket && socket.readyState === WebSocket.OPEN) socket.close();
    if (targetId) {
      try { await fetch(`${devToolsUrl}/json/close/${targetId}`); } catch { /* Browser is shutting down. */ }
    }
    await new Promise((resolve) => server.close(resolve));
    if (browser.pid && process.platform === "win32") {
      try { execFileSync("taskkill.exe", ["/PID", String(browser.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); }
      catch { browser.kill(); }
    } else {
      browser.kill("SIGTERM");
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
