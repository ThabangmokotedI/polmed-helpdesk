# SOFTWARE REQUIREMENTS SPECIFICATION (SRS)
## Polmed Connect — Helpdesk Ticket Tracker
**Version:** 1.0  
**Date:** May 2026  
**Author:** Polmed Connect Helpdesk Team  
**Classification:** Internal — Restricted

---

## 1. Introduction

### 1.1 Purpose
This document defines the software requirements for the Polmed Connect Helpdesk Ticket Tracker — a web-based system for logging, tracking, and resolving WhatsApp-based technical support queries related to the Polmed Connect mobile application.

### 1.2 Scope
The system allows authorised helpdesk agents to:
- Log member support queries received via WhatsApp, Email, or Phone call
- Generate unique ticket IDs to link WhatsApp conversations to records
- Track ticket status in real-time across multiple agents simultaneously
- View and update all tickets without duplication or data loss
- Comply with POPIA (Protection of Personal Information Act, 2013)

### 1.3 Intended Audience
- Helpdesk agents handling Polmed Connect app support queries
- Polmed internal IT / systems team (for integration planning)
- Any developer building on or extending this system

### 1.4 Definitions

| Term | Definition |
|---|---|
| Ticket | A logged record of one member's support query |
| Agent | An authorised Polmed helpdesk team member |
| TID | Ticket ID — unique identifier in format TKT-YYYYMMDD-NNN |
| POPIA | Protection of Personal Information Act (South Africa, 2013) |
| Firestore | Google Firebase's real-time NoSQL cloud database |
| WhatsApp label | A category label applied to a WhatsApp chat (In Progress, Resolved, etc.) |

---

## 2. Overall Description

### 2.1 System Context
Members experiencing difficulties with the Polmed Connect app contact the helpdesk via a dedicated WhatsApp Business number, email, or phone. Agents receive these queries, log them as tickets, assist the member, and update the ticket status through to resolution.

### 2.2 Current Problem
The current process uses a shared Excel spreadsheet with the following documented issues:
- No unique ticket identifier → agents cannot match WhatsApp chats to spreadsheet rows
- Duplicate entries created when multiple agents log the same query
- Status update confusion when following up on "In Progress" items
- No access control → anyone with the link can view sensitive member data
- No audit trail of who changed what and when

### 2.3 Proposed Solution
A web-based ticket tracker built with:
- **Frontend:** HTML, CSS, JavaScript (no framework required, runs in any browser)
- **Backend / Database:** Google Firebase (Firestore for real-time data, Authentication for login)
- **Hosting:** Netlify (free tier) or any static web host
- **Access:** Login-protected with individual agent email accounts

---

## 3. Functional Requirements

### FR-01: User Authentication
| # | Requirement |
|---|---|
| FR-01.1 | The system shall require agents to log in with an email address and password |
| FR-01.2 | The system shall redirect unauthenticated users to the login page |
| FR-01.3 | The system shall provide a "Forgot Password" function that sends a reset email |
| FR-01.4 | Each agent shall have an individual login — shared accounts are not permitted |
| FR-01.5 | The system shall record the logged-in agent's email on every ticket action |

### FR-02: Ticket Creation
| # | Requirement |
|---|---|
| FR-02.1 | Any authenticated agent may create a new ticket |
| FR-02.2 | The system shall auto-generate a unique Ticket ID in format TKT-YYYYMMDD-NNN |
| FR-02.3 | Required fields: Contact Method, Issue Type, Description, Date Received |
| FR-02.4 | Optional fields: Member Identifier (number), Time Received, Time to First Response, Resolution Time, RT in Hours, Resolution Description |
| FR-02.5 | The system shall record the creating agent's email and timestamp |

### FR-03: Ticket Fields (matching existing spreadsheet exactly)
| Field | Type | Required | Notes |
|---|---|---|---|
| Ticket ID | Auto-generated | — | TKT-YYYYMMDD-NNN |
| Contact Method | Dropdown | Yes | WhatsApp / Email / Phone call |
| Identifier (Member No.) | Text | No | Member's Polmed number |
| Issue Type | Dropdown | Yes | See section 3.6 |
| Description | Textarea | Yes | Full description of query |
| Date Received | Date | Yes | |
| Time Received | Time | No | |
| Time to First Response | Text | No | e.g. "17 minutes" |
| Status | Dropdown | Yes | In Progress / Resolved / Unresolved |
| Resolution Time | Text | No | e.g. "2 hours" |
| RT (in hours) | Number | No | Numeric value for stats |
| Resolution Description | Textarea | No | Required when status = Resolved |

### FR-04: Issue Type Values
- Onboarding assistance
- Login Issue
- Forgot username/password
- Membership & documents
- Wellness tracker
- Feature malfunction
- Huawei user
- Unspecified / No Response

### FR-05: Ticket Management
| # | Requirement |
|---|---|
| FR-05.1 | Agents may view all tickets regardless of who created them |
| FR-05.2 | Agents may edit any ticket field |
| FR-05.3 | Agents may delete tickets (with confirmation prompt) |
| FR-05.4 | The system shall record the updating agent's email and timestamp on every edit |

