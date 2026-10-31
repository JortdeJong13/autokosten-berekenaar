/**
 * Extraction against a real electric listing, driven through the floating panel
 * so the whole chain is covered: page -> extraction -> form.
 *
 * This listing caught three separate bugs, so it is kept as a fixture test:
 *   1. The script scan read the extension's OWN bundled source, whose comments
 *      contain an example plate ("N-123-AB"), and reported that as the car's
 *      plate.
 *   2. Mileage extraction floored at 100 km, so a delivery-mileage car showing
 *      "1 km" produced no mileage at all.
 *   3. The plate field stayed visible on a listing that has no plate but was
 *      fully identified from its JSON-LD.
 *
 * Requires /tmp/ev.html, saved from the listing below. Skips if absent so it
 * does not fail on a machine without the fixture.
 */
import { webkit } from 'playwright';
import { readFileSync } from 'node:fs';
const ROOT='/Users/jortdejong/GitHub/car-cost-extension/';
const read=p=>readFileSync(ROOT+p,'utf8');
const FIXTURE = '/tmp/ev.html';
let html;
try { html = readFileSync(FIXTURE,'utf8'); }
catch {
  console.log('SKIP — fixture not present at ' + FIXTURE);
  console.log('  save the listing HTML there first:');
  console.log('  curl -sL "<autoscout24 listing url>" -o ' + FIXTURE);
  process.exit(0);
}

const browser = await webkit.launch();
const ctx = await browser.newContext({ viewport:{width:1280,height:1000} });
const page = await ctx.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(e.message));

await page.setContent(html, { waitUntil:'domcontentloaded' });
await page.addStyleTag({ content: read('content/form.css') });
await page.addStyleTag({ content: read('content/autoscout.css') });
await page.addScriptTag({ content: read('utils/kenteken.js') });
await page.addScriptTag({ content: read('utils/vehicle.js') });
await page.addScriptTag({ content: read('utils/options.js') });
await page.addScriptTag({ content: read('utils/calculator-form.js') });
await page.addScriptTag({ content: read('content/autoscout.js') });
await page.waitForTimeout(800);

// Open the panel, which triggers on-demand extraction from the page.
await page.click('#anwb-floating-trigger');
await page.waitForTimeout(900);

const state = await page.evaluate(() => {
  const card = document.querySelector('.anwb-floating-card');
  const vis = (role) => {
    const el = card?.querySelector(`[data-role="${role}"]`);
    if (!el) return 'absent';
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? 'VISIBLE' : 'hidden';
  };
  return {
    plate: vis('plate-field'), mileage: vis('mileage-field'), price: vis('price-field'),
    kmRow: vis('kmprice-row'),
    plateValue: card?.querySelector('[data-role="plate"]')?.value || '',
    mileageValue: card?.querySelector('[data-role="mileage"]')?.value || '',
    priceValue: card?.querySelector('[data-role="price"]')?.value || '',
  };
});
let failures = 0;
const check = (name, ok, detail='') => {
  if (ok) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail?`\n    ${detail}`:''}`); }
};

console.log('extraction — electric listing (no plate)');
check('renders without errors', errs.length === 0, errs.join('\n'));
check('no false plate from the extension\'s own source',
  state.plateValue === '', `plate was "${state.plateValue}"`);
check('delivery mileage (1 km) is extracted', state.mileageValue === '1', `got "${state.mileageValue}"`);
check('price is extracted', state.priceValue === '88.270', `got "${state.priceValue}"`);
check('all answered fields are hidden',
  state.plate === 'hidden' && state.mileage === 'hidden' && state.price === 'hidden',
  JSON.stringify(state));

await browser.close();
console.log(failures === 0 ? '\nPASS' : `\nFAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
