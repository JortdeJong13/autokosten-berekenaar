/**
 * DOM automation helpers for the ANWB Autokosten calculator.
 *
 * ANWB's calculator is a React app (React Hook Form + Radix UI). Two things
 * matter when driving it from a content script:
 *
 *  1. Inputs and selects are controlled by React, so assigning `.value` and
 *     dispatching `change` is not enough on its own — React's internal value
 *     tracker has to be updated too. `setInputValue` / `setSelectValue` handle
 *     both. Every "combobox" ANWB renders also carries a hidden native
 *     `<select>` twin, which is far easier to drive than the Radix popup.
 *
 *  2. React Hook Form validates on submit and rejects a submit that arrives
 *     while it is still settling, even though the field already holds a valid
 *     value. Re-clicking *without* re-filling the field succeeds. So callers
 *     should click, wait for the step to change, and click again — never
 *     re-type in between.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DOMUtils = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Thrown when a `guard` callback aborts a wait (e.g. the user hit Stop). */
  class AbortedError extends Error {
    constructor(message = 'Afgebroken') {
      super(message);
      this.name = 'AbortedError';
    }
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Visible = has layout box and isn't hidden by CSS. */
  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }

  /**
   * Poll `fn` until it returns a truthy value.
   * Rejects with the timeout error, or with `AbortedError` if `guard` throws.
   */
  async function waitFor(fn, { timeout = 15000, interval = 250, guard = null } = {}) {
    const deadline = Date.now() + timeout;
    let lastError = null;

    for (;;) {
      if (guard) guard();

      try {
        const value = fn();
        if (value) return value;
      } catch (err) {
        lastError = err;
      }

      if (Date.now() >= deadline) {
        const suffix = lastError ? ` (laatste fout: ${lastError.message})` : '';
        throw new Error(`Timeout na ${timeout}ms bij wachten op element${suffix}`);
      }
      await sleep(interval);
    }
  }

  /**
   * Set the value of a React-controlled input/textarea.
   * Uses the prototype's value setter so React's value tracker sees the change.
   */
  function setInputValue(el, value) {
    if (!el) return false;

    const stringValue = String(value);
    el.focus();

    const previous = el.value;
    const prototype = Object.getPrototypeOf(el);
    const prototypeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    const ownSetter = Object.getOwnPropertyDescriptor(el, 'value')?.set;

    if (prototypeSetter && ownSetter !== prototypeSetter) {
      prototypeSetter.call(el, stringValue);
    } else if (ownSetter) {
      ownSetter.call(el, stringValue);
    } else {
      el.value = stringValue;
    }

    // Tell React the value changed from `previous` so it doesn't swallow the event.
    if (el._valueTracker) el._valueTracker.setValue(previous);

    el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
    el.blur();
    el.dispatchEvent(new FocusEvent('blur', { bubbles: true, composed: true }));

    return true;
  }

  /**
   * Select an option in a native <select> by value or visible text.
   */
  function setSelectValue(select, valueOrText) {
    if (!select || !select.options) return false;

    const wanted = String(valueOrText).trim().toLowerCase();
    const option = Array.from(select.options).find(
      (opt) => opt.value.toLowerCase() === wanted || opt.text.trim().toLowerCase() === wanted
    );
    if (!option) return false;

    const prototypeSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    if (prototypeSetter) prototypeSetter.call(select, option.value);
    else select.value = option.value;

    select.dispatchEvent(new Event('input', { bubbles: true, cancelable: true, composed: true }));
    select.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
    return true;
  }

  /**
   * Select an option that may not be rendered yet and may start out disabled.
   * ANWB reveals/enables several selects only after earlier fields are valid.
   */
  async function setSelectWhenReady(name, valueOrText, options = {}) {
    const { timeout = 15000, guard = null, root = document } = options;
    const select = await waitFor(
      () => {
        const el = root.querySelector(`select[name="${name}"]`);
        if (!el || el.disabled || el.options.length < 2) return null;
        return el.options.length > 1 ? el : null;
      },
      { timeout, guard }
    );

    const ok = await waitFor(() => setSelectValue(select, valueOrText) || null, {
      timeout: 5000,
      guard,
      interval: 200,
    });
    if (!ok) throw new Error(`Optie "${valueOrText}" niet gevonden in select "${name}"`);
    return select;
  }

  /** Tick a checkbox/radio the way a user click would, so React sees it. */
  function checkCheckbox(element) {
    if (!element) return false;
    element.click();
    return element.checked;
  }

  /** Find a visible, enabled button whose text matches `pattern`. */
  function findButton(pattern, root = document) {
    const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i');
    const candidates = root.querySelectorAll('button, input[type="submit"], input[type="button"]');

    for (const el of candidates) {
      if (el.disabled || !isVisible(el)) continue;
      const text = (el.textContent || el.value || '').trim();
      if (regex.test(text)) return el;
    }
    return null;
  }

  /**
   * Click a button by its label. Uses `el.click()` so React's synthetic
   * onClick handler fires normally.
   */
  function clickButton(pattern, root = document) {
    const button = findButton(pattern, root);
    if (!button) return null;

    button.scrollIntoView({ block: 'center', behavior: 'instant' });
    button.click();
    return (button.textContent || button.value || '').trim();
  }

  /** Dismiss the ANWB cookie wall if it is showing. */
  function dismissCookieBanners(root = document) {
    const accept = findButton(/^accepteren$/i, root) || findButton(/^alles accepteren$/i, root);
    if (!accept) return false;
    accept.click();
    return true;
  }

  /** Remove any leftover consent overlay that would swallow pointer events. */
  function removeBlockingOverlays(root = document) {
    let removed = 0;
    for (const el of root.querySelectorAll('div, section, aside, dialog')) {
      const style = getComputedStyle(el);
      if (style.position !== 'fixed' && style.position !== 'absolute') continue;
      if (!style.zIndex || Number.parseInt(style.zIndex, 10) < 100) continue;
      if (el.getBoundingClientRect().height < 100) continue;
      if (!/cookie|consent|privacy|accepteren|weigeren/i.test(el.textContent || '')) continue;
      el.remove();
      removed++;
    }
    if (removed) {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    }
    return removed;
  }

  return {
    AbortedError,
    sleep,
    isVisible,
    waitFor,
    setInputValue,
    setSelectValue,
    setSelectWhenReady,
    checkCheckbox,
    findButton,
    clickButton,
    dismissCookieBanners,
    removeBlockingOverlays,
  };
});
