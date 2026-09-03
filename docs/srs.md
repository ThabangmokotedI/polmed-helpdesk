# SOFTWARE REQUIREMENTS SPECIFICATION (SRS)
## Polmed Connect — Helpdesk Ticket Tracker
**Version:** 1.1  
**Date:** 2026-08-11  
**Author:** Polmed Connect Helpdesk Team  
**Classification:** Internal — Restricted

---

## 1. Introduction

### 1.1 Purpose
This document describes the current requirements, implemented capabilities, and operating model for the Polmed Connect Helpdesk Ticket Tracker.

### 1.2 Scope
The system is a browser-based helpdesk tracker for Polmed Connect support agents. It supports:
- WhatsApp ticket ingestion via Meta webhook
- Email ticket ingestion via Mailgun inbound routes
- Real-time Firestore ticket sync and dashboard updates
- Agent authentication, ticket triage, and ticket lifecycle management
- Supervisor role control for ticket deletion and role governance

### 1.3 Intended Audience
- Polmed helpdesk agents using the tracker
- Operations and support managers overseeing ticket workflow
- Developers maintaining or extending the helpdesk system

### 1.4 Definitions

| Term | Definition |
|---|---|
| Ticket | A logged record of one member support interaction |
| Agent | Authenticated Polmed support staff member |
| Supervisor | Agent with elevated privileges (delete tickets, manage roles) |
| Ticket ID | Unique tracker identifier, e.g. `TKT-20260811-WA-123456` |
| POPIA | Protection of Personal Information Act (South Africa, 2013) |
| Firestore | Google Firebase cloud database service |
| WhatsApp webhook | Netlify serverless function that receives Meta cloud messages |
| Email webhook | Netlify serverless function that receives Mailgun inbound emails |

---

## 2. Overall Description

### 2.1 System Context
Support members contact Polmed Connect through WhatsApp or email. Incoming messages are auto-logged as tickets and surfaced to authenticated helpdesk agents in a centralized web dashboard.

### 2.2 Project Status
The implementation is complete for the core ticketing workflow:
- Login page and password reset
- Ticket dashboard with status/issue/contact filters
- Real-time syncing from Firestore
- WhatsApp webhook for incoming messages and media
- Email webhook for Mailgun inbound email
- Supervisor-only ticket deletion in Firestore rules
- Agent role auto-creation on first login

### 2.3 Key Benefits
- Unique ticket tracking for WhatsApp and email queries
- Reduced duplicate logging through existing ticket threading
- Real-time visibility for multiple agents
- Secure, authenticated access with audit metadata
- POPIA-aware handling of member data and access control

---

## 3. Functional Requirements

### FR-01: User Authentication
| # | Requirement |
|---|---|
| FR-01.1 | Agents must sign in with Firebase Email/Password |
| FR-01.2 | Unauthenticated users are redirected to `index.html` |
| FR-01.3 | Password reset email is supported from the login page |
| FR-01.4 | Each agent uses an individual authenticated account |
| FR-01.5 | Ticket actions store the agent email or webhook source |

### FR-02: Ticket Ingestion
| # | Requirement |
|---|---|
| FR-02.1 | WhatsApp messages create or append tickets automatically |
| FR-02.2 | Email messages create tickets automatically from Mailgun |
| FR-02.3 | Incoming tickets default to `New` status |
| FR-02.4 | WhatsApp thread updates use existing open tickets when possible |
| FR-02.5 | Incoming media is downloaded and stored in Firebase Storage |

### FR-03: Ticket Fields and Form
| Field | Type | Required | Notes |
|---|---|---|---|
| Ticket ID | Auto-generated | Yes | `TKT-YYYYMMDD-WA-XXXXXX`, `TKT-YYYYMMDD-EM-XXXXXX`, or admin-generated ticket ID |
| Contact Method | Dropdown | Yes | WhatsApp / Email / Phone call / In person |
| Identifier (Member No.) | Text | No | Member number for ticket matching |
| Issue Type | Dropdown | No | Several issue categories supported |
| Description | Textarea | No | Initial request or summary |
| Date Received | Date | Yes | Ticket received date |
| Time Received | Time | No | Time of incoming request |
| Status | Dropdown | Yes | New / In Progress / Resolved / Unresolved / Redirected / Merged |
| Resolution Description | Textarea | No | Required for resolved or closed tickets |
| `fromEmail` / `phoneNumber` | String | No | Stored internally for webhook ticket provenance |

