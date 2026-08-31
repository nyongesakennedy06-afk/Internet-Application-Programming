# ENDPOINT_LIST.md

## Endpoints — Team 9 (Strathbites)

| Method | Path | Purpose | Maps to Need |
|--------|------|---------|---------------|
| GET | /pesatracker/budgets/food | Read the user's food budget allocation and remaining balance | Need #1: read customer food budget allocations |
| POST | /pesatracker/spend-events | Notify Pesa Tracker of a completed order to update remaining food balance | Need #2: update remaining food balance |
| GET | /pesatracker/auth/verify | Verify a user is logged in on Pesa Tracker to keep sessions in sync | Need #3: authenticate users on both apps |
| GET | /orders?userId={id}&fields=timestamp | Return a user's order history with timestamps | Team 10 Need #1: GET timestamp order history |
| GET | /orders?userId={id}&fields=location | Return location data for a user's orders | Team 10 Need #2: GET location-based order info |
| GET | /users/{id}/order-frequency | Return how often a user has ordered at a given location, to assess credibility as a first-time or repeat user | Team 10 Need #3: GET first-time user info |

## Open questions / notes

- Ownership of the "update remaining food balance" write (row 2) is still unresolved with Team 8 as of Week 3. Assumed here that Team 8 owns the balance and receives spend notifications from us — pending confirmation.
- Rows 1–3 are endpoints on Team 8's (Pesa Tracker's) API that we consume, not endpoints we implement ourselves.
- Row 6's path (`/users/{id}/order-frequency`) is a candidate for revision — could alternatively be a query parameter on `/orders` depending on whether frequency is treated as a user property or a computed view over orders.