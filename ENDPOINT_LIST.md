# ENDPOINT_LIST.md

## Endpoints — Team 9 (Strathbites)

| Method | Path | Purpose | Maps to Need |
|--------|------|---------|---------------|
| GET | /budgets?category=food | Read the user's food budget allocation and remaining balance | Need #1: read customer food budget allocations |
| POST | /spend-events | Notify Pesa Tracker of a completed order to update remaining food balance | Need #2: update remaining food balance |
| POST | /sessions | Verify/establish that a user is logged in on Pesa Tracker to keep sessions in sync | Need #3: authenticate users on both apps |
| GET | /orders?userId={id}&fields=timestamp,location | Return a user's order history with timestamps and location, for lost-item matching | Team 10 Need #1 + Need #2: GET timestamp order history; GET location-based order info |
| GET | /orders?userId={id} | Return a user's raw order history, from which order frequency at a location can be derived | Team 10 Need #3: GET first-time user info |

## Peer review feedback (received)

- Rows 1 and 3 (formerly `/pesatracker/budgets/food` and `/pesatracker/auth/verify`) had unnecessary nesting and a verb (`verify`) in the path. Fixed: `verify` removed, path flattened to a noun resource (`/sessions`), and the `pesatracker` prefix dropped since these are Team 8's own endpoints, not ours to namespace.
- Rows 4 and 5 (formerly two near-identical `/orders` calls differing only by `fields`) were merged into one endpoint using a multi-value `fields` query parameter.
- Row 6 (`/users/{id}/order-frequency`) exposed a Team-10-specific computed metric rather than a resource. Changed to expose the raw `/orders` data; frequency calculation is now the consumer's (Team 10's) responsibility.

## Open questions / notes

- Ownership of the "update remaining food balance" write (row 2) is still unresolved with Team 8 as of Week 3. Assumed here that Team 8 owns the balance and receives spend notifications from us — pending confirmation.
- Rows 1–3 are endpoints on Team 8's (Pesa Tracker's) API that we consume, not endpoints we implement ourselves.