### FR-04: Issue Type Values
The UI currently supports these issue types:
- Onboarding assistance
- Login Issue
- Forgot username/password
- Membership & documents
- Wellness tracker
- Feature malfunction
- Huawei user
- Not App Related
- Unspecified / No Response

### FR-05: Ticket Management
| # | Requirement |
|---|---|
| FR-05.1 | Agents may view all tickets in the dashboard |
| FR-05.2 | Agents may update ticket fields and issue type |
| FR-05.3 | Supervisors may delete tickets via Firestore rules |
| FR-05.4 | Every update stores `updatedBy` and `updatedAt` metadata |

### FR-06: Real-Time Sync
| # | Requirement |
|---|---|
| FR-06.1 | Ticket changes appear in all agents' dashboards in real time |
| FR-06.2 | The dashboard updates without a page refresh |
| FR-06.3 | New ticket and unread reply indicators appear automatically |

### FR-07: Filtering & Search
| # | Requirement |
|---|---|
| FR-07.1 | Search supports Ticket ID, member number, issue type, and description |
| FR-07.2 | Filter by status, contact method, and issue type |
| FR-07.3 | Dashboard supports status values `New`, `In Progress`, `Resolved`, `Redirected`, `Unresolved`, `Merged` |

### FR-08: Dashboard Statistics
| # | Requirement |
|---|---|
| FR-08.1 | Dashboard displays totals for tickets, In Progress, Resolved, Unresolved, WhatsApp, Email |
| FR-08.2 | Statistics refresh automatically with Firestore updates |

### FR-09: WhatsApp and Email Workflow Guidance
| # | Requirement |
|---|---|
| FR-09.1 | The app includes a help section for WhatsApp ticket workflow |
| FR-09.2 | The app documents WhatsApp threading and ticket status mapping |
| FR-09.3 | The app clarifies POPIA expectations for agents |

---

## 4. Non-Functional Requirements

### NFR-01: Security
- Only authenticated users may read or write tickets.
- Only supervisors may delete tickets in `docs/firestore.rules`.
- Agent role records are stored in `agents/{uid}` and default to `agent`.
- Incoming webhook requests are verified by signature when configured.

### NFR-02: POPIA Compliance
- Phone numbers are stored only for internal webhook correlation and not exposed in UI.
- Member identifiers are stored as member numbers rather than contact numbers.
- Agent audit metadata is captured on all ticket updates.
- Firestore rules prevent public access to ticket documents.

### NFR-03: Performance
- Ticket data loads quickly from Firestore and renders immediately.
- Real-time updates are reflected as snapshot events arrive.

### NFR-04: Usability
- The interface is browser-based and responsive for desktop use.
- A local mock mode exists when Firebase config is absent.
- Authentication, search, and filtering are available from the dashboard.

### NFR-05: Availability
- Hosting is configured for Netlify with `netlify/functions`.
- If Firebase is unreachable, the app should display a connection problem.

---

## 5. System Architecture

```
[Agent Browser]
      |
      | HTTPS
      ↓
[Netlify CDN] ─── Static files: index.html, dashboard.html, CSS, JS
      |
      | Netlify Functions
      ↓
[whatsapp-webhook.js]     Receives Meta WhatsApp events
[email-webhook.js]        Receives Mailgun inbound emails
      |
      ↓
[Firebase Admin SDK]      Writes tickets to Firestore, stores media in Storage
      |
      ↓
[Firebase Firestore]      tickets collection, agents collection

[Agent Browser] also directly communicates with:
[Firebase Auth]           Agent login
[Firebase Firestore]      Real-time ticket list and updates
```

---

## 6. Data Model

