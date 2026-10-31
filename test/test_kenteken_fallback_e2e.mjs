/**
 * A plate that is valid in format but not in the RDW register makes ANWB answer
 * 404 with "Autogegevens ophalen mislukt". The extension must notice that and
 * switch to the make/model route rather than sitting there or giving up.
 *
 *   node test/test_kenteken_fallback_e2e.mjs
 */
import { openPage, readSource, ANWB_URL } from './harness.mjs';

const scripts = [
  readSource('utils/kenteken.js'),
  readSource('utils/dom-utils.js'),
  readSource('utils/vehicle.js'),
  readSource('utils/options.js'),
  readSource('content/anwb.js'),
];

// ZZ-99-ZZ is a valid sidecode shape but is not a registered vehicle, which is
// how this was reproduced against the live site.
const payload = {
  licensePlate: 'ZZ-99-ZZ',
  cleanPlate: 'ZZ99ZZ',
  mileage: 94411,
  price: 49995,
  vehicle: {
    brand: 'Mercedes-Benz',
    model: 'GLC 300',
    productionDate: '2021-01-01',
    doors: 5,
    fuel: 'Elektro/Benzine',
    transmission: 'Automatisch',
    paintType: 'Metallic',
    equipment: ['Open dak', 'Lederen bekleding'],
  },
  timestamp: Date.now(),
};

console.log('ANWB kenteken-lookup fallback — plate valid in format, unknown to RDW\n');

const { browser, page, getStore, logs } = await openPage({
  url: ANWB_URL, scripts, storage: { pendingCalculation: payload }, recordConsole: true,
});

let ok = false;
try {
  await page.waitForFunction(
    () => Boolean(window.chrome?.__store?.lastResult?.monthly),
    null,
    { timeout: 200000 }
  );
  const results = (await getStore()).lastResult;
  console.log('URL    :', page.url());
  console.log('Result :', JSON.stringify(results));
  console.log(`\n✓ Fell back to make/model and produced € ${results.monthly}/month`);
  ok = Boolean(results.monthly);
  if (results.optionsTicked?.length) console.log(`✓ Options: ${results.optionsTicked.join(', ')}`);
} catch (err) {
  console.error('\n✗ FAILED:', err.message.split('\n')[0]);
  console.error('  URL:', page.url());
  console.error('  State:', JSON.stringify(await page.evaluate(() => ({
    banner: document.querySelector('#anwb-ext-title')?.textContent || null,
    onKenteken: !!document.querySelector('input[name="licensePlate"]'),
    onMerkModel: !!document.querySelector('select[name="brand"]'),
    lookupError: /niet gelukt om de autogegevens/i.test(document.body.innerText),
  })), null, 2));
} finally {
  if (process.env.VERBOSE) console.log('\nConsole:\n' + logs.join('\n'));
  await browser.close();
}
console.log(ok ? '\nPASS' : '\nFAIL');
process.exit(ok ? 0 : 1);
