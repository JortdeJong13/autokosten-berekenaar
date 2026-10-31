/**
 * Find every distinct option ANWB can offer, across many cars.
 * Uses the same make/model flow but only records the options step.
 */
import { webkit } from 'playwright';

const CARS = [
  ['Toyota','aygo','2019'], ['Kia','picanto','2021'], ['BMW','5-serie','2020'],
  ['Mercedes','e-klasse','2021'], ['Tesla','model 3','2022'],
  ['Peugeot','3008','2020'], ['Audi','a4','2020'],
  ['Ford','focus','2019'], ['Opel','astra','2018'], ['Seat','ibiza','2019'],
  ['Skoda','octavia','2020'], ['Hyundai','i20','2020'], ['Volvo','xc60','2021'],
  ['Mini','cooper','2020'], ['Citroen','c3','2019'], ['Fiat','500','2019'],
];

const browser = await webkit.launch({ headless: true });
const union = new Map();

for (const [brand, modelRe, year] of CARS) {
  const ctx = await browser.newContext({ locale:'nl-NL', timezoneId:'Europe/Amsterdam',
    viewport:{width:1440,height:1600},
    userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'});
  const page = await ctx.newPage();
  let status = '';
  try {
    await page.goto('https://www.anwb.nl/auto/autokosten/berekenen',{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForTimeout(5000);
    await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/^accepteren$/i.test(x.textContent.trim()));if(b)b.click();});
    await page.waitForTimeout(1500);
    await page.evaluate(()=>{const t=[...document.querySelectorAll('button,[role="tab"],label,a')].find(e=>/zoek op merk en model/i.test(e.textContent)&&e.getBoundingClientRect().width);if(t)t.click();});
    await page.waitForTimeout(2500);
    const set=(n,r)=>page.evaluate(([n,r])=>{const s=document.querySelector(`select[name="${n}"]`);
      if(!s||s.disabled)return null;const o=[...s.options].find(o=>new RegExp(r,'i').test(o.text));if(!o)return null;
      s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}));s.dispatchEvent(new Event('input',{bubbles:true}));return o.text.trim();},[n,r]);
    const waitN=async(n)=>{for(let i=0;i<40;i++){const c=await page.evaluate(x=>{const s=document.querySelector(`select[name="${x}"]`);return s&&!s.disabled?s.options.length:0;},n);if(c>=2)return true;await page.waitForTimeout(250);}return false;};
    const next=()=>page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/volgende stap/i.test(x.textContent)&&x.getBoundingClientRect().width&&!x.disabled);if(b){b.click();return true;}return false;});

    if(!await set('brand','^'+brand)){status='brand?';await ctx.close();continue;}
    await page.waitForTimeout(2500);
    if(!await waitN('model')){status='model?';await ctx.close();continue;}
    const picked = await set('model',modelRe);
    if(!picked){status='no '+modelRe;await ctx.close();continue;}
    await page.waitForTimeout(2500);
    if(!await waitN('licensePlateYear')){status='year?';await ctx.close();continue;}
    await set('licensePlateYear','^'+year);
    if(!await waitN('licensePlateMonth')){status='month?';await ctx.close();continue;}
    await set('licensePlateMonth','januari');
    await page.waitForTimeout(2500);

    for(let r=0;r<4;r++){
      await next(); await page.waitForTimeout(5500);
      const opts = await page.evaluate(()=>{
        if(!/invloed op de waarde/i.test(document.body.innerText)) return null;
        const out=[];
        for(const cb of document.querySelectorAll('input[type="checkbox"]')){
          if(!cb.getBoundingClientRect().width)continue;
          const lab=cb.closest('label')||cb.parentElement?.parentElement;
          const t=(lab?.textContent||'').trim().replace(/\s+/g,' ');
          if(t)out.push(t);
        }
        return out;
      });
      if(opts){ status=`${opts.length} options`; for(const o of opts){ const name=o.replace(/€\s*[\d.,]+/,'').trim(); if(!union.has(name)) union.set(name,o.match(/€\s*([\d.,]+)/)?.[1]||''); } break; }
      if(await page.evaluate(()=>!!document.querySelector('input[name="price"]'))){status='no options step';break;}
    }
  } catch(e){ status='err '+e.message.slice(0,40); }
  console.log(`${brand} ${modelRe} (${year}): ${status}`);
  await ctx.close();
}

console.log('\n=== UNION of ANWB options across cars ===');
[...union.entries()].sort().forEach(([n,p])=>console.log(`  ${n.padEnd(48)} € ${p}`));
console.log(`\ndistinct options: ${union.size}`);
await browser.close();
