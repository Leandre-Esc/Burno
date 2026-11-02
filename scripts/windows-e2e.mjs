// Launches the installed Burno on Windows and drives it through the webview's debugging port.
// Needs the APP env var (path of the installed exe).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const DEBUG_PORT = 9222;
const SHOTS = "e2e-screenshots";
const COLLECTION = join(process.env.APPDATA, "com.burno.app", "collections", "My Collection");

mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A local API with one route that works and one that fails
const hits = [];
const server = createServer((req, res) => {
  hits.push(`${req.method} ${req.url}`);
  res.writeHead(req.url === "/fail" ? 500 : 200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: req.url !== "/fail" }));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const app = spawn(process.env.APP, [], {
  stdio: "inherit",
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${DEBUG_PORT}` },
});
let exited = null;
app.on("exit", (code) => (exited = code ?? "signal"));

let ws;
let nextId = 1;
const pending = new Map();

/** Sends a Chrome DevTools Protocol command to the app's webview */
function cdp(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject, method }));
}

async function connect() {
  const end = Date.now() + 60000;
  for (;;) {
    if (exited !== null) throw new Error(`Burno exited with code ${exited}`);
    const targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
      .then((r) => r.json())
      .catch(() => []);
    const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
    if (page) {
      ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = () => reject(new Error("Could not connect to the webview"));
      });
      ws.onmessage = ({ data }) => {
        const { id, result, error } = JSON.parse(data);
        const call = pending.get(id);
        if (!call) return;
        pending.delete(id);
        if (error) call.reject(new Error(`${call.method}: ${error.message}`));
        else call.resolve(result);
      };
      return;
    }
    if (Date.now() > end) throw new Error("The webview debugging port never opened");
    await sleep(500);
  }
}

async function evaluate(expression) {
  const { result, exceptionDetails } = await cdp("Runtime.evaluate", { expression, returnByValue: true });
  if (exceptionDetails) throw new Error(`Page error: ${exceptionDetails.text}`);
  return result.value;
}

/** Waits for a visible element and returns its center */
async function find(css, timeout = 20000) {
  const q = JSON.stringify(css);
  const end = Date.now() + timeout;
  for (;;) {
    const c = await evaluate(`(() => {
      const el = document.querySelector(${q});
      if (!el) return null;
      el.scrollIntoView({ block: "nearest" });
      const r = el.getBoundingClientRect();
      return r.width && r.height ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    })()`);
    if (c) return c;
    if (Date.now() > end) throw new Error(`Not found: ${css}`);
    await sleep(200);
  }
}
async function click(css) {
  const { x, y } = await find(css);
  const mouse = { x, y, button: "left", clickCount: 1 };
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...mouse });
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...mouse });
}
/** Replaces the content of an input, through real key events */
async function type(css, value) {
  await click(css);
  const a = { key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2, commands: ["selectAll"] };
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", ...a });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...a });
  await cdp("Input.insertText", { text: value });
}
const text = async (css) => evaluate(`document.querySelector(${JSON.stringify(css)})?.innerText ?? ""`);
const gone = async (css) => evaluate(`!document.querySelector(${JSON.stringify(css)})`);
async function shot(name) {
  const { data } = await cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(data, "base64"));
}
async function until(what, check, timeout = 20000) {
  const end = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`Timed out: ${what}`);
    await sleep(200);
  }
  console.log(`ok - ${what}`);
}

let failed = false;
try {
  await connect();
  await cdp("Emulation.setFocusEmulationEnabled", { enabled: true });

  await find(".brand-name");
  await until("default collection created on disk", () => existsSync(join(COLLECTION, "burno.json")));
  await shot("1-home");

  await click(".empty-state .btn-primary");
  await find(".url-input input");
  await until("new request written to disk", () => existsSync(join(COLLECTION, "New Request.json")));

  // Collection environment: file on disk, variable used in the URL
  await click(".env-picker");
  await click('[title="Configure collection environments"]');
  await click(".env-list .env-add");
  await find(".env-name");
  const envFile = join(COLLECTION, "environments", "New Environment.json");
  await until("environment file created", () => existsSync(envFile));
  await type(".env-editor .kv-table tr:first-child td:nth-child(2) input", "base");
  await type(".env-editor .kv-table tr:first-child td:nth-child(3) input", base);
  await click(".env-editor-header .btn");
  await until("variable saved in the environment file", () => readFileSync(envFile, "utf8").includes(base));
  await shot("2-environment");
  await click('.modal [title="Close"]');

  await type(".url-input input", "{{base}}/ok");
  await click(".send-btn");
  await until("request sent with the resolved variable", () => hits.includes("GET /ok"));
  await until("200 shown", async () => (await text(".status-pill")).includes("200"));
  await shot("3-success");

  // Hand-made dropdown, then an error response
  await click(".method-select");
  await click(".dropdown-menu li.method-POST");
  await type(".url-input input", "{{base}}/fail");
  await click(".send-btn");
  await until("POST sent through the dropdown choice", () => hits.includes("POST /fail"));
  await find(".burned");
  console.log("ok - burned popup on a 500");
  await sleep(1500);
  await shot("4-burned");
  await click(".burned-btn");
  await until("popup closed", () => gone(".burned"));
  await until("500 shown", async () => (await text(".status-pill")).includes("500"));

  // No server listening: network error
  await type(".url-input input", "http://127.0.0.1:1/");
  await click(".send-btn");
  await find(".burned");
  console.log("ok - burned popup on a network error");
  await click(".burned-btn");
  await until("popup closed again", () => gone(".burned"));
  await shot("5-end");
} catch (e) {
  failed = true;
  console.error(`FAILED: ${e.message}`);
  if (ws) await shot("failure").catch(() => {});
} finally {
  ws?.close();
  spawnSync("taskkill", ["/PID", String(app.pid), "/T", "/F"]);
  server.close();
}
process.exit(failed ? 1 : 0);
