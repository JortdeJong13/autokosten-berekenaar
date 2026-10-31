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
  const VehicleUtils = window.VehicleUtils;
  const OptionsUtils = window.OptionsUtils;
  const { sleep, waitFor, AbortedError } = DOM;

  const DEFAULT_SETTINGS = {
    ownershipYears: 8,
    kmPerYear: 10000,
    province: 'Noord-Holland',
  };

  const CALC_URL = 'https://www.anwb.nl/auto/autokosten/berekenen';
  // How long to wait after a submit before assuming it was rejected and
  // clicking again. ANWB's vehicle lookup answers in ~300-600ms, so this
  // comfortably covers it while still recovering quickly when it is slower.
  const CLICK_RETRY_MS = 1500;
  const MAX_CLICKS_PER_STEP = 4;

  let pendingData = null;
  let settings = { ...DEFAULT_SETTINGS };
  // True when the listing had no plate and we are describing the car instead.
  let useMerkModel = false;
  // True when the listing gave enough detail to describe the car, so we can
  // fall back if ANWB cannot find the plate.
  let vehicleFallbackReady = false;
  // Option labels the automation ticked, reported with the result.
  let tickedOptions = [];
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
    // ANWB answers a plate it cannot find with a 404 and this message. It can
    // happen even for a plate that looks valid, e.g. a car not yet in the RDW
    // register, and ANWB itself suggests the make/model route in that case.
    hasKentekenError: () =>
      Array.from(document.querySelectorAll('[role="alert"], [class*="error" i], p, span, div')).some((el) =>
        /niet gelukt om de autogegevens|autogegevens ophalen mislukt/i.test(el.textContent || '')
      ),
    // The make/model branch, used only when a listing has no licence plate.
    // It grows in stages: Merk -> Model -> Bouwjaar -> Bouwmaand -> [extra].
    isMerkModel: () => hasField('select[name="brand"]') || hasField('select[name="model"]'),
    isUitvoering: () => hasField('input[name="selectedConfigurationId"]'),
    // ANWB's options step, present only on the make/model path. Detected by its
    // heading, since it is a set of unlabelled checkboxes.
    isOpties: () =>
      Array.from(document.querySelectorAll('h1,h2,h3,p,span')).some((el) =>
        /invloed op de waarde/i.test(el.textContent)
      ) && document.querySelectorAll('input[type="checkbox"]').length > 0,
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
   * re-filling in between.
   *
   * Why the re-clicking: ANWB's submit handler looks up the car via an API call,
   * and a submit that arrives before that response lands is rejected with a
   * generic "velden niet of onjuist ingevuld" error — even though the value is
   * perfectly valid. The gate is the network, not the form.
   *
   * Measured against the live site: the lookup takes 282-600ms, and its latency
   * varies run to run. So a single click after a fixed wait is unreliable in
   * both directions — waiting 300ms failed every time, while 800ms succeeded,
   * purely because the API happened to answer inside that window.
   *
   * So rather than guess a delay, this clicks and then polls in short slices,
   * clicking again if the screen hasn't moved. That is typically one click, and
   * it never advances until the response has actually landed.
   */
  async function advance(label, isDone, { step }) {
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_CLICKS_PER_STEP; attempt++) {
      guard();

      const clicked = DOM.clickButton(label);
      if (!clicked) throw new Error(`Knop "${label}" niet gevonden`);

      // Short slices so a re-click happens promptly when the API is slow, while
      // still giving the request room to finish before we click again.
      try {
        await waitFor(isDone, { timeout: CLICK_RETRY_MS, interval: 60, guard });
        return;
      } catch (err) {
        if (err instanceof AbortedError) throw err;
        lastError = err;
        // Not advanced yet. The next pass clicks again; the first click's
        // request is usually still in flight and about to be accepted.
      }
    }

    // Final, longer chance before declaring failure.
    try {
      await waitFor(isDone, { timeout: 10000, guard });
    } catch (err) {
      if (err instanceof AbortedError) throw err;
      throw lastError || err;
    }
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

    // Stop on the lookup error too, otherwise a 404 leaves this retrying until
    // the timeout instead of handing over to the make/model fallback.
    await advance(
      /volgende stap/i,
      () => !screen.isKenteken() || screen.isAanschaf() || screen.hasKentekenError(),
      { step: 35 }
    );
    filled.delete('kenteken');
  }

  /**
   * ANWB opens on its "Zoek op kenteken" tab. Without a plate we need the
   * "Zoek op merk en model" tab instead.
   */
  async function switchToMerkModelTab() {
    setStatus('Overschakelen naar zoeken op merk en model…', { step: 10 });

    const switched = await waitFor(
      () => {
        const tab = Array.from(document.querySelectorAll('button, [role="tab"], label, a'))
          .find((el) => /zoek op merk en model/i.test(el.textContent) && isVisible(el));
        if (!tab) return false;

        tab.click();
        return true;
      },
      { timeout: 15000, guard }
    );

    if (!switched) throw new Error('Tabblad "Zoek op merk en model" niet gevonden');

    // Wait for the brand dropdown to arrive.
    await waitFor(() => {
      const el = field('select[name="brand"]');
      return el && el.options.length > 1;
    }, { timeout: 20000, guard });
  }

  const isVisible = (el) => Boolean(el && el.getBoundingClientRect().width);

  /**
   * Wait for a select to be usable, set it, and confirm the value stuck.
   *
   * Verifying matters here: the make/model form re-renders each dropdown in
   * response to the previous answer, so a value written while React is still
   * re-rendering that select is silently discarded. Setting the year straight
   * after the model did exactly that, leaving the month dropdown disabled
   * forever. Re-setting after the re-render settles fixes it.
   */
  async function setSelectAndVerify(name, valueOrText, { timeout = 20000, guard: g = guard, attempts = 5 } = {}) {
    let select = null;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      select = await waitFor(
        () => {
          const el = field(`select[name="${name}"]`);
          return el && !el.disabled && el.options.length > 1 ? el : null;
        },
        { timeout, guard: g }
      );

      DOM.setSelectValue(select, valueOrText);

      // Give React a beat, then check the selection survived the re-render.
      await sleep(500);
      g();

      if (select.value) return select;
    }

    if (!select || !select.value) {
      throw new Error(`Kon "${valueOrText}" niet selecteren in "${name}"`);
    }
    return select;
  }

  /**
   * Re-assert every value we control, immediately before submitting.
   *
   * Each answer makes ANWB re-render the form, and a re-render can drop a value
   * that was set moments earlier — the change lands in the DOM but not in
   * React's state, so React then paints its own (empty) value back. Verifying
   * once after setting is not enough, because the wipe can come later.
   *
   * So before submitting, check them all and repair whatever went missing,
   * looping because a repair can itself trigger another re-render.
   */
  async function reassertFields(desired) {
    for (let pass = 1; pass <= 4; pass++) {
      guard();

      const broken = [];
      for (const [name, want] of Object.entries(desired)) {
        if (want == null) continue;

        const el = field(`select[name="${name}"]`);
        if (!el) continue;

        // Already correct: the select holds the option matching `want`.
        const current = el.options[el.selectedIndex];
        const matches = current && (current.value === String(want)
          || current.text.trim().toLowerCase() === String(want).toLowerCase());
        if (matches) continue;

        broken.push(name);
      }

      if (!broken.length) return;

      console.log(`[AutokostenBerekenaar] Opnieuw instellen (ronde ${pass}):`, broken.join(', '));

      for (const name of broken) {
        try {
          await setSelectAndVerify(name, desired[name], { timeout: 8000, attempts: 2 });
        } catch (err) {
          // A field that vanished is not necessarily fatal: ANWB only shows
          // fuel/doors for some cars.
          console.warn(`[AutokostenBerekenaar] ${name} opnieuw instellen mislukt:`, err.message);
        }
      }

      await sleep(600);
    }
  }

  /**
   * Fallback flow — make/model, used when the listing has no licence plate.
   *
   * The form is dynamic: it asks Merk, Model, Bouwjaar, Bouwmaand, and *only
   * for some cars* Aantal deuren, Brandstofsoort and Soort transmissie. Each
   * answer reveals the next, so this fills whatever is present and lets the
   * runner come back around as the form grows.
   *
   * Model matching is imperfect (AutoScout24 says "318I" where ANWB says
   * "3-Serie"), so a low-confidence match is surfaced to the user rather than
   * silently trusted — a wrong model produces a plausible but wrong cost.
   */
  /**
   * Decide what to put in ANWB's fuel dropdown.
   *
   * `mapFuel` covers the common AS24 labels. When it returns nothing but ANWB
   * is still asking, fall back to the closest option present rather than
   * submitting an empty field, which ANWB rejects:
   *
   *   - a plug-in hybrid label we did not recognise maps to a PHEV option
   *   - a "Waterstof"/"Overig" style label has no close match, so take the
   *     first real option and let the user correct it if it matters
   */
  function resolveFuelOption(vehicle, fuelSelect) {
    const V = VehicleUtils;
    const direct = V.mapFuel(vehicle.fuel);
    if (direct) return direct;

    const raw = String(vehicle.fuel || '');
    const options = Array.from(fuelSelect.options).map((o) => o.text.trim());
    const has = (needle) => options.find((t) => new RegExp(needle, 'i').test(t)) || null;

    // Anything mentioning electricity alongside a fuel is a plug-in hybrid.
    if (/elektro|hybrid|phev/i.test(raw)) {
      const phev = has('phev.*benzine') || has('phev') || has('benzine');
      if (phev) return phev;
    }

    // Diesel mentioned anywhere is a better guess than nothing.
    if (/diesel/i.test(raw)) {
      const diesel = has('diesel');
      if (diesel) return diesel;
    }

    // Last resort: ANWB is asking and silence fails validation, so pick a real
    // option. The banner reports the choice, so it is visible, not silent.
    const fallback = options[0] || null;
    if (fallback) {
      console.warn(`[AutokostenBerekenaar] Brandstof "${raw}" onbekend; "${fallback}" gekozen.`);
    }
    return fallback;
  }

  /** The value each select should end up holding, keyed by select name. */
  function buildDesiredValues(vehicle) {
    const V = VehicleUtils;
    return {
      brand: currentSelectedText('brand'),
      model: currentSelectedText('model'),
      licensePlateYear: vehicle.year ? String(vehicle.year) : null,
      licensePlateMonth: vehicle.month ? V.monthName(vehicle.month) : null,
      // Only assert fuel when ANWB is actually asking for it, and never with a
      // null value — that would force the field back to its placeholder.
      fuel: (() => {
        const el = field('select[name="fuel"]');
        if (!el || el.disabled || el.options.length < 2) return null;
        return resolveFuelOption(vehicle, el);
      })(),
      // A disabled transmission select holds ANWB's own answer, so leave it be.
      transmission: (() => {
        const el = field('select[name="transmission"]');
        if (!el || el.disabled || el.options.length < 2) return null;
        return V.mapTransmission(vehicle.transmission);
      })(),
    };
  }

  /** The text of the currently selected option, or null. */
  function currentSelectedText(name) {
    const el = field(`select[name="${name}"]`);
    if (!el || !el.value) return null;
    return el.options[el.selectedIndex]?.text?.trim() || null;
  }

  async function doMerkModel(data, filled) {
    const vehicle = data.vehicle || {};
    const V = VehicleUtils;

    // --- Merk ---
    if (!filled.has('merk')) {
      setStatus('Auto zoeken op merk en model…', { step: 15 });

      const brandSelect = await waitFor(
        () => {
          const el = field('select[name="brand"]');
          return el && el.options.length > 1 ? el : null;
        },
        { timeout: 20000, guard }
      );

      const match = V.matchBrand(Array.from(brandSelect.options).filter((o) => o.value), vehicle.brand);
      if (!match.option) {
        throw new Error(`Merk "${vehicle.brand}" niet gevonden bij ANWB`);
      }

      await setSelectAndVerify('brand', match.option.value);
      filled.add('merk');
      setStatus(`Merk gekozen: ${match.option.text}`, { step: 25 });
    }

    // --- Model (populated after Merk) ---
    if (!filled.has('model')) {
      const modelSelect = await waitFor(
        () => {
          const el = field('select[name="model"]');
          return el && el.options.length > 1 ? el : null;
        },
        { timeout: 20000, guard }
      );

      const options = Array.from(modelSelect.options).filter((o) => o.value);
      const match = V.matchModel(options, vehicle.model);

      if (!match.option) {
        throw new Error(
          `Model "${vehicle.model}" kon niet automatisch worden gekoppeld. ` +
          'Kies het model handmatig en klik op Volgende stap.'
        );
      }

      const lowConfidence = match.confidence < V.Confidence.HIGH;
      await setSelectAndVerify('model', match.option.value);
      filled.add('model');

      setStatus(
        lowConfidence
          ? `Let op: "${vehicle.model}" is gekoppeld aan "${match.option.text}". Controleer dit.`
          : `Model gekozen: ${match.option.text}`,
        { step: 35 }
      );
    }

    // --- Bouwjaar (appears after Model) ---
    if (!filled.has('bouwjaar') && vehicle.year) {
      await setSelectAndVerify('licensePlateYear', String(vehicle.year));
      filled.add('bouwjaar');
      setStatus(`Bouwjaar gekozen: ${vehicle.year}`, { step: 38 });
    }

    // --- Bouwmaand (enabled after Bouwjaar) ---
    if (!filled.has('bouwmaand') && vehicle.month) {
      await setSelectAndVerify('licensePlateMonth', V.monthName(vehicle.month));
      filled.add('bouwmaand');
      setStatus(`Bouwmaand gekozen: ${V.monthName(vehicle.month)}`, { step: 42 });
    }

    // --- Fuel, present only for cars ANWB cannot infer it for ---
    // Fuel comes first: for some cars the transmission select only becomes
    // enabled once a fuel is chosen, so answering it earlier finds it disabled.
    if (!filled.has('fuel')) {
      const fuelSelect = field('select[name="fuel"]');
      // A disabled fuel select means ANWB filled it from the configuration, and
      // it needs no answer from us.
      if (fuelSelect && !fuelSelect.disabled && fuelSelect.options.length > 1) {
        const fuel = resolveFuelOption(vehicle, fuelSelect);

        if (fuel) {
          await setSelectAndVerify('fuel', fuel, { timeout: 10000, attempts: 3 });
          setStatus(`Brandstof gekozen: ${fuel}`, { step: 40 });
        } else {
          // Nothing mapped and the field is asking for an answer: submitting
          // now would fail validation with "Selecteer een brandstof".
          console.warn('[AutokostenBerekenaar] Geen brandstofkoppeling voor:', vehicle.fuel);
        }
        filled.add('fuel');
      }
    }

    // --- Soort transmissie, for cars where ANWB does not know it ---
    // ANWB disables this select and fills in "Automaat" when the model only
    // came with one gearbox. When it is a real choice, an empty value is a
    // hard validation error ("Selecteer een transmissie"), so every manual
    // car on this route used to fail. It renders after fuel, so it is asked
    // for last.
    if (!filled.has('transmission')) {
      const transmissionSelect = field('select[name="transmission"]');
      if (transmissionSelect && !transmissionSelect.disabled && transmissionSelect.options.length > 1) {
        const transmission = V.mapTransmission(vehicle.transmission);

        if (transmission) {
          await setSelectAndVerify('transmission', transmission, { timeout: 10000, attempts: 3 });
          setStatus(`Transmissie gekozen: ${transmission}`, { step: 41 });
        } else {
          console.warn('[AutokostenBerekenaar] Geen transmissiekoppeling voor:', vehicle.transmission);
        }
        filled.add('transmission');
      }
    }

    // Repair anything ANWB wiped during a re-render before we submit.
    await reassertFields(buildDesiredValues(vehicle));

    await advance(
      /volgende stap/i,
      () => !screen.isMerkModel() || screen.isUitvoering() || screen.isOpties() || screen.isAanschaf(),
      { step: 45 }
    );

    // If the step did not move, the submit was rejected; repair and retry.
    if (screen.isMerkModel()) {
      await reassertFields(buildDesiredValues(vehicle));
    }

    filled.clear();
  }

  /**
   * ANWB's options step: a list of checkboxes whose labels are option names.
   * Only appears on the make/model path, and the list is per car.
   *
   * We tick only what the listing gives real evidence for, matched by concept
   * (see utils/options.js) rather than by any make-specific table. An unticked
   * box is the safe default: a wrong tick inflates the car's value.
   */
  async function doOpties(data, filled) {
    setStatus('Opties beoordelen…', { step: 50 });

    if (!filled.has('opties')) {
      const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'))
        .filter((cb) => isVisible(cb) && !cb.closest('header, nav'));

      // Each checkbox's label text carries the option name and its price.
      const labels = checkboxes.map((cb) => {
        const scope = cb.closest('label')
          || (cb.id && document.querySelector(`label[for="${cb.id}"]`))
          || cb.parentElement?.parentElement;
        return (scope?.textContent || '').trim().replace(/\s+/g, ' ');
      });

      const decisions = OptionsUtils?.resolveOptions(labels, data.vehicle) || [];
      const ticked = [];

      decisions.forEach((decision, index) => {
        const cb = checkboxes[index];
        if (!cb || !decision.tick) return;
        if (!cb.checked) DOM.checkCheckbox(cb);
        ticked.push(decision.label.replace(/€\s*[\d.,]+/, '').trim());
      });

      filled.add('opties');
      tickedOptions = ticked;

      if (ticked.length) {
        setStatus(`Opties aangevinkt: ${ticked.join(', ')}`, { step: 55 });
      } else {
        setStatus('Geen opties herkend in de advertentie.', { step: 55 });
      }
      console.log('[AutokostenBerekenaar] Opties:', decisions.map((d) =>
        `${d.tick ? 'AAN' : 'uit'} ${d.label.slice(0, 40)}${d.source ? ` (${d.source})` : ''}`).join(' | '));
    }

    await advance(/volgende stap/i, () => !screen.isOpties() || screen.isAanschaf(), { step: 60 });
    filled.delete('opties');
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

    // On the make/model path an options step follows, so "reached aanschaf" is
    // not the only way to be done here. Stopping only on aanschaf/resultaat
    // clicked straight past the options screen and left every box unticked.
    await advance(
      /volgende stap/i,
      () => screen.isOpties() || screen.isAanschaf() || screen.isResultaat(),
      { step: 60 }
    );
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
      await chrome.storage.local.set({
        lastResult: { ...results, optionsTicked: tickedOptions, timestamp: Date.now() },
      });
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

        if (screen.isOpties()) {
          await doOpties(pendingData, filled);
          idlePasses = 0;
          continue;
        }

        if (screen.isUitvoering()) {
          await doUitvoering(filled);
          idlePasses = 0;
          continue;
        }

        if (screen.isMerkModel()) {
          await doMerkModel(pendingData, filled);
          idlePasses = 0;
          continue;
        }

        if (screen.isKenteken()) {
          // Switch to the make/model tab when there is no plate at all, or when
          // ANWB could not find the one we gave it.
          const lookupFailed = screen.hasKentekenError();

          if (lookupFailed && !vehicleFallbackReady) {
            setStatus('Kenteken niet gevonden bij ANWB.', { error: true });
            return;
          }

          if ((useMerkModel || lookupFailed) && !filled.has('tab-switched')) {
            if (lookupFailed && !useMerkModel) {
              console.log('[AutokostenBerekenaar] Kenteken niet gevonden; terugval op merk/model.');
              setStatus('Kenteken niet gevonden — verder op merk en model…', { step: 10 });
            }
            useMerkModel = true;
            await switchToMerkModelTab();
            filled.add('tab-switched');
            idlePasses = 0;
            continue;
          }

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
      console.error('[AutokostenBerekenaar] Automatisering mislukt:', err);
      setStatus(`Automatiseren mislukt: ${err.message}`, { error: true });
    } finally {
      running = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------------

  // The banner's Stop button sets `stopped` directly; no message is involved.

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

    // buildVehiclePayload derives year/month from productionDate, so use its
    // result rather than the raw extracted shape (which only carries
    // productionDate). Reading the raw shape left year undefined.
    const vehicle = VehicleUtils?.buildVehiclePayload(pendingData.vehicle || {});
    if (vehicle) pendingData.vehicle = vehicle;
    vehicleFallbackReady = Boolean(vehicle);

    // No usable plate: go straight to the make/model form.
    if (!Kenteken?.isValid(pendingData.licensePlate)) {
      if (!vehicleFallbackReady) {
        console.warn(
          '[AutokostenBerekenaar] Geen kenteken en te weinig voertuiggegevens, automatisering overgeslagen.'
        );
        return;
      }
      useMerkModel = true;
      console.log('[AutokostenBerekenaar] Geen kenteken — merk/model-fallback met:', vehicle);
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
