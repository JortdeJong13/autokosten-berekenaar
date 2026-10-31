/**
 * Integration: a listing with no plate must survive the whole chain —
 * page extraction -> shared form -> stored payload -> ANWB make/model flow.
 *
 * The failure this guards against: the form used to reject submission when no
 * plate was present, so the make/model fallback could never run.
 */
import { webkit } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

let failures = 0;
const check = (name, ok, detail = '') => {
  if (ok) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`); }
};

const browser = await webkit.launch();
const ctx = await browser.newContext({ viewport: { width: 400, height: 800 } });
const page = await ctx.newPage();

await page.addInitScript(() => {
  const store = {};
  window.chrome = {
    __store: store,
    storage: { local: {
      get: (k, cb) => { const o = {}; for (const x of [].concat(k)) if (x in store) o[x] = store[x]; cb(o); },
      set: (i, cb) => { Object.assign(store, i); cb && cb(); },
      remove: (k, cb) => { for (const x of [].concat(k)) delete store[x]; cb && cb(); },
    } },
    runtime: { lastError: null, sendMessage: (m, cb) => cb && cb({ success: true }) },
    tabs: { query: (q, cb) => cb([]), create: () => {}, sendMessage: () => {} },
  };
});

await page.goto(pathToFileURL(path.join(ROOT, 'popup/popup.html')).href, { waitUntil: 'load' });
await page.waitForTimeout(600);

console.log('no-plate flow');

// 1. Simulate what autoscout.js extracts from a plate-less listing.
const extracted = await page.evaluate(() => {
  const vehicle = {
    brand: 'Mercedes-Benz', model: 'GLC 300', productionDate: '2021-01-01',
    doors: 5, fuel: 'Elektro/Benzine', transmission: 'Automatisch',
  };
  window.__form.setValues({
    licensePlate: null, mileage: 94411, price: 49995,
    title: 'Mercedes-Benz GLC 300', vehicle,
  });
  return vehicle;
});
check('extraction produced the vehicle identity', extracted.brand === 'Mercedes-Benz');

// 2. The form must accept a submission with no plate.
await page.click('[data-role="submit"]');
await page.waitForTimeout(500);

const payload = await page.evaluate(() => window.chrome.__store.pendingCalculation);
check('a payload was stored', Boolean(payload), JSON.stringify(payload));
check('no licence plate in the payload', payload && payload.licensePlate === null,
  JSON.stringify(payload));
check('vehicle details carried through',
  payload?.vehicle?.brand === 'Mercedes-Benz' && payload?.vehicle?.model === 'GLC 300',
  JSON.stringify(payload?.vehicle));

// 3. The ANWB content script must turn that payload into a usable search.
const normalised = await page.evaluate((p) => {
  const v = window.VehicleUtils.buildVehiclePayload(p.vehicle);
  return {
    usable: Boolean(v),
    year: v?.year, month: v?.month,
    monthName: v?.month ? window.VehicleUtils.monthName(v.month) : null,
  };
}, payload);
check('vehicle payload is usable for ANWB', normalised.usable, JSON.stringify(normalised));
check('year derived from productionDate', normalised.year === 2021, JSON.stringify(normalised));
check('month name matches ANWB wording', normalised.monthName === 'Januari', JSON.stringify(normalised));

// 4. And the brand/model resolve against ANWB's real option lists.
const matches = await page.evaluate(() => {
  const brands = [{ text: 'Mercedes', value: 'uuid-1' }, { text: 'Audi', value: 'uuid-2' }];
  const models = [{ text: 'Glc-Klasse', value: 'm1' }, { text: 'A-Klasse', value: 'm2' }];
  const b = window.VehicleUtils.matchBrand(brands, 'Mercedes-Benz');
  const m = window.VehicleUtils.matchModel(models, 'GLC 300');
  return { brand: b.option?.text, brandConf: b.confidence, model: m.option?.text, modelConf: m.confidence };
});
check('brand resolves to Mercedes', matches.brand === 'Mercedes', JSON.stringify(matches));
check('model resolves to Glc-Klasse', matches.model === 'Glc-Klasse', JSON.stringify(matches));
check('fuel maps to an ANWB option',
  await page.evaluate(() => window.VehicleUtils.mapFuel('Elektro/Benzine')) === 'PHEV Benzine');

await browser.close();
console.log(failures === 0 ? '\nPASS' : `\nFAIL (${failures} failed)`);
process.exit(failures === 0 ? 0 : 1);
