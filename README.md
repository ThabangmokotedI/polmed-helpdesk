# Polmed Helpdesk

Polmed Connect Helpdesk is a working ticket tracker for member support that
combines a static browser dashboard with Netlify serverless functions for
WhatsApp and email ticket ingestion.

## Current status

- Core ticket dashboard is implemented and live-ready.
- Authentication uses Firebase Email/Password.
- Tickets sync in real time from Firestore.
- WhatsApp webhook creates or appends WhatsApp tickets.
- Email webhook creates tickets from Mailgun inbound email.
- Firestore security rules allow authenticated agents to read/update tickets
  and reserve delete permission for supervisors.
- `js/firebase-config.js` is already populated with the Polmed Helpdesk Firebase
  project config.

## Folder structure

```
polmed-helpdesk/
├── index.html                      Login page
├── dashboard.html                  Ticket dashboard and reports
├── netlify.toml                    Netlify build config
├── package.json                    Node dependencies for serverless functions
├── css/
│   ├── auth.css                    Login page styling
│   ├── app.css                     Dashboard styling
│   └── conversation-thread.css     Chat thread + ticket detail styling
├── js/
│   ├── firebase-config.js          Firebase web app config (safe to commit)
│   ├── auth.js                     Login/reset UI helpers
│   └── tickets.js                  Ticket logic, reports, filters, roles
├── netlify/functions/
│   ├── whatsapp-webhook.js         Incoming WhatsApp ticket ingestion
│   ├── email-webhook.js            Incoming email ticket ingestion
│   └── polmed-helpdesk-firebase-adminsdk-fbsvc-7e5d2c2227.json
│                                   Local Firebase Admin service account file
└── docs/
    ├── firestore.rules             Firestore security rules
    └── srs.md                      Software requirements specification
```

## Deployment and environment configuration

### Required Netlify environment variables

- `FIREBASE_SERVICE_ACCOUNT` — service account JSON string for Firebase Admin
- `FIREBASE_PROJECT_ID` — Firebase project ID
- `WHATSAPP_VERIFY_TOKEN` — webhook verification token for Meta
- `META_APP_SECRET` — Meta app secret used to verify incoming WhatsApp payloads
- `WHATSAPP_ACCESS_TOKEN` — token used to download WhatsApp media attachments
- `MAILGUN_SIGNING_KEY` — Mailgun inbound signature key (optional in dev)

### Important credential guidance

- `js/firebase-config.js` contains public Firebase web app values and is safe
  to keep in source control.
- The service account JSON is secret and must only live in Netlify environment
  variables for production.
- If the local `netlify/functions/*-firebase-adminsdk-*.json` file exists,
  treat it as a development artifact and do not commit or share it.

### Netlify configuration

The project is configured in `netlify.toml` to deploy the repo root as static
site assets and to run functions from `netlify/functions`.

## How to use

1. Ensure Firebase Authentication Email/Password is enabled.
2. Create Firestore and apply the rules from `docs/firestore.rules`.
3. Add agent users in Firebase Authentication.
4. Configure required Netlify environment variables.
5. Deploy the repo to Netlify.

## Supported features

- Agent login and password reset
- Real-time ticket list and reports
- Ticket filters by status, contact method, and issue type
- WhatsApp ticket creation and message threading
- Email ticket creation from Mailgun inbound email
- Supervisor-only delete permission in Firestore rules
- POPIA-aware data handling and agent audit metadata
