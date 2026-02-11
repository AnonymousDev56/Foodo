#!/usr/bin/env node

const config = {
  authUrl: process.env.SMOKE_AUTH_URL ?? "http://127.0.0.1:3001",
  ordersUrl: process.env.SMOKE_ORDERS_URL ?? "http://127.0.0.1:3002",
  warehouseUrl: process.env.SMOKE_WAREHOUSE_URL ?? "http://127.0.0.1:3003",
  deliveryUrl: process.env.SMOKE_DELIVERY_URL ?? "http://127.0.0.1:3004",
  notificationUrl: process.env.SMOKE_NOTIFICATION_URL ?? "http://127.0.0.1:3005",
  requestTimeoutMs: Number(process.env.SMOKE_REQUEST_TIMEOUT_MS ?? 10_000),
  pollIntervalMs: Number(process.env.SMOKE_POLL_INTERVAL_MS ?? 1_500),
  pollAttempts: Number(process.env.SMOKE_POLL_ATTEMPTS ?? 40),
  customerEmail: process.env.SMOKE_CUSTOMER_EMAIL ?? "customer@foodo.local",
  customerPassword: process.env.SMOKE_CUSTOMER_PASSWORD ?? "customer123",
  adminEmail: process.env.SMOKE_ADMIN_EMAIL ?? "admin@foodo.local",
  adminPassword: process.env.SMOKE_ADMIN_PASSWORD ?? "admin123",
  courierEmail: process.env.SMOKE_COURIER_EMAIL ?? "courier1@foodo.local",
  courierPassword: process.env.SMOKE_COURIER_PASSWORD ?? "courier123"
};

