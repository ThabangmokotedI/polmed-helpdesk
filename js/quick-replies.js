// js/quick-replies.js — WhatsApp-friendly quick reply templates for the
// Polmed Connect Helpdesk. Adapted from POLMED_Connect_Email_FAQ_Response_Templates.docx
// (originally written for email — shortened here for WhatsApp, links kept).
//
// Include this file in dashboard.html with:
//   <script src="js/quick-replies.js"></script>
// (a plain script, not type="module" — it just needs to exist before tickets.js runs)

const QUICK_REPLIES = [
  {
    group: 'General',
    items: [
      {
        label: 'Apology for delayed response',
        text: `Good day, valued member.\n\nApologies for the delayed response — we've been receiving a high volume of queries. We'll get back to you as soon as possible.`
      },
      {
        label: 'Not app-related — redirect to medical aid',
        text: `Hi, thanks for reaching out. This WhatsApp line is for the POLMED Connect app only.\n\nFor your medical aid query, please email polmed@medscheme.co.za or call the POLMED Client Service Call Centre on 0860 765 633.\n\nIf you don't have the POLMED Connect app yet, you can download it at www.polmedconnect.co.za`
      },
      {
        label: 'Redirect — general query numbers',
        text: `For that query, please contact:\n\nGeneral queries: polmed@medscheme.co.za\nMembership queries: polmedmembership@medscheme.co.za\nChronic medicine/Authorisations: 0860 765 633 or polmedcmm@medscheme.co.za\nBack and neck programme: polmedcbnrp@medscheme.co.za\nCall Centre: 0860 765 633`
      },
    ]
  },
  {
    group: 'Login & registration',
    items: [
      {
        label: 'How to register on the app',
        text: `Here's how to register on POLMED Connect:\n\n1. Open the app and tap Register (under the Log In button)\n2. Enter your ID and membership numbers (no spaces or errors)\n3. Tap Register\n4. Choose to receive your OTP via both Email and SMS\n5. Enter the OTP when it arrives, then tap Submit\n6. Create a username and password (password needs at least 8 characters, 1 uppercase, 1 lowercase, 1 number, 1 special character)\n7. Tap Submit\n\nNote: this app isn't linked to any older POLMED app, so you'll need to register fresh here. Let us know if you hit any issues!`
      },
      {
        label: 'Cannot log in',
        text: `The POLMED Connect app isn't linked to any older POLMED app or website, so you'll need to register a new account here first.\n\nOnce registered, log in with that new username and password. By default your username is your email address unless you changed it during registration.\n\nStill getting a "Login failed" message? Let us know and we'll assist further.`
      },
      {
        label: 'Not receiving OTP via email',
        text: `On the latest version of POLMED Connect, you can choose to receive your OTP via email or SMS, and the OTP window has been extended.\n\nPlease make sure you have the latest version of the app installed. If you're still not receiving it, let us know.`
      },
      {
        label: 'Screen goes blank during registration',
        text: `If your screen goes blank while registering, please restart the registration process. When asked where to receive your OTP, select "Send to both" — this usually resolves it.`
      },
      {
        label: 'Change email/phone number for OTP',
        text: `For security, POLMED Connect uses the contact details on your POLMED membership record. To update them, please fill in this form and email it to polmed@medscheme.co.za:\nhttps://www.polmed.co.za/wp-content/uploads/2024/12/POLMED-Contact-Details-Forms.pdf\n\nOnce updated, please allow 24 hours before registering on the app. Need help with the form? Call 0860 765 633.`
      },
    ]
  },
  {
    group: 'Wellness tracker',
    items: [
      {
        label: 'Wellness tracker not counting steps',
        text: `If your steps show correctly in Google Fit/Strava but not in POLMED Connect, this is usually a sync or permission issue. Try:\n\n1. Check permissions — Android: Samsung Health Connect; iPhone: Apple Health. Make sure step/activity sharing is on.\n2. Refresh the Wellness Tracker in the app, or disconnect and reconnect your health app.\n3. Make sure POLMED Connect and your health app are both updated.\n4. Check battery/data-saving settings aren't blocking background activity.\n5. Restart your phone.\n6. Step data can take a few hours to sync — check again later the same day.\n\nStill not showing after trying these? Let us know and we'll look into it.`
      },
    ]
  },
  {
    group: 'Documents & membership',
    items: [
      {
        label: 'Find a service provider / check network',
        text: `To check if your service provider is in the POLMED network:\n\n1. Open the menu (top left)\n2. Select Service Provider Search\n3. Allow location access for better results\n4. Search by name, or use the filter (top right) to search by address, radius, or provider type\n\nProvider still not showing? They may not be in the POLMED network yet. To nominate a GP, fill in this form and email it to polmedgpnomination@medscheme.co.za:\nhttps://www.polmed.co.za/wp-content/uploads/2025/11/GP-Nomination-form.pdf`
      },
      {
        label: 'Access Digital Membership Card',
        text: `To view your digital membership card:\n\n1. Log into the app\n2. Open the menu (top left)\n3. Select Digital Membership Card\n4. Tap the three dots (top right) → My Card for the detailed view\n\nNot seeing this option? Send us a screenshot and we'll look into it.`
      },
      {
        label: 'Access Member Certificate',
        text: `To view your member certificate:\n\n1. Log into the app\n2. Open the menu (top left)\n3. Select My Documents\n4. Tap Member Certificate and enter your ID number to view it\n\nNot seeing this option? Send us a screenshot and we'll look into it.`
      },
      {
        label: 'Access Tax Certificate',
        text: `To view your tax certificate:\n\n1. Log into the app\n2. Open the menu (top left)\n3. Select My Documents\n4. Choose the relevant year\n5. Tap Tax Certificate and enter your ID number to view it\n\nNot seeing this option? Send us a screenshot and we'll look into it.`
      },
      {
        label: 'Multiple membership numbers explained',
        text: `It's normal to see more than one membership number on your digital card or in the app — all numbers shown are valid and correct. You're welcome to keep using whichever one you're familiar with.`
      },
    ]
  },
  {
    group: 'Wrap-up',
    items: [
      {
        label: 'Ask for an app store review',
        text: `If you have a moment, we'd really appreciate a review on the app store:\n\nPlay Store: https://play.google.com/store/apps/details?id=com.polmed.connect\nApp Store: https://apps.apple.com/us/app/polmed-connect/id6748287604\n\nThank you for using POLMED Connect!`
      },
    ]
  },
];

// Populates the <select id="quick-reply-select"> dropdown in the ticket
// detail modal, grouped by category, and wires it to insert the chosen
// template into the reply textarea when selected.
function populateQuickReplies() {
  const select = document.getElementById('quick-reply-select');
  if (!select) return;

  select.innerHTML = '<option value="">💬 Insert a quick reply…</option>' +
    QUICK_REPLIES.map(group =>
      `<optgroup label="${group.group}">` +
      group.items.map((item, i) =>
        `<option value="${group.group}::${i}">${item.label}</option>`
      ).join('') +
      `</optgroup>`
    ).join('');

  select.onchange = function () {
    if (!this.value) return;
    const [groupName, idx] = this.value.split('::');
    const group = QUICK_REPLIES.find(g => g.group === groupName);
    const item = group?.items[Number(idx)];
    if (!item) return;

    const textarea = document.getElementById('detail-reply-text');
    if (textarea) {
      const insertText = item.text;
      if (textarea.value.trim() && !confirm('Replace the current reply text with this template?')) {
        this.value = '';
        return;
      }
      textarea.value = insertText;
    }
    this.value = ''; // reset dropdown so the same template can be picked again later
  };
}