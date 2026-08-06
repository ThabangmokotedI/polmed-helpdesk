# Polmed Helpdesk

Static site + Netlify serverless functions for the Polmed Connect member
support helpdesk (WhatsApp auto-logging, email-to-ticket, role-based access).

## Folder structure

```
polmed-helpdesk/
├── index.html              Login page
├── dashboard.html          Main helpdesk dashboard
├── netlify.toml            Netlify build config
├── package.json            Dependencies (firebase-admin)
├── css/
│   ├── auth.css            Styles for login page
│   └── app.css             Styles for dashboard
├── js/
│   ├── firebase-config.js  Your Firebase web app config (NOT secret — see below)
│   ├── local-firebase-mock.js  In-memory demo mode, used until firebase-config.js is filled in
│   ├── auth.js              Login page behaviour
│   ├── tickets.js           Ticket logic, reports, role checks
│   └── app.js                Dashboard navigation/UI
├── netlify/functions/
│   ├── whatsapp-webhook.js  Receives WhatsApp messages → creates tickets
│   └── email-webhook.js     Receives inbound email → creates tickets
└── docs/
    ├── firestore.rules      Paste into Firebase Console → Firestore → Rules
    └── srs.md               Software requirements spec
```

## Where credentials live (read this before deploying)

This project uses **two different kinds** of Firebase credentials. They are
not interchangeable, and only one of them is a secret.

| Credential | Where it goes | Secret? |
|---|---|---|
| Web app config (`apiKey`, `authDomain`, etc.) | `js/firebase-config.js` in this repo | No — safe to commit. It only identifies your project to the browser; it doesn't grant access on its own. |
| Service account JSON (Admin SDK key) | **Netlify → Site configuration → Environment variables → `FIREBASE_SERVICE_ACCOUNT`** | **Yes.** This grants full read/write access to your Firestore database (all member tickets). It must never be committed to git, zipped into a shared folder, or pasted anywhere outside Netlify's environment variables. |

The `.gitignore` in this project already blocks any `*-firebase-adminsdk-*.json`
file from being committed, as a safety net.

### If your service account key was ever pasted somewhere outside Netlify
(chat, email, a shared doc, etc.), treat it as exposed and rotate it:
Firebase Console → gear icon → **Project settings → Service accounts →
Generate new private key**, update the `FIREBASE_SERVICE_ACCOUNT` value in
Netlify with the new one, then delete the old key from the same page
("Manage service account permissions" → find the key → delete).

## Filling in `js/firebase-config.js`

1. Firebase Console → gear icon → **Project settings → General**.
2. Scroll to "Your apps". If none exists, click **Add app → Web (`</>`)**.
3. Copy the six values shown (`apiKey`, `authDomain`, `projectId`,
   `storageBucket`, `messagingSenderId`, `appId`) into `js/firebase-config.js`,
   replacing the `REPLACE_WITH_...` placeholders.
4. Commit this file — it's safe, it's not the same as the service account key.

## Deploying

Push this folder to your Netlify site (via git or drag-and-drop deploy).
`netlify.toml` already points Netlify at `netlify/functions` for the two
webhook functions, and publishes the site root as static files.
