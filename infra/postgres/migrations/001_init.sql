BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Customer', 'Courier', 'Admin')),
  name TEXT,
  is_email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  email_verified_at TIMESTAMPTZ,
  verification_sent_at TIMESTAMPTZ,
  created_by_admin_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS is_email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by_admin_id TEXT REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_role_verified ON users(role, is_email_verified);
CREATE INDEX IF NOT EXISTS idx_users_created_by_admin_id ON users(created_by_admin_id);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_verifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_snapshot TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_verifications_user_id ON email_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_email_verifications_expires_at ON email_verifications(expires_at);
CREATE INDEX IF NOT EXISTS idx_email_verifications_active_user ON email_verifications(user_id, expires_at)
WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  name TEXT NOT NULL,
  price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
  stock INTEGER NOT NULL CHECK (stock >= 0),
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'cooking', 'delivery', 'done')),
  address TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  total NUMERIC(10, 2) NOT NULL CHECK (total >= 0),
  delivery_courier_id TEXT,
  delivery_courier_name TEXT,
  delivery_address TEXT,
  delivery_eta_minutes INTEGER,
  delivery_status TEXT CHECK (delivery_status IN ('assigned', 'cooking', 'delivery', 'done')),
  delivery_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_eta_lower_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS delivery_eta_upper_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS delivery_eta_confidence_score NUMERIC(5, 2);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status_updated_at ON orders(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  name TEXT NOT NULL,
  price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_total NUMERIC(10, 2) NOT NULL CHECK (line_total >= 0)
);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_product ON order_items(order_id, product_id);

