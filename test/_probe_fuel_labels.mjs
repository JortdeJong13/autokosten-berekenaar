// What fuel labels does AS24 actually produce, and can mapFuel handle them?
import { webkit } from 'playwright';
import { readFileSync } from 'node:fs';
const ROOT='/Users/jortdejong/GitHub/car-cost-extension/';
const browser = await webkit.launch();
const ctx = await browser.newContext({ locale:'nl-NL', timezoneId:'Europe/Amsterdam',
  viewport:{width:1440,height:1200},
  userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'});
const page = await ctx.newPage();

// A search results page lists many cars; the detail page carries the fuel label.
const URLS = process.argv.slice(2);
if (!URLS.length) { console.log('pass listing URLs'); process.exit(0); }

const V = require('node:module').createRequire(import.meta.url)(ROOT+'utils/vehicle.js');
for (const u of URLS) {
  try {
    await page.goto(u, { waitUntil:'domcontentloaded', timeout:60000 });
    await page.waitForTimeout(2500);
    const labels = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('dt, th, span')) {
        if (!/^brandstof$/i.test(el.textContent.trim())) continue;
        const v = el.nextElementSibling?.textContent?.trim();
        if (v && v.length < 40) out.push(v);
      }
      // also from __NEXT_DATA__
      const nd = document.getElementById('__NEXT_DATA__');
      if (nd) {
        const find = (n) => {
          if (!n || typeof n !== 'object') return null;
          if (n.fuelCategory?.formatted) return n.fuelCategory.formatted;
          for (const x of Object.values(n)) { const h = find(x); if (h) return h; }
          return null;
        };
        try { const f = find(JSON.parse(nd.textContent)); if (f) out.push('NEXT_DATA:'+f); } catch {}
      }
      return [...new Set(out)];
    });
    for (const l of labels) {
      const clean = l.replace(/^NEXT_DATA:/,'');
      const mapped = V.mapFuel(clean);
      console.log(`${clean.padEnd(24)} -> ${mapped===null?'null (field left blank)':JSON.stringify(mapped)}   [${l.startsWith('NEXT')?'__NEXT_DATA__':'DOM'}]`);
    }
  } catch(e){ console.log('ERR', u.slice(0,60), e.message.slice(0,50)); }
}
await browser.close();
