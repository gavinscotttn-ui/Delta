/* Astra triage: reads a pasted customer email or ticket and pulls out what a service-desk engineer would look for first.
   Plain pattern matching, no model and no network: everything it reports was found word for word in the text, and
   anything it suggests (priority, guide, missing evidence) says why. No DOM, no state. */
window.AstraTriage = (function () {
  "use strict";

  /* ------------------------------------------------------------- cleaning */

  /* Drops quoted replies and forwarded history: only the newest message is about this case. */
  function newestMessage(text) {
    const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (/^\s*-{2,}\s*(original message|forwarded message)/i.test(l)) break;
      if (/^\s*On .{4,120}wrote:\s*$/i.test(l)) break;
      /* Gmail wraps a long "On ... wrote:" line over two or three lines. */
      if (/^\s*On .{4,160}$/i.test(l) && lines.slice(i + 1, i + 3).some((x) => /wrote:\s*$/i.test(x))) break;
      /* An Outlook reply header: "From:" followed within a few lines by "Sent:" or "Date:". Skip the first one, which
         may be the header of the message itself. */
      if (
        out.some((x) => x.trim()) &&
        /^\s*From:\s/i.test(l) &&
        lines.slice(i + 1, i + 4).some((x) => /^\s*(Sent|Date):\s/i.test(x))
      )
        break;
      if (/^\s*>/.test(l)) continue;
      out.push(l);
    }
    return out.join("\n").trim();
  }

  const SIGN_OFF =
    /^\s*(kind regards|best regards|warm regards|many thanks|thanks( again| very much)?|thank you|regards|cheers|best wishes|best|sincerely|yours sincerely|yours faithfully|ta)\b[\s,.!]*$/i;

  /* Splits the message into header lines (From:, Subject: ...), the body and the signature. */
  function parts(message) {
    const lines = message.split("\n");
    const header = {};
    let i = 0;
    while (i < lines.length && /^\s*(From|To|Cc|Sent|Date|Subject):\s/i.test(lines[i])) {
      const m = /^\s*(\w+):\s*(.*)$/.exec(lines[i]);
      header[m[1].toLowerCase()] = m[2].trim();
      i++;
    }
    const rest = lines.slice(i);
    /* The sign-off is the first thanks or regards after the message has said something beyond a greeting, so a
       "Thank you." straight after "Hi," does not swallow the email. */
    const GREETING =
      /^\s*(hi|hello|hey|dear|good (morning|afternoon|evening)|morning|afternoon)\b[^.!?]{0,40}[,!.]?\s*$/i;
    let said = false;
    let cut = rest.findIndex((l) => {
      if (said && SIGN_OFF.test(l)) return true;
      if (l.trim() && !GREETING.test(l) && !SIGN_OFF.test(l)) said = true;
      return false;
    });
    if (cut === -1) cut = rest.findIndex((l) => /^\s*--\s*$/.test(l));
    const body = (cut === -1 ? rest : rest.slice(0, cut)).join("\n").trim();
    const signature =
      cut === -1
        ? []
        : rest
            .slice(cut + 1)
            .map((l) => l.trim())
            .filter(Boolean);
    return { header, body, signature, content: rest.join("\n") };
  }

  /* ------------------------------------------------------------ finders */

  const uniq = (list) => [...new Set(list)];

  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const IP = /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g;
  const MAC = /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g;
  const BARE_MAC = /\bmac(?:\s*address)?\b[^.\n]{0,40}?\b([0-9A-Fa-f]{12})\b/gi;
  const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[ABD-HJLNP-UW-Z]{2})\b/gi;
  const PHONE = /(?:\+44\s?\(0\)\s?|\+44\s?|\b0044\s?|\(0|\b0)(?:\d\)?[\s-]?){9,10}(?!\d)/g;

  /* UK numbers in the usual groupings. Returns "" for anything that is not a UK number. */
  function ukPhone(raw) {
    let p = String(raw)
      .replace(/\(0\)/g, "")
      .replace(/[^\d+]/g, "");
    if (p.startsWith("+44")) p = "0" + p.slice(3);
    else if (p.startsWith("0044")) p = "0" + p.slice(4);
    const split = (...sizes) => {
      let i = 0;
      return sizes.map((n) => p.slice(i, (i += n))).join(" ");
    };
    if (/^07\d{9}$/.test(p)) return split(5, 6);
    if (/^02\d{9}$/.test(p)) return split(3, 4, 4);
    if (/^0(11\d|1\d1)\d{7}$/.test(p)) return split(4, 3, 4);
    if (/^0[389]\d{9}$/.test(p)) return split(4, 3, 4);
    if (/^01\d{8,9}$/.test(p)) return split(5, p.length - 5);
    return "";
  }

  const macOut = (m) =>
    m
      .replace(/[^0-9a-f]/gi, "")
      .toUpperCase()
      .match(/../g)
      .join(":");

  const isPrivateIP = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|169\.254\.)/.test(ip);

  /* Equipment and services, named the way the guides name them. */
  const MODELS = [
    {
      re: /\b(?:yealink\s+)?(?:sip-?)?(T[2-9]\d[A-Z]{0,2})\b/gi,
      name: (m) => "Yealink " + m[1].toUpperCase(),
      maker: "Yealink",
      needs: /yealink|\bT(4[0-9]|5[0-9]|7[0-9]|3[0-9]|2[0-9])[SUGWP]{1,2}\b/i,
    },
    {
      re: /\b(?:yealink\s+)?(W[5-9]\d[PHB])\b/gi,
      name: (m) => "Yealink " + m[1].toUpperCase(),
      maker: "Yealink",
    },
    {
      re: /\b(?:yealink\s+)?(AX\d{2}[A-Z]?)\b/gi,
      name: (m) => "Yealink " + m[1].toUpperCase(),
      maker: "Yealink",
    },
    { re: /\b(?:polycom\s+)?(VVX)\s*-?(\d{3})\b/gi, name: (m) => "Polycom VVX " + m[2], maker: "Polycom" },
    {
      re: /\b(?:polycom\s+)?(Trio)\s*-?(\d{4}|C\d{2})\b/gi,
      name: (m) => "Polycom Trio " + m[2].toUpperCase(),
      maker: "Polycom",
    },
    {
      re: /\b(?:polycom\s+)?(SoundPoint)(?:\s*IP)?\s*-?(\d{3})\b/gi,
      name: (m) => "Polycom SoundPoint IP " + m[2],
      maker: "Polycom",
    },
    { re: /\bcisco\s+(?:ip\s+phone\s+)?(?:CP-)?(\d{4})\b/gi, name: (m) => "Cisco " + m[1], maker: "Cisco" },
    { re: /\bCP-(\d{4})\b/gi, name: (m) => "Cisco " + m[1], maker: "Cisco" },
  ];

  const SERVICES = [
    ["Horizon", /\bhorizon\b/i],
    ["Voxone", /\bvox ?one\b/i],
    ["Webex", /\bwebex\b/i],
    ["Collaborate", /\bcollaborate\b/i],
    ["iPECS", /\bipecs\b/i],
    [
      "Microsoft Teams",
      /\b(ms|microsoft) teams\b|\bteams (app|call|calls|calling|meeting|meetings|phone)\b/i,
    ],
    ["Openreach", /\bopenreach\b/i],
    ["Broadband", /\b(broadband|internet|fttp|fttc|sogea|adsl|full fibre)\b/i],
    ["Router", /\b(router|draytek|zyxel|netgear|tp-?link|hub)\b/i],
    ["Wi-Fi", /\b(wi-?fi|wireless)\b/i],
    ["Mobile app", /\b(iphone|android|mobile app|softphone|soft client)\b/i],
    ["Call recording", /\bcall recording\b/i],
    ["Call queue", /\b(call (queue|centre|center)|hunt group|ring group)\b/i],
    ["Voicemail", /\bvoice ?mail\b/i],
    ["Auto attendant", /\b(auto ?attendant|ivr|menu option)\b/i],
  ];

  const TIME = /\b(?:(?:[01]?\d|2[0-3]):[0-5]\d(?:\s?[ap]m)?|(?:1[0-2]|0?[1-9])(?:\.[0-5]\d)?\s?[ap]m)\b/gi;
  const DAY =
    /\b(today|yesterday|this morning|this afternoon|last night|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/gi;

  const TICKET = [
    /\b(?:ticket|case|ref(?:erence)?|incident|job|call ref)\s*(?:no\.?|number|#)?\s*(?:is\s+)?[:#-]?\s*([A-Z]{0,5}-?\d{4,}[A-Z0-9-]*)\b/gi,
    /\b((?:INC|REQ|CHG|RITM|TKT|SR|CS|PRB)-?\d{4,})\b/g,
  ];

  const GENERIC_MAIL =
    /@(gmail|googlemail|outlook|hotmail|live|msn|yahoo|icloud|me|aol|btinternet|sky|virginmedia|talktalk|protonmail|proton)\./i;

  /* ------------------------------------------------------------- reading */

  const FAULT =
    /\b(not working|isn'?t working|won'?t|can'?t|cannot|unable|no (dial ?tone|audio|sound|service|signal|internet|connection)|dropp(ed|ing)|cut(s|ting)? (off|out)|one[- ]way|echo|crackl\w*|robotic|choppy|breaking up|fault\w*|error|issue|problem|down\b|offline|keeps|stopped|fail(s|ed|ing)?|broken|dead|not ringing|doesn'?t ring|initiali[sz]ing|unregistered|not registering|no calls?)\b/i;
  const REQUEST =
    /\b(how (do|can|would) (i|we)|could you (please )?(add|change|set ?up|create|move|remove|update|order|send)|can you (please )?(add|change|set ?up|create|move|remove|update|order|send)|please (add|change|set ?up|create|move|remove|update|order)|new (user|starter|extension|number|line|site)|leaver|request(ing)?|quote|price|cost of|order(ing)? a|would like to (add|order|change)|set up a)\b/i;

  /* A suggestion, with the words that led to it. Teams use different schemes: the labels are a starting point. */
  function priority(text) {
    const t = text.replace(/\s+/g, " ");
    /* The words that matched, widened to the clause around them so the reason reads as the customer wrote it. */
    /* A clause ends at punctuation, but not inside a time or number such as 8:30, 8.30 or 1,200. */
    const stop = (i, marks) =>
      marks.test(t[i]) && !(/[:.,]/.test(t[i]) && /\d/.test(t[i - 1] || "") && /\d/.test(t[i + 1] || ""));
    const hit = (re) => {
      const m = re.exec(t);
      if (!m) return "";
      let start = m.index;
      let end = m.index + m[0].length;
      while (start > 0 && !stop(start - 1, /[.!?,;:\n(]/) && m.index - start < 40) start--;
      while (end < t.length && !stop(end, /[.!?,;:\n)]/) && end - (m.index + m[0].length) < 40) end++;
      /* Never cut a word in half: step in to the nearest space when the limit stopped mid-word. */
      const cutStart = start > 0 && /\w/.test(t[start - 1]) && /\w/.test(t[start]);
      const cutEnd = end < t.length && /\w/.test(t[end - 1]) && /\w/.test(t[end]);
      if (cutStart) start = Math.min(m.index, t.indexOf(" ", start) + 1 || m.index);
      if (cutEnd) end = Math.max(m.index + m[0].length, t.lastIndexOf(" ", end));
      let quote = t.slice(start, end).trim();
      /* A bracket opened or closed outside the quote is dropped, so the quote reads as a whole. */
      if ((quote.match(/\(/g) || []).length !== (quote.match(/\)/g) || []).length)
        quote = quote.replace(/[()]/g, "").trim();
      return (cutStart ? "…" : "") + quote + (cutEnd ? "…" : "");
    };
    const p1 = [
      hit(
        /\b(all|every|whole|entire|none of (the|our))\b[^.?!]{0,35}\b(phones?|lines?|handsets?|calls?|site|office|users?|staff|extensions?|numbers?)\b[^.?!]{0,40}\b(down|dead|not working|offline|no service|can'?t|cannot|unable|fail\w*|stopped|no dial ?tone|initiali[sz]ing|not register\w*|won'?t register|unregistered|not ringing|dropp\w*|cutting off|no audio|one[- ]way|no sound)/i,
      ),
      hit(/\b(site|office|building|branch)\s+(is\s+|are\s+)?(completely\s+)?(down|offline|dead)\b/i),
      hit(/\bno(body| ?one) (can|is able to) (make|receive|call|ring|get)\b[^.?!]{0,30}/i),
      hit(/\b(total|complete|full) (outage|loss of service)\b/i),
      hit(/\boutage\b/i),
    ].filter(Boolean);
    if (p1.length)
      return {
        level: 1,
        label: "P1 · Critical",
        reasons: p1,
        note: "The whole site or service seems to be affected.",
      };
    const p2 = [
      hit(
        /\b(several|multiple|many|a few|some|half|most|lots of|a number of|\d{1,3})\s+(of (the|our)\s+)?(users|phones|people|staff|handsets|extensions|colleagues|calls|agents|sites)\b/i,
      ),
      hit(/\b(customers|callers) (can'?t|cannot|are unable to) (get through|reach|call)\b/i),
      hit(
        /\b(main|reception|sales|support) (number|line)\b[^.?!]{0,30}\b(down|not working|dead|not ringing|can'?t|cannot)/i,
      ),
    ].filter(Boolean);
    const urgent = hit(
      /\b(urgent(ly)?|asap|as soon as possible|critical|emergency|losing (business|money|customers))\b/i,
    );
    const fault = FAULT.test(t);
    const request = !fault && REQUEST.test(t);
    if (p2.length)
      return {
        level: 2,
        label: "P2 · High",
        reasons: p2.concat(urgent || []),
        note: "More than one user, or a main number, seems affected.",
      };
    if (request)
      return {
        level: 4,
        label: "P4 · Request",
        reasons: [hit(REQUEST)],
        note: "Reads as a request or question, not a fault.",
      };
    if (fault && urgent)
      return {
        level: 2,
        label: "P2 · High",
        reasons: [hit(FAULT), urgent],
        note: "A single fault, marked urgent by the customer. Check the impact before agreeing.",
      };
    if (fault)
      return {
        level: 3,
        label: "P3 · Normal",
        reasons: [hit(FAULT)],
        note: "Reads as a fault affecting one user or device.",
      };
    return {
      level: 3,
      label: "P3 · Normal",
      reasons: [],
      note: "Nothing in the text says how widespread this is. Ask.",
    };
  }

  /* The first real sentence: greetings and pleasantries skipped. */
  function summary(header, body) {
    if (header.subject) {
      const s = header.subject.replace(/^((re|fw|fwd)\s*:\s*)+/i, "").trim();
      if (s.length > 4) return s.slice(0, 160);
    }
    const sentences = body
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const skip =
      /^(hi|hello|hey|dear|good (morning|afternoon|evening)|morning|afternoon|hope (you|this|all)|i hope|thanks|thank you|please see|see below|just a quick)\b/i;
    const pick =
      sentences.find((s) => FAULT.test(s) && !/^(hi|hello|dear)\b[^,]*,?$/i.test(s)) ||
      sentences.find((s) => !skip.test(s) && s.length > 12) ||
      sentences[0] ||
      "";
    /* "Hi, our broadband..." and "Hi Sarah, our broadband..." both read "Our broadband...". */
    const clean = pick
      .replace(/^(hi|hello|hey|dear|good (morning|afternoon|evening))(\s+[^,]{1,30})?,\s*/i, "")
      .replace(/^./, (c) => c.toUpperCase());
    return clean.length > 160 ? clean.slice(0, 157).replace(/\s+\S*$/, "") + "..." : clean;
  }

  /* Name and company from the "From:" line or the signature. Only what is written there; never guessed. */
  function sender(header, signature, emails) {
    let name = "";
    let email = "";
    if (header.from) {
      const from = header.from.replace(/\s*\[mailto:([^\]]+)\]/i, " <$1>");
      const m = /^"?([^"<@]{2,60}?)"?\s*<([^>]+)>/.exec(from);
      if (m) {
        name = m[1].trim();
        email = m[2].trim();
        /* Outlook writes "Jones, Sarah": put the first name first. */
        const swapped = /^([A-Z][\w'’-]+),\s*([A-Z][\w'’-]+(?:\s+[A-Z][\w'’-]+)?)$/.exec(name);
        if (swapped) name = `${swapped[2]} ${swapped[1]}`;
      } else if (/@/.test(from)) email = (from.match(EMAIL) || [from.trim()])[0];
    }
    const looksLikeName = (l) => /^[A-Z][a-z'’-]+(?:\s+[A-Z][a-z'’-]+){0,2}$/.test(l) && l.length < 40;
    if (!name && signature.length && looksLikeName(signature[0])) name = signature[0];
    const company =
      signature.find(
        (l) =>
          /(\b(ltd|limited|llp|plc|inc|group|solicitors|accountants|surgery|school|council|trust|partners)\b|&\s?co\b)\.?/i.test(
            l,
          ) &&
          l.length < 70 &&
          !/@|\d{5,}/.test(l),
      ) || "";
    if (!email) email = emails.find((e) => !GENERIC_MAIL.test(e)) || emails[0] || "";
    const domain = email && !GENERIC_MAIL.test(email) ? email.split("@")[1].toLowerCase() : "";
    return { name, email, company, domain };
  }

  /* ---------------------------------------------------- evidence needed */

  /* Each list comes from a guide in Astra, named in `guide`, so the engineer can check the wording. */
  const CHECKLISTS = [
    {
      id: "calls",
      /* A fault on phone calls themselves. "Call me back" or "give us a call" is not one. */
      when: /\b(calls?\s+(keep|are|is|were|was|won'?t|can'?t|cannot|not|fail\w*|drop\w*|cut\w*|going|go|end\w*)|(incoming|outgoing|inbound|outbound|external|internal|answer\w*|making|receiving|taking|make|receive|take)\s+calls?|on (a|the) call|during (a |the )?calls?|audio|can'?t hear|cannot hear|unable to hear|choppy|robotic|crackl\w*|echo\w*|one[- ]way|ringing|ring out|dial ?tone|dropp\w* calls?|call quality)\b/i,
      title: "For a call fault, Gamma needs",
      guide: "kb-horizon-raise-fault",
      items: (f) => {
        /* The customer's own contact number is how to reach them, not a call example. */
        const mentioned = f.phones.filter((p) => !f.contactPhones.includes(p));
        return [
          {
            label: "Date and time of each call (at least 3 examples)",
            have: f.times.length >= 3,
            partial: f.times.length > 0 && f.times.length < 3 ? `${f.times.length} found` : "",
            who: "customer",
          },
          { label: "Calling number", have: mentioned.length >= 1, who: "customer" },
          { label: "Destination number", have: mentioned.length >= 2, who: "customer" },
          { label: "Handset make and model", have: f.models.length > 0, who: "customer" },
          { label: "What happened on the call", have: f.isFault, who: "customer" },
        ];
      },
    },
    {
      id: "quality",
      when: /\b(quality|choppy|robotic|crackl\w*|echo|jitter|one[- ]way|breaking up|delay|lag|muffled|distort\w*)\b/i,
      title: "For a call quality fault, also",
      guide: "kb-call-quality",
      items: () => [
        {
          label: "Your access investigation: packet loss, jitter and latency on the line",
          have: false,
          who: "you",
        },
        { label: "The codec in use", have: false, who: "you" },
      ],
    },
    {
      id: "broadband",
      when: /\b(broadband|internet|fttp|fttc|sogea|adsl|openreach|router|no connection|full fibre|engineer)\b/i,
      title: "Before booking an engineer",
      guide: "kb-first-line-checks",
      items: () => [
        {
          label: "First line checks done with the customer and recorded on the ticket",
          have: false,
          who: "you",
        },
        {
          label:
            "Customer accepts call-out charges if no fault is found (starting from £85 per hour; aborted visit £180)",
          have: false,
          who: "customer",
        },
      ],
    },
  ];

  /* --------------------------------------------------------------- main */

  function read(raw) {
    const text = String(raw || "").slice(0, 50000);
    const message = newestMessage(text);
    const { header, body, signature, content } = parts(message);
    /* Header lines (From:, Sent:) are read for the sender only: their dates are not about the fault. */
    const all = content;

    const emails = uniq([...((header.from || "").match(EMAIL) || []), ...(all.match(EMAIL) || [])]).map((e) =>
      e.toLowerCase(),
    );
    /* A firmware version such as 108.86.0.45 looks like an address: skip numbers that follow "firmware" or "version". */
    const ips = uniq(
      [...all.matchAll(IP)]
        .filter(
          (m) =>
            !/\b(firmware|version|ver|fw|v)\.?\s*[:=]?\s*$/i.test(
              all.slice(Math.max(0, m.index - 20), m.index),
            ),
        )
        .map((m) => m[0]),
    );
    const macs = uniq(
      [...(all.match(MAC) || []), ...[...all.matchAll(BARE_MAC)].map((m) => m[1])].map(macOut),
    );
    const noNet = all.replace(IP, " ").replace(MAC, " ").replace(EMAIL, " ");
    const postcodes = uniq([...noNet.matchAll(POSTCODE)].map((m) => `${m[1]} ${m[2]}`.toUpperCase())).filter(
      (p) => !/^(T|W|AX|CP|VVX)\d/.test(p),
    );

    /* Numbers in the signature, or next to "tel/mobile/call me on", belong to the person writing. */
    const phoneHits = [...noNet.matchAll(PHONE)].map((m) => ({ raw: m[0], at: m.index }));
    const contactZone = (at) => {
      const before = noNet.slice(Math.max(0, at - 40), at);
      return /\b(tel|telephone|phone|mob|mobile|m|t|direct|dd|call me on|call me back on|call back on|ring me on|ring me back on|reach me on|contact me on|text me on|my number|my mobile|my mobile is|mobile number is)\b[\s.:]*$/i.test(
        before,
      );
    };
    const sigText = signature.join("\n");
    const phones = [];
    const contactPhones = [];
    for (const h of phoneHits) {
      const p = ukPhone(h.raw);
      if (!p) continue;
      const mine = contactZone(h.at) || sigText.includes(h.raw.trim());
      (mine ? contactPhones : phones).push(p);
    }

    /* Ticket refs are often only in the subject line, such as "[INC-48213]". */
    const ticketText = `${header.subject || ""}\n${all}`;
    const tickets = uniq(TICKET.flatMap((re) => [...ticketText.matchAll(re)].map((m) => m[1].toUpperCase())));
    const models = [];
    for (const m of MODELS) {
      if (m.needs && !m.needs.test(all)) continue;
      for (const hit of all.matchAll(m.re)) models.push(m.name(hit));
    }
    const services = SERVICES.filter(([, re]) => re.test(body || all)).map(([n]) => n);
    const times = uniq(noNet.match(TIME) || []);
    const days = uniq((noNet.match(DAY) || []).map((d) => d.toLowerCase()));

    const who = sender(header, signature, emails);
    const isFault = FAULT.test(body || all);
    const facts = {
      emails,
      ips: ips.map((ip) => ({ ip, private: isPrivateIP(ip) })),
      macs,
      postcodes,
      phones: uniq(phones),
      contactPhones: uniq(contactPhones),
      tickets,
      models: uniq(models),
      services,
      times,
      days,
      isFault,
    };

    const requests = REQUESTS.filter((r) => r.re.test(body || all)).map((r) => r.id);
    let prio = priority(body || all);
    if (!isFault && requests.length && prio.level === 3 && !prio.reasons.length)
      prio = {
        level: 4,
        label: "P4 · Request",
        reasons: [],
        note: "Reads as a request, not a fault.",
      };
    const symptoms = SYMPTOMS.filter(([, re]) => re.test(body || all)).map(([label, , query]) => ({
      label,
      query,
    }));
    const checks = CHECKLISTS.filter((c) => c.when.test(body || all) && (c.id !== "calls" || isFault)).map(
      (c) => ({
        id: c.id,
        title: c.title,
        guide: c.guide,
        items: c.items(facts),
      }),
    );

    return {
      message,
      header,
      body,
      signature,
      sender: who,
      summary: summary(header, body || all),
      facts,
      priority: prio,
      checks,
      kind: isFault ? "fault" : prio.level === 4 || requests.length ? "request" : "unclear",
      requests,
      losingProvider: losingProvider(body || all),
      symptoms: symptoms.map((x) => x.label),
      queries: searchQueries(header, body || all, facts, symptoms),
      query: searchQueries(header, body || all, facts, symptoms)[0] || "",
    };
  }

  /* Requests that have a form or a standard email of their own. Matched on the newest message only. */
  const REQUESTS = [
    {
      id: "port",
      re: /\b(number port|port(ing)? (over |across )?(my|our|the|a|their|these|those|this) (phone |telephone |landline |main )?numbers?|porting|ported|transfer(ring)? (my|our|the|a|their) (phone |telephone |landline |main )?numbers? (over |across )?(to (you|us|telecom networks)|from)\b|bring (my|our|the|their) (phone |telephone |landline |main )?numbers?|keep (my|our|the|their) (existing |current )?(phone |telephone |landline |main )?numbers?|letter of authority|loa)\b/i,
    },
    {
      id: "new-system",
      re: /\b(new (phone |telephone )?system|new (desk )?(phones|handsets)|set ?up (the|our|my|new) (phones|handsets|phone system)|requirement form|crf)\b/i,
    },
    {
      id: "rma",
      re: /\b(rma|replacement (handset|phone|unit|base|router)|(handset|phone|base( unit)?|router) (is |has |was )?(broken|faulty|dead|damaged|cracked|smashed)|(broken|faulty|dead|damaged|cracked|smashed) (handset|phone|base|router))\b/i,
    },
    {
      id: "openreach",
      re: /\b(openreach|engineer (visit|appointment)|appointment (date|slot)|install(ation)? (date|appointment))\b/i,
    },
  ];

  /* The provider the numbers are leaving, for the LOA: "from BT", "currently with Gamma", "our BT line". */
  function losingProvider(text) {
    const m =
      /\b(?:from|with|leaving|currently on|moving away from)\s+(BT|Gamma|VOIP Unlimited|Voip Unlimited)\b/i.exec(
        text,
      ) || /\b(BT|Gamma|VOIP Unlimited)\b/.exec(text);
    return m
      ? { bt: "bt", gamma: "gamma", "voip unlimited": "voip-unlimited" }[m[1].toLowerCase()] || ""
      : "";
  }

  /* Common faults in the words customers use, each with a short query in the words the guides use. */
  const SYMPTOMS = [
    [
      "Calls dropping",
      /\b(dropp(ed|ing|s)?\s+(the\s+|my\s+|our\s+)?calls?|calls?\s+(keep\s+|are\s+|keeps\s+)?(dropp\w*|cutting off|cut off|ending)|cut(s|ting)?\s+off|calls?\s+drop)\b/i,
      "calls dropping",
    ],
    [
      "Handset not registering",
      /\b(initiali[sz]ing|won'?t register|not registering|unregistered|registration (failed|lost)|keeps? (losing|dropping) registration)\b/i,
      "handset not registering initialising",
    ],
    [
      "One-way or no audio",
      /\b(one[- ]way|can'?t hear|cannot hear|unable to hear|no audio|can only hear|can'?t be heard)\b/i,
      "one way audio can only hear one side",
    ],
    [
      "Poor call quality",
      /\b(robotic|choppy|crackl\w*|breaking up|poor (call |line )?quality|echo\w*|jitter|muffled|distort\w*)\b/i,
      "call quality choppy robotic",
    ],
    [
      "Calls not ringing",
      /\b(not ringing|doesn'?t ring|won'?t ring|isn'?t ringing|don'?t ring|no incoming calls?|calls? (are )?not (coming|getting) through)\b/i,
      "calls not ringing",
    ],
    [
      "Can't make calls",
      /\b(can'?t (make|dial|call out)|cannot (make|dial)|unable to (make|dial)|outbound calls? (fail\w*|not working)|no dial ?tone)\b/i,
      "calls not connecting cannot make calls",
    ],
    [
      "No broadband",
      /\b(no (internet|broadband|connection)|(internet|broadband|connection|wifi|wi-fi) (is |has )?(down|not working|gone|dropping|keeps dropping|stopped)|router (lights? (are |is )?)?(red|off|flashing))\b/i,
      "broadband no connection router",
    ],
  ];

  const DEVICES = /\b(iphone|ipad|android|samsung|pixel|windows|mac(book)?|desktop app)\b/gi;

  /* Queries for the guide search, best first: the symptoms found, then the subject, then the problem sentences.
     The caller searches each and keeps the most confident match. */
  function searchQueries(header, body, facts, symptoms) {
    const devices = uniq((body.match(DEVICES) || []).map((d) => d.toLowerCase()));
    /* Equipment is left out: a model name is rare, so it outweighs the symptom and pulls in that model's how-to. */
    const extra = [...facts.services.filter((s) => !["Broadband", "Router"].includes(s)), ...devices];
    const out = [];
    if (symptoms.length) out.push([...symptoms.map((s) => s.query), ...extra].join(" "));
    if (header.subject) out.push(header.subject.replace(/^((re|fw|fwd)\s*:\s*)+/i, ""));
    const sentences = body
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+/)
      .filter((s) => FAULT.test(s) || REQUEST.test(s))
      .slice(0, 3)
      .map((s) =>
        s
          .replace(EMAIL, " ")
          .replace(PHONE, " ")
          .replace(IP, " ")
          .replace(TIME, " ")
          .replace(/\d+/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .split(" ")
          .slice(0, 16)
          .join(" "),
      );
    out.push(...sentences);
    return uniq(out.filter((q) => q && q.split(" ").length >= 2));
  }

  const RANK = { strong: 3, possible: 2, weak: 1, none: 0 };

  /* Searches each query with the guide search engine (AstraAssistant) and keeps the most confident result. */
  function bestSearch(queries, engine) {
    let best = null;
    for (const q of queries || []) {
      const r = engine.search(q);
      const top = r.guides[0];
      const key = [RANK[r.confidence] || 0, top ? top.coverage : 0, top ? top.score : 0];
      const better =
        !best ||
        key[0] > best.key[0] ||
        (key[0] === best.key[0] &&
          (key[1] > best.key[1] || (key[1] === best.key[1] && key[2] > best.key[2])));
      if (better) best = { r, key, q };
    }
    return best;
  }

  /* --------------------------------------------------------- write-ups */

  const firstName = (name) =>
    name
      ? name
          .trim()
          .split(/\s+/)[0]
          .replace(/[^\p{L}'’-]/gu, "")
      : "";

  /* What is still needed from the customer, as a message. Plain and short: edit it before sending. */
  function askForDetails(t, { from = "" } = {}) {
    const wanted = t.checks.flatMap((c) => c.items).filter((i) => !i.have && i.who === "customer");
    if (!wanted.length) return "";
    const lines = [
      `Hi${firstName(t.sender.name) ? " " + firstName(t.sender.name) : ""},`,
      "",
      "Thanks for letting us know. So we can investigate and raise this with our supplier if needed, please could you send:",
      "",
      ...uniq(wanted.map((i) => "- " + i.label)),
      "",
      "Kind regards,",
      from,
    ];
    return lines.join("\n").trim();
  }

  /* A ticket note built only from what was found. Lines with nothing to say are left out. */
  function ticketNote(t, { guide = "", workflow = "", stamp = "" } = {}) {
    const f = t.facts;
    const s = t.sender;
    const line = (label, value) => (value ? `${label}: ${value}` : "");
    const missing = uniq(
      t.checks
        .flatMap((c) => c.items)
        .filter((i) => !i.have)
        .map((i) => i.label),
    );
    return [
      stamp,
      line("Issue", t.summary),
      line("Reported by", [s.name, s.email, f.contactPhones[0]].filter(Boolean).join(", ")),
      line("Company", s.company),
      line("Site postcode", f.postcodes.join(", ")),
      line("Ticket refs", f.tickets.join(", ")),
      line("Equipment", f.models.join(", ")),
      line("Services", f.services.join(", ")),
      line("Numbers mentioned", f.phones.join(", ")),
      line("When", [...f.days, ...f.times].join(", ")),
      line("IP addresses", f.ips.map((x) => x.ip + (x.private ? " (private)" : "")).join(", ")),
      line("MAC addresses", f.macs.join(", ")),
      line(
        "Suggested priority",
        t.priority.label + (t.priority.reasons.length ? ` ("${t.priority.reasons[0]}")` : ""),
      ),
      line("Likely guide", guide),
      line("Workflow", workflow),
      missing.length ? "Still needed:\n" + missing.map((m) => "- " + m).join("\n") : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return { read, bestSearch, ukPhone, askForDetails, ticketNote, newestMessage, CHECKLISTS };
})();