CREATE TABLE IF NOT EXISTS couriers (
  id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE couriers
  ADD COLUMN IF NOT EXISTS eta_bias_factor NUMERIC(6, 4) NOT NULL DEFAULT 1.0000,
  ADD COLUMN IF NOT EXISTS eta_reliability_score NUMERIC(5, 2) NOT NULL DEFAULT 80.00,
  ADD COLUMN IF NOT EXISTS completed_deliveries INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_couriers_is_available ON couriers(is_available);

CREATE TABLE IF NOT EXISTS delivery_routes (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  courier_id TEXT NOT NULL REFERENCES couriers(id) ON DELETE RESTRICT,
  courier_name TEXT NOT NULL,
  address TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  eta_minutes INTEGER NOT NULL CHECK (eta_minutes > 0),
  status TEXT NOT NULL CHECK (status IN ('assigned', 'cooking', 'delivery', 'done')),
  total NUMERIC(10, 2) NOT NULL CHECK (total >= 0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ
);
ALTER TABLE delivery_routes
  ADD COLUMN IF NOT EXISTS route_sequence INTEGER NOT NULL DEFAULT 1;
ALTER TABLE delivery_routes
  ADD COLUMN IF NOT EXISTS route_total_time_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE delivery_routes
  ADD COLUMN IF NOT EXISTS route_distance_km NUMERIC(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE delivery_routes
  ADD COLUMN IF NOT EXISTS eta_lower_minutes INTEGER NOT NULL DEFAULT 1;
ALTER TABLE delivery_routes
  ADD COLUMN IF NOT EXISTS eta_upper_minutes INTEGER NOT NULL DEFAULT 1;
ALTER TABLE delivery_routes
  ADD COLUMN IF NOT EXISTS eta_confidence_score NUMERIC(5, 2) NOT NULL DEFAULT 80.00;
CREATE INDEX IF NOT EXISTS idx_delivery_routes_courier_id ON delivery_routes(courier_id);
CREATE INDEX IF NOT EXISTS idx_delivery_routes_status ON delivery_routes(status);
CREATE INDEX IF NOT EXISTS idx_delivery_routes_created_at ON delivery_routes(created_at);
CREATE INDEX IF NOT EXISTS idx_delivery_routes_status_eta ON delivery_routes(status, eta_minutes);
CREATE INDEX IF NOT EXISTS idx_delivery_routes_courier_status_sequence ON delivery_routes(courier_id, status, route_sequence);
CREATE INDEX IF NOT EXISTS idx_delivery_routes_status_updated_at ON delivery_routes(status, updated_at DESC);

COMMIT;

INSERT INTO categories (id, name)
VALUES
  ('cat-burgers', 'Burgers'),
  ('cat-pizza', 'Pizza'),
  ('cat-salads', 'Salads'),
  ('cat-wraps', 'Wraps'),
  ('cat-desserts', 'Desserts'),
  ('cat-drinks', 'Drinks')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  updated_at = NOW();

INSERT INTO users (
  id,
  email,
  password,
  role,
  name,
  is_email_verified,
  email_verified_at
)
VALUES
  ('user-admin-1', 'admin@foodo.local', 'admin123', 'Admin', 'Admin User', TRUE, NOW()),
  ('courier-1', 'courier1@foodo.local', 'courier123', 'Courier', 'Alex Courier', TRUE, NOW()),
  ('courier-2', 'courier2@foodo.local', 'courier123', 'Courier', 'Mia Rider', TRUE, NOW()),
  ('user-customer-1', 'customer@foodo.local', 'customer123', 'Customer', 'Demo Customer', TRUE, NOW())
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  password = EXCLUDED.password,
  role = EXCLUDED.role,
  name = EXCLUDED.name,
  is_email_verified = EXCLUDED.is_email_verified,
  email_verified_at = EXCLUDED.email_verified_at,
  updated_at = NOW();

INSERT INTO couriers (id, email, name, lat, lng, is_available)
VALUES
  ('courier-1', 'courier1@foodo.local', 'Alex Courier', 40.73061, -73.935242, TRUE),
  ('courier-2', 'courier2@foodo.local', 'Mia Rider', 40.712776, -74.005974, TRUE)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  name = EXCLUDED.name,
  lat = EXCLUDED.lat,
  lng = EXCLUDED.lng,
  is_available = EXCLUDED.is_available,
  updated_at = NOW();

INSERT INTO products (id, category_id, name, price, stock, image_url)
VALUES
  ('prod-burger-classic', 'cat-burgers', 'Classic Burger', 9.90, 40, 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=1200&q=80'),
  ('prod-burger-double', 'cat-burgers', 'Double Beef Burger', 12.80, 25, 'https://images.unsplash.com/photo-1553979459-d2229ba7433b?auto=format&fit=crop&w=1200&q=80'),
  ('prod-burger-chicken', 'cat-burgers', 'Crispy Chicken Burger', 10.40, 28, 'https://images.unsplash.com/photo-1610440042657-612c34d95e9f?auto=format&fit=crop&w=1200&q=80'),
  ('prod-pizza-pepperoni', 'cat-pizza', 'Pepperoni Pizza', 14.50, 25, 'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=1200&q=80'),
  ('prod-pizza-margherita', 'cat-pizza', 'Margherita Pizza', 12.20, 22, 'https://images.unsplash.com/photo-1604382354936-07c5d9983bd3?auto=format&fit=crop&w=1200&q=80'),
  ('prod-pizza-bbq', 'cat-pizza', 'BBQ Chicken Pizza', 16.10, 16, 'https://images.unsplash.com/photo-1593560708920-61dd98c46a4e?auto=format&fit=crop&w=1200&q=80'),
  ('prod-salad-caesar', 'cat-salads', 'Caesar Salad', 7.50, 30, 'https://images.unsplash.com/photo-1546793665-c74683f339c1?auto=format&fit=crop&w=1200&q=80'),
  ('prod-salad-greek', 'cat-salads', 'Greek Salad', 8.20, 24, 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=1200&q=80'),
  ('prod-salad-tuna', 'cat-salads', 'Tuna Salad', 9.10, 18, 'https://images.unsplash.com/photo-1625944230945-1b7dd3b949ab?auto=format&fit=crop&w=1200&q=80'),
  ('prod-salad-avocado', 'cat-salads', 'Avocado Bowl', 10.90, 15, 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=1200&q=80'),
  ('prod-wrap-caesar', 'cat-wraps', 'Chicken Caesar Wrap', 9.80, 20, 'https://images.unsplash.com/photo-1626700051175-6818013e1d4f?auto=format&fit=crop&w=1200&q=80'),
  ('prod-wrap-veggie', 'cat-wraps', 'Veggie Hummus Wrap', 8.70, 22, 'https://images.unsplash.com/photo-1666187671096-2fdcf85d5e4f?auto=format&fit=crop&w=1200&q=80'),
  ('prod-wrap-turkey', 'cat-wraps', 'Turkey Club Wrap', 10.30, 18, 'https://images.unsplash.com/photo-1600850056064-a8b380df8395?auto=format&fit=crop&w=1200&q=80'),
  ('prod-dessert-cheesecake', 'cat-desserts', 'New York Cheesecake', 6.90, 26, 'https://images.unsplash.com/photo-1533134242443-d4fd215305ad?auto=format&fit=crop&w=1200&q=80'),
  ('prod-dessert-brownie', 'cat-desserts', 'Chocolate Brownie', 5.40, 30, 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=1200&q=80'),
  ('prod-dessert-tiramisu', 'cat-desserts', 'Tiramisu Cup', 6.20, 24, 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?auto=format&fit=crop&w=1200&q=80'),
  ('prod-drink-lemonade', 'cat-drinks', 'Fresh Lemonade', 3.90, 45, 'https://images.unsplash.com/photo-1621263764928-df1444c5e859?auto=format&fit=crop&w=1200&q=80'),
  ('prod-drink-iced-tea', 'cat-drinks', 'Lemon Iced Tea', 3.70, 42, 'https://images.unsplash.com/photo-1499638673689-79a0b5115d87?auto=format&fit=crop&w=1200&q=80'),
  ('prod-drink-espresso', 'cat-drinks', 'Espresso Shot', 2.80, 50, 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=1200&q=80'),
  ('prod-drink-smoothie', 'cat-drinks', 'Berry Smoothie', 4.90, 28, 'https://images.unsplash.com/photo-1553530666-ba11a7da3888?auto=format&fit=crop&w=1200&q=80')
ON CONFLICT (id) DO UPDATE SET
  category_id = EXCLUDED.category_id,
  name = EXCLUDED.name,
  price = EXCLUDED.price,
  stock = EXCLUDED.stock,
  image_url = EXCLUDED.image_url,
  updated_at = NOW();
