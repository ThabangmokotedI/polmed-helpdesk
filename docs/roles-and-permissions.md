# POLMED Helpdesk Roles and Permissions

This summary reflects the permissions enforced by the dashboard code and `doc/firestore.rules`.

## Agent

An authenticated user whose `agents/{userId}` record has no elevated role is treated as an agent.

Agents can:

- Sign in and access the dashboard.
- Read all ticket records.
- Create tickets.
- Update allowed ticket fields, including issue type, description, status, timing fields, conversation entries, typing indicators, duplicate decisions, archive fields, and audit metadata.
- Read system webhook-health information.
- Read deletion-audit records.
- Send WhatsApp replies through the authenticated dashboard workflow.

Agents cannot:

- Permanently delete tickets.
- Create or change another user's role.
- Edit or delete deletion-audit records.
- Write system webhook-health records directly.

## Supervisor

A supervisor is an authenticated user whose `agents/{userId}` record has `role: "supervisor"`.

Supervisors have the agent permissions above, plus they can:

- Permanently delete tickets.
- Create the deletion-audit record associated with a ticket deletion.
- Update or delete agent role records.
- Delete agent records.

## Role and permission gaps

- The rules allow any authenticated agent to update any ticket's allowed fields; there is no ticket ownership restriction.
- The rules allow any authenticated agent to create a ticket.
- A first-time authenticated user can create their own agent record only with the `agent` role. Elevating a user to supervisor requires an existing supervisor or another trusted administrative process.
- The rules do not enforce the meaning of audit fields such as `updatedBy`; clients can write those fields as part of an otherwise allowed ticket update.
- The rules do not independently enforce the WhatsApp send workflow; the Netlify function performs its own authenticated-token check.
- No separate permissions for reports, filters, attachments, or individual ticket fields are defined beyond the authenticated read/update rules.