**Collection:** `tickets`  
**Document ID:** Auto-generated by Firestore

**Fields:**

```json
{
  "ticketId": "TKT-20260811-WA-123456",
  "contactMethod": "WhatsApp",
  "source": "whatsapp-webhook",
  "status": "New",
  "message": "Member said their OTP did not arrive",
  "description": "",
  "issueType": "",
  "identifier": "",
  "phoneNumber": "+2765XXXXXXX",
  "fromEmail": "",
  "mediaUrl": "https://...",
  "mediaType": "image",
  "conversation": [
    {"from":"member","text":"Hi, I can't log in","at":"2026-08-11T10:12:00Z"}
  ],
  "dateReceived": "2026-08-11",
  "timeReceived": "10:12:00",
  "createdBy": "WhatsApp webhook",
  "createdAt": "Firestore Timestamp",
  "updatedBy": "WhatsApp webhook",
  "updatedAt": "Firestore Timestamp",
  "hasNewReply": true
}
```

---

## 7. Deployment Notes

- `js/firebase-config.js` is already configured for the current Firebase project.
- `docs/firestore.rules` defines agent-only access and supervisor delete privileges.
- `netlify.toml` publishes the repo root and routes functions from `netlify/functions`.
- Required environment variables are documented in `README.md`.

| Feature | Service | Monthly Cost |
|---|---|---|
| WhatsApp Cloud API access | Meta (free tier) | R0 (up to 1,000 conversations/month) |
| WhatsApp Cloud API — beyond free tier | Meta | ~R0.65–R1.50 per conversation |
| Cloud function to receive/send messages | Firebase Cloud Functions | R0 (2M invocations free/month) |
| OR hosted server (if needed) | Railway / Render | ~R180–R350/month |
| WhatsApp number (dedicated, new) | Any SA network SIM | ~R30–R100/month |
| **Phase 3 Total (low volume)** | | **R30–R450/month** |
| **Phase 3 Total (high volume, 500+ chats/month)** | | **R500–R1,500/month** |

### Total Cost Summary

| Phase | Description | Monthly Cost |
|---|---|---|
| Phase 1 | Core tracker — authentication, real-time sync, ticket management | **R0** |
| Phase 2 | Spreadsheet sync automation (optional) | **R0–R350** |
| Phase 3 | WhatsApp API integration (requires Polmed IT approval) | **R30–R1,500** |

> **Recommendation for demo:** Deploy Phase 1 at R0/month. Present Phase 2 and 3 as a roadmap.

---

## 8. Deployment Instructions

### Step 1: Firebase Setup
1. Go to https://console.firebase.google.com
2. Create project: "polmed-helpdesk"
3. Enable **Authentication** → Sign-in method → **Email/Password**
4. Create **Firestore Database** → Start in production mode
5. Paste rules from `docs/firestore.rules` into Firestore → Rules
6. Register a **Web App** → copy config values into `js/firebase-config.js`
7. Add agent accounts: Authentication → Users → Add user (for each agent)

### Step 2: Netlify Deployment
1. Go to https://netlify.com → Sign up free
2. Drag and drop the project folder onto the Netlify deploy area
3. Your site goes live at a URL like `https://polmed-helpdesk.netlify.app`
4. (Optional) Set a custom domain in Netlify → Domain Management

### Step 3: Agent Onboarding
1. Create a Firebase Auth account for each agent (email + temporary password)
2. Share the Netlify URL with agents
3. Each agent logs in and resets their password on first login

---

## 9. Future Considerations

| Feature | Notes |
|---|---|
| WhatsApp API auto-logging | When a member messages the helpdesk, a ticket draft is created automatically |
| Email-to-ticket | Inbound emails automatically create tickets via a webhook |
| Role-based access | Supervisor role with delete permissions; agent role without |
| Reporting dashboard | Monthly stats, resolution time averages, issue type breakdown |
| SMS notifications | Agent notified when a ticket is assigned or updated |
| Data export | One-click export to CSV for audit or archiving |

---

*Document end — Polmed Connect Helpdesk SRS v1.0*
