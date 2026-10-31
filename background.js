/**
 * Background page for the Safari Web Extension.
 *
 * Safari may unload this script at any time and does not guarantee that a
 * response reaches the caller, so `startCalculation` opens the tab itself and
 * always calls `sendResponse` — the content scripts have their own fallback for
 * the case where no response arrives at all.
 */

'use strict';

const ANWB_URL = 'https://www.anwb.nl/auto/autokosten/berekenen';

console.log('[AutokostenBerekenaar] Background script initialized');

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[AutokostenBerekenaar] Installed/updated:', details.reason);
});

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  console.log('[AutokostenBerekenaar] Message received:', request.action);

  switch (request.action) {
    case 'startCalculation':
      chrome.storage.local.set({ pendingCalculation: request.data }, () => {
        chrome.tabs.create({ url: ANWB_URL, active: true }, (tab) => {
          sendResponse({ success: true, tabId: tab?.id ?? null });
        });
      });
      return true; // keep the channel open for the async response

    // That is the only message the extension sends. The readers of the pending
    // payload (the ANWB content script) and the writer of results live in the
    // pages themselves, so there is no get/clear counterpart here.
    default:
      return false;
  }
});
