# StrathsBites

A campus food delivery MVP built with React, Vite, and React Router for Strathmore University cafeterias.

This is a group project designed to practice core React concepts (components, routing, props, state, context) and Git/GitHub collaboration workflows.


## 🛠️ Tech Stack & Commands

*   **Framework:** React (Vite-based)
*   **Routing:** React Router v7 (`react-router-dom`)
*   **Styling:** Vanilla CSS (written in `src/App.css` and `src/index.css`)


## 📂 Project Structure

*   `src/components/` — Reusable elements (Header, Layout, CafeteriaCard, MenuItem)
*   `src/pages/` — Main views (HomePage, CafeteriaMenuPage, CheckoutPage)
*   `src/data/` — Static mock database (`data.json`) containing cafeteria and food items.
*   `src/App.js` — Route configuration.
*   `src/App.css` — Global CSS styling sheets.


## 💳 Wallet (a read-only view of Pesa Tracker)

The wallet does not hold money. It shows two things from **Pesa Tracker** (Team 8's budget API) and nothing else:

* **Food budget remaining**, read live from Pesa Tracker (`GET /users/{id}/budget`).
* **Transactions**, the purchases we recorded there (`POST /users/{id}/transactions`), newest first.

Nothing can be typed in: there is no top-up and no balance stored in our database.

### Linking a user to Pesa Tracker

Each user has an optional `users.pesa_user_id`. Users without one see "not linked" on the wallet and order as normal.

```sql
UPDATE users SET pesa_user_id = 'usr_7f2a9c1e' WHERE email = '...';
```

Set `PESA_TRACKER_URL` and `PESA_TRACKER_API_KEY` in `server/.env` (see `.env.example`). Leave `PESA_TRACKER_URL` empty to switch the integration off.

### Setup

New databases created from `schema.sql` already have everything. A database that has the **old local wallet** (top-ups) needs the migration once; it adds `orders.pesa_transaction_id` and **drops** the old `wallets` and `wallet_transactions` tables:

```bash
mysql -u root -p strathsbites < server/migrations/001_wallet_from_pesa_tracker.sql
```

### What happens at checkout (`POST /api/orders`, linked users)

1. Read the remaining budget from Pesa Tracker. If the order total is more, answer **422** and place nothing.
2. Save the order, then record the purchase on Pesa Tracker. It deducts the budget itself, so we never also call its `PATCH` "deduct".
3. Save the transaction id Pesa Tracker returns on the order (`orders.pesa_transaction_id`). The wallet lists only orders that have one, so it lines up with what Pesa Tracker knows.
4. If Pesa Tracker refuses or cannot be reached, the order is rolled back and the answer is **422** or **502**. Nothing is half-done.
5. Only after the commit does the server tell the user's open tabs to reload their wallet.

A linked user who has no budget set on Pesa Tracker can still order; there is no budget to enforce, so nothing is recorded there.

### What the wallet shows (`status`)

| `status` | Meaning |
|----------|---------|
| `ok` | `remaining` is the live number from Pesa Tracker |
| `not_linked` | The user has no `pesa_user_id` (or the integration is switched off) |
| `no_budget` | Linked, but Pesa Tracker has no budget for them yet |
| `unavailable` | Pesa Tracker could not be reached; past transactions still show |

### Live updates

`server/events.js` pushes to the browser over `GET /api/events` (Server-Sent Events), only **after** the database commit. The page reloads `/api/wallet` when the connection opens, when the tab becomes visible again, and when it hears `wallet.updated` or `order.updated`. The event bus is in memory, so it reaches clients connected to the same Node process: run **one** server instance, or replace `server/events.js` with Redis pub/sub (same `publish` / `subscribe` functions).

### Endpoints (all need `Authorization: Bearer <token>`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/wallet` | `{ status, remaining, currency, transactions }` (read-only) |
| GET | `/api/events` | Live event stream: `wallet.updated`, `order.updated` |
| GET | `/api/orders/mine` | Your orders, with cafeteria name and line items |
| PATCH | `/api/orders/:id/status` | **Admin only.** `{ "status": "confirmed" }` (`pending` / `confirmed` / `completed`); the customer's page updates live |

`POST /api/orders` answers **422** when a linked user's order is more than their remaining Pesa Tracker budget, and **502** when Pesa Tracker cannot be reached or errors for a linked user (the order is not placed).

To try the admin status update, make a user an admin with `UPDATE users SET role = 'admin' WHERE email = '...';`, then log in again to get a token with the new role.

### Configuration

The frontend reads the API address from `VITE_API_URL` (default `http://localhost:4000`).

### Tests

`npm test` in `server/` runs against your MySQL database (built from `schema.sql`). Pesa Tracker is replaced by a stand-in server (`__tests__/fakePesa.js`), so the tests never contact the real service. `__tests__/wallet.test.js` covers the read-only wallet, "remaining drops after an order", the transaction list, the missing top-up routes, and the live event stream; `__tests__/budget.test.js` covers the checkout budget rules.