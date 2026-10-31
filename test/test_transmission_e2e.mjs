/**
 * The make/model form asks for Soort transmissie for some cars, and rejects the
 * submit without it ("Selecteer een transmissie"). Those cars only appear when
 * the transmission field renders, so the test drives several real ones.
 *
 *   node test/test_transmission_e2e.mjs
 */
import { openPage, readSource, ANWB_URL } from './harness.mjs';

/**
 * Cars that list their gearbox here. All three sell with a manual gearbox, so
 * ANWB renders a live "Soort transmissie" select for them. A car whose model
 * only came with an automatic gets that select disabled and prefilled, and
 * needs no test.
 */
const cars = [
  { brand: 'Volkswagen', model: 'Golf',    productionDate: '2021-01-01', fuel: 'Benzine', transmission: 'Automatisch' },
  { brand: 'Peugeot',    model: '208',     productionDate: '2019-01-01', fuel: 'Benzine', transmission: 'Handgeschakeld' },
  { brand: 'Kia',        model: 'Picanto', productionDate: '2018-01-01', fuel: 'Benzine', transmission: 'Handgeschakeld' },
];
const scripts = [
  readSource('utils/kenteken.js'), readSource('utils/dom-utils.js'),
  readSource('utils/vehicle.js'), readSource('utils/options.js'),
  readSource('content/anwb.js'),
];

let failures = 0;
for (const vehicle of cars) {
  const { browser, page, getStore, logs } = await openPage({
    url: ANWB_URL, scripts,
    storage: {
      pendingCalculation: {
        licensePlate: null, mileage: 45000, price: 12500,
        carTitle: 'transmission test', timestamp: Date.now(), vehicle,
      },
    },
    recordConsole: true,
  });

  let verdict;
  try {
    await page.waitForFunction(() => Boolean(window.chrome?.__store?.lastResult?.monthly), null, { timeout: 180000 });
    verdict = `ok  € ${(await getStore()).lastResult.monthly}/mnd`;
  } catch {
    const state = await page.evaluate(() => ({
      banner: document.querySelector('#anwb-ext-title')?.textContent?.slice(0, 70) || null,
      errors: [...new Set((document.body.innerText.match(/Selecteer [^\n]*/g) || []))].slice(0, 5),
      transmission: (() => { const s = document.querySelector('select[name="transmission"]');
        return s ? { value: s.value, disabled: s.disabled } : null; })(),
    }));
    verdict = `FAIL ${JSON.stringify(state)}`;
    failures++;
    console.log(logs.filter((l) => /transmissie|mislukt/i.test(l)).join('\n'));
  }
  console.log(`${vehicle.brand} ${vehicle.model}: ${verdict}`);
  await browser.close();
}

console.log(failures === 0 ? `\nPASS — ${cars.length}/${cars.length}` : `\nFAIL — ${failures}/${cars.length}`);
process.exit(failures === 0 ? 0 : 1);
