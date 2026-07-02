import * as Electron from "electron";
const { app, BrowserWindow } = Electron;

const pairingUrl = process.argv[2];
if (!pairingUrl) {
  console.error("usage: electron e2e-browser-probe-electron.mjs <pairingUrl>");
  process.exit(2);
}

const origin = new URL(pairingUrl).origin;
const backendOrigin = "http://localhost:13774";
const consoleMessages = [];
const networkFailures = [];
const wsEvents = [];
const authEvents = [];

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function attachDiagnostics(win) {
  const wc = win.webContents;
  wc.on("console-message", (_event, level, message, line, sourceId) => {
    if (level >= 2) {
      consoleMessages.push(`[console.${level}] ${message} (${sourceId}:${line})`);
    }
  });
  wc.on("render-process-gone", (_event, details) => {
    consoleMessages.push(
      `[render-process-gone] reason=${details.reason} exitCode=${details.exitCode}`,
    );
  });
  wc.session.webRequest.onErrorOccurred((details) => {
    networkFailures.push(`[requestfailed] ${details.method} ${details.url} -> ${details.error}`);
  });
  wc.session.webRequest.onBeforeRequest((details, callback) => {
    if (details.resourceType === "webSocket") {
      wsEvents.push(`[ws open] ${details.url}`);
    }
    callback({});
  });
  wc.session.webRequest.onCompleted((details) => {
    if (details.url.includes("/api/auth/")) {
      authEvents.push(`[auth completed] ${details.method} ${details.url} -> ${details.statusCode}`);
    }
  });
}

async function capture(win, path) {
  const image = await win.webContents.capturePage();
  await import("node:fs/promises").then((fs) => fs.writeFile(path, image.toPNG()));
}

async function bodyText(win) {
  return win.webContents.executeJavaScript("document.body?.innerText ?? ''", true);
}

async function dumpCookies(win, label) {
  const cookies = await win.webContents.session.cookies.get({ url: backendOrigin });
  console.log(`\n===== ${label} COOKIES (${backendOrigin}) =====`);
  for (const cookie of cookies) {
    console.log(
      `${cookie.name} domain=${cookie.domain} path=${cookie.path} secure=${cookie.secure} httpOnly=${cookie.httpOnly}`,
    );
  }
  if (cookies.length === 0) {
    console.log("(none)");
  }
}

async function main() {
  await app.whenReady();

  const win = new BrowserWindow({
    width: 1440,
    height: 1100,
    show: false,
    webPreferences: {
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  attachDiagnostics(win);

  console.log(`opening pairing url: ${pairingUrl}`);
  await win.loadURL(pairingUrl);
  await wait(5000);
  await capture(win, "/tmp/e2e-probe-1-after-pairing.png");
  console.log(`after pairing: url=${win.webContents.getURL()}`);
  console.log("\n===== AFTER PAIRING TEXT (first 1200 chars) =====");
  console.log((await bodyText(win)).slice(0, 1200));
  await dumpCookies(win, "AFTER PAIRING");

  const providersUrl = `${origin}/settings/providers`;
  console.log(`opening providers settings: ${providersUrl}`);
  await win.loadURL(providersUrl);
  await wait(15000);
  await capture(win, "/tmp/e2e-probe-2-providers.png");
  await dumpCookies(win, "AFTER PROVIDERS");

  const text = await bodyText(win);
  const checking = text.includes("Checking provider status");
  console.log("\n===== PROVIDERS PAGE TEXT (first 2000 chars) =====");
  console.log(text.slice(0, 2000));
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
  console.log("\n-- auth events --");
  for (const message of authEvents) {
    console.log(message);
  }
  console.log("\n-- websocket events --");
  for (const message of wsEvents) {
    console.log(message);
  }

  await win.close();
  await app.quit();
  process.exit(checking ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
