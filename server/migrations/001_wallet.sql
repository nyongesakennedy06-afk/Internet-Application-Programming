-- Adds the wallet: one balance per user plus a ledger of every movement of money.
-- Safe to run more than once.  Run it with:
--   mysql -u root -p strathsbites < server/migrations/001_wallet.sql

-- One row per user. The CHECK makes MySQL itself refuse a negative balance,
-- so even a bug in the server code cannot overspend a wallet.
CREATE TABLE IF NOT EXISTS wallets (
  user_id INT NOT NULL,
  balance DECIMAL(10,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT wallets_balance_not_negative CHECK (balance >= 0),
  CONSTRAINT wallets_ibfk_1 FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- The statement. Every change to wallets.balance writes exactly one row here, in the
-- same DB transaction, so SUM(amount) for a user always equals their balance.
--   amount        signed: positive = money in (topup), negative = money out (order_payment)
--   balance_after the wallet balance right after this row was applied
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id INT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  type ENUM('topup', 'order_payment') NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  balance_after DECIMAL(10,2) NOT NULL,
  order_id INT NULL,
  description VARCHAR(255) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY user_created (user_id, created_at),
  KEY order_id (order_id),
  CONSTRAINT wallet_transactions_ibfk_1 FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT wallet_transactions_ibfk_2 FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE SET NULL
);
