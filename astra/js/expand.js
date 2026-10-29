/* Quick line shortcuts: type a shortcut such as ;close5 followed by a space, and it becomes the quick line, with the
   case's details filled in. Works in any text box or rich text editor on the page it is attached to. Shared by Astra
   itself and, when allowed in Settings, by the content script on Zoho Desk. It reads only the few characters just
   before the cursor, and sends nothing anywhere. */
self.AstraExpand = (function () {
  "use strict";

  /* A shortcut is a semicolon and up to 20 letters, digits or dashes: ;ack, ;close5, ;speed-test. */
  const SHORTCUT = /^;[a-z0-9-]{1,20}$/i;
  const valid = (s) => typeof s === "string" && SHORTCUT.test(s);
  const PLACEHOLDER = /\{\s*([^}]+?)\s*\}/g;

  /* The shortcut just typed, if the text before the cursor ends with one and a space. */
  function shortcutAt(before) {
    const m = /(^|[\s(>])(;[a-z0-9-]{1,20})[ \u00a0]$/i.exec(before);
    return m ? m[2].toLowerCase() : "";
  }

  /* The text a shortcut becomes: known details filled in, anything else shown as [detail] to be typed over. */
  function fill(text, values) {
    return String(text).replace(PLACEHOLDER, (_, k) => {
      const v = values && typeof values[k] === "string" ? values[k].trim() : "";
      return v || `[${k.replaceAll("_", " ")}]`;
    });
  }

  function expansion(before, data) {
    const key = shortcutAt(before);
    if (!key || !data || !data.lines) return null;
    const text = data.lines[key];
    if (typeof text !== "string" || !text) return null;
    /* The shortcut and the space typed after it are replaced. */
    return { remove: key.length + 1, text: fill(text, data.values) };
  }

  const editable = (el) =>
    !!el &&
    ((el.tagName === "TEXTAREA" && !el.readOnly) ||
      (el.tagName === "INPUT" && /^(text|search|)$/i.test(el.type) && !el.readOnly) ||
      el.isContentEditable);

  /* Selects the shortcut in the box and types the line over it, so the box's own undo takes it back. */
  function replace(doc, el, remove, text) {
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const end = el.selectionEnd;
      el.setSelectionRange(end - remove, end);
      /* Typing it keeps the box's undo; where that is refused the text is set directly and the page told. */
      if (!doc.execCommand("insertText", false, text)) {
        el.setRangeText(text, end - remove, end, "end");
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText" }));
      }
      return;
    }
    const sel = doc.getSelection();
    if (!sel || !sel.rangeCount) return;
    for (let i = 0; i < remove; i++) sel.modify("extend", "backward", "character");
    doc.execCommand("insertText", false, text);
  }

  function textBefore(doc, el) {
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      if (el.selectionStart !== el.selectionEnd) return "";
      return el.value.slice(Math.max(0, el.selectionEnd - 30), el.selectionEnd);
    }
    const sel = doc.getSelection();
    if (!sel || !sel.isCollapsed || !sel.rangeCount) return "";
    const range = sel.getRangeAt(0).cloneRange();
    const node = range.startContainer;
    if (node.nodeType !== 3) return "";
    return node.textContent
      .slice(Math.max(0, range.startOffset - 30), range.startOffset)
      .replace(/\u00a0/g, " ");
  }

  /* Watches one document. getData() returns { lines: { ";close5": "text" }, values: { ticket: "INC-1" } }; skip(el) can
     leave a box alone (such as the box where a shortcut is being set). Returns a function that stops watching. */
  function attach(doc, getData, { skip = () => false, done = () => {} } = {}) {
    const onInput = (e) => {
      if (e.isComposing || (e.inputType && e.inputType !== "insertText")) return;
      const box = e.target && e.target.nodeType === 1 ? e.target : null;
      if (!box || !editable(box) || skip(box)) return;
      const found = expansion(textBefore(doc, box), getData());
      if (!found) return;
      replace(doc, box, found.remove, found.text);
      done(found);
    };
    doc.addEventListener("input", onInput, true);
    return () => doc.removeEventListener("input", onInput, true);
  }

  /* The shortcuts in a set of quick lines, as { shortcut: text }. The first line to claim a shortcut keeps it. */
  function linesOf(snippets) {
    const out = {};
    for (const l of Array.isArray(snippets) ? snippets : [])
      if (l && valid(l.shortcut) && typeof l.text === "string" && !out[l.shortcut.toLowerCase()])
        out[l.shortcut.toLowerCase()] = l.text;
    return out;
  }

  return { SHORTCUT, valid, shortcutAt, fill, expansion, attach, linesOf };
})();
