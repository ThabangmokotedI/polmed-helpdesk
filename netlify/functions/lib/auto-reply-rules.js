// netlify/functions/lib/auto-reply-rules.js
// Keyword-matched auto-replies for whatsapp-webhook.js. Each rule maps a set
// of trigger phrases to a tailored, pre-approved message the member gets
// immediately -- no agent involved -- for issues with a fixed, known answer.
//
// Deliberately a separate, Node/CommonJS copy of the wording in
// js/quick-replies.js (a browser global, different runtime) rather than a
// shared import: the automated-reply versions drop the "[Name]" agent
// placeholder and add a short disclaimer line so members know it's a bot and
// can still ask for a human. Keeping them separate also lets each one be
// tweaked independently, as requested.
//
// Deliberately NOT auto-handled (need a human / collect PII / are agent-
// authored closing messages, not member-triggered): "Member cannot
// register" (creates an account), "Assisted member with registering",
// "Issue is resolved" / "leave a review".

const AUTO_DISCLAIMER = '_This is an automated reply. If this doesn\'t answer your question, just reply here and one of our agents will follow up._';

const AUTO_REPLY_RULES = [
  {
    id: 'out-of-scope',
    // "consultation(s)"/"benefit(s)"/"claim(s)" were removed from here --
    // those are actually viewable in-app (see benefits-lookup and
    // claims-lookup below), so redirecting them to the Call Centre was
    // wrong. What's left genuinely isn't shown anywhere in the app.
    keywords: [
      'authorisation', 'authorisations', 'authorization', 'authorizations',
      'premium', 'contribution', 'membership fee'
    ],
    status: 'Redirected', // matches the existing "Redirected" reporting rule
    text: `Good day, Valued Member\n\n` +
      `For better assistance with your query, please contact the POLMED Client Service Call Centre on 0860765633 or send a WhatsApp text to 0600702547.\n\n` +
      `This channel is strictly for queries related to the *POLMED Connect Mobile App*.\n\n` +
      AUTO_DISCLAIMER
  },
  {
    id: 'benefits-lookup',
    keywords: [
      'consultation', 'consultations', 'benefit', 'benefits', 'how many visits',
      'medical aid balance', 'available balance'
    ],
    status: null,
    text: `Good day, Valued Member\n\n` +
      `You can view the full list of your benefits in the POLMED Connect app:\n\n` +
      `1. Log into the app\n` +
      `2. Open the menu on the top left corner\n` +
      `3. Select *Benefits Lookup*\n\n` +
      `_These are steps to follow in the app itself -- no need to reply with a number. Reply here if you can't find what you're looking for there._`
  },
  {
    id: 'claims-lookup',
    keywords: ['claim', 'claims'],
    status: null,
    text: `Good day, Valued Member\n\n` +
      `You can view your claims, including past claims, in the POLMED Connect app under *My Documents* in the menu.\n\n` +
      AUTO_DISCLAIMER
  },
  {
    id: 'forgot-password',
    keywords: [
      'forgot my password', 'forgot password', 'forgotten my password',
      'reset password', 'reset my password', "can't login", 'cannot login',
      "can't log in", 'cannot log in', 'locked out'
    ],
    status: null,
    text: `Good day, Valued Member\n\n` +
      `If you remember your username but have forgotten your password, you can reset it yourself:\n\n` +
      `1. On the POLMED Connect app login screen, tap *Forgot Password*\n` +
      `2. Follow the prompts to verify your details and set a new password\n\n` +
      `If you don't see this option, or run into any issues resetting it, just reply here and we'll assist further.\n\n` +
      AUTO_DISCLAIMER
  },
  {
    id: 'forgot-username',
    keywords: [
      'forgot my username', 'forgot username', 'forgotten my username',
      "don't remember my username", 'dont remember my username',
      'what is my username', "what's my username"
    ],
    status: null,
    text: `Good day, Valued Member\n\n` +
      `We're sorry for how long this has taken, and we understand your frustration.\n\n` +
      `Unfortunately, retrieving a forgotten username isn't something our team is currently able to do -- this can only be actioned by our development team, and we don't yet have a confirmed timeline for when self-service username recovery will be added to the app.\n\n` +
      `We know this isn't the update you were hoping for. We're continuing to follow up on this internally and will let you know the moment there's a change.\n\n` +
      `We appreciate your patience, and we're sorry again for the inconvenience this has caused.\n\n` +
      AUTO_DISCLAIMER
  },
  {
    id: 'register-help',
    keywords: [
      'how do i register', 'how to register', 'how do i sign up', 'sign up',
      'create an account', 'create account', 'registration steps', 'how to create an account'
    ],
    status: null,
    text: `If you don't have the POLMED Connect app yet, you can download it at www.polmedconnect.co.za\n\n` +
      `Here's how to register on POLMED Connect:\n\n` +
      `1. Open the app and tap *Register* (under the Log In button)\n` +
      `2. Enter your ID and membership numbers (no spaces or errors)\n` +
      `3. Tap *Register*\n` +
      `4. Choose to receive your OTP via both *Email* and *SMS*\n` +
      `5. Enter the OTP when it arrives, then tap *Submit*\n` +
      `6. Create a username and password (password needs at least 8 characters, 1 uppercase, 1 lowercase, 1 number, 1 special character)\n` +
      `7. Tap *Submit*\n\n` +
      `Note: this app isn't linked to any older POLMED app, so you'll need to register fresh here.\n\n` +
      `_These are steps to follow in the app itself -- no need to reply with a number, just work through them there. Reply here only if you get stuck._`
  },
  {
    id: 'digital-card',
    keywords: [
      'digital card', 'virtual card', 'membership card', 'download my card',
      'download card', 'view my card', 'view card'
    ],
    status: null,
    text: `Good day, Valued Member\n\n` +
      `You can access your virtual membership card through the POLMED Connect app. Here's how:\n` +
      `1. Log into the app\n` +
      `2. Click on the menu on the top left corner\n` +
      `3. Select *Digital Membership Card*\n` +
      `4. To access the detailed view of your card, tap the three dots on the top right corner, and select *My Card*\n\n` +
      `_These are steps to follow in the app itself -- no need to reply with a number. Reply here if you're not seeing these pages on the app._`
  },
  {
    id: 'member-certificate',
    keywords: ['member certificate', 'membership certificate'],
    status: null,
    text: `Good day, Valued Member\n\n` +
      `You can access your member certificate through the POLMED Connect app. Here's how:\n` +
      `1. Log into the app\n` +
      `2. Click on the menu on the top left corner\n` +
      `3. Select *My Documents*\n` +
      `4. Click on your *Member Certificate*, and enter your ID number to view the document\n\n` +
      `_These are steps to follow in the app itself -- no need to reply with a number. Reply here if you're not seeing these pages on the app._`
  },
  {
    id: 'tax-certificate',
    keywords: ['tax certificate', 'tax cert'],
    status: null,
    text: `Good day, Valued Member\n\n` +
      `You can access your tax certificate through the POLMED Connect app. Here's how:\n` +
      `1. Log into the app\n` +
      `2. Click on the menu on the top left corner\n` +
      `3. Select *My Documents*\n` +
      `4. Choose the year you'd like to view\n` +
      `5. Click on your *Tax Certificate*, and enter your ID number to view the document\n\n` +
      `_These are steps to follow in the app itself -- no need to reply with a number. Reply here if you're not seeing these pages on the app._`
  },
  {
    id: 'gp-nomination',
    keywords: ['nominate a gp', 'nominate gp', 'gp nomination', 'change my gp', 'change gp'],
    status: null,
    text: `Good day, Valued Member\n\n` +
      `*To nominate a GP, kindly fill in the following form:*\n` +
      `https://www.polmed.co.za/wp-content/uploads/2025/11/GP-Nomination-form.pdf\n\n` +
      `Please return your completed form to *polmedgpnomination@medscheme.co.za*\n\n` +
      AUTO_DISCLAIMER
  },
  {
    id: 'update-contact',
    keywords: ['update my contact', 'update contact details', 'change my details', 'change my number', 'change my email address'],
    status: null,
    text: `Good day, Valued Member\n\n` +
      `*To update your contact details, fill in the following form:*\n` +
      `https://www.polmed.co.za/wp-content/uploads/2024/12/POLMED-Contact-Details-Forms.pdf\n\n` +
      `Please submit the completed form to *polmedmembership@medscheme.co.za*. If you need help completing it, contact the POLMED Client Service Call Centre on 0860765633.\n\n` +
      AUTO_DISCLAIMER
  },
  {
    id: 'scam-fraud',
    keywords: ['scam', 'fraud', 'suspicious call', 'suspicious message', 'phishing'],
    status: null,
    text: `Good day, Valued Member\n\n` +
      `If you receive suspicious communication, we recommend that you do not engage with the caller and do not share any details. You may report the matter directly to POLMED through their official contact channels so that they can investigate further.\n\n` +
      `*Polmed Fraud Hotline:*\n` +
      `Call: 0800 112 811\n` +
      `SMS: 33490\n` +
      `Email: information@whistleblowing.co.za\n` +
      `Email: fraud@medscheme.co.za\n\n` +
      AUTO_DISCLAIMER
  },
  {
    // Menu-only consolidation of claims-lookup/member-certificate/tax-
    // certificate -- they're all under the same "My Documents" app menu,
    // and a 10-row WhatsApp list has no room for three separate rows. Free
    // text like "tax certificate" still gets its own specific rule above;
    // this exists purely as the "My Documents" row's tap target.
    id: 'documents-lookup',
    keywords: ['my documents'],
    status: null,
    text: `Good day, Valued Member\n\n` +
      `Your claims, member certificate, and tax certificate are all available under *My Documents* in the POLMED Connect app menu.\n\n` +
      AUTO_DISCLAIMER
  }
];

function matchAutoReply(rawText) {
  const text = String(rawText || '').toLowerCase();
  if (!text) return null;
  return AUTO_REPLY_RULES.find(rule => rule.keywords.some(k => text.includes(k))) || null;
}

function getRuleById(id) {
  return AUTO_REPLY_RULES.find(rule => rule.id === id) || null;
}

module.exports = { AUTO_REPLY_RULES, matchAutoReply, getRuleById };
