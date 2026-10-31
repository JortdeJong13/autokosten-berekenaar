/**
 * UI tests: load the real popup HTML and the real AutoScout24 floating panel in
 * WebKit and assert they render the shared form and behave correctly.
 *
 * These catch wiring mistakes (a file missing from the manifest, a renamed
 * helper) that unit tests on pure functions cannot see.
 *
 *   node test/test_ui.mjs
 */
import { webkit } from 'playwright';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const fileUrl = (p) => pathToFileURL(path.join(ROOT, p)).href;

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
  }
}

const browser = await webkit.launch({ headless: true });

// ---------------------------------------------------------------------------
console.log('popup/popup.html');
// ---------------------------------------------------------------------------
{
  const context = await browser.newContext({ viewport: { width: 400, height: 700 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // chrome.* shim, installed before the popup's own scripts run.
  await page.addInitScript(() => {
    const store = {};
    window.chrome = {
      __store: store,
      storage: { local: {
        get: (keys, cb) => { const out = {}; for (const k of [].concat(keys)) if (k in store) out[k] = store[k]; cb(out); },
        set: (items, cb) => { Object.assign(store, items); cb && cb(); },
        remove: (keys, cb) => { for (const k of [].concat(keys)) delete store[k]; cb && cb(); },
      } },
      runtime: { lastError: null, sendMessage: (msg, cb) => cb && cb({ success: true }) },
      tabs: { create: (opts, cb) => { window.__tabs.push(opts.url); cb && cb({ id: 1 }); } },
    };
    window.__tabs = [];
  });

  // file:// pages can load sibling scripts, which is enough to exercise the popup.
  await page.goto(fileUrl('popup/popup.html'), { waitUntil: 'load' });
  await page.waitForTimeout(700);

  check('renders without JS errors', errors.length === 0, errors.join('\n'));

  const ui = await page.evaluate(() => ({
    hasForm: !!document.querySelector('.cce-form'),
    hasPlate: !!document.querySelector('[data-role="plate"]'),
    hasMileage: !!document.querySelector('[data-role="mileage"]'),
    hasPrice: !!document.querySelector('[data-role="price"]'),
    hasYears: !!document.querySelector('[data-role="years"]'),
    hasKmPerYear: !!document.querySelector('[data-role="kmPerYear"]'),
    hasProvince: !!document.querySelector('[data-role="province"]'),
    mileageLabel: document.querySelector('label[for="cce-mileage"]')?.textContent.trim(),
    yearsDefault: document.querySelector('[data-role="years"]')?.value,
    provinceDefault: document.querySelector('[data-role="province"]')?.value,
    kmPerYearDefault: document.querySelector('[data-role="kmPerYear"]')?.value,
    provinceCount: document.querySelector('[data-role="province"]')?.options.length,
    // The trailing "km" that collided with the stepper must be gone.
    hasTrailingKm: /km\s*$/i.test(document.querySelector('.cce-prefixed, .cce-row')?.textContent || ''),
  }));

  check('shared form rendered', ui.hasForm);
  check('all fields present', ui.hasPlate && ui.hasMileage && ui.hasPrice && ui.hasYears && ui.hasKmPerYear && ui.hasProvince);
  check('label reads "Km-stand"', ui.mileageLabel === 'Km-stand', `got "${ui.mileageLabel}"`);
  check('defaults applied (8 jaar / 10.000 / Noord-Holland)',
    ui.yearsDefault === '8' && ui.kmPerYearDefault === '10.000' && ui.provinceDefault === 'Noord-Holland',
    JSON.stringify(ui));
  check('all 12 provinces listed', ui.provinceCount === 12, `got ${ui.provinceCount}`);

  // Number formatting on input.
  await page.fill('[data-role="mileage"]', '205557');
  const mileage = await page.inputValue('[data-role="mileage"]');
  check('km-stand formats with dots', mileage === '205.557', `got "${mileage}"`);

  await page.fill('[data-role="price"]', '32950');
  const price = await page.inputValue('[data-role="price"]');
  check('price formats with dots', price === '32.950', `got "${price}"`);

  // Settings round-trip through the form.
  await page.selectOption('[data-role="years"]', '5');
  await page.fill('[data-role="kmPerYear"]', '15000');
  await page.selectOption('[data-role="province"]', 'Utrecht');
  const saved = await page.evaluate(() => window.chrome?.__store?.settings);
  check('settings persist to storage',
    saved?.ownershipYears === 5 && saved?.kmPerYear === 15000 && saved?.province === 'Utrecht',
    JSON.stringify(saved));

  // WebKit ignores padding on natively-styled selects, which used to leave the
  // dropdowns visibly shorter than the text inputs beside them.
  const heights = await page.evaluate(() => {
    const h = (role) => Math.round(document.querySelector(`[data-role="${role}"]`).getBoundingClientRect().height);
    return {
      years: h('years'), kmPerYear: h('kmPerYear'), province: h('province'),
      mileage: h('mileage'), price: h('price'),
      selectAppearance: getComputedStyle(document.querySelector('[data-role="years"]')).webkitAppearance,
    };
  });
  const all = [heights.years, heights.kmPerYear, heights.province, heights.mileage, heights.price];
  check('all form controls share one height', new Set(all).size === 1,
    `heights were ${JSON.stringify(heights)}`);
  check('selects do not use the native appearance', heights.selectAppearance === 'none',
    `appearance was "${heights.selectAppearance}"`);

  // A malformed plate is still rejected.
  await page.fill('[data-role="plate"]', 'ABC');
  await page.click('[data-role="submit"]');
  await page.waitForTimeout(200);
  const feedback = await page.textContent('[data-role="feedback"]');
  check('invalid kenteken shows an error', /geldig/i.test(feedback || ''), `got "${feedback}"`);

  // With no plate AND no vehicle details, submitting must be blocked: ANWB
  // cannot identify the car at all.
  await page.fill('[data-role="plate"]', '');
  await page.click('[data-role="submit"]');
  await page.waitForTimeout(200);
  const blocked = await page.textContent('[data-role="feedback"]');
  check('empty plate with no vehicle details is blocked',
    /kenteken in|merk en model/i.test(blocked || ''), `got "${blocked}"`);

  // With vehicle details, an empty plate is allowed and the field says so.
  await page.evaluate(() => {
    window.__form.setVehicleDetails({ brand: 'Mercedes-Benz', model: 'GLC 300' });
  });
  await page.waitForTimeout(100);
  const label = await page.textContent('[data-role="plate-label"]');
  check('vehicle details make the plate optional',
    /optioneel/i.test(label || ''), `label was "${label}"`);
  // The panel should stay quiet: no notice about a missing plate.
  const quiet = await page.evaluate(() => {
    const f = document.querySelector('[data-role="feedback"]');
    return { hidden: f ? f.hidden : true, text: f ? f.textContent : '' };
  });
  check('no notice about the missing plate',
    quiet.hidden || !/kenteken/i.test(quiet.text), JSON.stringify(quiet));

  await page.click('[data-role="submit"]');
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => {
    const p = window.chrome.__store.pendingCalculation;
    return { tabs: window.__tabs, plate: p ? p.licensePlate : 'no payload',
             vehicle: p ? p.vehicle : null };
  });
  check('opens the ANWB tab without a plate when vehicle details exist',
    after.tabs.length === 1 && after.tabs[0].includes('anwb.nl'), JSON.stringify(after));
  check('payload carries the vehicle details, not a plate',
    after.plate === null && after.vehicle?.brand === 'Mercedes-Benz' && after.vehicle?.model === 'GLC 300',
    JSON.stringify(after));

  await context.close();
}

// ---------------------------------------------------------------------------
console.log('\nAutoScout24 floating panel');
// ---------------------------------------------------------------------------
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // A stand-in for an AutoScout24 listing page.
  await page.setContent(`<!DOCTYPE html><html lang="nl"><body>
    <h1>Audi Q4 e-tron 35 S edition</h1>
    <dl><dt>Kenteken</dt><dd>X-353-NB</dd></dl>
    <div data-testid="VehicleDetails-mileage_road">68.500 km</div>
  </body></html>`);

  // Load the exact scripts the manifest injects for AutoScout24.
  await page.addScriptTag({ content: read('utils/kenteken.js') });
  await page.addScriptTag({ content: read('utils/calculator-form.js') });
  await page.addScriptTag({ content: read('content/autoscout.js') });
  await page.waitForTimeout(400);

  check('injects without JS errors', errors.length === 0, errors.join('\n'));
  check('floating button present', await page.locator('#anwb-floating-trigger').count() === 1);

  // Panel starts hidden, opens on click, and shows the shared form.
  check('panel starts hidden', await page.locator('#anwb-floating-card').isHidden());

  await page.click('#anwb-floating-trigger');
  await page.waitForTimeout(400);

  check('panel opens', await page.locator('#anwb-floating-card').isVisible());
  check('panel renders the shared form', await page.locator('.anwb-floating-card .cce-form').count() === 1);
  check('panel has the settings controls', await page.locator('.anwb-floating-card [data-role="province"]').count() === 1);

  const panelValues = await page.evaluate(() => ({
    plate: document.querySelector('.anwb-floating-card [data-role="plate"]')?.value,
    mileage: document.querySelector('.anwb-floating-card [data-role="mileage"]')?.value,
  }));
  check('prefilled from the page', panelValues.plate === 'X-353-NB' && panelValues.mileage === '68.500',
    JSON.stringify(panelValues));

  // Emoji-free chrome.
  const panelText = await page.textContent('.anwb-floating-card');
  check('no emojis in the panel', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(panelText), panelText.slice(0, 120));

  await context.close();
}

// ---------------------------------------------------------------------------
console.log('\nlaunch() behaviour');
// ---------------------------------------------------------------------------
{
  // Popup context: has chrome.tabs, so it must open the tab itself and not
  // round-trip through the background.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.__created = [];
      window.__messages = [];
      window.chrome = {
        storage: { local: { set: (i, cb) => cb && cb(), get: (k, cb) => cb({}), remove: (k, cb) => cb && cb() } },
        tabs: { create: (opts) => window.__created.push(opts.url) },
        runtime: { lastError: null, sendMessage: (m, cb) => { window.__messages.push(m.action); cb && cb({ success: true }); } },
      };
    });
    await page.goto(fileUrl('popup/popup.html'), { waitUntil: 'load' });
    await page.waitForTimeout(300);

    await page.evaluate(() => window.CalculatorForm.launch({ licensePlate: 'X-353-NB' }));
    await page.waitForTimeout(300);

    const res = await page.evaluate(() => ({ created: window.__created, messages: window.__messages }));
    check('popup opens the tab directly', res.created.length === 1 && res.created[0].includes('anwb.nl'),
      JSON.stringify(res));
    check('popup does not rely on the background', res.messages.length === 0, JSON.stringify(res));
    await context.close();
  }

  // Content-script context: no chrome.tabs, so the background must open it.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.__messages = [];
      window.__opened = [];
      window.open = (url) => { window.__opened.push(url); return null; };
      window.chrome = {
        storage: { local: { set: (i, cb) => cb && cb(), get: (k, cb) => cb({}), remove: (k, cb) => cb && cb() } },
        runtime: { lastError: null, sendMessage: (m, cb) => { window.__messages.push(m.action); cb && cb({ success: true }); } },
      };
    });
    await page.goto(fileUrl('popup/popup.html'), { waitUntil: 'load' });
    await page.waitForTimeout(300);

    await page.evaluate(() => window.CalculatorForm.launch({ licensePlate: 'X-353-NB' }));
    await page.waitForTimeout(400);

    const res = await page.evaluate(() => ({ messages: window.__messages, opened: window.__opened }));
    check('content script delegates to the background', res.messages.includes('startCalculation'), JSON.stringify(res));
    check('no duplicate tab when the background answers', res.opened.length === 0, JSON.stringify(res));
    await context.close();
  }

  // Background is asleep: sendMessage never calls back, so we must fall back.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.__opened = [];
      window.open = (url) => { window.__opened.push(url); return null; };
      window.chrome = {
        storage: { local: { set: (i, cb) => cb && cb(), get: (k, cb) => cb({}), remove: (k, cb) => cb && cb() } },
        // Never invokes the callback, mimicking an unloaded background page.
        runtime: { lastError: null, sendMessage: () => {} },
      };
    });
    await page.goto(fileUrl('popup/popup.html'), { waitUntil: 'load' });
    await page.waitForTimeout(300);

    await page.evaluate(() => window.CalculatorForm.launch({ licensePlate: 'X-353-NB' }));
    await page.waitForTimeout(3600); // just past the 3s fallback timer

    const res = await page.evaluate(() => ({ opened: window.__opened }));
    check('falls back to opening the tab when the background is asleep',
      res.opened.length === 1 && res.opened[0].includes('anwb.nl'), JSON.stringify(res));
    await context.close();
  }
}

await browser.close();

console.log(failures === 0 ? '\nPASS' : `\nFAIL (${failures} failed)`);
process.exit(failures === 0 ? 0 : 1);
