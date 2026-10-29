/* Spelling something out over the phone: letters in the phonetic alphabet, digits and symbols by name. */
self.AstraPhonetic = (function () {
  "use strict";

  const LETTERS = {
    a: "Alpha",
    b: "Bravo",
    c: "Charlie",
    d: "Delta",
    e: "Echo",
    f: "Foxtrot",
    g: "Golf",
    h: "Hotel",
    i: "India",
    j: "Juliet",
    k: "Kilo",
    l: "Lima",
    m: "Mike",
    n: "November",
    o: "Oscar",
    p: "Papa",
    q: "Quebec",
    r: "Romeo",
    s: "Sierra",
    t: "Tango",
    u: "Uniform",
    v: "Victor",
    w: "Whiskey",
    x: "X-ray",
    y: "Yankee",
    z: "Zulu",
  };
  const DIGITS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
  const SYMBOLS = {
    " ": "space",
    "-": "dash",
    _: "underscore",
    ".": "dot",
    ",": "comma",
    ":": "colon",
    ";": "semicolon",
    "@": "at",
    "/": "forward slash",
    "\\": "backslash",
    "#": "hash",
    "!": "exclamation mark",
    "?": "question mark",
    $: "dollar",
    "£": "pound sign",
    "%": "percent",
    "&": "ampersand",
    "*": "star",
    "+": "plus",
    "=": "equals",
    "(": "open bracket",
    ")": "close bracket",
    "'": "apostrophe",
    '"': "quote",
    "~": "tilde",
    "^": "caret",
    "<": "less than",
    ">": "greater than",
    "[": "open square bracket",
    "]": "close square bracket",
    "{": "open curly bracket",
    "}": "close curly bracket",
    "|": "pipe",
  };

  /* Each character as it is said. Case is said only when the text mixes capitals and small letters, as in a
     password; a MAC address or postcode is read without it. */
  function spell(text) {
    const chars = [...String(text)];
    const mixed = /[a-z]/.test(text) && /[A-Z]/.test(text);
    return chars.map((c) => {
      const lower = c.toLowerCase();
      if (LETTERS[lower]) {
        const word = LETTERS[lower];
        if (!mixed) return { char: c, said: word };
        return {
          char: c,
          said: c === lower ? `small ${word.toLowerCase()}` : `capital ${word.toUpperCase()}`,
        };
      }
      if (/\d/.test(c)) return { char: c, said: DIGITS[Number(c)] };
      return { char: c, said: SYMBOLS[c] || `"${c}"` };
    });
  }

  const line = (text) =>
    spell(text)
      .map((x) => x.said)
      .join(", ");

  return { spell, line, LETTERS };
})();
