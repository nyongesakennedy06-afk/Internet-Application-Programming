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


## 💳 Wallet & live updates

Orders are paid from a per-user wallet, and the website updates the moment the database changes: the balance in the header, the statement, order statuses and a "Live activity" feed on `/wallet` that lists each backend step (BEGIN, SELECT … FOR UPDATE, INSERT, UPDATE, COMMIT/ROLLBACK).

### Setup (existing databases)

Run the migration once (safe to re-run). New databases created from `schema.sql` already include it.

```bash
mysql -u root -p strathsbites < server/migrations/001_wallet.sql
```

Users registered before the wallet existed get one automatically (KES 0) the first time it's used.

### How it stays in sync with the database

* **The DB guards the money.** `wallets.balance` has `CHECK (balance >= 0)`, and every balance change writes one `wallet_transactions` row in the same DB transaction, so the ledger always adds up to the balance.
* **No double spending.** Placing an order locks the user's wallet row (`SELECT … FOR UPDATE`) until COMMIT, so simultaneous orders queue instead of both spending the same money.
* **Events only after COMMIT.** `server/events.js` pushes to the browser over `GET /api/events` (Server-Sent Events) only once the transaction has committed, so the page never shows anything the DB rolled back.
* **Resync on reconnect.** On every (re)connect, and when the tab becomes visible again, the frontend reloads `/api/wallet` and `/api/orders/mine` from the DB.

The event bus is in memory, so it reaches clients connected to the same Node process. If you run several server instances, replace `server/events.js` with Redis pub/sub (same `publish` / `subscribe` functions).

### Endpoints (all need `Authorization: Bearer <token>`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/wallet` | Balance, last 25 statement rows, Pesa Tracker budget if linked |
| POST | `/api/wallet/topup` | `{ "amount": 500 }`, a whole number from 1 to 50,000. **Simulated**; this is where an M-Pesa callback would go |
| GET | `/api/events` | Live event stream: `wallet.updated`, `order.created`, `order.updated`, `order.rejected` |
| GET | `/api/orders/mine` | Your orders, with cafeteria name and line items |
| PATCH | `/api/orders/:id/status` | **Admin only.** `{ "status": "confirmed" }` (`pending` / `confirmed` / `completed`); the customer's page updates live |

`POST /api/orders` is unchanged for API consumers (same request and response). It now also returns **422** when the wallet balance is lower than the order total.

To try the admin status update, make a user an admin with `UPDATE users SET role = 'admin' WHERE email = '…';`, then log in again to get a token with the new role.

### Configuration

The frontend reads the API address from `VITE_API_URL` (default `http://localhost:4000`).

### Tests

`npm test` in `server/` runs against your MySQL database (the wallet migration must be applied). `__tests__/wallet.test.js` covers top-ups, payments, insufficient funds, simultaneous orders, the ledger adding up, and the live event stream.
