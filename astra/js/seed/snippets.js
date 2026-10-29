/* Built-in quick lines: short, ready-made sentences that copy in one click, to paste into a reply, a chat or a ticket
   note. Each needs a stable, unique id. Any figure, charge, phone number or notice period must come word for word from
   the Terms and Conditions or the guides (tests/snippets.test.mjs checks). Details in braces fill in from the current
   case or your profile: {customer}, {contact}, {ticket}, {site}, {mobile}, {supplier_ref}, {update_time}, {my_name},
   {company}, {today}; anything else, such as {date}, is asked for when the line is copied (as is a case detail that
   is still blank). */
(function (seed) {
  const add = (category, lines, favourites = []) => {
    for (const [id, text] of lines)
      seed.snippets.push({ id: "line-" + id, category, text, favourite: favourites.includes(id) });
  };

  add(
    "Acknowledge",
    [
      ["ack-looking", "Thanks for getting in touch. I've logged this and I'm looking into it now."],
      ["ack-shortly", "Thanks for letting us know. I'm on it and will come back to you shortly."],
      [
        "ack-ticket",
        "Thanks for your email. I've raised ticket {ticket} for this, so please quote it if you need to get back to us.",
      ],
      ["ack-details", "Thanks for the details, that's really helpful."],
      ["ack-patience", "Thanks for your patience while we look into this."],
      ["ack-sorry-trouble", "Sorry to hear you're having trouble with this. Let's get it sorted."],
      ["ack-sorry-inconvenience", "I'm sorry for the inconvenience this is causing."],
      ["ack-owner", "I've picked this up and will be your point of contact until it's resolved."],
      ["ack-call", "Thanks for speaking with me earlier. As discussed, I'm looking into this now."],
      ["ack-update-added", "Thanks for the update, I've added it to the ticket."],
      ["ack-confirming", "Thanks for confirming."],
      ["ack-sending", "Thanks for sending that over."],
      ["ack-received", "Received, thank you. I'll take a look and come back to you."],
      ["ack-urgent", "I understand this is urgent and I'm treating it as a priority."],
      ["ack-colleague", "Thanks for your email. I've passed this to a colleague who will be in touch."],
      ["ack-request", "Thanks for your request. I'll get this set up and let you know once it's done."],
      ["ack-question", "Good question. Let me check and come back to you."],
      ["ack-today", "Thanks for getting in touch. I'm looking into this for you today."],
    ],
    ["ack-looking"],
  );

  add(
    "Updates",
    [
      [
        "upd-still-working",
        "Just a quick update: we're still working on this and I'll let you know as soon as I have news.",
      ],
      ["upd-by-time", "I'll update you by {update_time}."],
      ["upd-by-time-sooner", "I'll update you again by {update_time}, or sooner if anything changes."],
      [
        "upd-waiting-supplier",
        "We're still waiting to hear back from our supplier. I've chased them and will let you know as soon as they reply.",
      ],
      ["upd-chased", "I've chased this again today and will be in touch once I hear back."],
      ["upd-not-forgotten", "I'm still looking into this and haven't forgotten about you."],
      ["upd-fixed", "Good news: this has now been fixed."],
      [
        "upd-changes-made",
        "The changes have now been made. Please let me know if anything isn't working as expected.",
      ],
      ["upd-take-effect", "I've made the change you asked for. It can take a few minutes to take effect."],
      ["upd-in-progress", "This is now in progress."],
      ["upd-complete", "This has been completed on our side."],
      ["upd-cause-found", "We've found the cause and are working on a fix."],
      [
        "upd-wider-issue",
        "There's a wider issue affecting some customers at the moment. We're working on it and will update you as soon as it's resolved.",
      ],
      [
        "upd-supplier-resolved",
        "Our supplier has resolved the issue. Please let me know if you're still having any problems.",
      ],
      [
        "upd-testing",
        "We've made some changes and are testing them now. I'll confirm once everything's working.",
      ],
      [
        "upd-monitoring",
        "Everything looks to be working now. We'll keep an eye on it and let you know if anything changes.",
      ],
      [
        "upd-next-step",
        "The next step is for us to hear back from our supplier. I'll update you as soon as we do.",
      ],
      ["upd-thanks-patience", "Thanks for bearing with us while we work on this."],
    ],
    ["upd-still-working"],
  );

  add(
    "Questions",
    [
      ["ask-router-photo", "Could you send me a photo of the router showing the lights?"],
      [
        "ask-router-lights",
        "Could you let me know the colour of each light on the router, and whether it's solid or flashing?",
      ],
      ["ask-number", "Could you send me the full number that's affected?"],
      [
        "ask-mac",
        "Could you send me the MAC address of the handset? It's on the box or the back of the phone. For a cordless handset, please send the MAC address of its base station.",
      ],
      ["ask-when-started", "Could you tell me roughly when this started?"],
      ["ask-who-affected", "Does this affect everyone in the office, or just some people?"],
      ["ask-every-call", "Is this happening on every call, or only some?"],
      [
        "ask-example-call",
        "Could you send me an example call: the number you called, the number you called from, and the date and time?",
      ],
      ["ask-inbound-outbound", "Is the problem with incoming calls, outgoing calls, or both?"],
      ["ask-screenshot", "Could you send me a screenshot of the error?"],
      ["ask-best-number", "What's the best number to reach you on?"],
      ["ask-good-time", "When would be a good time to call you?"],
      ["ask-site-address", "Could you confirm the full site address, including the postcode?"],
      ["ask-site-contact", "Who should we contact on site, and what's their number?"],
      ["ask-account-holder", "Could you confirm the name of the account holder?"],
      [
        "ask-speed-test",
        "Could you run a speed test on a computer plugged into the router by cable, and send me the results (download, upload and ping)?",
      ],
      ["ask-wifi-or-cable", "Does the problem happen on a cable connection too, or only on Wi-Fi?"],
      ["ask-model", "Could you tell me the make and model of the phone?"],
      ["ask-screen-message", "Is there any message showing on the phone's screen?"],
      [
        "ask-what-changed",
        "Has anything changed recently, such as new equipment, a move or work on the building?",
      ],
      ["ask-which-user", "Which user or extension is affected?"],
      ["ask-device", "Is this on a desk phone, the mobile app or the computer app?"],
      ["ask-what-tried", "Could you let me know what you've tried so far?"],
      ["ask-still-happening", "Is this still happening now?"],
      ["ask-preferred-contact", "Would you prefer we contact you by phone or by email?"],
    ],
    ["ask-router-photo"],
  );

  add(
    "Things to try",
    [
      [
        "try-restart-router",
        "Please turn the router off at the power for 30 seconds, then turn it back on and give it a few minutes to start up.",
      ],
      [
        "try-cables",
        "Please check that every cable is plugged in firmly, including the one to the phone socket.",
      ],
      ["try-restart-phone", "Could you unplug the phone, wait a moment, then plug it back in?"],
      ["try-other-cable", "Could you try a different network cable?"],
      ["try-other-port", "Could you try plugging the phone into a different network port?"],
      ["try-restart-app", "Could you close the app fully and open it again?"],
      ["try-sign-out", "Could you sign out of the app and sign back in?"],
      ["try-dnd", "Could you check that the phone isn't set to Do Not Disturb?"],
      ["try-forwarding", "Could you check whether call forwarding is switched on?"],
      ["try-test-call", "Could you make a test call to a mobile and let me know what happens?"],
      [
        "try-other-handset",
        "If you can, please try another handset on the same line, to rule out the phone itself.",
      ],
      ["try-restart-pc", "Could you restart your computer and try again?"],
      ["try-power", "Could you check the phone has power? The screen should be lit."],
      ["try-another-device", "Could you try on another device, to see whether it's the same there?"],
      ["try-reply-result", "Once you've tried that, please reply and let me know how you got on."],
      ["try-again-now", "Could you try again now and let me know if it works?"],
    ],
    ["try-restart-router"],
  );

  add(
    "Chasing",
    [
      ["chase-checking-in", "Just checking in to see whether you've had a chance to look at my last email."],
      [
        "chase-still-problem",
        "I haven't heard back from you, so I wanted to check whether this is still a problem.",
      ],
      ["chase-need-details", "We still need the details in my last email before we can go any further."],
      [
        "chase-close-5pm",
        "As we have not received a response, this ticket is now scheduled to close at 5pm today.",
      ],
      [
        "chase-close-5pm-reply",
        "As we have not received a response, this ticket is now scheduled to close at 5pm today. If you still need help, just reply before then and we'll keep it open.",
      ],
      [
        "chase-assume-working",
        "As we have not heard back, we'll assume everything is now working and close this ticket at 5pm today.",
      ],
      ["chase-close-unless", "This ticket will close at 5pm today unless we hear from you."],
      [
        "chase-tried-call",
        "I tried to call you today but couldn't get through. Please let me know a good time to call.",
      ],
      [
        "chase-voicemail",
        "I've left you a voicemail. Please call us back on 0141 404 5441 when it suits you.",
      ],
      [
        "chase-confirm-working",
        "Following my last email, could you confirm whether everything is now working?",
      ],
      [
        "chase-second",
        "I'm following up on my previous email, as we still need a reply to move this forward.",
      ],
      [
        "chase-final",
        "This is our final reminder: if we don't hear back, we'll close this ticket at 5pm today.",
      ],
      [
        "chase-reopen",
        "If you still need help after the ticket closes, just reply to this email and we'll pick it up.",
      ],
    ],
    ["chase-close-5pm"],
  );

  add(
    "Closing",
    [
      [
        "close-glad",
        "I'm glad that's sorted. I'll close this ticket now, but just reply if anything else comes up.",
      ],
      ["close-resolved", "As this is now resolved, I'll close the ticket. Thanks for your patience."],
      ["close-come-back", "If the problem comes back, just reply to this email and we'll pick it up."],
      ["close-anything-else", "Please let me know if there's anything else I can help with."],
      ["close-confirmed", "Thanks for confirming everything is working. I'll close this ticket now."],
      ["close-5pm-resolved", "As this is now working, ticket {ticket} will close at 5pm today."],
      ["close-open-until", "I'll leave this ticket open until 5pm today in case you need anything else."],
      ["close-pleasure", "It was a pleasure to help."],
      [
        "close-new-ticket",
        "If anything new comes up, please send it in separately so it gets its own ticket.",
      ],
      ["close-done", "That's all done for you."],
    ],
    ["close-glad"],
  );

  add("Engineers", [
    ["eng-18", "Please make sure someone aged 18 or over is available for the full appointment."],
    ["eng-access", "Please make sure the engineer can access the installation area."],
    [
      "eng-24h",
      "If you need to change or cancel the appointment, please let us know at least 24 hours before, so we can arrange another date with Openreach.",
    ],
    [
      "eng-aborted",
      "Please make sure someone is available for the full time slot, to avoid an aborted visit charge of £180.",
    ],
    ["eng-no-fault", "If no fault is found, call-out charges will apply, starting from £85 per hour."],
    [
      "eng-accept",
      "Before we book an engineer, please confirm you accept that call-out charges apply if no fault is found, starting from £85 per hour.",
    ],
    ["eng-booked", "The engineer is booked for {date}, {timeslot}."],
    [
      "eng-on-site-call",
      "When the engineer is on site, please call us on 0141 404 5441 so we can tell them what work to carry out.",
    ],
    ["eng-complete", "The engineer has completed the work. Please let me know if you have any problems."],
    [
      "eng-no-access",
      "The engineer couldn't gain access. Please let me know some dates and times that suit you and I'll rebook.",
    ],
    ["eng-availability", "Could you send me a few dates and times that suit you for an engineer visit?"],
    ["eng-confirmed", "I've confirmed the appointment and you'll receive the details by email."],
  ]);

  add("Suppliers", [
    ["sup-raised", "I've raised this with our supplier and will update you as soon as they come back to us."],
    ["sup-raised-ref", "I've raised this with our supplier under reference {supplier_ref}."],
    ["sup-escalated", "I've escalated this to make sure it gets the attention it needs."],
    ["sup-asked-update", "I've asked our supplier for an update and will pass it on as soon as I have it."],
    ["sup-investigating", "Our supplier is investigating and I'm keeping a close eye on it."],
    ["sup-need-access", "Our supplier may need to arrange access to your site. I'll be in touch if they do."],
    [
      "sup-request-update",
      "Please could you provide an update on this fault, including the current status and the next action?",
    ],
    [
      "sup-chase-again",
      "We're still waiting for an update on this fault. Please could you let us know where it stands?",
    ],
  ]);

  add("Porting and orders", [
    ["port-loa-thanks", "Thanks for the signed Letter of Authority. I'll submit the port request now."],
    ["port-loa-sign", "Please could you print, sign and return the attached Letter of Authority?"],
    [
      "port-crf",
      "Please could you fill in the attached Customer Requirement Form (CRF) and send it back to us?",
    ],
    ["port-booked", "Your number port is booked for {port_date}."],
    [
      "port-keep-old-phone",
      "We recommend keeping your old phone plugged in alongside your new handset until the port has gone through.",
    ],
    [
      "port-submitted",
      "Your port request has been submitted and I'll let you know as soon as we have a date.",
    ],
    ["order-placed", "Your order has been placed and I'll be in touch with the next steps."],
    ["order-router-received", "Could you let us know once the router arrives?"],
    ["order-handsets-sent", "Your handsets have been sent out. Please let us know when they arrive."],
    ["order-checking", "I'm checking the details of your order now and will come back to you."],
  ]);

  add("Billing and contracts", [
    ["bill-invoice-number", "Could you send me the invoice number you're asking about?"],
    ["bill-passed-on", "I've passed your billing question to the right person and they'll come back to you."],
    ["bill-account-number", "Could you confirm the account number?"],
    ["bill-security", "For security, could you confirm the first line of the billing address?"],
    ["bill-notice-90", "To cancel, we need 90 days' written notice, counted from the day we receive it."],
    [
      "bill-notice-received",
      "We've received your written notice to cancel. The 90 days' notice runs from the day we received it.",
    ],
    ["bill-looking", "I'm looking into the charge you've asked about and will explain it shortly."],
  ]);

  add("Chat and calls", [
    ["chat-checking", "Thanks, just checking that for you now."],
    ["chat-moment", "Bear with me one moment."],
    ["chat-thanks-waiting", "Thanks for waiting."],
    ["chat-anything-else", "Is there anything else I can help with today?"],
    ["chat-try-now", "Could you try that now and let me know?"],
    ["chat-glad", "Lovely, glad that's working."],
    ["chat-no-problem", "No problem at all."],
    ["chat-email-details", "I'll email you the details now."],
    ["chat-hold", "I'm just going to put you on hold for a moment while I check."],
    ["chat-name-company", "Could I take your name and the company you're calling from?"],
    ["chat-callback", "Could I take a number to call you back on?"],
    ["chat-ticket-raised", "I've raised a ticket for this and you'll get an email with the reference."],
    ["chat-colleague", "I'll pass this to a colleague and they'll be in touch."],
    ["chat-hello", "Hi, thanks for getting in touch. How can I help?"],
    ["chat-understand", "I understand, let me look into that for you."],
  ]);

  add(
    "Ticket notes",
    [
      ["note-no-answer-vm", "Called the customer: no answer. Left a voicemail."],
      ["note-no-answer", "Called the customer: no answer, no voicemail."],
      ["note-spoke", "Spoke to the customer: "],
      ["note-emailed-details", "Emailed the customer asking for more details."],
      ["note-resolved", "Customer confirmed the issue is resolved."],
      ["note-call-back", "Customer asked us to call back later."],
      ["note-raised-ref", "Raised with the supplier. Reference: {supplier_ref}"],
      ["note-chased-supplier", "Chased the supplier for an update."],
      ["note-restart-persists", "Customer restarted the router. Issue persists."],
      ["note-restart-fixed", "Customer restarted the router. Issue resolved."],
      ["note-awaiting-customer", "Awaiting customer response."],
      ["note-awaiting-supplier", "Awaiting supplier response."],
      ["note-engineer-booked", "Engineer booked for {date}, {timeslot}."],
      ["note-loa-sent", "Sent the LOA to the customer to sign."],
      ["note-crf-sent", "Sent the CRF to the customer to fill in."],
      ["note-port-submitted", "Port request submitted."],
      ["note-closing-5pm", "No response from the customer. Ticket scheduled to close at 5pm today."],
      ["note-closed-no-response", "Closed: no response after chasing."],
      ["note-charges-accepted", "Customer accepted that call-out charges apply if no fault is found."],
      ["note-escalated", "Escalated for a further look."],
      ["note-update-promised", "Update promised by {update_time}."],
    ],
    ["note-no-answer-vm"],
  );

  add("Sign-offs", [
    ["sign-weekend", "Have a lovely weekend."],
    ["sign-day", "Have a good day."],
    ["sign-thanks-again", "Thanks again for your patience."],
    ["sign-any-problems", "Any problems, just let me know."],
    ["sign-get-in-touch", "Please get in touch if you need anything else."],
    ["sign-regards", "Kind regards,\n{my_name}"],
    ["sign-regards-company", "Kind regards,\n{my_name}\n{company}"],
  ]);

  /* Shortcuts: type one and a space in any text box in Astra (or in Zoho Desk, once allowed in Settings) and it
     becomes the line. Each can be changed or removed on the Templates page. */
  const SHORTCUTS = {
    ack: "ack-looking",
    sorry: "ack-sorry-trouble",
    patience: "ack-patience",
    update: "upd-by-time",
    chased: "upd-chased",
    photo: "ask-router-photo",
    when: "ask-when-started",
    tried: "ask-what-tried",
    speed: "ask-speed-test",
    replug: "try-restart-phone",
    chase: "chase-checking-in",
    close5: "chase-close-5pm",
    final: "chase-final",
    vm: "chase-voicemail",
    resolved: "close-resolved",
    working: "close-5pm-resolved",
    else: "close-anything-else",
    raised: "sup-raised-ref",
    notice: "bill-notice-90",
    novm: "note-no-answer-vm",
    spoke: "note-spoke",
    hello: "chat-hello",
    regards: "sign-regards",
  };
  for (const [key, id] of Object.entries(SHORTCUTS)) {
    const line = seed.snippets.find((l) => l.id === "line-" + id);
    if (line) line.shortcut = ";" + key;
  }
})(window.AstraSeed);
