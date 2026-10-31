/**
 * End-to-end test: load the extension's real ANWB content script into WebKit
 * (Safari's engine) and verify it walks the live calculator to the result.
 *
 * Hits the real anwb.nl, so it needs network access and ANWB's API to be up.
 *   node test/test_anwb_e2e.mjs [kenteken] [price] [mileage]
 *
 * Exit code 0 = reached the result screen with a monthly cost.
 */
import {
  openPage,
  readSource,
  pendingCalculation,
  ANWB_URL,
} from './harness.mjs';

const PLATE = process.argv[2] || 'X-353-NB';
const PRICE = Number(process.argv[3] || 24950);
const MILEAGE = Number(process.argv[4] || 68500);

const scripts = [
  readSource('utils/kenteken.js'),
  readSource('utils/dom-utils.js'),
  readSource('content/anwb.js'),
];

const payload = pendingCalculation({ licensePlate: PLATE, price: PRICE, mileage: MILEAGE });

// Optional overrides, used to prove the stored settings reach the calculator.
const settings = {};
if (process.env.OWNERSHIP_YEARS) settings.ownershipYears = Number(process.env.OWNERSHIP_YEARS);
if (process.env.KM_PER_YEAR) settings.kmPerYear = Number(process.env.KM_PER_YEAR);
if (process.env.PROVINCE) settings.province = process.env.PROVINCE;

console.log(`ANWB e2e — ${PLATE}, € ${PRICE}, ${MILEAGE} km`);
if (Object.keys(settings).length) console.log('Settings  :', JSON.stringify(settings));
console.log();

const { browser, page, logs, getStore } = await openPage({
  url: ANWB_URL,
  scripts,
  storage: { pendingCalculation: payload, ...(Object.keys(settings).length ? { settings } : {}) },
  recordConsole: true,
});

let ok = false;
try {
  // Generous ceiling: ANWB's RDW lookup is slow and its form can need re-clicks.
  await page.waitForFunction(
    () => location.href.includes('autokosten-resultaat'),
    null,
    { timeout: 180000 }
  );

  // The URL flips before the cost figures render and before the script finishes
  // parsing them, so wait for the value the content script writes to storage.
  await page.waitForFunction(
    () => Boolean(window.chrome?.__store?.lastResult?.monthly),
    null,
    { timeout: 45000 }
  );

  const store = await getStore();
  const results = store.lastResult;
  console.log('URL     :', page.url());
  console.log('Result  :', JSON.stringify(results));

  if (!results || !results.monthly) throw new Error('Geen maandbedrag opgeslagen in chrome.storage');

  console.log(`\n✓ Monthly cost: € ${results.monthly}`);
  if (results.yearly) console.log(`✓ Yearly cost : € ${results.yearly}`);
  if (results.perKmText) console.log(`✓ Per km      : ${results.perKmText}`);

  if (!results.yearly) throw new Error('Jaarkosten ontbreken');
  if (!results.perKmText) throw new Error('Kosten per kilometer ontbreken');
  ok = true;
} catch (err) {
  console.error('\n✗ FAILED:', err.message.split('\n')[0]);
  console.error('  URL at failure:', page.url());
  const state = await page.evaluate(() => ({
    alerts: [...new Set([...document.querySelectorAll('[role="alert"]')].map((e) => e.textContent.trim()))],
    banner: document.querySelector('#anwb-ext-title')?.textContent || null,
    hasPlate: !!document.querySelector('input[name="licensePlate"]'),
    hasUitvoering: !!document.querySelector('input[name="selectedConfigurationId"]'),
    hasAanschaf: !!document.querySelector('input[name="mileageAtPurchase"]'),
  }));
  console.error('  State:', JSON.stringify(state, null, 2));
} finally {
  if (process.env.VERBOSE) console.log('\nConsole:\n' + logs.join('\n'));
  await browser.close();
}

console.log(ok ? '\nPASS' : '\nFAIL');
process.exit(ok ? 0 : 1);
