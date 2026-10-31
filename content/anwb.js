/**
 * ANWB Autokosten calculator automation.
 *
 * Walks the calculator's four screens:
 *   1. Kenteken            input[name="licensePlate"]
 *   2. Uitvoering          input[name="selectedConfigurationId"] (radio, default preselected)
 *   3. Aanschaf & bezit    selects year/month/usageInMonths/province + price/mileage inputs
 *   4. Resultaat           ?expoints=autokosten-resultaat
 *
 * The runner is a loop that looks at which fields are on screen and completes
 * that step, rather than a rigid sequence — so it recovers if ANWB reorders a
 * screen or skips one (e.g. no uitvoering prompt for a single-configuration car).
 *
 * Two ANWB quirks drive the design (both verified against the live site):
 *   - The first "Volgende stap" click is rejected while React Hook Form is
 *     still settling. Re-clicking *without* re-typing succeeds, so each step
 *     fills once and then clicks on every pass until the screen changes.
 *   - Several fields only render once earlier ones are valid, so step 3 fills
 *     in two waves and waits for each field to appear.
 */

(function () {
  'use strict';

  if (window.__anwbAutokostenLoaded) return;
  window.__anwbAutokostenLoaded = true;

  const DOM = window.DOMUtils;
  const Kenteken = window.KentekenUtils;
  const { sleep, waitFor, AbortedError } = DOM;

  const DEFAULT_SETTINGS = {
    ownershipYears: 8,
    kmPerYear: 10000,
    province: 'Noord-Holland',
  };

  const CALC_URL = 'https://www.anwb.nl/auto/autokosten/berekenen';
  const MAX_CLICKS_PER_STEP = 4;
  const STEP_SETTLE_MS = 15000;

  let pendingData = null;
  let settings = { ...DEFAULT_SETTINGS };
  let running = false;
  let stopped = false;
  let banner = null;

  // ---------------------------------------------------------------------------
  // Screen detection
  // ---------------------------------------------------------------------------

  const field = (selector) => document.querySelector(selector);
  const hasField = (selector) => Boolean(field(selector));

  const screen = {
    isKenteken: () => hasField('input[name="licensePlate"]'),
    isUitvoering: () => hasField('input[name="selectedConfigurationId"]'),
    isAanschaf: () =>
      hasField('input[name="mileageAtPurchase"]') ||
      hasField('select[name="usageInMonths"]') ||
      hasField('select[name="province"]'),
    isResultaat: () => {
      if (location.href.includes('autokosten-resultaat')) return true;
      return Boolean(
        Array.from(document.querySelectorAll('h1,h2,h3,dt,span,p')).some(
          (el) => /^kosten per maand$/i.test(el.textContent.trim())
        )
      );
    },
  };

  // ---------------------------------------------------------------------------
  // Progress banner
  // ---------------------------------------------------------------------------

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function createBanner(data) {
    banner?.remove();

    banner = document.createElement('div');
    banner.id = 'anwb-ext-banner';
    banner.innerHTML = `
      <div class="anwb-ext-panel">
        <div class="anwb-ext-row">
          <span class="anwb-ext-dot" id="anwb-ext-dot"></span>
          <div class="anwb-ext-text">
            <strong id="anwb-ext-title">Autokosten berekenen…</strong>
            <span id="anwb-ext-detail">${escapeHtml(data.carTitle || '')}</span>
          </div>
          <div class="anwb-ext-meta">
            <span class="anwb-ext-tag">${escapeHtml(data.licensePlate || '')}</span>
            ${data.mileage ? `<span class="anwb-ext-tag">${Number(data.mileage).toLocaleString('nl-NL')} km</span>` : ''}
            ${data.price ? `<span class="anwb-ext-tag">€&nbsp;${Number(data.price).toLocaleString('nl-NL')}</span>` : ''}
          </div>
          <button class="anwb-ext-stop" id="anwb-ext-stop" title="Stop met automatiseren">Stop</button>
        </div>
        <div class="anwb-ext-progress" id="anwb-ext-progress"></div>
      </div>
    `;

    document.documentElement.appendChild(banner);
    banner.querySelector('#anwb-ext-stop').addEventListener('click', () => {
      stopped = true;
      setStatus('Gestopt. Je kunt de calculator nu handmatig afmaken.');
    });
  }

  function setStatus(text, { step = null, done = false, error = false } = {}) {
    if (!banner) return;
    const title = banner.querySelector('#anwb-ext-title');
    const dot = banner.querySelector('#anwb-ext-dot');
    if (title) title.textContent = text;
    if (dot) {
      dot.className = 'anwb-ext-dot';
      if (done) dot.classList.add('is-done');
      else if (error) dot.classList.add('is-error');
    }
    if (step) {
      const bar = banner.querySelector('#anwb-ext-progress');
      if (bar) bar.style.width = `${step}%`;
    }
  }

  function removeBanner() {
    banner?.remove();
    banner = null;
  }

  // ---------------------------------------------------------------------------
  // Step actions
  // ---------------------------------------------------------------------------

  /**
   * Click `label` and wait for `isDone()` to become true, re-clicking without
   * re-filling in between (see file header). Returns once the screen changed.
   */
  async function advance(label, isDone, { step }) {
    for (let attempt = 1; attempt <= MAX_CLICKS_PER_STEP; attempt++) {
      guard();

      const clicked = DOM.clickButton(label);
      if (!clicked) throw new Error(`Knop "${label}" niet gevonden`);

      try {
        await waitFor(isDone, { timeout: STEP_SETTLE_MS / MAX_CLICKS_PER_STEP, guard });
        return;
      } catch (err) {
        if (err instanceof AbortedError) throw err;
        // Form wasn't ready for that submit — the next pass clicks again.
      }
    }

    // Give it one final, longer chance before declaring failure.
    await waitFor(isDone, { timeout: 10000, guard });
  }

  function guard() {
    if (stopped) throw new AbortedError();
  }

  /**
   * Screen 1 — kenteken. Filled once; later passes only re-click.
   */
  async function doKenteken(data, filled) {
    setStatus(`Stap 1 van 3 — kenteken ${data.licensePlate} invoeren…`, { step: 15 });

    if (!filled.has('kenteken')) {
      const input = await waitFor(() => field('input[name="licensePlate"]'), { timeout: 20000, guard });
      // ANWB's API takes the plate hyphenated; the field validates on format.
      DOM.setInputValue(input, Kenteken?.format(data.licensePlate) || data.licensePlate);
      filled.add('kenteken');
      await sleep(700);
      guard();
    }

    await advance(/volgende stap/i, () => !screen.isKenteken() || screen.isAanschaf(), { step: 35 });
    filled.delete('kenteken');
  }

  /**
   * Screen 2 — uitvoering. ANWB preselects the most likely configuration, so
   * we keep the default. Only shown for cars with multiple configurations.
   */
  async function doUitvoering(filled) {
    setStatus('Stap 2 van 3 — standaarduitvoering bevestigen…', { step: 50 });

    if (!filled.has('uitvoering')) {
      const checked = document.querySelector('input[name="selectedConfigurationId"]:checked');
      if (!checked) {
        const first = await waitFor(
          () => document.querySelector('input[name="selectedConfigurationId"]'),
          { timeout: 10000, guard }
        );
        first.click();
      }
      filled.add('uitvoering');
      await sleep(500);
      guard();
    }

    await advance(/volgende stap/i, () => screen.isAanschaf() || screen.isResultaat(), { step: 60 });
    filled.delete('uitvoering');
  }

  /**
   * Screen 3 — aanschaf & bezit. Two waves: year/month/price/mileage render
   * first, then bezitsduur / km per jaar / provincie once those are valid.
   */
  async function doAanschaf(data, filled) {
    setStatus('Stap 3 van 3 — aanschaf- en gebruiksgegevens invullen…', { step: 70 });

    if (!filled.has('aanschaf-basis')) {
      const now = new Date();

      await DOM.setSelectWhenReady('year', String(now.getFullYear()), { guard });
      await DOM.setSelectWhenReady('month', String(now.getMonth() + 1).padStart(2, '0'), { guard });

      const priceInput = await waitFor(() => field('input[name="price"]'), { timeout: 10000, guard });
      DOM.setInputValue(priceInput, data.price || 0);

      const mileageInput = await waitFor(() => field('input[name="mileageAtPurchase"]'), { timeout: 10000, guard });
      DOM.setInputValue(mileageInput, data.mileage || 0);

      filled.add('aanschaf-basis');
      await sleep(800);
      guard();
    }

    // Second wave — these only exist once the four fields above are valid.
    if (!filled.has('aanschaf-extra')) {
      await DOM.setSelectWhenReady('usageInMonths', `${settings.ownershipYears} jaar`, {
        timeout: 20000,
        guard,
      });

      const kmInput = await waitFor(() => field('input[name="mileagePerYear"]'), { timeout: 20000, guard });
      DOM.setInputValue(kmInput, settings.kmPerYear);

      await DOM.setSelectWhenReady('province', settings.province, { timeout: 20000, guard });

      filled.add('aanschaf-extra');
      await sleep(600);
      guard();
    }

    // Verzekeringsvorm and no-claimkorting are intentionally left at ANWB's defaults.

    await advance(
      /autokosten berekenen/i,
      () => screen.isResultaat(),
      { step: 85 }
    );
    filled.clear();
  }

  // ---------------------------------------------------------------------------
  // Results
  // ---------------------------------------------------------------------------

  /**
   * The cost tiles render as `<span aria-label="Kosten per maand: € 554">`.
   * Reading that attribute is the most stable hook — no DOM traversal, and it
   * is unaffected by the SVGs and styling wrappers around the value.
   */
  function readCostByAriaLabel(labelPattern) {
    const regex = labelPattern instanceof RegExp ? labelPattern : new RegExp(labelPattern, 'i');

    for (const el of document.querySelectorAll('[aria-label]')) {
      const label = el.getAttribute('aria-label').replace(/ /g, ' ').trim();
      const match = label.match(/^(.+?):\s*(.+)$/);
      if (!match) continue;
      if (regex.test(match[1].trim())) return match[2].trim();
    }
    return null;
  }

  /** Parse a Dutch-formatted amount: "€ 6.648" -> 6648, "66,9 cent" -> 66.9 */
  function parseAmount(text) {
    if (!text) return null;
    const number = text.match(/([\d.]+(?:,\d+)?)/);
    if (!number) return null;
    const value = Number.parseFloat(number[1].replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(value) ? value : null;
  }

  function extractResults() {
    const monthlyText = readCostByAriaLabel(/^kosten per maand$/i);
    const yearlyText = readCostByAriaLabel(/^kosten per jaar$/i);
    const perKmText = readCostByAriaLabel(/^kosten per kilometer$/i) || readCostByAriaLabel(/^kosten per km$/i);

    const monthly = parseAmount(monthlyText);
    const yearly = parseAmount(yearlyText);
    const perKm = parseAmount(perKmText);

    return {
      monthly: monthly === null ? null : Math.round(monthly),
      yearly: yearly === null ? null : Math.round(yearly),
      perKmCents: perKm,
      perKmText,
      monthlyText,
    };
  }

  async function finish() {
    setStatus('Resultaat ophalen…', { step: 95 });

    const results = await waitFor(
      () => {
        const found = extractResults();
        return found.monthly ? found : null;
      },
      { timeout: 25000, guard }
    );

    setStatus(
      `Klaar — € ${results.monthly.toLocaleString('nl-NL')} per maand` +
        (results.yearly ? ` (€ ${results.yearly.toLocaleString('nl-NL')} per jaar)` : '') +
        (results.perKmText ? ` · ${results.perKmText}` : ''),
      { step: 100, done: true }
    );

    if (chrome?.storage?.local) {
      await chrome.storage.local.remove(['pendingCalculation']);
      await chrome.storage.local.set({ lastResult: { ...results, timestamp: Date.now() } });
    }

    // Let the banner sit on the finished result instead of disappearing.
    setTimeout(() => removeBanner(), 12000);
    return results;
  }

  // ---------------------------------------------------------------------------
  // Runner
  // ---------------------------------------------------------------------------

  async function run() {
    if (running) return;
    running = true;

    const filled = new Set();
    let idlePasses = 0;

    try {
      createBanner(pendingData);

      for (;;) {
        guard();

        if (screen.isResultaat()) {
          await finish();
          return;
        }

        if (screen.isAanschaf()) {
          await doAanschaf(pendingData, filled);
          idlePasses = 0;
          continue;
        }

        if (screen.isUitvoering()) {
          await doUitvoering(filled);
          idlePasses = 0;
          continue;
        }

        if (screen.isKenteken()) {
          await doKenteken(pendingData, filled);
          idlePasses = 0;
          continue;
        }

        // Nothing recognised — ANWB may still be rendering.
        if (++idlePasses > 20) {
          setStatus('Kon de calculator niet herkennen. Vul de gegevens handmatig in.', { error: true });
          return;
        }
        await sleep(500);
      }
    } catch (err) {
      if (err instanceof AbortedError) {
        setStatus('Gestopt.');
        return;
      }
      console.error('[CarCostExtension] Automatisering mislukt:', err);
      setStatus(`Automatiseren mislukt: ${err.message}`, { error: true });
    } finally {
      running = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------------

  if (chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
      if (request.action === 'stopAutomation') {
        stopped = true;
        sendResponse({ success: true });
      }
      if (request.action === 'getAutomationStatus') {
        sendResponse({ running, hasPending: Boolean(pendingData) });
      }
      return true;
    });
  }

  async function init() {
    if (!chrome?.storage?.local) return;
    if (!location.href.startsWith(CALC_URL)) return;

    const stored = await chrome.storage.local.get(['pendingCalculation', 'settings']);
    pendingData = stored.pendingCalculation;
    settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };

    if (!pendingData) return;

    if (Date.now() - (pendingData.timestamp || 0) > 10 * 60 * 1000) {
      await chrome.storage.local.remove(['pendingCalculation']);
      return;
    }

    if (!Kenteken?.isValid(pendingData.licensePlate)) {
      console.warn('[CarCostExtension] Ongeldig kenteken, automatisering overgeslagen:', pendingData.licensePlate);
      return;
    }

    await waitFor(() => document.body, { timeout: 10000 }).catch(() => {});
    DOM.dismissCookieBanners();
    DOM.removeBlockingOverlays();

    run();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
