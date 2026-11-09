-- For a database that already has the old local wallet (the one with top-ups).
-- New databases created from schema.sql do NOT need this file.
--
-- The wallet is now just a read-only view of the user's Pesa Tracker budget, so:
--   1. orders gets a column to remember the transaction id Pesa Tracker returns for each purchase
--      (the wallet's transaction list is the orders that have one);
--   2. the old local wallet tables are dropped. This deletes the (simulated) balances and ledger.
--
-- Run it ONCE:
--   mysql -u root -p strathsbites < server/migrations/001_wallet_from_pesa_tracker.sql

ALTER TABLE orders ADD COLUMN pesa_transaction_id VARCHAR(50) NULL AFTER total_amount;

DROP TABLE IF EXISTS wallet_transactions;
DROP TABLE IF EXISTS wallets;