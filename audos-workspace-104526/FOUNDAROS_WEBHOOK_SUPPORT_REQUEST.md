# Support request: Enable secure portfolio-wide Flutterwave routing for FoundarOS

## Workspace

- Workspace: FoundarOS
- Space ID: `workspace-104526`
- Workspace UUID: `abb0d8aa-e900-4f77-b506-6f5450c3838b`
- Custom domain: `www.foundaros.com`
- Webhook: `https://www.foundaros.com/api/workspaces/104526/hooks/flutterwave-webhook/execute`

## Request summary

We need the FoundarOS Flutterwave webhook to act as a central payment router for seven portfolio workspaces. The workspace draft already receives Flutterwave payloads, returns HTTP 200, logs events, matches `tx_ref` prefixes, and can create a contact in the FoundarOS CRM. Three platform capabilities are required before this can be used safely in production.

## 1. Authenticated cross-workspace CRM contact upsert

Please provide a server-function helper or internal endpoint that allows this FoundarOS hook to upsert a contact into an explicitly authorized target workspace.

Authorized routing scope:

| tx_ref prefix | Workspace ID | Workspace name |
|---|---:|---|
| `workspace/104526` | 104526 | FoundarOS |
| `workspace/968216` | 968216 | OziUno |
| `workspace/911294` | 911294 | Porta |
| `workspace/302984` | 302984 | Concedo AI |
| `workspace/868460` | 868460 | DealDesk |
| `workspace/651454` | 651454 | PryceLense |
| `workspace/439499` | 439499 | SourceThread |

Required contact fields:

```json
{
  "email": "customer@example.com",
  "name": "Customer Name",
  "phone": "+1234567890",
  "tags": ["flutterwave-paid", "new-customer"],
  "notes": "Flutterwave payment confirmed. tx_ref: {tx_ref}, amount: {amount} {currency}, flw_ref: {flw_ref}",
  "source": "flutterwave-webhook"
}
```

The operation should be an upsert keyed by normalized email so repeat or retried webhooks do not create duplicate contacts. Access should be restricted to the seven workspace IDs above and should not grant general cross-workspace access.

Current constraint: the documented `platform.createContact({ email, name?, phone?, tags? })` helper is pre-scoped to the current workspace, accepts no target workspace ID, does not document upsert behavior, and does not accept `notes` or `source`.

## 2. Reliable processing after the webhook acknowledgement

Flutterwave requires a fast HTTP 200 acknowledgement. Please provide a documented server-function primitive such as `waitUntil(promise)`, a durable queue, or an event-enqueue helper that allows the hook to:

1. Flush `200 { "status": "received" }` immediately.
2. Reliably insert and update the webhook log afterward.
3. Retry transient CRM delivery failures without making Flutterwave wait.
4. Preserve an error outcome when background work ultimately fails.

Current constraint: the server-functions contract documents `respond()` and a five-minute execution timeout but no post-response/background primitive. The draft calls `respond(200, ...)` before processing, but there is no documented guarantee that the response is flushed before the remaining database and CRM work completes.

## 3. Founder-only webhook log access and enforced writes

The `webhook_logs` table contains customer email addresses and full raw payment payloads. Please enable a founder/admin-only read policy for this table so customer-facing WorkspaceDB credentials cannot read these records, including through direct API replay.

Please also switch the table's stored write policy from `watch` to `enforce`. Its intended policy is:

- Server hooks only for insert, update, and delete.
- No browser or shared writes.
- Payment, routing, customer, and raw payload fields are server-protected.

Current constraint: the policy was saved but reported as `SAVED, NOT YET APPLIED` with enforcement state `watch`. The Webhook Log app is hidden from customer mode in the UI, but UI visibility is not sufficient protection for payment data.

## Current implementation and evidence

- The `flutterwave-webhook` server function is registered and enabled.
- Its health check returns HTTP 200 and reports seven configured routes.
- An ignored-payment smoke test returned `200 { "status": "received" }` and produced an `ignored` log row.
- A successful OziUno-prefix smoke test returned HTTP 200 and produced an `error` row stating that cross-workspace CRM delivery is unavailable.
- Successful FoundarOS events use the current-workspace CRM helper.
- The Webhook Log admin app shows the latest 50 rows, expands raw JSON payloads, and refreshes every 30 seconds.
- The implementation remains an unpublished draft.

## Requested acceptance criteria

1. A successful webhook for each listed prefix upserts exactly one contact in the matching workspace CRM with email, name, phone, both tags, notes, and source.
2. Retrying the same webhook does not create duplicate contacts.
3. The public webhook acknowledgement is flushed before CRM or database routing work begins.
4. Background failures are retried and ultimately recorded in `webhook_logs.routing_error`.
5. Only authenticated FoundarOS founders/admins can read `webhook_logs`; customer and anonymous requests are denied.
6. Browser attempts to insert, update, or delete `webhook_logs` rows are actively rejected, not merely observed.
7. The platform confirms the minimum credentials/configuration the founder must supply, if any.

## Support questions

- Which supported API/helper should the hook use for scoped cross-workspace contact upserts?
- Can authorization be limited to only the six non-FoundarOS target workspaces listed above?
- What is the supported background-processing primitive for a public server function?
- Can founder-only read access and write-policy enforcement be enabled specifically for `webhook_logs` without changing unrelated tables?
