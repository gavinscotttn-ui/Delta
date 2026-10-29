/* Astra reply builder: writes customer emails from checked building blocks.
   A reply is one situation (what the customer has: "calls dropping", "new user") at one stage of the ticket
   ("first reply", "raised with Gamma", "chase", "closing"), as a full email or a short message, to the customer or to
   their IT team. Every step, charge and number below comes from the guides or the team's own templates; nothing is
   promised that the guides do not say. Details that are not known yet (ticket, update time, supplier reference) are
   left out of the sentence rather than shown as blanks. No DOM, no state. */
window.AstraReplies = (function () {
  "use strict";

  /* Our own contact details, as used in the team's templates. */
  const US = { phone: "0141 404 5441", email: "info@telecomnetworks.co.uk" };

  /* Evidence Gamma needs for any call fault (kb-horizon-raise-fault). */
  const CALL_EVIDENCE = [
    "the date and time of at least three affected calls",
    "the number calling and the number called for each one",
    "the make and model of the handset",
    "what happened on each call",
  ];
  const BYPASS_SWITCH =
    "If the phone is connected through a network switch, try plugging it straight into the router and let me know whether that changes anything.";
  const ROUTER_RESTART =
    "Turn the router off at the power for 30 seconds, then turn it back on and give it a few minutes to start up.";

  /* ------------------------------------------------------------ situations */
  /* kind: fault (something is broken), request (something to set up or change), howto (a question to answer).
     about: completes "about ..."; title: short name; ask: details to request; steps: things the customer can safely
     try; it: steps for the customer's IT team; supplier: who we raise it with; engineer: an engineer visit may be
     needed (brings the call-out charges); test: completes "Could you ...". */
  const SITUATIONS = [
    /* Broadband and lines */
    {
      id: "broadband-down",
      group: "Broadband",
      kind: "fault",
      title: "Broadband down",
      about: "your broadband being down",
      tags: ["no internet", "offline", "no connection", "internet down", "broadband not working", "router"],
      match:
        /\b(no (internet|broadband|connection|wi-?fi)|(internet|broadband|connection|wi-?fi|router)\b[^.?!]{0,25}\b(down|not working|isn'?t working|stopped working|offline|gone off|went off)|lost (the |our |all )?(internet|broadband|connection))\b/i,
      ask: [
        "whether every device is affected, or only some",
        "the colour of each light on the router, and whether it is solid or flashing",
        "roughly when it stopped working",
      ],
      steps: [
        "Check the router has power and that every cable is plugged in firmly, including the one to the phone socket.",
        ROUTER_RESTART,
      ],
      supplier: "Gamma",
      engineer: true,
      test: "check the connection on a couple of devices",
      guide: "kb-gamma-broadband-checks",
    },
    {
      id: "broadband-slow",
      group: "Broadband",
      kind: "fault",
      title: "Slow broadband",
      about: "your broadband running slowly",
      tags: ["slow internet", "slow speed", "speed test", "buffering", "laggy"],
      match:
        /\b(slow (internet|broadband|connection|speed)s?|(internet|broadband|connection) (is |has been )?(really |very )?slow|speed test)\b/i,
      ask: [
        "the download, upload and ping from a speed test, and the time you ran it",
        "whether the device was wired or on Wi-Fi, and roughly how many devices were in use",
        "whether it is slow all the time or only at certain times of day",
      ],
      steps: [
        "Connect one computer to the router with a network cable and run a speed test, with as little else using the connection as possible.",
        ROUTER_RESTART,
      ],
      supplier: "Gamma",
      engineer: true,
      test: "run another speed test",
      guide: "k-slow",
    },
    {
      id: "broadband-dropping",
      group: "Broadband",
      kind: "fault",
      title: "Broadband dropping in and out",
      about: "your broadband dropping in and out",
      tags: ["intermittent", "keeps dropping", "disconnecting", "drops out", "unstable"],
      match:
        /\b((internet|broadband|connection|wifi|wi-fi) (keeps |is )?(dropping|disconnecting|cutting out|going off)|intermittent)\b/i,
      ask: [
        "roughly when it drops and for how long",
        "whether the lights on the router change when it drops",
        "whether it happens at certain times of day",
      ],
      steps: [
        "Make sure the router is plugged into the main phone socket, with nothing else on the line such as old phones or fax machines.",
        "If there is a microfilter on the socket, try a different one.",
      ],
      supplier: "Gamma",
      engineer: true,
      test: "keep an eye on the connection over the next day",
      guide: "kb-gamma-broadband-checks",
    },
    {
      id: "router-setup",
      group: "Broadband",
      kind: "fault",
      title: "New Zyxel router (SoGEA) not connecting",
      about: "getting your new Zyxel router connected",
      tags: ["sogea", "zyxel", "new router", "router setup", "plug in router", "install"],
      match: /\bzyxel\b|\bsogea\b[\s\S]{0,60}\brouter\b/i,
      ask: ["which lights are on, and whether they are solid or flashing"],
      steps: [
        "Plug the power pack into the router's power port and switch it on.",
        "Connect the small grey cable from the grey DSL port on the router to the port marked modem on the BT wall socket.",
        "Wait for the lights to settle: the Wi-Fi network then appears, and wired devices go in the yellow ports.",
      ],
      supplier: "Gamma",
      engineer: true,
      test: "check you are online",
      guide: "kb-sogea-zyxel-connect",
    },
    {
      id: "no-dial-tone",
      group: "Broadband",
      kind: "fault",
      title: "No dial tone on the phone line",
      about: "there being no dial tone on your line",
      tags: ["dial tone", "dead line", "pstn", "analogue line", "phone line dead"],
      match: /\b(no dial ?tone|line (is )?dead|dead line)\b/i,
      ask: ["whether a phone plugged into the test socket gets a dial tone"],
      steps: [
        "Unplug everything else from the phone line, then try a phone in the main socket.",
        "If you can, unscrew the faceplate on the main socket, plug a phone into the test socket behind it and listen for a dial tone.",
      ],
      supplier: "Gamma",
      engineer: true,
      test: "check for a dial tone",
      guide: "kb-gamma-broadband-checks",
    },
    {
      id: "noisy-line",
      group: "Broadband",
      kind: "fault",
      title: "Noise on the phone line",
      about: "the noise on your phone line",
      tags: ["crackling line", "humming", "noisy line", "interference", "quiet line test", "17070"],
      match: /\b(crackl\w*|humm\w*|buzz\w*|noisy|noise) on (the |our )?line\b/i,
      ask: ["what you hear (crackling, humming or popping) and whether it is constant"],
      steps: [
        "Dial 17070 and choose option 2 for a quiet line test, then listen for any noise.",
        "Unplug any other equipment on the line, such as old phones or fax machines, and try again.",
      ],
      supplier: "Gamma",
      engineer: true,
      test: "make a test call",
      guide: "kb-gamma-broadband-checks",
    },
    {
      id: "ethernet-down",
      group: "Broadband",
      kind: "fault",
      title: "Ethernet circuit down",
      about: "your Ethernet circuit being down",
      tags: ["leased line", "ethernet", "circuit down", "nte", "managed router", "ead"],
      match: /\b(leased line|ethernet (circuit|line)?|circuit) (is )?(down|not working)\b/i,
      ask: [
        "whether there is power to the BT box (the NTE), and which lights are on",
        "whether there is power to our managed router, and which lights are on",
        "the name and number of someone on site, and when they are there, in case an engineer is needed",
      ],
      steps: [],
      supplier: "Gamma",
      test: "confirm everything is working",
      guide: "kb-gamma-ethernet-down",
    },

    /* Calls */
    {
      id: "calls-dropping",
      group: "Calls",
      kind: "fault",
      title: "Calls dropping",
      about: "your calls dropping",
      tags: ["calls cutting off", "dropped calls", "calls end", "cut off"],
      match: /\b(dropp(ed|ing) calls?|calls? (keep )?(dropping|cutting off|cut off|ending))\b/i,
      ask: CALL_EVIDENCE,
      steps: [BYPASS_SWITCH],
      it: ["Check SIP ALG is switched off on the router: Horizon is not supported while it is on."],
      supplier: "Gamma",
      test: "make a few test calls",
      guide: "kb-horizon-calls-not-connecting",
    },
    {
      id: "one-way-audio",
      group: "Calls",
      kind: "fault",
      title: "One-way or no audio",
      about: "the calls where one side cannot be heard",
      tags: ["one way audio", "can't hear", "no audio", "silence", "can only hear"],
      match: /\b(one[- ]way|can'?t hear|cannot hear|no audio|can only hear)\b/i,
      ask: [
        ...CALL_EVIDENCE,
        "which side could not hear the other",
        "whether anything has changed on your network recently, such as a new router or firewall",
      ],
      steps: [BYPASS_SWITCH],
      it: [
        "Check SIP ALG is switched off on the router: it often rewrites call traffic and causes one-way audio.",
        "Make sure the firewall allows the ports in Gamma's Horizon network configuration guidelines.",
      ],
      supplier: "Gamma",
      test: "make a few test calls",
      guide: "kb-sip-alg",
    },
    {
      id: "call-quality",
      group: "Calls",
      kind: "fault",
      title: "Poor call quality",
      about: "the poor call quality",
      tags: ["choppy", "robotic", "breaking up", "echo", "crackling calls", "jitter"],
      match: /\b(robotic|choppy|breaking up|poor (call )?quality|echo|jitter|muffled)\b/i,
      ask: [
        ...CALL_EVIDENCE,
        "what it sounds like (crackling, robotic, echo or breaking up) and which side hears it",
        "whether it is constant or only at certain times of day",
      ],
      steps: [BYPASS_SWITCH],
      it: [
        "Check SIP ALG is switched off on the router.",
        "Check for packet loss, jitter and high latency on the internet connection, and that there is enough bandwidth for the number of calls at once.",
      ],
      supplier: "Gamma",
      test: "make a few test calls",
      guide: "kb-call-quality",
    },
    {
      id: "not-ringing",
      group: "Calls",
      kind: "fault",
      title: "Incoming calls not ringing",
      about: "incoming calls not ringing through",
      tags: ["not ringing", "no incoming calls", "calls not coming through", "inbound"],
      match:
        /\b(not ringing|isn'?t ringing|aren'?t ringing|stopped ringing|doesn'?t ring|don'?t ring|won'?t ring|no incoming calls|calls? (are |is )?not coming through|can'?t receive (any )?calls)\b/i,
      ask: [
        "the number that was dialled, and the date and time of the call",
        "which phones should have rung",
        "what the caller heard",
      ],
      steps: ["Check Do Not Disturb is off on the phone: press the DND key, or dial *79 to turn it off."],
      supplier: "Gamma",
      test: "ask someone to call in",
      guide: "kb-horizon-calls-not-connecting",
    },
    {
      id: "cant-call-out",
      group: "Calls",
      kind: "fault",
      title: "Can't make outgoing calls",
      about: "outgoing calls not connecting",
      tags: [
        "can't dial out",
        "outbound calls",
        "this call cannot be completed",
        "can't call mobiles",
        "barred",
      ],
      match:
        /\b((can'?t|cannot|unable to) (make|place) ((any|outgoing|outbound|external) ){0,2}calls?|(can'?t|cannot|unable to) (dial|call|ring) (out|anyone|mobiles?|international|abroad|0\d+|numbers?)|this call cannot be completed|outgoing calls? (are )?(failing|fail|not working|won'?t connect))\b/i,
      ask: [
        "the number you were trying to call",
        "the date and time you tried",
        "any message you heard",
        "which phone or user it happened on",
      ],
      steps: [],
      supplier: "Gamma",
      test: "make a test call to the same number",
      guide: "kb-horizon-call-barring",
    },
    {
      id: "wrong-number-shown",
      group: "Calls",
      kind: "fault",
      title: "Wrong number shown when calling out",
      about: "the wrong number showing when you call out",
      tags: ["cli", "caller id", "number presentation", "withheld", "wrong number displayed"],
      match:
        /\b(wrong number (shows|showing|is showing|displayed|is displayed|appears)|(shows|showing|displays|displaying) (the |a )?wrong number|(our|my|the) number (is )?(being )?withheld|(shows?|showing|comes up|appears) as (withheld|private|unknown))\b/i,
      ask: ["which user or phone it is", "the number being shown", "the number you would like shown"],
      steps: [],
      test: "make a test call to a mobile and check the number shown",
      fixedBy: "us",
      guide: "kb-horizon-number-presentation",
    },
    {
      id: "calls-wrong-place",
      group: "Calls",
      kind: "fault",
      title: "Calls going to the wrong place",
      about: "calls going to the wrong place",
      tags: ["out of hours", "divert not working", "going to voicemail", "schedule", "wrong destination"],
      match:
        /\b(going (straight )?to voicemail|diverts? (is |are )?not working|(calls? )?(is |are )?going to the wrong|out of hours (message|greeting|divert) (is )?(still )?(playing|on|not working|isn'?t working)|wrong (message|greeting) (is )?playing)\b/i,
      ask: [
        "the number that was dialled, and the date and time of the call",
        "where the call went, and where it should have gone",
      ],
      steps: [],
      test: "ask someone to call in",
      fixedBy: "us",
      guide: "kb-horizon-schedules",
    },
    {
      id: "voicemail-not-working",
      group: "Calls",
      kind: "fault",
      title: "Voicemail not working",
      about: "your voicemail",
      tags: ["voicemail", "voice mail", "passcode", "can't get messages", "*62"],
      match:
        /\bvoice ?mail\b[^.?!]{0,60}\b(not working|isn'?t working|doesn'?t work|stopped working|broken|not accepted|no greeting)\b|\b(can'?t|cannot|unable to) (get|access|check|retrieve|get into|listen to) (my |our |the )?voice ?mail|\bvoice ?mail (passcode|pin)\b/i,
      ask: [
        "what happens when you try (for example, no greeting, or the passcode is not accepted)",
        "which user or extension it is",
      ],
      steps: [
        "Dial *62 from your phone, enter your extension and then your passcode.",
        "If you have forgotten the passcode, reply and we will reset it.",
      ],
      supplier: "Gamma",
      test: "leave a test message and play it back",
      guide: "kb-horizon-voicemail",
    },
    {
      id: "voicemail-full",
      group: "Calls",
      kind: "fault",
      title: "Voicemail full",
      about: "your voicemail box being full",
      tags: ["mailbox full", "voicemail full", "can't leave a message"],
      match: /\b(mailbox|voice ?mail) (is )?full\b/i,
      ask: [],
      steps: [
        "Dial *62, enter your extension and passcode, and delete any messages you no longer need: a mailbox holds 100 minutes of messages, and callers cannot leave a new one once it is full.",
      ],
      note: "Messages are kept for 30 days. To keep one for longer, we can turn on email notifications that attach each voicemail.",
      test: "leave a test message",
      guide: "kb-horizon-voicemail",
    },
    {
      id: "agent-no-calls",
      group: "Calls",
      kind: "fault",
      title: "Call centre agent not getting calls",
      about: "calls not reaching one of your agents",
      tags: ["call centre", "agent", "queue", "not receiving calls", "acd"],
      match: /\b(agent|queue) (is )?not (getting|receiving) calls\b/i,
      ask: ["the agent's name and extension", "the date and time of a few calls they should have received"],
      steps: [
        "Check the agent is joined to the call centre and set to Available. Signed In on its own is not enough: calls are only sent to agents who are Available.",
        "Check their phone is not on another call, and that they have not been left in Unavailable or Wrap-Up after their last call.",
      ],
      supplier: "Gamma",
      test: "ask the agent to take a test call",
      guide: "kb-horizon-cc-agent-no-calls",
    },
    {
      id: "call-recording",
      group: "Calls",
      kind: "fault",
      title: "Call recording missing",
      about: "the call recording you are looking for",
      tags: ["call recording", "recording missing", "can't play recording"],
      match: /\b(call )?recording (is )?(missing|not (there|working|playing))\b/i,
      ask: ["the date and time of the call", "the numbers involved", "which user took or made the call"],
      steps: [],
      supplier: "Gamma",
      test: "check the recording plays",
      guide: "kb-horizon-call-recording",
    },

    /* Handsets */
    {
      id: "handset-not-registering",
      group: "Handsets",
      kind: "fault",
      title: "Phone not registering",
      about: "your phone not connecting",
      tags: ["initialising", "url calling disabled", "not registered", "no service on handset", "dhcp error"],
      match:
        /\b(initiali[sz]ing|url calling disabled|not register\w*|won'?t register|unregistered|dhcp error)\b/i,
      ask: [
        "what the screen shows (for example Initialising or URL calling disabled)",
        "the make and model of the phone",
        "the MAC address, from the back of the phone or its box (for a cordless phone, the base station's)",
      ],
      steps: [
        "Check the network cable is plugged firmly into the phone and into the wall socket or router.",
        "Restart the phone by unplugging its power (or its network cable, if that powers it) for 30 seconds, then plug it back in.",
        "Give it 15 to 20 minutes: the phone may restart a few times while it updates.",
      ],
      it: [
        "Check the router is giving the phone an IP address (DHCP).",
        "Make sure the firewall allows the ports in Gamma's Horizon network configuration guidelines.",
        "Check SIP ALG is switched off on the router.",
      ],
      supplier: "Gamma",
      test: "make a test call",
      guide: "kb-horizon-handset-not-registering",
    },
    {
      id: "desk-phone-no-power",
      group: "Handsets",
      kind: "fault",
      title: "Desk phone won't turn on",
      about: "the desk phone that will not turn on",
      tags: ["no power", "blank screen", "won't turn on", "dead phone", "poe"],
      match:
        /\b(phone|handset|it) (won'?t|will not|doesn'?t|does not) (turn|switch|power) on|\bscreen is blank|\bblank screen|\b(phone|handset) (has )?no power\b/i,
      ask: ["the make and model of the phone"],
      steps: [
        "If the phone has a power adapter, check it is plugged in and the socket is switched on.",
        "If it is powered through the network cable, try a different network socket or port.",
      ],
      test: "check the phone starts up",
      guide: "kb-yealink-desk-basics",
    },
    {
      id: "cordless-pairing",
      group: "Handsets",
      kind: "fault",
      title: "Cordless handset not pairing",
      about: "the cordless handset that will not connect to its base",
      tags: ["w73p", "w52p", "dect", "searching for base", "re-pair", "register handset", "cordless"],
      match:
        /\b(searching for base|won'?t pair|not pairing|re-?pair|lost (its |the )?(connection to the )?base|register (the |a )?(cordless|handset) to (the )?base|(cordless|handset) (is )?not (registered|connected) to (the )?base)\b/i,
      ask: [],
      steps: [
        "Check the Power and Network lights on the base are on, then restart the base by unplugging it for 30 seconds.",
        "Press and hold the button on the base until its light flashes.",
        "On the handset go to OK > Settings > Registration > Register Handset, choose the base and enter the PIN 0000.",
      ],
      test: "make a test call from the handset",
      guide: "kb-w73p-troubleshooting",
    },
    {
      id: "cordless-signal",
      group: "Handsets",
      kind: "fault",
      title: "Cordless handset losing signal",
      about: "the cordless handset losing signal",
      tags: ["cordless signal", "out of range", "calls breaking up cordless", "dect range"],
      match:
        /\b(out of range|losing (the )?signal|no signal|poor signal|signal (keeps )?(dropping|drops))\b/i,
      ask: [],
      steps: [
        "Move the base to an open spot, nearer to where the handset is used.",
        "Restart both the handset and the base, using the cables that came with them.",
      ],
      test: "try a call from where the signal dropped",
      guide: "kb-w73p-troubleshooting",
    },
    {
      id: "cordless-battery",
      group: "Handsets",
      kind: "fault",
      title: "Cordless handset won't charge",
      about: "the cordless handset that will not charge or turn on",
      tags: ["battery", "won't charge", "charging", "cordless dead"],
      match: /\b(won'?t charge|not charging|battery)\b/i,
      ask: ["the model of the handset"],
      steps: [
        "Check the battery is fitted the right way round.",
        "Leave the handset on its charging cradle for a few hours and try again.",
      ],
      test: "check it holds its charge",
      guide: "kb-w73p-troubleshooting",
    },
    {
      id: "handset-stuck",
      group: "Handsets",
      kind: "fault",
      title: "Phone stuck starting up",
      about: "the phone that will not finish starting up",
      tags: ["recovery mode", "sos", "stuck booting", "won't boot", "cisco", "polycom"],
      match: /\b(recovery mode|stuck (on|booting|loading|starting)|won'?t boot)\b/i,
      ask: ["a photo of the screen", "the make and model of the phone"],
      steps: [],
      test: "make a test call",
      fixedBy: "us",
      guide: "kb-cisco-sos-recovery",
    },
    {
      id: "handset-faulty",
      group: "Handsets",
      kind: "fault",
      title: "Faulty or damaged phone",
      about: "the faulty phone",
      tags: ["broken phone", "damaged", "faulty handset", "replacement", "rma", "cracked screen"],
      match:
        /\b(broken|faulty|damaged|cracked|smashed) (handset|phone|screen|base)|\b(handset|phone|screen|base)( screen)? (is |has been |got )?(broken|faulty|damaged|cracked|smashed)\b/i,
      ask: [
        "the MAC address, from the back of the phone or its box (for a cordless phone, the base station's)",
        "what is wrong with it, with a photo if it is damaged",
        "the address a replacement should go to, if one is needed",
      ],
      note: "Gamma's service desk first checks the phone is faulty. Under our terms, damage to equipment, whatever the cause, is charged for repair or replacement.",
      resolved: "Good news: your replacement phone is on its way.",
      steps: [],
      supplier: "Gamma",
      test: "let me know once the replacement is plugged in and working",
      guide: "kb-horizon-returns",
    },
    {
      id: "headset",
      group: "Handsets",
      kind: "fault",
      title: "Headset not working with the PC app",
      about: "your headset",
      tags: ["headset", "speaker", "microphone", "audio device", "collaborate audio"],
      match: /\bheadset\b/i,
      ask: [],
      steps: [
        "In the app open Settings > Audio/Video and choose your headset for both the speaker and the microphone.",
        "If that does not change it, right-click the speaker icon in Windows, open the sound settings and set the headset as the default communication device.",
      ],
      test: "make a test call",
      guide: "kb-collaborate-audio-video",
    },

    /* Apps */
    {
      id: "webex-android",
      group: "Apps",
      kind: "fault",
      title: "Webex calls not showing on Android",
      about: "Webex calls not coming through on your Android phone",
      tags: ["webex", "android", "samsung", "calls not appearing", "mobile app"],
      match: /\bwebex\b[\s\S]{0,80}\b(android|samsung)\b|\b(android|samsung)\b[\s\S]{0,80}\bwebex\b/i,
      ask: [],
      steps: [
        "Update Webex from the Play Store and restart the phone.",
        "Press and hold the Webex icon > App info: allow the Microphone permission and turn on notifications, including calls.",
        "In Webex, tap your picture > Settings > Notifications > Calling and turn on Incoming Calls on This Device.",
        "In App info > Battery choose Unrestricted. On a Samsung, also take Webex out of Sleeping apps and Deep sleeping apps.",
        "If you use Do Not Disturb, add Webex to its allowed apps.",
      ],
      test: "ask someone to call your Webex number",
      guide: "kb-webex-calls-android",
    },
    {
      id: "webex-iphone",
      group: "Apps",
      kind: "fault",
      title: "Webex calls not showing on iPhone",
      about: "Webex calls not coming through on your iPhone",
      tags: ["webex", "iphone", "ios", "calls not appearing", "mobile app"],
      match: /\bwebex\b[\s\S]{0,80}\b(iphone|ios)\b|\b(iphone|ios)\b[\s\S]{0,80}\bwebex\b/i,
      ask: [],
      steps: [
        "Update Webex from the App Store and restart the iPhone.",
        "In Settings > Apps > Webex, turn on the Microphone and allow notifications on the Lock Screen, Notification Centre and Banners.",
        "In Webex, tap your picture > Settings > Notifications > Calling and turn on Incoming Calls on This Device.",
        "Turn on Background App Refresh for Webex, and try with Low Power Mode off.",
        "If you use a Focus such as Do Not Disturb, add Webex to its allowed apps, and check the Silent switch.",
      ],
      test: "ask someone to call your Webex number",
      guide: "kb-webex-calls-iphone",
    },
    {
      id: "app-sign-in",
      group: "Apps",
      kind: "fault",
      title: "Can't sign in to the Collaborate app",
      about: "signing in to the app",
      tags: ["collaborate", "sign in", "login", "password", "forgot password", "client password"],
      match:
        /\b(collaborate|client password)\b[\s\S]{0,80}\b(sign|log) ?in|\b(sign|log) ?in\b[\s\S]{0,80}\bcollaborate\b/i,
      ask: ["your Horizon username"],
      steps: [
        "Sign in with your Horizon username and the client password, which is different from the Horizon portal password.",
        "If it is not accepted, tap Forgot password and enter your Horizon username and email address: a new client password is emailed to you.",
      ],
      test: "sign in again",
      guide: "kb-collaborate-sign-in",
    },
    {
      id: "app-video",
      group: "Apps",
      kind: "fault",
      title: "Camera not working in the app",
      about: "your camera in the app",
      tags: ["video", "webcam", "camera", "no video"],
      match: /\b(camera|webcam|no video)\b/i,
      ask: [],
      steps: [
        "In the app open Settings > Audio/Video and check the right camera is chosen.",
        "Test the camera in the Windows Camera app. If it does not work there either, the camera itself is at fault.",
      ],
      test: "try a video call",
      guide: "kb-collaborate-audio-video",
    },
    {
      id: "app-mobile-data",
      group: "Apps",
      kind: "fault",
      title: "App calls failing on mobile data",
      about: "calls in the mobile app",
      tags: ["mobile data", "4g", "5g", "app calls", "collaborate mobile"],
      match: /\b(mobile data|4g|5g)\b/i,
      ask: [],
      steps: [
        "Make the same call with the phone on Wi-Fi. The app works over mobile networks, but each network is set up differently, so Wi-Fi is the supported way to use it.",
      ],
      test: "make a test call on Wi-Fi",
      guide: "kb-collaborate-sign-in",
    },

    /* For the customer's IT team */
    {
      id: "voxone-firewall",
      group: "Network",
      kind: "fault",
      title: "Voxone phones not registering (firewall)",
      about: "your Voxone phones not registering",
      tags: ["voxone", "firewall", "ports", "ttl", "registering", "one way audio"],
      match: /\bvoxone\b/i,
      ask: ["the make and model of the firewall or router"],
      steps: [],
      it: [
        "Allow all UDP and TCP ports outbound to the Voxone network 80.83.208.0/20. No inbound rules are needed.",
        "Set that rule's timeout (TTL) to at least 3720 seconds, as the phones check in every 3600 seconds.",
        "Switch off SIP ALG, application control and IPS/IDS for Voxone traffic.",
        "Make sure the phones can reach DNS: they use 8.8.8.8 and 8.8.4.4.",
      ],
      supplier: "Voxone",
      test: "check the phones show as registered",
      fixedBy: "customer",
      guide: "kb-voxone-firewall-checklist",
    },
    {
      id: "sip-alg",
      group: "Network",
      kind: "fault",
      title: "SIP ALG needs switching off",
      about: "a router setting that affects your calls",
      tags: ["sip alg", "router setting", "alg", "registration", "one way audio"],
      match: /\bsip ?alg\b/i,
      ask: ["who manages your router, if it is not you"],
      steps: [],
      it: [
        "Switch off SIP ALG on the router. It inspects and rewrites call traffic, and typically causes phones not registering, incoming calls failing, one-way audio and transfers failing.",
      ],
      test: "make a few test calls",
      guide: "kb-sip-alg",
    },

    /* Requests */
    {
      id: "new-user",
      group: "Changes",
      kind: "request",
      title: "New user or starter",
      subject: "New user setup",
      about: "setting up your new starter",
      tags: ["new starter", "new user", "add user", "joiner", "new employee"],
      match: /\b(new (starter|user|employee|joiner)|add (a )?(new )?user)\b/i,
      ask: [
        "their full name and email address",
        "the extension and direct number they should have, if you have a preference",
        "whether they need a new phone, and which model",
        "which groups their calls should come through",
        "whether they need voicemail",
      ],
      done: "set up the new user",
      test: "make and receive a test call",
      guide: "kb-webex-onboarding",
    },
    {
      id: "leaver",
      group: "Changes",
      kind: "request",
      title: "Staff member leaving (remove a user)",
      subject: "Removing a user",
      about: "the member of staff who is leaving",
      tags: ["leaver", "remove user", "staff leaving", "employee leaving", "delete user"],
      match:
        /\b(leaver|(staff member|member of staff|colleague|employee|user) (is |has )?(leaving|left)|(has|have|is) (left|leaving) (the |our )?(company|business|firm|practice|team)|remove (a |the |this |their )?user|last day (is|will be))\b/i,
      ask: [
        "their name and extension",
        "their last day",
        "where their calls should go afterwards (a colleague, a group or voicemail)",
      ],
      done: "made the changes for the leaver",
      test: "call their old number and check it goes to the right place",
      guide: "kb-horizon-dnd-forwarding",
    },
    {
      id: "divert-setup",
      group: "Changes",
      kind: "request",
      title: "Set up call forwarding",
      about: "setting up call forwarding",
      tags: ["divert", "call forwarding", "forward calls", "redirect calls"],
      match: /\b(divert|forward(ing)?) (my |our |the |all )?calls?\b|\bcall (divert|forwarding)\b/i,
      ask: [
        "which user or number it is for",
        "the UK number calls should go to",
        "when they should forward: always, when busy, when not answered (and after how many rings), or when the phone is offline",
      ],
      note: "Calls can be forwarded to any UK number. If they go to a mobile, your callers pay nothing extra, but the forwarded calls are charged to you.",
      done: "set up the call forwarding",
      test: "ask someone to call and check where it goes",
      guide: "kb-horizon-dnd-forwarding",
    },
    {
      id: "opening-hours",
      group: "Changes",
      kind: "request",
      title: "Change opening hours",
      about: "your opening hours",
      tags: ["opening hours", "out of hours", "closed", "bank holiday", "schedule", "christmas"],
      match:
        /\b(opening hours|bank holiday|christmas|closing early|office (will be )?closed|out of hours (message|greeting))\b/i,
      ask: [
        "your opening hours for each day",
        "where calls should go while you are closed",
        "any dates you will be closed, such as bank holidays",
      ],
      done: "updated your opening hours",
      test: "call in outside the opening hours and check where it goes",
      guide: "kb-horizon-schedules",
    },
    {
      id: "greeting-change",
      group: "Changes",
      kind: "request",
      title: "Change the welcome message or menu",
      about: "changing your welcome message",
      tags: ["auto attendant", "ivr", "greeting", "welcome message", "menu options", "press 1"],
      match: /\b(auto ?attendant|ivr|welcome message|greeting|menu options?|press [0-9])\b/i,
      ask: [
        "the new wording, or the recording as a .wav file (CCITT u-Law, 8000 Hz, 8-bit mono, under 5 MB)",
        "the menu options and where each one should go",
      ],
      done: "updated your welcome message",
      test: "call in and listen to the new message",
      guide: "kb-horizon-auto-attendant",
    },
    {
      id: "hold-music",
      group: "Changes",
      kind: "request",
      title: "Change the music on hold",
      about: "changing your music on hold",
      tags: ["music on hold", "hold music", "on hold message"],
      match: /\b(music on hold|hold music|on hold (music|message))\b/i,
      ask: [
        "the audio as a .wav file (CCITT u-Law, 8000 Hz, 8-bit mono), no more than 5 MB or 625 seconds",
        "which site it is for",
      ],
      note: "Live radio cannot be played on hold, and you will need the rights to any music you use.",
      done: "updated your music on hold",
      test: "put a call on hold and listen",
      guide: "kb-horizon-music-on-hold",
    },
    {
      id: "hunt-group-change",
      group: "Changes",
      kind: "request",
      title: "Change who answers a group",
      about: "changing who answers your group",
      tags: ["hunt group", "ring group", "call group", "add to group", "remove from group"],
      match: /\b(hunt|ring|call) group\b/i,
      ask: [
        "which group it is",
        "who to add or remove",
        "whether the phones should ring all at once or in turn",
      ],
      done: "updated the group",
      test: "call the group and check the right phones ring",
      guide: "kb-horizon-hunt-groups",
    },
    {
      id: "barring-change",
      group: "Changes",
      kind: "request",
      title: "Allow or block call types",
      about: "changing which calls can be made",
      tags: ["call barring", "international calls", "premium numbers", "unbar", "bar calls"],
      match:
        /\b(international calls?|premium (rate )?numbers?|unbar|call barring|bar (international|premium|mobile))\b/i,
      ask: [
        "whether it is for the whole site or for certain users",
        "which types of call to allow or block: international, premium, mobile, 084 and 087, directory services or freephone",
      ],
      done: "made the change",
      test: "make a test call of that type",
      guide: "kb-horizon-call-barring",
    },
    {
      id: "number-shown-change",
      group: "Changes",
      kind: "request",
      title: "Change the number shown when calling out",
      about: "changing the number shown on your outgoing calls",
      tags: ["cli", "caller id", "show main number", "withhold number", "presentation"],
      match: /\b(show (our|the) main number|withhold (our|my|the) number|change (the |our )?caller id)\b/i,
      ask: ["which users it is for", "the number you would like shown"],
      done: "changed the number shown",
      test: "call a mobile and check the number shown",
      guide: "kb-horizon-number-presentation",
    },
    {
      id: "block-nuisance",
      group: "Changes",
      kind: "request",
      title: "Block nuisance calls",
      about: "the nuisance calls",
      tags: ["nuisance calls", "block number", "spam calls", "unwanted calls"],
      match:
        /\b(nuisance|spam|unwanted|scam) (calls?|callers?|numbers?)\b|\bblock (a |this |that |the |these )?(\w+ )?numbers?\b/i,
      ask: ["the numbers calling, and when", "which number or group they are calling"],
      note: "Numbers are blocked on a call group, up to 12 per group, and must match exactly. It needs an add-on for each group, which we will confirm with you before setting it up.",
      done: "blocked the numbers",
      test: "keep an eye out for any more of those calls",
      guide: "kb-horizon-nuisance-calls",
    },
    {
      id: "voicemail-setup",
      group: "Changes",
      kind: "request",
      title: "Set up voicemail",
      about: "setting up voicemail",
      tags: ["voicemail setup", "add voicemail", "voicemail to email"],
      match: /\b(set ?up|add|turn on) voice ?mail\b|\bvoice ?mail to email\b/i,
      ask: [
        "which users need it",
        "whether messages should also be emailed, and to which address",
        "after how many rings unanswered calls should go to voicemail",
      ],
      done: "set up voicemail",
      test: "leave a test message",
      guide: "kb-horizon-voicemail",
    },
    {
      id: "extra-phones",
      group: "Changes",
      kind: "request",
      title: "Order more phones",
      about: "your order for more phones",
      tags: ["new handset", "extra phone", "order phones", "additional handset"],
      match: /\b(order|need|want) (an? )?(more|extra|new|another|additional) (phones?|handsets?)\b/i,
      ask: ["how many, and which model", "who each one is for", "the delivery address"],
      done: "placed the order",
      test: "make a test call once they are plugged in",
      guide: "kb-handset-mac-address",
    },
    {
      id: "office-move",
      group: "Changes",
      kind: "request",
      title: "Moving office",
      about: "your office move",
      tags: ["office move", "relocation", "moving premises", "new address"],
      match: /\b(moving (office|premises|to a new)|office move|relocat\w*|new premises)\b/i,
      ask: [
        "the new address",
        "the date you move",
        "which services are moving: phones, broadband, or both",
        "a contact on site for the move",
      ],
      done: "made the arrangements for your move",
      test: "make a test call once you are in",
      guide: "kb-first-line-checks",
    },
    {
      id: "number-port",
      group: "Changes",
      kind: "request",
      title: "Bring numbers across (port)",
      subject: "Bringing your numbers across",
      about: "bringing your numbers across to us",
      tags: ["port", "porting", "loa", "keep numbers", "transfer numbers"],
      match: /\b(port(ing)? (our|my|the) numbers?|keep (our|my) numbers?|letter of authority|loa)\b/i,
      ask: [
        "the signed Customer Letter of Authority, attached (both pages must be signed, as Openreach will not accept it otherwise)",
        "the numbers to bring across, and who they are with now",
      ],
      progress:
        "I have submitted the request to bring your numbers across. Once the date is confirmed I will send you a calendar invite.",
      done: "brought your numbers across",
      test: "make a few calls in and out",
      guide: "kb-company-porting-addresses",
    },
    {
      id: "new-system",
      group: "Changes",
      kind: "request",
      title: "New phone system",
      about: "your new phone system",
      tags: ["crf", "customer requirement form", "new system", "programming", "set up phones"],
      match: /\b(new (phone |telephone )?system|requirement form|crf)\b/i,
      ask: [
        "the completed Customer Requirement Form (CRF), attached, so we can set everything up the way you want",
      ],
      done: "set up your new system",
      test: "make and receive a few test calls",
      guide: "kb-company-gamma-accounts",
    },

    {
      id: "ring-mobile",
      group: "Changes",
      kind: "request",
      title: "Ring a mobile at the same time",
      about: "ringing your mobile at the same time as your desk phone",
      tags: ["twinning", "ring my mobile", "simultaneous ring", "mobile too"],
      match: /\b(twinning|ring (my|the) mobile|mobile (to )?ring (as well|too|at the same time))\b/i,
      ask: ["which user it is for", "the mobile number (up to seven numbers can ring at once)"],
      done: "set your mobile to ring at the same time",
      test: "ask someone to call your desk number and check both ring",
      guide: "kb-horizon-personal-call-handling",
    },
    {
      id: "hot-desk",
      group: "Changes",
      kind: "request",
      title: "Set up hot desking",
      about: "setting up hot desking",
      tags: ["hot desk", "hot desking", "shared desk", "log in to another phone"],
      match: /\bhot ?desk\w*\b/i,
      ask: [
        "which users will hot desk",
        "which phones they will use (the extension, or the MAC address from the back of the phone)",
      ],
      note: "Hot desking is switched off for every user by default for security, so we turn it on for just the people and phones you name.",
      done: "set up hot desking",
      test: "try logging in at the shared phone",
      guide: "kb-horizon-hot-desking",
    },
    {
      id: "install-details",
      group: "Changes",
      kind: "request",
      title: "Installation appointment details",
      about: "your installation appointment",
      tags: ["installation", "install", "appointment", "engineer visit", "site access"],
      match: /\binstall(ation)? (appointment|date|visit)\b/i,
      ask: [
        "the full site address",
        "the name and mobile number of the person on site",
        "any access restrictions, and parking or reception instructions",
      ],
      note: "An adult needs to be on site for the whole appointment, and the engineer will need access to where the equipment is going.",
      done: "booked the installation",
      test: "check everything is working once it is in",
      guide: "k-appointment",
    },
    {
      id: "ethernet-slow",
      group: "Broadband",
      kind: "fault",
      title: "Ethernet circuit slow or dropping",
      about: "your Ethernet circuit being slow or dropping",
      tags: ["leased line slow", "ethernet slow", "packet loss", "latency", "intermittent ethernet"],
      match: /\b(leased line|ethernet)\b[\s\S]{0,60}\b(slow|dropping|packet loss|latency|intermittent)\b/i,
      ask: [
        "whether it is slow, dropping in and out, or losing packets",
        "a speed test from a wired computer, with the time you ran it",
        "roughly when it started, and whether it is constant",
      ],
      steps: [],
      supplier: "Gamma",
      test: "run another wired speed test",
      guide: "kb-gamma-ethernet-down",
    },

    /* Account */
    {
      id: "cancel-service",
      group: "Account",
      kind: "request",
      title: "Customer cancelling (90 days' notice)",
      subject: "Your notice to end your service",
      warm: false,
      about: "ending your service with us",
      tags: [
        "cancel",
        "cancellation",
        "terminate",
        "notice",
        "leaving",
        "end contract",
        "switching provider",
        "90 days",
      ],
      match:
        /\b(cancel(ling|lation)?|terminat(e|ing|ion)|end|close) (our|my|the|this) (contract|account|agreement|services?|phones|phone system|broadband|lines?)\b|\b(formal )?notice (to|that we (wish|want|would like) to) (terminate|cancel|end|leave)\b|\b(give|giving|serve|serving|handing in) (our |my |you )?(formal )?notice\b|\b(switching|moving (over )?to|going (over )?to) (another|a new|a different) (provider|supplier)\b|\bswitching (provider|supplier)s?\b|\bleaving (you|telecom networks)\b/i,
      /* Cancelling an engineer visit, an order or a divert is not ending the service. */
      exclude: /\b(appointment|visit|engineer|install(ation)?|order|divert|forward(ing)?|renew(al)?)\b/i,
      ask: [
        "which services you would like to end (phones, broadband or both), and the account or site they are for",
        "the name and job title of the person giving notice",
      ],
      note: [
        "Under our terms, ending the service needs 90 days' written notice, sent to the address on your bill. The 90 days count from the day we receive it.",
        "If you are still within your minimum period (the first 12 months, unless your order says otherwise), early termination fees equal to the remaining contract value apply. Broadband circuits may also have a one-off cease charge of £45.",
        "Services added after your contract started can end later than the rest; I will confirm the end date for each one.",
        "Equipment we supplied stays our property and needs returning in working order at the end of the contract. Items not returned, such as Ethernet broadband routers, may incur replacement charges of upwards of £300.",
      ].join("\n\n"),
      noteShort:
        "Our terms need 90 days' written notice, sent to the address on your bill and counted from the day we receive it. Early termination fees apply within the minimum period, broadband circuits may have a one-off £45 cease charge, and our equipment must be returned.",
      /* With the date the notice arrived, the reply gives the date the 90 days end (counted by AstraContract). */
      progress: (v) =>
        v.notice_received && v.notice_end
          ? `Your notice to end your service is recorded. We received it on ${v.notice_received}, so your 90 days' notice ends on ${v.notice_end}. Services added after your contract started can end later than the rest; I will confirm the end date for each one, and how to return any of our equipment, before then.`
          : "Your notice to end your service is recorded, and your 90-day notice period runs from the day we received it. I will confirm the end date for each service, and how to return any of our equipment, before then.",
      done: "recorded your notice",
      stages: ["first-reply", "ask-details", "progress", "no-reply"],
      test: "check the details",
      guide: "kb-company-terms",
    },
    {
      id: "billing-query",
      group: "Account",
      kind: "request",
      title: "Billing query",
      about: "your bill",
      tags: ["invoice", "bill", "billing", "overcharged", "refund", "credit", "charges"],
      match:
        /\b(invoice|overcharged|charged (twice|wrong(ly)?|incorrectly)|credit note|refund|(our|my|the|this) bill)\b/i,
      ask: [
        "the invoice number or date",
        "which charges you think are wrong, and why",
        "anything that supports it, such as a copy of an earlier cancellation request",
      ],
      note: "Under our terms, a billing error that we verify is credited or refunded for up to the previous three months.",
      done: "corrected your billing",
      test: "check your next invoice",
      guide: "kb-company-terms",
    },
    {
      id: "change-of-ownership",
      group: "Account",
      kind: "request",
      title: "Business sold (change of ownership)",
      about: "the change of ownership of your business",
      tags: ["selling the business", "new owner", "change of ownership", "takeover", "transfer contract"],
      match:
        /\b(sold|selling|sale of) (the |our |my )?(business|company)\b|\b(new|change of) owner(s|ship)?\b/i,
      ask: ["the new owner's company name and contact details", "the date the sale completes"],
      note: [
        "Under our terms, the contract can pass to the new owners only if everyone agrees. If they do not take it on, the termination fees and cease charges stay with the current owner, and the numbers cannot move to the new company while a contract is still active.",
        "To avoid any loss of service, the new owner should sign for the transfer of ownership, a new service agreement in the new company name and a new Direct Debit before any numbers are exchanged.",
      ].join("\n\n"),
      done: "set up the transfer of ownership",
      test: "check everything is working under the new company",
      guide: "kb-company-terms",
    },

    /* Questions */
    {
      id: "dnd-howto",
      group: "How to",
      kind: "howto",
      title: "How to use Do Not Disturb",
      about: "Do Not Disturb",
      tags: ["dnd", "do not disturb", "*78", "*79"],
      match: /\b(dnd|do not disturb)\b/i,
      answer: [
        "Dial *78 to turn Do Not Disturb on, and *79 to turn it off. Most phones also have a DND key that does the same.",
        "While it is on, your calls are treated as if you were busy (for example, sent to voicemail if you have it), so remember to turn it off afterwards.",
      ],
      guide: "kb-horizon-dnd-forwarding",
    },
    {
      id: "voicemail-howto",
      group: "How to",
      kind: "howto",
      title: "How to check voicemail",
      about: "checking your voicemail",
      tags: ["check voicemail", "listen to messages", "*62", "*86"],
      match: /\b(how (do i|to) (check|listen|get)).{0,20}(voice ?mail|messages)\b/i,
      answer: [
        "Dial *62 from your phone (or *86), then enter your extension and passcode.",
        "Messages are kept for 30 days and a mailbox holds 100 minutes, so it is worth deleting old ones.",
      ],
      guide: "kb-horizon-voicemail",
    },
    {
      id: "find-mac",
      group: "How to",
      kind: "howto",
      title: "Where to find the MAC address",
      about: "finding the MAC address",
      tags: ["mac address", "find mac", "serial", "label"],
      match: /\bmac address\b/i,
      answer: [
        "The MAC address is a 12-character code of letters and numbers, printed on the back of the phone or on its box. It is sometimes written in pairs separated by colons.",
        "For a cordless phone, send the MAC address of the base station, as the handset itself does not have one.",
        "Please send it exactly as printed: it is how the phone is matched to your account.",
      ],
      guide: "kb-handset-mac-address",
    },
    {
      id: "pull-call",
      group: "How to",
      kind: "howto",
      title: "Move a call to the mobile app",
      about: "moving a call to your mobile",
      tags: ["pull call", "move call to mobile", "collaborate", "transfer to mobile"],
      match: /\bpull (a |the )?call\b|\bmove (a |the )?call to (my |the )?mobile\b/i,
      answer: [
        "In the mobile app, open the menu (the three lines at the top left) and choose Pull Call. The call moves from your desk phone or PC to the mobile.",
      ],
      guide: "kb-collaborate-sign-in",
    },
    {
      id: "transfer-howto",
      group: "How to",
      kind: "howto",
      title: "How to transfer a call",
      about: "transferring calls",
      tags: ["transfer", "warm transfer", "blind transfer", "transfer to voicemail", "t46u"],
      match: /\bhow (do i|to|can i) transfer\b/i,
      answer: [
        "To introduce the caller first: press Transfer, dial your colleague, tell them who is calling when they answer, then press Transfer again.",
        "To send the call straight through: press Transfer, then the Blind soft key, dial the extension and press Transfer again.",
        "To send it to someone's voicemail: press Transfer, then Blind, dial *0 followed by their extension, and press Transfer.",
      ],
      guide: "kb-yealink-t46u-quick",
    },
    {
      id: "park-howto",
      group: "How to",
      kind: "howto",
      title: "How to park a call",
      about: "parking calls",
      tags: ["park", "call park", "retrieve parked call", "##*3"],
      match: /\b(park(ed|ing)? (a |the )?call|call park)\b/i,
      answer: [
        "On a call, press the More soft key until Park shows and press it, or press ##*3. Listen for the park location it announces (for example *802) and note it.",
        "To pick the call back up, press * followed by that park location.",
      ],
      guide: "kb-yealink-t46u-quick",
    },
    {
      id: "anonymous-calls",
      group: "How to",
      kind: "howto",
      title: "How to block withheld numbers",
      about: "blocking calls from withheld numbers",
      tags: ["anonymous call rejection", "withheld numbers", "private numbers", "*77"],
      match: /\b(withheld|anonymous|private) (numbers?|calls?)\b/i,
      answer: [
        "Dial *77 from your phone to reject calls from withheld numbers, and *87 to allow them again.",
      ],
      guide: "kb-horizon-shortcodes",
    },
    {
      id: "cordless-wifi",
      group: "How to",
      kind: "howto",
      title: "Change the Wi-Fi on an AX83H",
      about: "changing the Wi-Fi network on your AX83H",
      tags: ["ax83h", "wifi", "wi-fi", "change network", "cordless wifi"],
      match: /\bax83h\b|\bwi-?fi\b[\s\S]{0,40}\bhandset\b/i,
      answer: [
        "Press the middle OK button on the handset and open the Wi-Fi settings (the third icon from the left on the top row).",
        "Scroll down to 4. Wi-Fi Network, choose your network and enter the password with the number and letter keys.",
      ],
      guide: "kb-yealink-ax83h-wifi",
    },
    {
      id: "webex-first-sign-in",
      group: "How to",
      kind: "howto",
      title: "First sign-in to Webex",
      about: "signing in to Webex for the first time",
      tags: ["webex", "onboarding", "first sign in", "activation email", "reset password"],
      match: /\bwebex\b[\s\S]{0,60}\b(sign ?in|log ?in|set ?up|password|activate)\b/i,
      answer: [
        "Open the onboarding email, click the link and choose Reset Password. The new password must be 16 characters long, so keep a note of it somewhere safe.",
        "Then download the Webex app, choose Sign In and enter the username you were given and your new password.",
        "Please add important business contacts to the phone system directory rather than to Webex contacts, so they are not lost if the app changes.",
      ],
      guide: "kb-webex-onboarding",
    },
  ];

  /* ----------------------------------------------------------------- stages */
  /* Each stage turns a situation and the known details into paragraphs. v holds the details (all optional):
     ticket, update_time, supplier_ref, date, timeslot, close_date, site. */

  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const list = (items) => items.map((i) => "- " + cap(i)).join("\n");
  const ticketRef = (v) => (v.ticket ? ` (ticket ${v.ticket})` : "");
  const nextUpdate = (v) =>
    v.update_time ? `I will update you by ${v.update_time}.` : "I will update you as soon as I have news.";
  const engineerBy = (s) => (s.supplier === "Gamma" ? "an Openreach engineer" : "an engineer");
  const raisedWith = (s, v) =>
    `I have raised this with ${s.supplier}${v.supplier_ref ? ` under their reference ${v.supplier_ref}` : ""}`;
  const ourContact = `just reply to this email or call us on ${US.phone}`;

  /* "your ticket about ..." reads correctly with every situation's phrase, whatever its grammar. */
  const ticketAbout = (s, v) =>
    `${/^your\b/.test(s.about) ? "the" : "your"} ticket about ${s.about}${ticketRef(v)}`;
  const stepsIntro = (n, audience) =>
    audience === "it"
      ? n === 1
        ? "This is the usual cause, so please could you check it:"
        : "These are the usual causes, so please could you go through them:"
      : n === 1
        ? "This often sorts it, so please could you try it:"
        : "These often sort it, so please could you try them:";

  /* Stages in the order a ticket goes through them; group is how the builder lays them out. */
  const STAGES = [
    {
      id: "first-reply",
      group: "Start",
      name: "First reply",
      hint: "Thanks, what to try and what we need",
      kinds: ["fault", "request"],
      body(s, v, audience, length) {
        const steps = audience === "it" ? s.it || [] : s.steps || [];
        const out = [`Thanks for getting in touch about ${s.about}${ticketRef(v)}.`];
        if (s.kind === "request" && s.warm !== false) out[0] += " I am happy to sort this for you.";
        if (steps.length) out.push(`${stepsIntro(steps.length, audience)}\n${list(steps)}`);
        if (s.note) out.push(length === "short" && s.noteShort ? s.noteShort : s.note);
        if (s.ask?.length)
          out.push(
            `${steps.length ? (audience === "it" ? "If it is still not right" : "If that does not fix it") + ", please" : "So I can get this moving, please could you"} send me:\n${list(s.ask)}`,
          );
        if (!steps.length && !s.ask?.length) out.push(`I am looking into it now. ${nextUpdate(v)}`);
        else if (s.ask?.length)
          out.push(v.update_time ? nextUpdate(v) : "As soon as I have these, I will take it from there.");
        else out.push("Let me know how you get on.");
        return out;
      },
    },
    {
      id: "ask-details",
      group: "Start",
      name: "Ask for details",
      hint: "Only the details still needed",
      kinds: ["fault", "request"],
      when: (s) => s.ask?.length,
      body: (s, v) => [
        `So I can take ${ticketAbout(s, v)} further, please could you send me:\n${list(s.ask)}`,
        "As soon as I have these, I will get it moving.",
      ],
    },
    {
      id: "try-steps",
      group: "Start",
      name: "Steps to try",
      hint: "Self-help steps from the guide",
      kinds: ["fault"],
      when: (s, audience) => (audience === "it" ? s.it?.length : s.steps?.length),
      body: (s, v, audience) => {
        const steps = audience === "it" ? s.it : s.steps;
        return [
          `About ${ticketAbout(s, v)}: ${stepsIntro(steps.length, audience).replace(/^./, (c) => c.toLowerCase())}\n${list(steps)}`,
          "Let me know how you get on. If it is still not right, I will take it further straight away.",
        ];
      },
    },
    {
      id: "raised",
      group: "Updates",
      name: "Raised with the supplier",
      hint: "Send once it is raised, with their reference",
      kinds: ["fault"],
      when: (s) => s.supplier,
      body: (s, v) => [
        `A quick update on ${ticketAbout(s, v)}: ${raisedWith(s, v)}, and they are now investigating.`,
        nextUpdate(v),
      ],
    },
    {
      id: "progress",
      group: "Updates",
      name: "Progress update",
      hint: "Still investigating",
      kinds: ["fault", "request"],
      body: (s, v) => [
        s.kind === "request"
          ? (typeof s.progress === "function" ? s.progress(v) : s.progress) ||
            `A quick update on ${ticketAbout(s, v)}: this is in hand and I am working through it.`
          : `A quick update on ${ticketAbout(s, v)}: ${s.supplier ? `${s.supplier} are still investigating, and I have chased them for progress` : "I am still working on this"}.`,
        nextUpdate(v),
      ],
    },
    {
      id: "delay",
      group: "Updates",
      name: "Sorry for the delay",
      hint: "Taking longer than expected",
      kinds: ["fault", "request"],
      body: (s, v) => [
        `I am sorry that ${ticketAbout(s, v)} is taking longer than we would like.`,
        s.supplier && s.kind === "fault"
          ? `I have chased ${s.supplier} again and asked them to prioritise it. ${nextUpdate(v)}`
          : `It is still in hand. ${nextUpdate(v)}`,
      ],
    },
    {
      id: "escalated",
      group: "Updates",
      name: "Escalated",
      hint: "Send once it is escalated with the supplier",
      kinds: ["fault"],
      when: (s) => s.supplier,
      body: (s, v) => [
        `As ${ticketAbout(s, v)} is not resolved yet, I have escalated it with ${s.supplier}${v.supplier_ref ? ` (their reference ${v.supplier_ref})` : ""} so it gets more attention.`,
        nextUpdate(v),
      ],
    },
    {
      id: "engineer-needed",
      group: "Engineer",
      name: "Engineer needed (charges)",
      hint: "Ask to go ahead, with the call-out charges",
      kinds: ["fault"],
      when: (s) => s.engineer,
      body: (s, v) => [
        `To resolve ${ticketAbout(s, v)}, we need to send ${engineerBy(s)}. Before I book it, please be aware:\n` +
          list([
            "if the engineer finds no fault on the network, or the fault is with equipment or wiring on your side, the visit is chargeable, from £85 per hour",
            "if nobody is on site to let the engineer in, an aborted visit charge of £180 applies",
          ]),
        "Could you confirm you are happy to go ahead, and send me the name and number of someone who will be on site?",
      ],
    },
    {
      id: "engineer-booked",
      group: "Engineer",
      name: "Engineer booked",
      hint: "Date and slot, access and charges",
      kinds: ["fault"],
      when: (s) => s.engineer,
      needs: ["date", "timeslot"],
      body: (s, v) => [
        `${cap(engineerBy(s))} is booked to visit${v.site ? " " + v.site : ""} on ${v.date || "[date]"}, ${v.timeslot || "[time slot]"}, for ${ticketAbout(s, v)}.`,
        "Please make sure someone is available for the whole slot to let the engineer in: a missed (aborted) visit is charged at £180.",
        `When the engineer arrives, please call us on ${US.phone} so we can tell them exactly what needs doing.`,
        "If you need to change or cancel the appointment, we need at least 24 hours' notice. After that, the £180 charge applies whether or not the engineer can get in.",
      ],
    },
    {
      id: "resolved-check",
      group: "Finish",
      name: "Fixed: please check",
      hint: "Send once it is fixed, to ask them to test",
      kinds: ["fault", "request"],
      /* Only where the fix is ours or the supplier's: a fault the customer fixes with the steps has nothing to report. */
      when: (s) => s.kind === "request" || (s.fixedBy ? s.fixedBy === "us" : !!s.supplier),
      body: (s, v) => [
        s.kind === "request"
          ? `Good news: I have ${s.done || "made the change"}${ticketRef(v)}.`
          : s.resolved ||
            `Good news: the fault on ${ticketAbout(s, v)} has been fixed${s.supplier ? ` by ${s.supplier}` : ""}.`,
        `Please could you ${s.test || "check everything is working"}? Let me know if anything is not right.`,
      ],
    },
    {
      id: "no-reply",
      group: "Finish",
      name: "No reply: chase",
      hint: "First chase to the customer",
      kinds: ["fault", "request"],
      body: (s, v, audience) => [
        `I am just following up on my last email about ${s.about}${ticketRef(v)}.`,
        audience === "it"
          ? "When you have a moment, please could you let me know how the checks went, and what was changed, if anything?"
          : s.ask?.length
            ? `When you have a moment, please could you send me:\n${list(s.ask)}`
            : `When you have a moment, please could you ${s.test || "check everything is working"}? Let me know how it goes.`,
      ],
    },
    {
      id: "no-reply-final",
      group: "Finish",
      name: "No reply: closing soon",
      hint: "Last chase before closing",
      kinds: ["fault", "request"],
      needs: ["close_date"],
      body: (s, v) => [
        `I have not heard back about ${s.about}${ticketRef(v)}, so I will close the ticket ${
          v.close_date === "today" ? "at 5pm today" : `on ${v.close_date || "[date]"}`
        }.`,
        `If you still need help, ${ourContact} before then and I will keep it open.`,
      ],
    },
    {
      id: "answer",
      group: "Start",
      name: "Answer",
      hint: "The answer to their question",
      kinds: ["howto"],
      body: (s) => [`Thanks for your question about ${s.about}.`, ...s.answer, "I hope that helps."],
    },
    {
      id: "closed",
      group: "Finish",
      name: "Closing",
      hint: "Resolved and closing",
      kinds: ["fault", "request", "howto"],
      body: (s, v) => [
        `Thanks for confirming. I will now close the ticket about ${s.about}${v.ticket ? ` (${v.ticket})` : ""}.`,
        `If anything else comes up, ${ourContact}.`,
      ],
    },
  ];

  const AUDIENCES = [
    { id: "customer", name: "Customer" },
    { id: "it", name: "Their IT team" },
  ];
  const TONES = [
    { id: "friendly", name: "Friendly" },
    { id: "formal", name: "Formal" },
  ];
  const LENGTHS = [
    { id: "email", name: "Email" },
    { id: "short", name: "Short message" },
  ];

  const stageById = (id) => STAGES.find((x) => x.id === id);
  const situationById = (id) => SITUATIONS.find((x) => x.id === id);

  /* Stages that make sense for this situation and audience. */
  function stagesFor(s, audience = "customer") {
    return STAGES.filter(
      (st) =>
        st.kinds.includes(s.kind) &&
        (!st.when || st.when(s, audience)) &&
        (!s.stages || s.stages.includes(st.id)) &&
        (audience !== "it" || ["first-reply", "try-steps", "no-reply"].includes(st.id)),
    );
  }
  const audiencesFor = (s) => (s.it?.length ? AUDIENCES : AUDIENCES.slice(0, 1));

  /* Friendly replies use everyday contractions; formal ones keep every word. */
  const CONTRACTIONS = [
    [/\bI am\b/g, "I'm"],
    [/\bI will\b/g, "I'll"],
    [/\bI have not\b/g, "I haven't"],
    [
      /\bI have (?=[a-z]+ed\b|been|made|set|sent|put|got|chased|done|raised|escalated|submitted|brought|blocked|updated|booked|placed|changed)/g,
      "I've ",
    ],
    [/\bwe will\b/g, "we'll"],
    [/\bWe will\b/g, "We'll"],
    [/\bwe would\b/g, "we'd"],
    [/\bdo not\b/g, "don't"],
    [/\bdoes not\b/g, "doesn't"],
    [/\bis not\b/g, "isn't"],
    [/\bare not\b/g, "aren't"],
    [/\bwill not\b/g, "won't"],
    [/\bcannot\b/g, "can't"],
    [/\bhave not\b/g, "haven't"],
    /* "it is", "they are" and the like only shorten when a word follows: "which group it is" stays whole. */
    [/\bit is(?= [a-z])/g, "it's"],
    [/\bIt is(?= [a-z])/g, "It's"],
    [/\bthey are(?= [a-z])/g, "they're"],
    [/\byou are(?= [a-z])/g, "you're"],
    [/\bthat is(?= [a-z])/g, "that's"],
  ];
  const contract = (text) => CONTRACTIONS.reduce((t, [re, to]) => t.replace(re, to), text);

  /* "Sarah", from "Sarah Jones" or "Sarah," and never with stray punctuation. */
  /* How a reply greets someone: "Priya" from "Priya Shah"; "Mr Carter" from "Mr John Carter" (a title alone is
     not a greeting). */
  const clean = (w) => w.replace(/[^\p{L}'’-]/gu, "");
  function firstName(name) {
    const words = String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!words.length) return "";
    if (/^(mr|mrs|ms|miss|mx|dr)\.?$/i.test(words[0]))
      return words.length > 1 ? `${clean(words[0])} ${clean(words[words.length - 1])}` : "";
    return clean(words[0]);
  }

  /* A short message: the first paragraph and the question, lists joined into one sentence. */
  function shorten(paragraphs) {
    const flat = paragraphs.map((p) =>
      p.replace(/:\n((?:- .*\n?)+)/g, (_, items) => {
        const parts = items
          .trim()
          .split("\n")
          .map((l) => l.replace(/^- /, "").replace(/\.$/, ""));
        const lower = parts.map((x, i) =>
          i ? x[0].toLowerCase() + x.slice(1) : x[0].toLowerCase() + x.slice(1),
        );
        return (
          ": " + (lower.length > 1 ? lower.slice(0, -1).join("; ") + "; and " + lower.at(-1) : lower[0]) + "."
        );
      }),
    );
    return flat.slice(0, 3).join(" ");
  }

  /* Builds one reply. Returns { subject, body, missing } where missing lists details the stage needs. */
  function compose({
    situation,
    stage,
    audience = "customer",
    length = "email",
    tone = "friendly",
    values = {},
    signOff = "Kind regards,",
    ask = null,
    skip = null,
  }) {
    const found = typeof situation === "string" ? situationById(situation) : situation;
    /* ask: the details still needed, when the caller knows better (Triage knows what the email already gave).
       skip: steps the customer has already done, such as restarting the router, which are not asked of them again. */
    let s = found && Array.isArray(ask) ? { ...found, ask } : found;
    if (s && skip instanceof RegExp && s.steps?.some((x) => skip.test(x)))
      s = { ...s, steps: s.steps.filter((x) => !skip.test(x)) };
    const st = typeof stage === "string" ? stageById(stage) : stage;
    if (!s || !st) return { subject: "", body: "", missing: [] };
    const v = Object.fromEntries(
      Object.entries(values).map(([k, x]) => [
        k,
        String(x ?? "")
          .replace(/\s+/g, " ")
          .trim(),
      ]),
    );
    const paragraphs = st
      .body(s, v, audience, length)
      .filter(Boolean)
      .map((p) => (length === "short" ? p.replace(/\n\n+/g, " ") : p));
    const formal = tone === "formal" && length !== "short";
    const name = firstName(v.contact);
    const hello = formal ? (name ? `Dear ${name},` : "Hello,") : name ? `Hi ${name},` : "Hi there,";
    let body =
      length === "short"
        ? `${hello} ${shorten(paragraphs).replace(/^(?!I[ '])[A-Z]/, (c) => c.toLowerCase())}${v.sender ? ` Thanks, ${firstName(v.sender)}` : ""}`
        : [hello, "", paragraphs.join("\n\n"), "", signOff, v.sender || ""].join("\n").trim();
    if (!formal) body = contract(body);
    const subject = `${s.subject || s.title}${v.ticket ? ` [${v.ticket}]` : ""}${st.id === "closed" ? ": resolved" : ""}`;
    const missing = (st.needs || []).filter((k) => !v[k]);
    return { subject, body: body.replace(/[ \t]+\n/g, "\n"), missing };
  }

  /* Every reply the builder can write: situation x stage x audience, as a friendly email, a formal email or a short
     message (short messages have one tone). */
  function all() {
    const out = [];
    for (const s of SITUATIONS)
      for (const a of audiencesFor(s))
        for (const st of stagesFor(s, a.id)) {
          const base = { situation: s.id, stage: st.id, audience: a.id };
          out.push(
            { ...base, length: "email", tone: "friendly" },
            { ...base, length: "email", tone: "formal" },
            { ...base, length: "short", tone: "friendly" },
          );
        }
    return out;
  }

  /* ----------------------------------------------------------------- choose */

  const words = (t) =>
    String(t || "")
      .toLowerCase()
      .match(/[a-z0-9*]+/g) || [];

  /* Ranks situations for free text ("chase gamma about dropped calls"). Stage words pick the stage. */
  const STAGE_WORDS = [
    ["no-reply-final", /\b(final chase|last chase|(no reply|not heard|chase)\b.*\bclos\w*)\b/i],
    [
      "closed",
      /\b(close (the |this )?(ticket|case|it)|closing (the |this )?(ticket|case)|clos\w* .*\b(fixed|resolved|sorted)|(fixed|resolved|sorted)\b.*\bclos\w*)\b/i,
    ],
    ["no-reply", /\b(chase|chasing|no reply|not heard|follow ?up)\b/i],
    ["engineer-booked", /\b(engineer booked|appointment|visit booked)\b/i],
    ["engineer-needed", /\b(engineer|call ?out|charges?)\b/i],
    ["escalated", /\bescalat\w*\b/i],
    ["raised", /\b(raised|logged with|reported to)\b/i],
    ["delay", /\b(sorry|delay|apolog\w*|taking long)\b/i],
    ["resolved-check", /\b(fixed|resolved|test it|working now|done)\b/i],
    ["progress", /\b(update|progress)\b/i],
    ["ask-details", /\b(need (more )?(info|details)|ask for|missing)\b/i],
  ];

  function search(text, limit = 8) {
    const q = words(text);
    if (!q.length) return [];
    const stage = STAGE_WORDS.find(([, re]) => re.test(text))?.[0] || "";
    return SITUATIONS.map((s) => {
      const hay = (s.hay ||= words([s.title, s.about, s.group, ...(s.tags || [])].join(" ")));
      const hits = q.filter(
        (w) => w.length > 2 && hay.some((h) => h === w || (w.length > 3 && h.startsWith(w))),
      );
      let score = hits.length / q.length + (s.match.test(text) ? 1 : 0);
      if (s.title.toLowerCase().includes(text.toLowerCase().trim())) score += 1;
      return { situation: s, score, stage: stage && stagesFor(s).some((x) => x.id === stage) ? stage : "" };
    })
      .filter((r) => r.score > 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /* What the customer is doing: asking how, asking for a change, or reporting something broken. A situation of the
     same kind gets a lift, so one generic word in a request does not turn it into a fault. */
  const INTENT = {
    howto: /\bhow (do|can|would|should) (i|we|you)\b|\bhow to\b|\bwhere (do|can) (i|we) (find|get)\b/i,
    request:
      /\b(can|could|would) (you|we) (please )?(set ?up|add|change|create|remove|put|turn|switch|arrange|update|block|order|have|get|move)\b|\bplease (can you |could you )?(set ?up|add|change|create|remove|put|turn|switch|arrange|update|block|order)\b|\b(we|i)('d| would) like\b|\bwe need (to|a|an|more|another)\b/i,
    fault:
      /\b(not working|isn'?t working|stopped|broken|keeps?|can'?t|cannot|won'?t|unable|fail\w*|down|dropp\w*|problem|issue|fault|since (this morning|yesterday|\d))\b/i,
  };
  const sentenceAround = (text, at) => {
    const start =
      Math.max(
        text.lastIndexOf(".", at),
        text.lastIndexOf("?", at),
        text.lastIndexOf("!", at),
        text.lastIndexOf("\n", at),
      ) + 1;
    const ends = [".", "?", "!", "\n"].map((c) => text.indexOf(c, at)).filter((n) => n !== -1);
    return text.slice(start, ends.length ? Math.min(...ends) : text.length);
  };

  /* Picks the situation for a pasted email (from AstraTriage.read): the most specific match, lifted when it is the
     same kind of message as the email (a question, a request or a fault). */
  function suggest(t) {
    const text = [t?.header?.subject || "", t?.body || t?.message || ""].join("\n");
    const kinds = Object.fromEntries(Object.entries(INTENT).map(([k, re]) => [k, re.test(text)]));
    const rank = { fault: 0, request: 1, howto: 2 };
    const hits = [];
    for (const s of SITUATIONS) {
      const m = s.match.exec(text);
      if (!m) continue;
      if (s.exclude && s.exclude.test(sentenceAround(text, m.index))) continue;
      hits.push({ s, score: m[0].length + (kinds[s.kind] ? 12 : 0) });
    }
    if (!hits.length) return null;
    hits.sort((a, b) => b.score - a.score || rank[a.s.kind] - rank[b.s.kind]);
    const s = hits[0].s;
    return {
      situation: s,
      stage: s.kind === "howto" ? "answer" : "first-reply",
      others: hits.slice(1, 4).map((h) => h.s),
    };
  }

  return {
    SITUATIONS,
    STAGES,
    AUDIENCES,
    LENGTHS,
    TONES,
    US,
    CALL_EVIDENCE,
    stagesFor,
    audiencesFor,
    compose,
    all,
    search,
    suggest,
    situationById,
    stageById,
  };
})();
