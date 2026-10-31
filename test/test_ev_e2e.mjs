/**
 * A pure-electric car with no plate: ANWB's fuel dropdown then offers only
 * "Elektrisch", which mapFuel must return instead of null.
 *
 *   node test/test_ev_e2e.mjs
 */
import { openPage, readSource, ANWB_URL } from './harness.mjs';

const scripts = [
  readSource('utils/kenteken.js'), readSource('utils/dom-utils.js'),
  readSource('utils/vehicle.js'), readSource('utils/options.js'),
  readSource('content/anwb.js'),
];

// The reported listing: Mercedes GLC 250, electric, no plate.
const vehicle = {
  brand: 'Mercedes-Benz', model: 'GLC 250', productionDate: '2026-01-01',
  doors: 5, transmission: 'Automatisch', fuel: 'Elektrisch',
  paintType: null, equipment: [],
};

console.log('ANWB electric, no plate — Mercedes-Benz GLC 250\n');

const { browser, page, getStore, logs } = await openPage({
  url: ANWB_URL, scripts,
  storage: { pendingCalculation: { licensePlate: null, mileage: 1, price: 88270, vehicle, timestamp: Date.now() } },
  recordConsole: true,
});

let ok = false;
try {
  await page.waitForFunction(() => Boolean(window.chrome?.__store?.lastResult?.monthly), null, { timeout: 200000 });
  const r = (await getStore()).lastResult;
  console.log('Result:', JSON.stringify(r));
  console.log(`\n✓ Electric car calculated: € ${r.monthly}/month`);
  ok = Boolean(r.monthly);
} catch (err) {
  console.error('\n✗ FAILED:', err.message.split('\n')[0]);
  console.error('  State:', JSON.stringify(await page.evaluate(() => {
    const g = (n) => { const s = document.querySelector(`select[name="${n}"]`); return s ? s.value : null; };
    return {
      banner: document.querySelector('#anwb-ext-title')?.textContent?.slice(0,70) || null,
      validationError: /niet of onjuist ingevuld/i.test(document.body.innerText),
      fuel: g('fuel'), year: g('licensePlateYear'), month: g('licensePlateMonth'),
    };
  }), null, 2));
} finally {
  if (process.env.VERBOSE) console.log('\nConsole:\n' + logs.join('\n'));
  await browser.close();
}
console.log(ok ? '\nPASS' : '\nFAIL');
process.exit(ok ? 0 : 1);
