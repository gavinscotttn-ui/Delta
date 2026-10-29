/* Astra's background script.
   - "Triage with Astra" on the right-click menu, for text selected on any page. The selection goes to a new Astra tab
     through the browser's session storage, which is held in memory only, readable only by Astra's own pages, and
     cleared as soon as the tab has read it.
   - Quick line shortcuts on Zoho Desk, when switched on in Settings.
   It keeps no other data. */
"use strict";

const MENU = "astra-triage";
const HANDOFF = "astra.triage.";
const LIMIT = 50000; /* characters: a long email thread, not a whole web page */

/* Install and startup can both run after a browser update: the second "already exists" is expected and ignored. */
function addMenu() {
  chrome.contextMenus.removeAll(() =>
    chrome.contextMenus.create(
      { id: MENU, title: "Triage with Astra", contexts: ["selection"] },
      () => void chrome.runtime.lastError,
    ),
  );
}
chrome.runtime.onInstalled.addListener(addMenu);
chrome.runtime.onStartup.addListener(addMenu);

/* The selection as the page has it. The menu's own copy runs the lines together, and a signature needs its line
   breaks to tell the name from the number and the address. Reading it needs the right-click's one-off access to the
   tab (activeTab); where the browser does not allow that (its own pages, the PDF viewer, another site's frame), the
   menu's copy is used instead. */
async function selection(info, tab) {
  if (tab && tab.id >= 0) {
    try {
      const [frame] = await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [info.frameId || 0] },
        func: () => String(getSelection()),
      });
      if (frame && typeof frame.result === "string" && frame.result.trim()) return frame.result;
    } catch {
      /* not allowed on this page: fall back to the menu's copy */
    }
  }
  return typeof info.selectionText === "string" ? info.selectionText : "";
}

async function triage(info, tab) {
  const text = (await selection(info, tab)).slice(0, LIMIT);
  if (!text.trim()) return;
  /* Each email has its own id, so two right-clicks in quick succession each reach their own tab. */
  const id = crypto.randomUUID();
  await chrome.storage.session.set({ [HANDOFF + id]: { text, at: Date.now() } });
  await chrome.tabs.create({
    url: chrome.runtime.getURL("index.html#triage=" + id),
    ...(tab && tab.id >= 0 ? { index: tab.index + 1, openerTabId: tab.id } : {}),
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU) triage(info, tab);
});

/* ------------------------------------------- quick line shortcuts in Zoho Desk */

/* Off unless switched on in Settings, which asks the browser for access to Zoho's pages. The script then runs on
   those pages only, in every frame (Zoho's editor sits in one), and only reads what is typed just before the cursor. */
const ZOHO = ["https://*.zoho.eu/*", "https://*.zoho.com/*"];
const SHORTCUTS = "astra-shortcuts";

async function shortcuts(on) {
  const have = await chrome.scripting.getRegisteredContentScripts({ ids: [SHORTCUTS] }).catch(() => []);
  if (on && !(await chrome.permissions.contains({ origins: ZOHO }))) on = false;
  if (on && !have.length)
    await chrome.scripting.registerContentScripts([
      {
        id: SHORTCUTS,
        matches: ZOHO,
        js: ["js/expand.js", "js/expand-content.js"],
        allFrames: true,
        matchOriginAsFallback: true,
        runAt: "document_idle",
      },
    ]);
  else if (!on && have.length) await chrome.scripting.unregisterContentScripts({ ids: [SHORTCUTS] });
  return on;
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== "astra-shortcuts" || sender.id !== chrome.runtime.id) return;
  shortcuts(message.on === true).then(reply, () => reply(false));
  return true;
});
/* Access taken away in the browser's own settings switches them off. */
chrome.permissions.onRemoved.addListener(() => shortcuts(false));

/* For the tests, which cannot right-click. */
self.astraTriage = triage;
self.astraShortcuts = shortcuts;
