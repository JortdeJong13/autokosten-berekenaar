/**
 * Toolbar popup. Renders the same CalculatorForm the AutoScout24 floating
 * panel uses, pre-filled from the active tab when it's a car page.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const mount = document.getElementById('form-root');

  const form = window.CalculatorForm.render(mount, {
    title: 'ANWB Autokosten',
    onSubmit: () => {
      // Close the popup once the ANWB tab has been opened.
      setTimeout(() => window.close(), 400);
    },
  });

  form.applySettings(await window.CalculatorForm.readSettings());

  const details = await extractFromActiveTab();
  if (details) {
    form.setValues({
      licensePlate: details.licensePlate,
      mileage: details.mileage,
      price: details.price,
      title: details.title,
    });

    if (details.licensePlate) {
      form.showFeedback('Gegevens overgenomen van de pagina.', 'info');
    } else {
      form.showFeedback('Geen kenteken in de advertentie gevonden, vul het hier in.', 'info');
      form.focusPlate();
    }
  }

  if (!details || !details.licensePlate) form.focusPlate();
});

/**
 * Ask the AutoScout24 content script for the current page's details.
 * Returns null when the active tab isn't a supported car page, or when the
 * content script isn't reachable (extension just installed / page not reloaded).
 */
async function extractFromActiveTab() {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) return null;

  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (err) {
    console.warn('[CarCostExtension] tabs.query failed:', err);
    return null;
  }

  if (!tab?.url?.includes('autoscout24.nl/aanbod/')) return null;

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, { action: 'extractCarDetails' }, (response) => {
      if (chrome.runtime.lastError || !response?.data) {
        console.log('[CarCostExtension] Content script unreachable:', chrome.runtime.lastError?.message);
        resolve({ title: tab.title || 'AutoScout24 Occasion' });
        return;
      }
      resolve(response.data);
    });
  });
}
