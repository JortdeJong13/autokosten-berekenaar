/**
 * End-to-end test of the make/model fallback: no licence plate, so the
 * extension must describe the car on ANWB's "Zoek op merk en model" tab.
 *
 *   node test/test_merk_model_e2e.mjs
 */
import { openPage, readSource, ANWB_URL } from './harness.mjs';

const scripts = [
  readSource('utils/kenteken.js'),
  readSource('utils/dom-utils.js'),
  readSource('utils/vehicle.js'),
  readSource('utils/options.js'),
  readSource('content/anwb.js'),
];

// Mercedes-Benz GLC 300, 01/2021, the listing that prompted this feature.
const payload = {
  licensePlate: null,
  cleanPlate: null,
  mileage: 94411,
  price: 49995,
  carTitle: 'Mercedes-Benz GLC 300',
  vehicle: {
    brand: 'Mercedes-Benz',
    model: 'GLC 300',
    productionDate: '2021-01-01',
    doors: 5,
    fuel: 'Elektro/Benzine',
    transmission: 'Automatisch',
    // This listing is metallic with a glass roof, so both of the options ANWB
    // offers for this car should be ticked.
    paintType: 'Metallic',
    equipment: ['Airconditioning', 'Open dak', 'LED verlichting'],
  },
  timestamp: Date.now(),
};

console.log('ANWB make/model fallback — Mercedes-Benz GLC 300 (no plate)\n');

const { browser, page, getStore, logs } = await openPage({
  url: ANWB_URL,
  scripts,
  storage: { pendingCalculation: payload },
  recordConsole: true,
});

let ok = false;
try {
  await page.waitForFunction(
    () => Boolean(window.chrome?.__store?.lastResult?.monthly),
    null,
    { timeout: 180000 }
  );

  const results = (await getStore()).lastResult;
  console.log('URL    :', page.url());
  console.log('Result :', JSON.stringify(results));

  const text = await page.evaluate(() => document.body.innerText);
  const brand = await page.evaluate(() => {
    const s = document.querySelector('select[name="brand"]');
    return s ? [...s.options].find((o) => o.value === s.value)?.text : null;
  });

  console.log(`\n✓ Monthly: € ${results.monthly}`);
  console.log(`✓ Yearly : € ${results.yearly}`);
  if (brand) console.log(`✓ Brand  : ${brand}`);
  if (results.optionsTicked) console.log(`✓ Options: ${results.optionsTicked.join(', ')}`);
  ok = Boolean(results.monthly);
} catch (err) {
  console.error('\n✗ FAILED:', err.message.split('\n')[0]);
  console.error('  URL:', page.url());
  console.error('  State:', JSON.stringify(await page.evaluate(() => ({
    banner: document.querySelector('#anwb-ext-title')?.textContent || null,
    onMerkModel: !!document.querySelector('select[name="brand"]'),
    onKenteken: !!document.querySelector('input[name="licensePlate"]'),
    onUitvoering: !!document.querySelector('input[name="selectedConfigurationId"]'),
    onAanschaf: !!document.querySelector('input[name="mileageAtPurchase"]'),
    alerts: [...new Set([...document.querySelectorAll('[role="alert"]')].map(e => e.textContent.trim()))],
  })), null, 2));
} finally {
  if (process.env.VERBOSE) console.log('\nConsole:\n' + logs.join('\n'));
  await browser.close();
}

console.log(ok ? '\nPASS' : '\nFAIL');
process.exit(ok ? 0 : 1);
