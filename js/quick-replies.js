// js/quick-replies.js — WhatsApp-friendly quick reply templates for the
// Polmed Connect Helpdesk. Adapted from POLMED_Connect_Email_FAQ_Response_Templates.docx
// (originally written for email — shortened here for WhatsApp, links kept).
//
// Include this file in dashboard.html with:
//   <script src="js/quick-replies.js"></script>
// (a plain script, not type="module" — it just needs to exist before tickets.js runs)

const QUICK_REPLIES = [
  {
    group: 'Approved replies',
    items: [
      { label: 'Member sends a greeting message', text: `Thank you for contacting the POLMED Connect Helpdesk.\n\nPlease note that this channel is strictly for queries and support related to the POLMED Connect Mobile App.\nIf your enquiry relates to medical aid benefits, claims, authorisations, or any other general matter, kindly WhatsApp 0600702547 or call 0860765633 for assistance.\n\nIf you have a query regarding the app, please describe the issue and one of our agents will get back to you as soon as possible.` },
      { label: 'Wants to speak to an agent', text: `Good day, Valued Member. You are speaking to [Name]. Please let me know how I can help.` },
      { label: 'Query is not related to the app', text: `Good day, Valued Member\n\nFor better assistance with your query, please contact the POLMED Client Service Call Centre on 0860765633 or send a WhatsApp text to 0600702547.\n\nThis channel is strictly for queries related to the *POLMED Connect Mobile App*.` },
      { label: 'Forgot password (remembers username)', text: `Good day, Valued Member\n\nIf you remember your username but have forgotten your password, you can reset it yourself:\n\n1. On the POLMED Connect app login screen, tap *Forgot Password*\n2. Follow the prompts to verify your details and set a new password\n\nIf you don't see this option, or run into any issues resetting it, please let us know and we'll assist further.` },
      { label: 'Forgot username — cannot currently retrieve', text: `Good day, Valued Member\n\nWe're sorry for how long this has taken, and we understand your frustration.\n\nUnfortunately, retrieving a forgotten username isn't something our team is currently able to do — this can only be actioned by our development team, and we don't yet have a confirmed timeline for when self-service username recovery will be added to the app.\n\nWe know this isn't the update you were hoping for. We're continuing to follow up on this internally and will let you know the moment there's a change.\n\nWe appreciate your patience, and we're sorry again for the inconvenience this has caused.` },
      { label: 'Member cannot register', text: `Good day, Valued Member\n\nApologies for this inconvenience.\nKindly send the following details so that we can create an account for you:\n* Membership number\n* ID number\n* Email address` },
      { label: 'How to register on the app (step-by-step)', text: `If you don't have the POLMED Connect app yet, you can download it at www.polmedconnect.co.za\n\nHere's how to register on POLMED Connect:\n\n1. Open the app and tap *Register* (under the Log In button)\n2. Enter your ID and membership numbers (no spaces or errors)\n3. Tap *Register*\n4. Choose to receive your OTP via both *Email* and *SMS*\n5. Enter the OTP when it arrives, then tap *Submit*\n6. Create a username and password (password needs at least 8 characters, 1 uppercase, 1 lowercase, 1 number, 1 special character)\n7. Tap *Submit*\n\nNote: this app isn't linked to any older POLMED app, so you'll need to register fresh here. Let us know if you hit any issues!` },
      { label: 'Assisted member with registering', text: `Thank you. Your profile has been created successfully.\n\nPlease log into the app with the below details:\n- *Username:*\n- *Password:*\n_To change your password, use the 'Forgot Password' feature._\n\nYou can now explore the exciting features our app has to offer. Please let me know if there anything else I can assist with.` },
      { label: 'Member gets a blank screen after requesting OTP', text: `Good day, Valued Member\n\nIf your screen goes blank when registering on the POLMED Connect App, please choose the option which sends your OTP to *both* your *email address and phone number*. _If this does not work, you can send us the following details and we'll create the account for you:_\n\n* Membership number\n* ID number\n* Email address` },
      { label: 'Member wants to update their contact details', text: `Good day, Valued Member\n\n*To update your contact details, fill in the following form:*\nhttps://www.polmed.co.za/wp-content/uploads/2024/12/POLMED-Contact-Details-Forms.pdf\n\n*To update your Adult Dependant's details, fill in the following form:*\nhttps://www.polmed.co.za/wp-content/uploads/2026/02/Adult-Dependent-Contact-Details-form.pdf\n\nPlease ensure that you submit the forms to *polmedmembership@medscheme.co.za*. If you require assistance completing the forms, please contact the POLMED Client Service Call Centre on 0860765633.` },
      { label: 'Wants to nominate a GP', text: `Good day, Valued Member\n\n*To nominate a GP, kindly fill in the following form:*\nhttps://www.polmed.co.za/wp-content/uploads/2025/11/GP-Nomination-form.pdf\n\nPlease return your completed form to *polmedgpnomination@medscheme.co.za*` },
      { label: 'Enquiring about a potential scam or fraud', text: `Good day, Valued Member\n\nIf you receive suspicious communication, we recommend that you do not engage with the caller and do not share any details. You may report the matter directly to POLMED through their official contact channels so that they can investigate further.\n\n*Polmed Fraud Hotline:*\nCall: 0800 112 811\nSMS: 33490\nEmail: information@whistleblowing.co.za\nEmail: fraud@medscheme.co.za\n\nIf you have a query related to the POLMED Connect app, please let us know and we will gladly assist.` },
      { label: "Searching for a specific service provider / wants to know if they're in POLMED's network", text: `Good day, Valued Member\n\nTo check whether your service provider is under the POLMED network, kindly log onto the app and follow these steps:\n1. Open the menu on the top left corner\n2. Select *Service Provider Search*\n3. Allow POLMED Connect to access your location while using the app (this allows for more convenient search options)\n3. Search for your service provider by name. If they do not appear, use the *filter* on the top right corner. This will allow you to search by address, KM radius, and provider type.\n4. Apply the filter and search again.\n\nIf your provider still does not appear, then they may not be part of the POLMED network.\nTo *nominate a GP*, kindly fill in the following form:\nhttps://www.polmed.co.za/wp-content/uploads/2025/11/GP-Nomination-form.pdf\n\nPlease return your completed form to *polmedgpnomination@medscheme.co.za*` },
      { label: 'Wants to access Digital Membership Card', text: `Good day, Valued Member\n\nYou can access your virtual membership card through the POLMED Connect app. Here's how:\n1. Log into the app\n2. Click on the menu on the top left corner\n3. Select *Digital Membership Card*\n4. To access the detailed view of your card, tap the three dots on the top right corner, and select *My Card*\n\nIf you are not seeing any of these pages on the app, kindly send a screenshot and we will look into it.` },
      { label: 'Wants Member Certificate', text: `Good day, Valued Member\n\nYou can access your member certificate through the POLMED Connect app. Here's how:\n1. Log into the app\n2. Click on the menu on the top left corner\n3. Select *My Documents*\n4. Click on your *Member Certificate*, and enter your ID number to view the document\n\nIf you are not seeing any of these pages on the app, kindly send a screenshot and we will look into it.` },
      { label: 'Wants Tax Certificate', text: `Good day, Valued Member\n\nYou can access your tax certificate through the POLMED Connect app. Here's how:\n1. Log into the app\n2. Click on the menu on the top left corner\n3. Select *My Documents*\n4. Choose the year you'd like to view\n5. Click on your *Tax Certificate*, and enter your ID number to view the document\n\nIf you are not seeing any of these pages on the app, kindly send a screenshot and we will look into it.` },
      { label: 'Issue is resolved', text: `Thank you for your patience. We sincerely apologise for the inconvenience and trust that you will enjoy using the app.\n\nShould you have any questions related to the POLMED Connect app, please feel free to contact us here. Enjoy the rest of your day.` },
      { label: 'Issue resolved — member wants to leave a review', text: `It's a pleasure. Enjoy your day further.\n\nPlease let us know if you experience any issues with the app, and we'll be happy to assist.\nKindly leave us a review on the app store if you are satisfied with our services:\n- Play Store: https://play.google.com/store/apps/details?id=com.polmed.connect\n- App Store: https://apps.apple.com/us/app/polmed-connect/id6748287604\n\n*POLMED Connect*\n_Your Wellness At Your Fingertips_` },
    ]
  }
];

// Populates the <select id="quick-reply-select"> dropdown in the ticket
// detail modal, grouped by category, and wires it to insert the chosen
// template into the reply textarea when selected.
function populateQuickReplies() {
  const select = document.getElementById('quick-reply-select');
  if (!select) return;

  select.innerHTML = '<option value="">Insert a quick reply…</option>' +
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
      const insertText = item.text.replace('[Name]',
        typeof window.getPolmedAgentName === 'function' ? window.getPolmedAgentName() : '[Name]');
      if (textarea.value.trim() && !confirm('Replace the current reply text with this template?')) {
        this.value = '';
        return;
      }
      textarea.value = insertText;
    }
    this.value = ''; // reset dropdown so the same template can be picked again later
  };
}