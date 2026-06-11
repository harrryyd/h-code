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

page.on("console", (message) => {
  if (message.type() === "error" || message.type() === "warning") {
    consoleMessages.push(`[console.${message.type()}] ${message.text()}`);
  }
});
page.on("pageerror", (error) => {
  consoleMessages.push(`[pageerror] ${error.message}`);
});
page.on("requestfailed", (request) => {
  networkFailures.push(
    `[requestfailed] ${request.method()} ${request.url()} -> ${request.failure()?.errorText}`,
  );
});
page.on("websocket", (ws) => {
  wsEvents.push(`[ws open] ${ws.url()}`);
  ws.on("close", () => wsEvents.push(`[ws close] ${ws.url()}`));
  ws.on("socketerror", (err) => wsEvents.push(`[ws error] ${ws.url()} ${err}`));
});

console.log(`opening pairing url: ${pairingUrl}`);
await page.goto(pairingUrl, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);
await page.screenshot({ path: "/tmp/e2e-probe-1-after-pairing.png", fullPage: true });
console.log(`after pairing: url=${page.url()}`);

console.log(`opening providers settings: ${origin}/settings/providers`);
await page.goto(`${origin}/settings/providers`, { waitUntil: "domcontentloaded" });
// Give provider statuses ample time to arrive.
await page.waitForTimeout(15000);
await page.screenshot({ path: "/tmp/e2e-probe-2-providers.png", fullPage: true });

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
