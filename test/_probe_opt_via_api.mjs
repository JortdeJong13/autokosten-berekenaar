/**
 * Get ANWB's full option vocabulary via the configurations API, across many
 * models, without driving the UI for each one.
 *
 * The options array is per configuration, so this samples widely and takes the
 * union.
 */
import { webkit } from 'playwright';
const browser = await webkit.launch({ headless: true });
const ctx = await browser.newContext({ locale:'nl-NL', timezoneId:'Europe/Amsterdam',
  viewport:{width:1440,height:1000},
  userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'});
const page = await ctx.newPage();
await page.goto('https://www.anwb.nl/auto/autokosten/berekenen',{waitUntil:'domcontentloaded',timeout:60000});
await page.waitForTimeout(6000);
await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/^accepteren$/i.test(x.textContent.trim()));if(b)b.click();});
await page.waitForTimeout(2000);

const out = await page.evaluate(async () => {
  const BASE='https://api.anwb.nl/car-information/backend-application/api/v0';
  const H={'x-anwb-caller-id':'car/cost-calculator-web',
           'x-auto-kosten-tool-id':'1db3d877-e4d3-4a55-b551-d2a49fb7df34','accept':'application/json'};
  const get=async(p)=>{const r=await fetch(`${BASE}${p}`,{headers:H}); return r.ok? await r.json():null;};

  const asArray = (v, key) => Array.isArray(v) ? v : (v && Array.isArray(v[key]) ? v[key] : []);
  const brandsRaw = await get('/brands');
  const brands = asArray(brandsRaw, 'brands');
  // Sample a spread of makes and eras.
  const wanted = ['VOLKSWAGEN','TOYOTA','BMW','MERCEDES','KIA','PEUGEOT','AUDI','TESLA','VOLVO','RENAULT','FORD','HYUNDAI'];
  const union = new Map();
  const perModel = [];

  for (const bName of wanted) {
    const brand = brands.find(b => (b.name||'').toUpperCase() === bName);
    if (!brand) continue;
    const models = asArray(await get(`/brand/${brand.id}/models`), 'models');
    if (!models.length) continue;

    // Take a few models per brand, spanning model years.
    for (const model of models.slice(0, 3)) {
      for (const year of [2018, 2021]) {
        const q = new URLSearchParams({ modelId: model.id, month: '1', year: String(year), disableOptions: 'false' });
        const cfgs = asArray(await get(`/configurations?${q}`), 'configurations');
        if (!cfgs.length) continue;
        for (const c of cfgs) {
          // options may be an array or an object keyed by category
          const raw = c.options;
          const list = Array.isArray(raw) ? raw
            : (raw && typeof raw === 'object' ? Object.values(raw).flat() : []);
          for (const opt of list) {
            if (!opt || typeof opt !== 'object') continue;
            const label = opt.name || opt.id || opt.description || null;
            if (!label) continue;
            const price = opt.price ?? opt.amount ?? opt.listPrice ?? null;
            const priced = typeof price === 'number' && price > 0;
            const key = label + (priced ? ' [priced]' : '');
            if (!union.has(key)) union.set(key, { price, priced, example: `${bName} ${model.name} ${year}` });
          }
        }
        perModel.push(`${bName} ${model.name} ${year}: ${cfgs.reduce((n,c)=>n+(c.options?.length||0),0)} options`);
      }
    }
  }
  const all = [...union.entries()].map(([k,v])=>({name:k, ...v}));
  return { perModel, all,
    priced: all.filter(o=>o.priced).map(o=>({name:o.name.replace(' [priced]',''), price:o.price, example:o.example})),
    total: all.length };
});

console.log(`total option names seen: ${out.total}`);
console.log(`\n=== PRICED options (what ANWB asks about as extras) — ${out.priced.length} distinct ===`);
for (const o of out.priced.sort((a,b)=>a.name.localeCompare(b.name))) {
  console.log(`  ${String(o.name).padEnd(34)} ${String(o.price).padStart(6)}   [${o.example}]`);
}
await browser.close();
