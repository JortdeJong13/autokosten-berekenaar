/**
 * The make/model form re-renders after each answer, and a value set during a
 * re-render is silently dropped — which showed up as an intermittent
 * "Brandstofsoort: Selecteer een brandstof" validation error.
 *
 * One run proves nothing about a race, so this repeats the same car and fails
 * if any run misses a field.
 *
 *   node test/test_merk_model_repeat.mjs [runs]
 */
import { openPage, readSource, ANWB_URL } from './harness.mjs';

const RUNS = Number(process.argv[2] || 3);
const scripts = [
  readSource('utils/kenteken.js'), readSource('utils/dom-utils.js'),
  readSource('utils/vehicle.js'), readSource('utils/options.js'),
  readSource('content/anwb.js'),
];

// The car from the report: a PHEV whose fuel field must end up filled.
const vehicle = {
  brand: 'Mercedes-Benz', model: 'GLC 400e', productionDate: '2023-05-01',
  doors: 5, fuel: 'Elektro/Benzine', transmission: 'Automatisch',
  paintType: 'Metallic', equipment: ['Open dak'],
};

let failures = 0;
for (let run = 1; run <= RUNS; run++) {
  const { browser, page, getStore, logs } = await openPage({
    url: ANWB_URL, scripts,
    storage: { pendingCalculation: { licensePlate: null, mileage: 20000, price: 55000, vehicle, timestamp: Date.now() } },
    recordConsole: true,
  });

  let verdict;
  try {
    await page.waitForFunction(
      () => Boolean(window.chrome?.__store?.lastResult?.monthly),
      null, { timeout: 180000 }
    );
    const r = (await getStore()).lastResult;
    verdict = `ok  € ${r.monthly}/mnd`;
  } catch {
    const state = await page.evaluate(() => {
      const fuel = document.querySelector('select[name="fuel"]');
      return {
        banner: document.querySelector('#anwb-ext-title')?.textContent?.slice(0, 60) || null,
        fuelValue: fuel ? fuel.value : 'n/a',
        validationError: /niet of onjuist ingevuld/i.test(document.body.innerText),
      };
    });
    verdict = `FAIL ${JSON.stringify(state)}`;
    failures++;
    if (process.env.VERBOSE) console.log(logs.filter(l => /Opnieuw instellen/.test(l)).join('\n'));
  }

  console.log(`run ${run}/${RUNS}: ${verdict}`);
  await browser.close();
}

console.log(failures === 0 ? `\nPASS — ${RUNS}/${RUNS} runs` : `\nFAIL — ${failures}/${RUNS} runs missed a field`);
process.exit(failures === 0 ? 0 : 1);
