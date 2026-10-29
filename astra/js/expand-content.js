/* Quick line shortcuts on Zoho Desk, once allowed in Astra's Settings. The lines and the case's details come from
   Astra through the extension's own storage. Nothing on the page is read except the few characters just before the
   cursor in the box being typed in, and nothing is sent anywhere. */
(function () {
  "use strict";
  if (self.__astraShortcuts) return;
  self.__astraShortcuts = true;
  const KEY = "astra.shortcuts";
  const empty = { lines: {}, values: {} };
  let data = empty;
  const take = (x) => (data = x && typeof x === "object" && x.lines ? x : empty);
  chrome.storage.local
    .get(KEY)
    .then((x) => take(x[KEY]))
    .catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[KEY]) take(changes[KEY].newValue);
  });
  self.AstraExpand.attach(document, () => data);
})();
