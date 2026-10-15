-- Strathbites database schema
-- orders and order_items: copied from SHOW CREATE TABLE on the working database.
-- cafeterias, menu_items, users: from the original schema file (consistent with
-- the columns the server code reads and writes).

CREATE DATABASE IF NOT EXISTS strathsbites;
USE strathsbites;

CREATE TABLE cafeterias (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  image VARCHAR(255),
  rating DECIMAL(2,1),
  delivery_time VARCHAR(50)
);

CREATE TABLE menu_items (
  id VARCHAR(50) PRIMARY KEY,
  cafeteria_id VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  price INT NOT NULL,
  image VARCHAR(255),
  category VARCHAR(50),
  FOREIGN KEY (cafeteria_id) REFERENCES cafeterias(id)
);

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('user', 'admin') NOT NULL DEFAULT 'user',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE orders (
  id INT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  cafeteria_id VARCHAR(50) NOT NULL,
  status ENUM('pending','confirmed','completed') NOT NULL DEFAULT 'pending',
  total_amount DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY user_id (user_id),
  KEY cafeteria_id (cafeteria_id),
  CONSTRAINT orders_ibfk_1 FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT orders_ibfk_2 FOREIGN KEY (cafeteria_id) REFERENCES cafeterias (id) ON DELETE RESTRICT
);

CREATE TABLE order_items (
  id INT NOT NULL AUTO_INCREMENT,
  order_id INT NOT NULL,
  menu_item_id VARCHAR(50) NOT NULL,
  item_name VARCHAR(100) NOT NULL,
  item_price INT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  KEY order_id (order_id),
  KEY menu_item_id (menu_item_id),
  CONSTRAINT order_items_ibfk_1 FOREIGN KEY (order_id) REFERENCES orders (id),
  CONSTRAINT order_items_ibfk_2 FOREIGN KEY (menu_item_id) REFERENCES menu_items (id)
);
