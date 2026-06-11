/**
 * Headless-browser probe for the real dev flow.
 * Opens the pairing URL, then the providers settings page, and reports:
 *  - console errors/warnings
 *  - failed network requests + hung websockets
 *  - provider row status text (the "Checking provider status" hang)
 * Saves screenshots to /tmp/e2e-probe-*.png
 *
 * Usage: node scratchpad/e2e-browser-probe.ts <pairingUrl>
 */
import { chromium } from "playwright";

const pairingUrl = process.argv[2];
if (!pairingUrl) {
  console.error("usage: node e2e-browser-probe.ts <pairingUrl>");
  process.exit(2);
}
const origin = new URL(pairingUrl).origin;

const consoleMessages: string[] = [];
const networkFailures: string[] = [];
const wsEvents: string[] = [];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

// Wrap WebSocket to capture who closes the connection and the first frames.
await page.addInitScript(() => {
  const OriginalWebSocket = window.WebSocket;
  let socketCounter = 0;
  const log = (...args: unknown[]) => console.log("[WSPROBE]", ...args);
  // @ts-expect-error override
  window.WebSocket = class extends OriginalWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      const socketId = ++socketCounter;
      const urlText = String(url);
      if (!urlText.includes("/ws")) return; // skip vite hmr
      const t0 = Date.now();
      let sent = 0;
      let received = 0;
      log(`#${socketId} new ${urlText.slice(0, 80)}`);
      const originalSend = this.send.bind(this);
      this.send = (data: any) => {
        sent += 1;
        if (sent <= 5) log(`#${socketId} +${Date.now() - t0}ms send[${sent}]: ${String(data).slice(0, 200)}`);
        return originalSend(data);
      };
      const originalClose = this.close.bind(this);
      this.close = (code?: number, reason?: string) => {
        log(`#${socketId} +${Date.now() - t0}ms CLIENT close(${code ?? ""}, ${reason ?? ""})`);
        return originalClose(code, reason);
      };
      this.addEventListener("open", () => log(`#${socketId} +${Date.now() - t0}ms open`));
      this.addEventListener("message", (event: MessageEvent) => {
        received += 1;
        if (received <= 5)
          log(`#${socketId} +${Date.now() - t0}ms recv[${received}]: ${String(event.data).slice(0, 200)}`);
      });
      this.addEventListener("close", (event: CloseEvent) =>
        log(
          `#${socketId} +${Date.now() - t0}ms closed code=${event.code} reason=${event.reason} wasClean=${event.wasClean} (sent=${sent} received=${received})`,
        ),
      );
      this.addEventListener("error", () => log(`#${socketId} +${Date.now() - t0}ms error event`));
    }
  };
});

page.on("console", (message) => {
  if (message.text().startsWith("[WSPROBE]")) {
    consoleMessages.push(message.text());
    return;
  }
  if (message.type() === "error" || message.type() === "warning") {
    consoleMessages.push(`[console.${message.type()}] ${message.text()}`);
  }
});
page.on("pageerror", (error) => {
  consoleMessages.push(`[pageerror] ${error.message}`);
});
page.on("requestfailed", (request) => {
  networkFailures.push(`[requestfailed] ${request.method()} ${request.url()} -> ${request.failure()?.errorText}`);
});
page.on("response", (response) => {
  if (response.status() >= 400) {
    response
      .text()
      .then((text) => {
        networkFailures.push(
          `[http ${response.status()}] ${response.request().method()} ${response.url()} -> ${text.slice(0, 300)}`,
        );
      })
      .catch(() => {
        networkFailures.push(`[http ${response.status()}] ${response.request().method()} ${response.url()}`);
      });
  }
});
page.on("websocket", (ws) => {
  wsEvents.push(`[ws open] ${ws.url()}`);
  ws.on("close", () => wsEvents.push(`[ws close] ${ws.url()}`));
  ws.on("socketerror", (err) => wsEvents.push(`[ws error] ${ws.url()} ${err}`));
});

const authRequests: string[] = [];
page.on("request", (request) => {
  if (request.url().includes("/api/auth/")) {
    authRequests.push(`[req +${Date.now() - startTime}ms] ${request.method()} ${request.url()}`);
  }
});
page.on("response", (response) => {
  if (response.url().includes("/api/auth/")) {
    authRequests.push(`[res +${Date.now() - startTime}ms] ${response.status()} ${response.url()}`);
  }
});
const startTime = Date.now();

console.log(`opening pairing url: ${pairingUrl}`);
await page.goto(pairingUrl, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);
await page.screenshot({ path: "/tmp/e2e-probe-1-after-pairing.png", fullPage: true });
console.log(`after pairing: url=${page.url()}`);
console.log("cookies after pairing:", JSON.stringify(await page.context().cookies()));

console.log(`opening providers settings: ${origin}/settings/providers`);
await page.goto(`${origin}/settings/providers`, { waitUntil: "domcontentloaded" });
// Give provider statuses ample time to arrive.
await page.waitForTimeout(15000);
await page.screenshot({ path: "/tmp/e2e-probe-2-providers.png", fullPage: true });

console.log("cookies after providers nav:", JSON.stringify(await page.context().cookies()));
console.log("\n-- auth request sequence --");
for (const m of authRequests) console.log(m);

const bodyText = await page.evaluate(() => document.body.innerText);
const checking = bodyText.includes("Checking provider status");
console.log("\n===== PROVIDERS PAGE TEXT (first 2000 chars) =====");
console.log(bodyText.slice(0, 2000));
console.log("\n===== DIAGNOSTICS =====");
console.log(`stuck on "Checking provider status": ${checking}`);
console.log("\n-- console errors/warnings --");
for (const m of consoleMessages) console.log(m);
console.log("\n-- network failures --");
for (const m of networkFailures) console.log(m);
console.log("\n-- websocket events --");
for (const m of wsEvents) console.log(m);

await browser.close();
process.exit(checking ? 1 : 0);