const step = (label) => console.log(`\n[smoke] ${label}`);

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    const headers = {
      Accept: "application/json",
      ...(options.headers ?? {})
    };

    let body = options.body;
    if (body && typeof body === "object" && !(body instanceof String)) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(body);
    }

    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body,
      signal: controller.signal
    });

    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!response.ok) {
      const message =
        typeof data === "object" && data !== null
          ? JSON.stringify(data)
          : String(data ?? "");
      throw new Error(`${response.status} ${response.statusText}: ${message}`);
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function waitFor(label, fn) {
  let lastError = null;

  for (let attempt = 1; attempt <= config.pollAttempts; attempt += 1) {
    try {
      const value = await fn();
      return value;
    } catch (error) {
      lastError = error;
      if (attempt < config.pollAttempts) {
        await sleep(config.pollIntervalMs);
      }
    }
  }

  throw new Error(`${label} failed after ${config.pollAttempts} attempts: ${lastError?.message ?? "unknown error"}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function healthCheck() {
  const checks = [
    { name: "auth-service", url: `${config.authUrl}/health` },
    { name: "orders-service", url: `${config.ordersUrl}/health` },
    { name: "warehouse-service", url: `${config.warehouseUrl}/health` },
    { name: "delivery-service", url: `${config.deliveryUrl}/health` },
    { name: "notification-service", url: `${config.notificationUrl}/health` }
  ];

  for (const check of checks) {
    const payload = await requestJson(check.url);
    assert(payload?.status === "ok", `${check.name} unhealthy`);
  }
}

async function login(email, password, label) {
  const payload = await requestJson(`${config.authUrl}/auth/login`, {
    method: "POST",
    body: { email, password }
  });

  assert(typeof payload?.accessToken === "string" && payload.accessToken.length > 0, `${label} login returned empty token`);
  return payload;
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

async function fetchProducts() {
  const products = await requestJson(`${config.warehouseUrl}/products`);
  assert(Array.isArray(products), "Warehouse /products did not return an array");

  const inStock = products.filter(
    (item) =>
      item &&
      typeof item === "object" &&
      typeof item.id === "string" &&
      typeof item.name === "string" &&
      typeof item.price === "number" &&
      typeof item.stock === "number" &&
      item.stock > 0
  );

  assert(inStock.length >= 2, "Need at least 2 in-stock products for smoke checkout");
  return inStock;
}

function buildOrderItems(products) {
  return products.slice(0, 2).map((product) => ({
    productId: product.id,
    name: product.name,
    price: product.price,
    quantity: 1
  }));
}

async function getOrderById(orderId, customerToken) {
  return requestJson(`${config.ordersUrl}/orders/${orderId}`, {
    headers: authHeader(customerToken)
  });
}

async function getDeliveryByOrder(orderId) {
  return requestJson(`${config.deliveryUrl}/delivery/${orderId}`);
}

async function patchDeliveryStatus(orderId, status) {
  return requestJson(`${config.deliveryUrl}/delivery/${orderId}/status`, {
    method: "PATCH",
    body: { status }
  });
}

async function main() {
  step("1/8 Health check");
  await healthCheck();
  console.log("[smoke] health ok");

  step("2/8 Login as customer/admin/courier");
  const customerLogin = await login(config.customerEmail, config.customerPassword, "customer");
  const adminLogin = await login(config.adminEmail, config.adminPassword, "admin");
  const courierLogin = await login(config.courierEmail, config.courierPassword, "courier");
  console.log(
    `[smoke] logins ok: customer=${customerLogin.user?.email}, admin=${adminLogin.user?.email}, courier=${courierLogin.user?.email}`
  );

  step("3/8 Create customer order");
  const products = await fetchProducts();
  const items = buildOrderItems(products);
  const createdOrder = await requestJson(`${config.ordersUrl}/orders`, {
    method: "POST",
    headers: authHeader(customerLogin.accessToken),
    body: { items }
  });
  assert(typeof createdOrder?.id === "string", "Order create response missing id");
  console.log(`[smoke] order created: ${createdOrder.id}`);

  step("4/8 Wait for delivery assignment");
  const route = await waitFor("delivery route assignment", async () => {
    const value = await getDeliveryByOrder(createdOrder.id);
    if (!value || typeof value !== "object") {
      throw new Error("invalid delivery payload");
    }
    return value;
  });
  assert(typeof route?.courierId === "string" && route.courierId.length > 0, "Route missing courierId");
  console.log(`[smoke] assigned courier: ${route.courierName} (${route.courierId}), status=${route.status}`);

  step("5/8 Validate courier active deliveries");
  const courierActive = await requestJson(`${config.deliveryUrl}/delivery/courier/${route.courierId}/active`);
  assert(Array.isArray(courierActive), "Courier active endpoint must return array");
  assert(
    courierActive.some((item) => item.orderId === createdOrder.id),
    "Assigned order not found in courier active list"
  );
  console.log("[smoke] courier active list contains new order");

  step("6/8 Progress delivery statuses (cooking -> delivery -> done)");
  const currentStatus = route.status;
  if (currentStatus === "cooking") {
    await patchDeliveryStatus(createdOrder.id, "delivery");
  } else if (currentStatus === "delivery") {
    // no-op, already in delivery
  } else if (currentStatus === "done") {
    // no-op, already done
  } else {
    throw new Error(`Unexpected initial delivery status: ${currentStatus}`);
  }

  await waitFor("order status delivery", async () => {
    const order = await getOrderById(createdOrder.id, customerLogin.accessToken);
    if (order.status !== "delivery" && order.status !== "done") {
      throw new Error(`status=${order.status}`);
    }
    return order;
  });

  await patchDeliveryStatus(createdOrder.id, "done");

  const doneOrder = await waitFor("order status done", async () => {
    const order = await getOrderById(createdOrder.id, customerLogin.accessToken);
    if (order.status !== "done") {
      throw new Error(`status=${order.status}`);
    }
    return order;
  });
  console.log(`[smoke] order completed: ${doneOrder.id}`);

  step("7/8 Validate admin dashboard metrics endpoint");
  const metrics = await requestJson(`${config.ordersUrl}/orders/admin/dashboard-metrics`, {
    headers: authHeader(adminLogin.accessToken)
  });
  const requiredKeys = ["activeOrders", "completedToday", "revenueToday", "topProducts"];
  for (const key of requiredKeys) {
    assert(Object.prototype.hasOwnProperty.call(metrics ?? {}, key), `Metrics missing key: ${key}`);
  }
  assert(Array.isArray(metrics.topProducts), "Metrics topProducts must be array");
  console.log("[smoke] admin metrics payload is valid");

  step("8/8 Validate courier route endpoint");
  const optimizedRoute = await requestJson(`${config.deliveryUrl}/delivery/route/${route.courierId}`);
  assert(typeof optimizedRoute?.courierId === "string", "Optimized route missing courierId");
  assert(Array.isArray(optimizedRoute?.assignedOrders), "Optimized route missing assignedOrders");
  console.log("[smoke] optimized route endpoint is valid");

  console.log("\n[smoke] ✅ Critical scenario passed");
  console.log(`[smoke] Order tested: ${createdOrder.id}`);
}

main().catch((error) => {
  console.error(`\n[smoke] ❌ ${error.message}`);
  process.exit(1);
});
