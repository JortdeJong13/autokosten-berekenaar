/**
 * Sample ANWB's options step across a spread of cars and report the union of
 * options offered, with prices. Determines whether a mapping table is viable.
 */
import { webkit } from 'playwright';

const CARS = [
  // [ANWB brand, model regex, year, fuel regex]
  ['Toyota',   '^aygo',        '2019', null],
  ['Kia',      '^picanto',     '2021', null],
  ['BMW',      '^5-serie',     '2020', null],
  ['Mercedes', '^e-klasse',    '2021', null],
  ['Tesla',    '^model 3',     '2022', null],
  ['Volkswagen','^id',         '2022', null],
  ['Renault',  '^scenic',      '2019', null],
  ['Peugeot',  '^3008',        '2020', null],
];

const browser = await webkit.launch({ headless: true });

async function probe([brand, modelRe, year, fuelRe]) {
  const ctx = await browser.newContext({ locale:'nl-NL', timezoneId:'Europe/Amsterdam',
    viewport:{width:1440,height:1600},
    userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'});
  const page = await ctx.newPage();
  const label = `${brand} ${modelRe}`;
  const result = { label, options: [], reached: false, note: null };

  try {
    await page.goto('https://www.anwb.nl/auto/autokosten/berekenen',{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForTimeout(5500);
    await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/^accepteren$/i.test(x.textContent.trim()));if(b)b.click();});
    await page.waitForTimeout(1800);
    await page.evaluate(()=>{const t=[...document.querySelectorAll('button,[role="tab"],label,a')].find(e=>/zoek op merk en model/i.test(e.textContent)&&e.getBoundingClientRect().width);if(t)t.click();});
    await page.waitForTimeout(2500);

    const set = (n,r) => page.evaluate(([n,r])=>{const s=document.querySelector(`select[name="${n}"]`);
      if(!s||s.disabled) return null; const o=[...s.options].find(o=>new RegExp(r,'i').test(o.text)); if(!o) return null;
      s.value=o.value; s.dispatchEvent(new Event('change',{bubbles:true}));
      s.dispatchEvent(new Event('input',{bubbles:true})); return o.text.trim();},[n,r]);
    const waitN = async (n,min=2)=>{for(let i=0;i<48;i++){
      const c=await page.evaluate(x=>{const s=document.querySelector(`select[name="${x}"]`);return s?{n:s.options.length,d:s.disabled}:null;},n);
      if(c && c.n>=min && !c.d) return true; await page.waitForTimeout(250);} return false;};
    const next = () => page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/volgende stap/i.test(x.textContent)&&x.getBoundingClientRect().width&&!x.disabled); if(b){b.click();return true;} return false;});

    if (!await set('brand', '^'+brand.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))) { result.note='brand missing'; return result; }
    if (!await waitN('model')) { result.note='no models'; return result; }
    if (!await set('model', modelRe)) { result.note=`no model ${modelRe}`; return result; }
    if (!await waitN('licensePlateYear')) { result.note='no years'; return result; }
    await set('licensePlateYear', '^'+year);
    if (!await waitN('licensePlateMonth')) { result.note='month never enabled'; return result; }
    await set('licensePlateMonth', 'januari');
    await page.waitForTimeout(3000);

    // Optional fuel
    if (fuelRe) { await set('fuel', fuelRe); await page.waitForTimeout(1500); }

    // Advance: uitvoering -> options -> aanschaf
    for (let r=0; r<4; r++) {
      await next();
      await page.waitForTimeout(6000);
      const has = await page.evaluate(()=>/invloed op de waarde/i.test(document.body.innerText));
      if (has) {
        result.reached = true;
        result.options = await page.evaluate(() => {
          const out=[];
          for (const cb of document.querySelectorAll('input[type="checkbox"]')) {
            if (!cb.getBoundingClientRect().width) continue;
            const lab = cb.closest('label') || (cb.id && document.querySelector(`label[for="${cb.id}"]`)) || cb.parentElement?.parentElement;
            const txt = (lab?.textContent||'').trim().replace(/\s+/g,' ');
            if (txt) out.push(txt);
          }
          return out;
        });
        break;
      }
      if (await page.evaluate(()=>!!document.querySelector('input[name="price"]'))) { result.note='passed options'; break; }
    }
  } catch (e) {
    result.note = 'error: ' + e.message.slice(0,60);
  }
  await ctx.close();
  return result;
}

const all = {};
for (const car of CARS) {
  const r = await probe(car);
  console.log(`${r.reached ? '✓' : '✗'} ${r.label.padEnd(20)} ${r.reached ? r.options.length + ' options' : (r.note||'?')}`);
  for (const o of r.options) {
    console.log(`      - ${o}`);
    const name = o.replace(/\s*€\s*[\d.,]+$/,'').trim();
    if (!all[name]) all[name] = o.match(/€\s*([\d.,]+)/)?.[1] || '';
  }
  await new Promise(r=>setTimeout(r,1500));
}

console.log('\n=== UNION of all options seen ===');
for (const [name, price] of Object.entries(all).sort()) console.log(`  ${name.padEnd(45)} € ${price}`);
console.log(`\ntotal distinct options: ${Object.keys(all).length}`);
await browser.close();
