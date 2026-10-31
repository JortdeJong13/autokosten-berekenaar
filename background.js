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

    case 'getPendingCalculation':
      chrome.storage.local.get(['pendingCalculation'], (result) => {
        sendResponse({ data: result.pendingCalculation ?? null });
      });
      return true;

    case 'clearPendingCalculation':
      chrome.storage.local.remove(['pendingCalculation'], () => {
        sendResponse({ success: true });
      });
      return true;

    default:
      return false;
  }
});
