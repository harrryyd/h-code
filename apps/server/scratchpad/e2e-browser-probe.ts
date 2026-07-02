/**
 * Headless browser probe for the local pairing flow.
 *
 * Usage:
 *   node scratchpad/e2e-browser-probe.ts <pairingUrl>
 */
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { resolveElectronLaunchCommand } from "../../desktop/scripts/electron-launcher.mjs";

const pairingUrl = process.argv[2];
if (!pairingUrl) {
  console.error("usage: node e2e-browser-probe.ts <pairingUrl>");
  process.exit(2);
}

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const electronProbeEntry = NodePath.join(__dirname, "e2e-browser-probe-electron.mjs");

async function runPlaywrightProbe() {
  const { chromium } = await import("playwright");

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
    ws.on("socketerror", (error) => wsEvents.push(`[ws error] ${ws.url()} ${error}`));
  });

  console.log(`opening pairing url: ${pairingUrl}`);
  await page.goto(pairingUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: "/tmp/e2e-probe-1-after-pairing.png", fullPage: true });
  console.log(`after pairing: url=${page.url()}`);

  console.log(`opening providers settings: ${origin}/settings/providers`);
  await page.goto(`${origin}/settings/providers`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(15000);
  await page.screenshot({ path: "/tmp/e2e-probe-2-providers.png", fullPage: true });

  const bodyText = await page.evaluate(() => document.body.innerText);
  const checking = bodyText.includes("Checking provider status");
  console.log("\n===== PROVIDERS PAGE TEXT (first 2000 chars) =====");
  console.log(bodyText.slice(0, 2000));
  console.log("\n===== DIAGNOSTICS =====");
  console.log(`stuck on "Checking provider status": ${checking}`);
  console.log("\n-- console errors/warnings --");
  for (const message of consoleMessages) {
    console.log(message);
  }
  console.log("\n-- network failures --");
  for (const message of networkFailures) {
    console.log(message);
  }
  console.log("\n-- websocket events --");
  for (const message of wsEvents) {
    console.log(message);
  }

  await browser.close();
  process.exit(checking ? 1 : 0);
}

function runElectronFallbackProbe() {
  console.warn("playwright package not available; falling back to Electron probe");
  const electronCommand = resolveElectronLaunchCommand([electronProbeEntry, pairingUrl]);
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const child = NodeChildProcess.spawn(electronCommand.electronPath, electronCommand.args, {
    stdio: "inherit",
    env: {
      ...childEnv,
      ELECTRON_ENABLE_LOGGING: "1",
      ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    },
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.exit(1);
      return;
    }
    process.exit(code ?? 1);
  });
}

try {
  await runPlaywrightProbe();
} catch (error) {
  const missingPlaywright =
    error instanceof Error &&
    /Cannot find package 'playwright'|ERR_MODULE_NOT_FOUND/.test(error.message);
  if (!missingPlaywright) {
    throw error;
  }
  runElectronFallbackProbe();
}
