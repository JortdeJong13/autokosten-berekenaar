/**
 * Test harness: load the extension's real content scripts into a WebKit page
 * with a minimal `chrome` API shim, so tests drive the same code Safari runs.
 */
import { webkit } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

export const SAFARI_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

export const ANWB_URL = 'https://www.anwb.nl/auto/autokosten/berekenen';

export function readSource(relativePath) {
  return readFileSync(new URL(relativePath, new URL('..', import.meta.url)), 'utf8');
}

/**
 * Chrome extension API shim. `initialStorage` seeds chrome.storage.local.
 * Records the last `lastResult` the automation writes.
 */
export function chromeShim(initialStorage = {}) {
  const store = { ...(initialStorage || {}) };

  return {
    __store: store,
    storage: {
      local: {
        get(keys, cb) {
          const list = Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const k of list) if (k in store) out[k] = store[k];
          const p = Promise.resolve(out);
          if (cb) p.then(cb);
          return p;
        },
        set(items, cb) {
          Object.assign(store, items);
          const p = Promise.resolve();
          if (cb) p.then(cb);
          return p;
        },
        remove(keys, cb) {
          for (const k of (Array.isArray(keys) ? keys : [keys])) delete store[k];
          const p = Promise.resolve();
          if (cb) p.then(cb);
          return p;
        },
      },
    },
    runtime: {
      onMessage: { addListener() {} },
      sendMessage() {},
      lastError: null,
    },
  };
}

/**
 * Launch WebKit and return a page on `url` with the given scripts injected
 * (in order) at document start.
 */
export async function openPage({ url = ANWB_URL, scripts = [], storage = {}, recordConsole = false } = {}) {
  const browser = await webkit.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'nl-NL',
    timezoneId: 'Europe/Amsterdam',
    viewport: { width: 1440, height: 1400 },
    userAgent: SAFARI_UA,
  });

  const page = await context.newPage();
  const logs = [];
  if (recordConsole) {
    page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
    page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  }

  const shim = chromeShim(storage);
  await page.addInitScript(({ shimSource, sources, seed }) => {
    // eslint-disable-next-line no-new-func
    window.chrome = new Function('seed', `return (${shimSource})(seed)`)(seed);
    for (const src of sources) {
      // eslint-disable-next-line no-new-func
      new Function(src)();
    }
  }, { shimSource: chromeShim.toString(), sources: scripts, seed: storage });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // The shim's store lives inside the page, so read it back from there.
  const getStore = () => page.evaluate(() => window.chrome.__store);

  return { browser, context, page, logs, getStore, nodeStore: shim.__store };
}

/** Payload in the same shape the popup writes to chrome.storage.local. */
export function pendingCalculation({ licensePlate = 'X-353-NB', price = 24950, mileage = 68500 } = {}) {
  return {
    licensePlate,
    cleanPlate: licensePlate.replace(/-/g, ''),
    price,
    mileage,
    carTitle: 'Test occasion',
    timestamp: Date.now(),
  };
}

export { ROOT };