### FR-06: Real-Time Sync
| # | Requirement |
|---|---|
| FR-06.1 | All ticket changes shall sync across all logged-in agents in real-time |
| FR-06.2 | No page refresh shall be required to see another agent's updates |
| FR-06.3 | The dashboard shall display a live indicator when connected |

### FR-07: Filtering & Search
| # | Requirement |
|---|---|
| FR-07.1 | Agents may search by Ticket ID, Member Identifier, Issue Type, or Description |
| FR-07.2 | Agents may filter by Status (All / Resolved / In Progress / Unresolved) |
| FR-07.3 | Agents may filter by Contact Method (All / WhatsApp / Email / Phone call) |
| FR-07.4 | Agents may filter by Issue Type |

### FR-08: Dashboard Statistics
| # | Requirement |
|---|---|
| FR-08.1 | The dashboard shall display: Total tickets, In Progress, Resolved, Unresolved, WhatsApp count, Email count |
| FR-08.2 | Stats shall update automatically when tickets are added or modified |

### FR-09: WhatsApp Linking Guide
| # | Requirement |
|---|---|
| FR-09.1 | The system shall include a built-in guide explaining how to link WhatsApp chats to ticket IDs |
| FR-09.2 | The guide shall include WhatsApp label → ticket status mapping |
| FR-09.3 | The guide shall include POPIA compliance rules for agents |

---

## 4. Non-Functional Requirements

### NFR-01: Security
- Authentication enforced on all pages — no unauthenticated access to ticket data
- Firestore security rules ensure only authenticated users can read/write tickets
- Optional: restrict access to @polmed.co.za email domain only

### NFR-02: POPIA Compliance
- Member phone numbers shall NOT be stored — the Member Identifier field uses the Polmed membership number only
- All data is stored in Google Firebase (data centres selectable — EU recommended for POPIA alignment)
- Access is restricted to named, authenticated individuals
- Audit trail: every record captures createdBy, createdAt, updatedBy, updatedAt
- Data retention policy: records older than 12 months must be archived or deleted
- No data is shared with external parties through this system

### NFR-03: Performance
- Ticket list shall load within 3 seconds on a standard broadband connection
- Real-time updates shall appear within 2 seconds of a change being saved

### NFR-04: Usability
- The system shall be usable on desktop browsers (Chrome, Edge, Firefox)
- The system shall be responsive and functional on mobile devices
- No installation or software download required — runs entirely in a browser

### NFR-05: Availability
- Target uptime: 99.5% (Netlify + Firebase SLA)
- Offline: if Firebase is unreachable, the system shows a connection error; no data loss occurs

---

## 5. System Architecture

```
[Agent Browser]
      |
      | HTTPS
      ↓
[Netlify CDN] ─── HTML / CSS / JS files (static)
      |
      | Firebase SDK (JS module)
      ↓
[Firebase Auth] ─── Email/password authentication
      |
[Firebase Firestore] ─── Real-time NoSQL database
      |
      └── Collection: "tickets"
              Documents: one per ticket
              Fields: all fields from FR-03
```

---

## 6. Data Model

**Collection:** `tickets`  
**Document ID:** Auto-generated by Firestore  
**Fields:**

```json
{
  "ticketId":             "TKT-20260513-004",
  "contactMethod":        "WhatsApp",
  "identifier":           "12345678",
  "issueType":            "Onboarding assistance",
  "description":          "Member couldn't receive their OTP",
  "dateReceived":         "2026-05-13",
  "timeReceived":         "11:05",
  "status":               "Resolved",
  "timeToFirstResponse":  "17 minutes",
  "resolutionTime":       "18 minutes",
  "rtInHours":            0.3,
  "resolutionDescription":"Member account created directly by agent",
  "createdBy":            "agent@polmed.co.za",
  "createdAt":            "Firestore Timestamp",
  "updatedBy":            "agent2@polmed.co.za",
  "updatedAt":            "Firestore Timestamp"
}
```

---

## 7. Feature-by-Feature Cost Breakdown

> Developer costs excluded as per requirement. Costs reflect platform/service fees only in ZAR (approximate, May 2026).

### Phase 1 — Core Tracker (Current Build)

| Feature | Service | Monthly Cost |
|---|---|---|
| User authentication (email/password) | Firebase Authentication | R0 (free up to 10,000 users/month) |
| Real-time database (Firestore) | Firebase Firestore | R0 (free tier: 1GB storage, 50K reads/day, 20K writes/day) |
| Hosting (web app) | Netlify Free Tier | R0 (100GB bandwidth/month) |
| Custom domain (optional) | Any registrar | ~R150–R250/year |
| **Phase 1 Total** | | **R0/month** (or ~R20/month with domain) |

### Phase 2 — Google Sheets / Excel Sync (optional, future)

| Feature | Service | Monthly Cost |
|---|---|---|
| Automation: Firestore → Google Sheets | Make.com Starter | ~R350/month |
| OR Microsoft Power Automate | Microsoft 365 (if already licensed) | R0 additional |
| **Phase 2 Total** | | **R0–R350/month** |

### Phase 3 — WhatsApp Business API Integration (future)

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
