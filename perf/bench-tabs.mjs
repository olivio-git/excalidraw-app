#!/usr/bin/env node
/**
 * Tab performance benchmark: runs the real app in Chromium (Playwright) with a
 * mocked Tauri backend (perf/harness/tauri-mock.ts) and measures:
 *
 *   switch   time from clicking a tab until the next frame is painted, over
 *            several rounds through 3 diagrams + 3 notes, with ~220 explorer
 *            nodes visible; plus long tasks (>50 ms, felt as stutter)
 *   restore  startup with 6 tabs restored from the last session: when the main
 *            thread stops being blocked (end of the last long task), long
 *            tasks, and how many diagram canvases were mounted
 *
 * Usage:
 *   pnpm bench:tabs                 production build (closest to the installed app)
 *   pnpm bench:tabs --dev           Vite dev server (no build; slower numbers)
 *   pnpm bench:tabs --md            open .md files in the Markdown editor
 *   pnpm bench:tabs --rounds 10     more switch rounds (default 5)
 *   pnpm bench:tabs --json          machine-readable output
 *   pnpm bench:tabs --single-click  open files with one click (older builds
 *                                   without preview tabs, to compare against)
 *
 * First time: `pnpm exec playwright install chromium`.
 * Numbers are relative: compare runs on the same machine, before vs after.
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build, createServer, preview } from "vite";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configFile = resolve(root, "perf/vite.perf.config.ts");
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const dev = flag("dev");
const rounds = Number(option("rounds", 5));
const markdown = flag("md");

const log = (...parts) => {
  if (!flag("json")) console.error(...parts);
};

async function startServer() {
  if (dev) {
    const server = await createServer({ configFile, root, server: { port: 5198 } });
    await server.listen();
    return { url: server.resolvedUrls.local[0], close: () => server.close() };
  }
  if (!flag("no-build")) {
    log("Building the app (production)…");
    await build({ configFile, root, logLevel: "warn" });
  }
  const server = await preview({ configFile, root, preview: { port: 5197 } });
  return { url: server.resolvedUrls.local[0], close: () => server.close() };
}

const round1 = (value) => Math.round(value * 10) / 10;

function stats(times) {
  const sorted = [...times].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return { median: round1(at(0.5)), p90: round1(at(0.9)), max: round1(sorted.at(-1)) };
}

async function openApp(browser, url, query = "") {
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  // Count long tasks from the very start (including app boot).
  await page.addInitScript(() => {
    window.__longTasks = [];
    window.__longTaskEnds = [];
    new PerformanceObserver((list) =>
      list.getEntries().forEach((entry) => {
        window.__longTasks.push(entry.duration);
        window.__longTaskEnds.push(entry.startTime + entry.duration);
      })
    ).observe({ type: "longtask", buffered: true });
  });
  await page.goto(`${url}perf/harness/app.html${query}`, { waitUntil: "load" });
  return { page, errors };
}

async function benchSwitch(browser, url) {
  const { page, errors } = await openApp(browser, url, markdown ? "?md=markdown" : "");
  await page.waitForSelector("text=proyecto", { timeout: 60000 });
  // `.last()`: the tree row, not the explorer breadcrumb showing the same name.
  const click = async (name, wait) => {
    await page.getByText(name, { exact: true }).last().click();
    await page.waitForTimeout(wait);
  };
  // Double-click keeps each file in its own tab (a single click only previews).
  // --single-click: for builds without preview tabs, where a click already keeps it.
  const open = async (name) => {
    const target = page.getByText(name, { exact: true }).last();
    await (flag("single-click") ? target.click() : target.dblclick());
    await page.waitForTimeout(1200);
  };
  for (const folder of ["diagrams", "notes", "proyecto"]) await click(folder, 150);
  for (let i = 0; i < 10; i++) await click(`carpeta-${i}`, 100);
  for (let i = 1; i <= 3; i++) await open(`diagrama-${i}.excalidraw`);
  for (let i = 1; i <= 3; i++) await open(`nota-${i}.md`);
  await page.waitForTimeout(2000);

  const result = await page.evaluate(async (rounds) => {
    const buttons = [...document.querySelectorAll("[data-tab-button]")];
    const nextFrame = () =>
      new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    window.__longTasks.length = 0;
    const times = [];
    for (let round = 0; round < rounds; round++) {
      for (const button of buttons) {
        const start = performance.now();
        button.click();
        await nextFrame();
        times.push(performance.now() - start);
        await new Promise((done) => setTimeout(done, 120));
      }
    }
    return { tabs: buttons.length, times, longTasks: [...window.__longTasks] };
  }, rounds);
  await page.close();
  return {
    tabs: result.tabs,
    switches: result.times.length,
    ...stats(result.times),
    longTasks: result.longTasks.length,
    longTaskMs: Math.round(result.longTasks.reduce((sum, value) => sum + value, 0)),
    errors,
  };
}

async function benchRestore(browser, url) {
  const query = `?restore=6${markdown ? "&md=markdown" : ""}`;
  const { page, errors } = await openApp(browser, url, query);
  await page.waitForSelector("[data-tab-button]", { timeout: 60000 });
  // Settled: no long task for 1.5 s.
  await page.evaluate(
    () =>
      new Promise((done) => {
        let seen = window.__longTasks.length;
        const check = () => {
          if (window.__longTasks.length === seen) done();
          else {
            seen = window.__longTasks.length;
            setTimeout(check, 1500);
          }
        };
        setTimeout(check, 1500);
      })
  );
  const result = await page.evaluate(() => ({
    longTasks: [...window.__longTasks],
    // performance.now() starts at navigation: when the main thread was last blocked.
    busyUntil: Math.max(0, ...window.__longTaskEnds),
    canvases: document.querySelectorAll(".excalidraw-container, .excalidraw").length,
    tabs: document.querySelectorAll("[data-tab-button]").length,
  }));
  await page.close();
  return {
    tabs: result.tabs,
    busyUntilMs: Math.round(result.busyUntil),
    longTasks: result.longTasks.length,
    longTaskMs: Math.round(result.longTasks.reduce((sum, value) => sum + value, 0)),
    diagramCanvasesMounted: result.canvases,
    errors,
  };
}

const server = await startServer();
const browser = await chromium.launch();
try {
  log(`Measuring against ${server.url} (${dev ? "dev" : "production"} build)…`);
  const results = {
    mode: dev ? "dev" : "production",
    editor: markdown ? "markdown" : "classic",
    switch: await benchSwitch(browser, server.url),
    restore: await benchRestore(browser, server.url),
  };
  if (flag("json")) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    const s = results.switch;
    const r = results.restore;
    console.log(`\nTab switch (${s.switches} switches over ${s.tabs} tabs, ${results.mode})`);
    console.log(`  median ${s.median} ms · p90 ${s.p90} ms · max ${s.max} ms`);
    console.log(`  long tasks: ${s.longTasks} (${s.longTaskMs} ms total)`);
    console.log(`\nStartup restoring ${r.tabs} tabs`);
    console.log(
      `  settled after ~${r.settledMs} ms · long tasks: ${r.longTasks} (${r.longTaskMs} ms)`
    );
    console.log(`  diagram canvases mounted: ${r.diagramCanvasesMounted}`);
    const errors = [...s.errors, ...r.errors];
    if (errors.length) console.log(`\nPage errors:\n  ${errors.slice(0, 5).join("\n  ")}`);
  }
} finally {
  await browser.close();
  await server.close();
}
