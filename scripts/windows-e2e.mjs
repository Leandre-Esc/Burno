// Drives the installed Burno through tauri-driver (WebDriver) on Windows.
// Needs the APP env var (path of the installed exe) and tauri-driver on the PATH.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const DRIVER = "http://127.0.0.1:4444";
const ELEMENT = "element-6066-11e4-a52e-4f735466cecf";
const SHOTS = "e2e-screenshots";
const CTRL_A = "a";
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

const driver = spawn("tauri-driver", ["--native-driver", join(process.env.EDGEWEBDRIVER, "msedgedriver.exe")], {
  stdio: "inherit",
});

let session;

async function wd(method, path, body) {
  const res = await fetch(`${DRIVER}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body && JSON.stringify(body),
  });
  const { value } = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${value?.message ?? res.status}`);
  return value;
}
const s = (path) => `/session/${session}${path}`;

/** Waits for an element, then returns its WebDriver id */
async function find(css, timeout = 20000) {
  const end = Date.now() + timeout;
  for (;;) {
    try {
      return (await wd("POST", s("/element"), { using: "css selector", value: css }))[ELEMENT];
    } catch (e) {
      if (Date.now() > end) throw new Error(`Not found: ${css}`);
      await sleep(200);
    }
  }
}
const click = async (css) => wd("POST", s(`/element/${await find(css)}/click`), {});
const type = async (css, text) => {
  await click(css);
  await wd("POST", s(`/element/${await find(css)}/value`), { text: CTRL_A + text });
};
const text = async (css) => wd("GET", s(`/element/${await find(css)}/text`));
const gone = async (css) => (await wd("POST", s("/elements"), { using: "css selector", value: css })).length === 0;
async function shot(name) {
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(await wd("GET", s("/screenshot")), "base64"));
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
  await sleep(2000); // let tauri-driver start
  session = (
    await wd("POST", "/session", {
      capabilities: { alwaysMatch: { browserName: "wry", "tauri:options": { application: process.env.APP } } },
    })
  ).sessionId;

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
  if (session) await shot("failure").catch(() => {});
} finally {
  if (session) await wd("DELETE", s("")).catch(() => {});
  driver.kill();
  server.close();
}
process.exit(failed ? 1 : 0);
