import express from "express";
import { Markup, Telegraf, type Context } from "telegraf";
import WebSocket from "ws";

type Role = "Customer" | "Courier" | "Admin";
type OrderStatus = "pending" | "cooking" | "delivery" | "done";
type DeliveryStatus = "assigned" | "cooking" | "delivery" | "done";

interface User {
  id: string;
  email: string;
  role: Role;
}

interface AuthResponse {
  accessToken: string;
  user: User;
}

interface OrderItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  lineTotal: number;
}

interface OrderRecord {
  id: string;
  userId: string;
  status: OrderStatus;
  address: string;
  lat: number;
  lng: number;
  total: number;
  createdAt: string;
  updatedAt: string;
  items: OrderItem[];
  delivery?: {
    courierId: string;
    courierName: string;
    address: string;
    etaMinutes: number;
    status: DeliveryStatus;
    updatedAt: string;
  };
}

interface DashboardMetrics {
  activeOrders: number;
  completedToday: number;
  averageEta: number;
  activeCouriers: number;
  revenueToday: number;
  topProducts: Array<{ name: string; count: number }>;
  ordersPerHour: Array<{ hour: string; value: number }>;
  revenuePerHour: Array<{ hour: string; value: number }>;
  updatedAt: string;
}

interface Courier {
  id: string;
  email: string;
  name: string;
  lat: number;
  lng: number;
  isAvailable: boolean;
}

interface DeliveryStats {
  activeRoutes: number;
  completedRoutes: number;
  averageEtaMinutes: number;
  couriers: Array<{
    courierId: string;
    courierName: string;
    activeCount: number;
    completedCount: number;
    avgDeliveryMinutes: number;
  }>;
}

interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  stock: number;
}

interface DeliveryRoute {
  orderId: string;
  courierId: string;
  courierName: string;
  address: string;
  etaMinutes: number;
  status: DeliveryStatus;
  updatedAt: string;
}

interface OrderLiveMessage {
  type: "order.updated";
  emittedAt: string;
  order: OrderRecord;
}

interface AdminSession {
  token?: string;
  user?: User;
  loginStep?: "email" | "password";
  pendingEmail?: string;
  ordersWs?: WebSocket;
  reconnectTimer?: NodeJS.Timeout;
  pollingTimer?: NodeJS.Timeout;
  lastOrderStatuses: Map<string, OrderStatus>;
  lastOrderCouriers: Map<string, string>;
}

class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const PORT = Number(process.env.PORT ?? 3009);
const TELEGRAM_BOT_TOKEN = process.env.ADMIN_TELEGRAM_BOT_TOKEN ?? "";
const TELEGRAM_WEBHOOK_URL = process.env.ADMIN_TELEGRAM_WEBHOOK_URL?.trim();
const AUTH_API_URL = process.env.AUTH_API_URL ?? "http://127.0.0.1:3001";
const ORDERS_API_URL = process.env.ORDERS_API_URL ?? "http://127.0.0.1:3002";
const DELIVERY_API_URL = process.env.DELIVERY_API_URL ?? "http://127.0.0.1:3004";
const WAREHOUSE_API_URL = process.env.WAREHOUSE_API_URL ?? "http://127.0.0.1:3003";
const WEBHOOK_PATH = "/telegram/webhook";
const POLLING_INTERVAL_MS = 15_000;
const MAX_TEXT_CHUNK = 3400;

const sessions = new Map<number, AdminSession>();

function swapLoopbackHost(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.hostname === "localhost") {
      parsed.hostname = "127.0.0.1";
      return parsed.toString().replace(/\/+$/, "");
    }
    if (parsed.hostname === "127.0.0.1") {
      parsed.hostname = "localhost";
      return parsed.toString().replace(/\/+$/, "");
    }
    return null;
  } catch {
    return null;
  }
}

function getBaseUrlCandidates(baseUrl: string) {
  const clean = baseUrl.replace(/\/+$/, "");
  const alt = swapLoopbackHost(clean);
  return alt && alt !== clean ? [clean, alt] : [clean];
}

function getSession(chatId: number) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, {
      lastOrderStatuses: new Map(),
      lastOrderCouriers: new Map()
    });
  }
  return sessions.get(chatId)!;
}

function clearWebSocket(session: AdminSession) {
  if (session.reconnectTimer) {
    clearTimeout(session.reconnectTimer);
    session.reconnectTimer = undefined;
  }

  if (session.ordersWs) {
    try {
      session.ordersWs.close();
    } catch {
      // Ignore close errors.
    }
    session.ordersWs = undefined;
  }
}

function clearPolling(session: AdminSession) {
  if (session.pollingTimer) {
    clearInterval(session.pollingTimer);
    session.pollingTimer = undefined;
  }
}

function clearLiveTracking(session: AdminSession) {
  clearWebSocket(session);
  clearPolling(session);
}

function formatMoney(value: number) {
  return `$${value.toFixed(2)}`;
}

function shortId(value: string) {
  return value.length > 8 ? value.slice(0, 8) : value;
}

function statusLabel(status: string) {
  switch (status) {
    case "pending":
      return "pending";
    case "cooking":
      return "cooking";
    case "delivery":
      return "delivery";
    case "done":
      return "done";
    case "assigned":
      return "assigned";
    default:
      return status;
  }
}

function extractCommandArgs(text?: string) {
  if (!text) {
    return [];
  }
  return text
    .trim()
    .split(/\s+/)
    .slice(1);
}

function buildMessageError(responseBody: unknown, fallback: string) {
  if (!responseBody || typeof responseBody !== "object") {
    return fallback;
  }

  const message = (responseBody as { message?: unknown }).message;
  if (Array.isArray(message)) {
    return message.join(", ");
  }
  if (typeof message === "string") {
    return message;
  }

  return fallback;
}

function authHeaders(token?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function isUnauthorizedError(error: unknown) {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

function mainMenuKeyboard() {
  return Markup.keyboard([
    ["/dashboard", "/orders"],
    ["/couriers", "/products"],
    ["/help", "/login"]
  ]).resize();
}

function helpText() {
  return [
    "FOODO Admin Bot",
    "",
    "Commands:",
    "/start - start/login",
    "/login - login as admin",
    "/dashboard - live business metrics",
    "/orders [status] - list orders (all|pending|cooking|delivery|done)",
    "/order <order_id> - order details",
    "/setstatus <order_id> <status> - admin override",
    "/couriers - courier stats",
    "/assign <order_id> <courier_id> - manual courier assignment",
    "/products - low stock products",
    "/help - this message"
  ].join("\n");
}

async function sendChunkedReply(ctx: Context, text: string) {
  if (text.length <= MAX_TEXT_CHUNK) {
    await ctx.reply(text);
    return;
  }

  const lines = text.split("\n");
  let buffer = "";
  for (const line of lines) {
    if ((buffer + line + "\n").length > MAX_TEXT_CHUNK) {
      await ctx.reply(buffer);
      buffer = "";
    }
    buffer += `${line}\n`;
  }

  if (buffer.trim()) {
    await ctx.reply(buffer);
  }
}

async function requestJson<T>(
  baseUrl: string,
  path: string,
  init: RequestInit,
  errorFallback: string
): Promise<T> {
  const candidates = getBaseUrlCandidates(baseUrl);
  let lastError: unknown = null;

  for (const candidate of candidates) {
    try {
      const response = await fetch(`${candidate}${path}`, init);
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      if (!response.ok) {
        throw new ApiError(response.status, buildMessageError(payload, `HTTP ${response.status}`));
      }

      return payload as T;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error(errorFallback);
}

async function authLogin(email: string, password: string) {
  return requestJson<AuthResponse>(
    AUTH_API_URL,
    "/auth/login",
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ email, password })
    },
    "Auth service is unavailable"
  );
}

async function fetchDashboardMetrics(token: string) {
  return requestJson<DashboardMetrics>(
    ORDERS_API_URL,
    "/orders/admin/dashboard-metrics",
    {
      method: "GET",
      headers: authHeaders(token)
    },
    "Dashboard metrics are unavailable"
  );
}

async function fetchAdminOrders(token: string, status?: string) {
  const query = status && status !== "all" ? `?status=${encodeURIComponent(status)}` : "";
  return requestJson<OrderRecord[]>(
    ORDERS_API_URL,
    `/orders/admin${query}`,
    {
      method: "GET",
      headers: authHeaders(token)
    },
    "Orders are unavailable"
  );
}

async function fetchOrderById(orderId: string, token: string) {
  return requestJson<OrderRecord>(
    ORDERS_API_URL,
    `/orders/${orderId}`,
    {
      method: "GET",
      headers: authHeaders(token)
    },
    "Order lookup failed"
  );
}

async function updateAdminOrderStatus(orderId: string, status: OrderStatus, token: string) {
  return requestJson<OrderRecord>(
    ORDERS_API_URL,
    `/orders/${orderId}/admin-status`,
    {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify({ status })
    },
    "Order status update failed"
  );
}

async function fetchCouriers(token: string) {
  return requestJson<Courier[]>(
    DELIVERY_API_URL,
    "/delivery/couriers",
    {
      method: "GET",
      headers: authHeaders(token)
    },
    "Courier list is unavailable"
  );
}

async function fetchDeliveryStats(token: string) {
  return requestJson<DeliveryStats>(
    DELIVERY_API_URL,
    "/delivery/stats",
    {
      method: "GET",
      headers: authHeaders(token)
    },
    "Delivery stats are unavailable"
  );
}

async function assignCourierManual(order: OrderRecord, courierId: string, token: string) {
  return requestJson<DeliveryRoute>(
    DELIVERY_API_URL,
    "/delivery/assign/manual",
    {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        orderId: order.id,
        userId: order.userId,
        address: order.address,
        lat: order.lat,
        lng: order.lng,
        total: order.total,
        items: order.items.map((item) => ({
          productId: item.productId,
          name: item.name,
          price: item.price,
          quantity: item.quantity
        })),
        courierId
      })
    },
    "Manual assignment failed"
  );
}

async function fetchProducts() {
  return requestJson<Product[]>(
    WAREHOUSE_API_URL,
    "/products",
    {
      method: "GET"
    },
    "Warehouse service is unavailable"
  );
}

async function openOrdersWebSocket(token: string) {
  const candidates = getBaseUrlCandidates(ORDERS_API_URL);

  for (const candidate of candidates) {
    const wsUrl = `${candidate.replace(/^http/, "ws")}/orders/ws?token=${encodeURIComponent(token)}`;

    try {
      const ws = await new Promise<WebSocket>((resolve, reject) => {
        const socket = new WebSocket(wsUrl);
        const timeout = setTimeout(() => {
          socket.terminate();
          reject(new Error("WS connect timeout"));
        }, 4_000);

        socket.once("open", () => {
          clearTimeout(timeout);
          resolve(socket);
        });

        socket.once("error", (error: Error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

      return ws;
    } catch {
      // Try next candidate.
    }
  }

  return null;
}

async function notifyOrderUpdate(
  bot: Telegraf<Context>,
  chatId: number,
  order: OrderRecord,
  previousStatus?: OrderStatus
) {
  const prefix = previousStatus ? "🔔 Order updated" : "🆕 New order";
  const statusPart = previousStatus
    ? `${statusLabel(previousStatus)} -> ${statusLabel(order.status)}`
    : statusLabel(order.status);
  const courierPart = order.delivery?.courierName
    ? `\nCourier: ${order.delivery.courierName}`
    : "";
  const etaPart = order.delivery?.etaMinutes
    ? `\nETA: ${order.delivery.etaMinutes} min`
    : "";

  await bot.telegram.sendMessage(
    chatId,
    `${prefix} #${shortId(order.id)}\nStatus: ${statusPart}\nTotal: ${formatMoney(order.total)}${courierPart}${etaPart}`
  );
}

async function trackOrderUpdate(
  bot: Telegraf<Context>,
  chatId: number,
  order: OrderRecord,
  options?: { silentNewOrder?: boolean }
) {
  const session = getSession(chatId);
  const previousStatus = session.lastOrderStatuses.get(order.id);
  const previousCourier = session.lastOrderCouriers.get(order.id);
  const nextCourier = order.delivery?.courierId ?? "";

  session.lastOrderStatuses.set(order.id, order.status);
  session.lastOrderCouriers.set(order.id, nextCourier);

  if (!previousStatus) {
    if (!options?.silentNewOrder) {
      await notifyOrderUpdate(bot, chatId, order);
    }
    return;
  }

  if (previousStatus !== order.status) {
    await notifyOrderUpdate(bot, chatId, order, previousStatus);
    return;
  }

  if (previousCourier !== nextCourier && nextCourier) {
    await bot.telegram.sendMessage(
      chatId,
      `📦 Courier assigned for #${shortId(order.id)}: ${order.delivery?.courierName ?? "Unknown courier"}`
    );
  }
}

async function pollAdminOrders(
  bot: Telegraf<Context>,
  chatId: number,
  options?: { silentNewOrder?: boolean }
) {
  const session = getSession(chatId);
  if (!session.token || !session.user) {
    return;
  }

  try {
    const orders = await fetchAdminOrders(session.token);

    for (const order of orders.slice(0, 20)) {
      await trackOrderUpdate(bot, chatId, order, options);
    }
  } catch (error) {
    if (isUnauthorizedError(error)) {
      clearLiveTracking(session);
      session.token = undefined;
      session.user = undefined;
      session.loginStep = undefined;
      session.pendingEmail = undefined;
      session.lastOrderStatuses.clear();
      session.lastOrderCouriers.clear();
      await bot.telegram.sendMessage(chatId, "Session expired. Please login again with /login.");
    }
  }
}

function startPolling(chatId: number, bot: Telegraf<Context>) {
  const session = getSession(chatId);
  clearPolling(session);

  void pollAdminOrders(bot, chatId, { silentNewOrder: true });

  session.pollingTimer = setInterval(() => {
    void pollAdminOrders(bot, chatId);
  }, POLLING_INTERVAL_MS);
}

async function ensureOrdersWatcher(chatId: number, bot: Telegraf<Context>) {
  const session = getSession(chatId);
  const token = session.token;
  clearWebSocket(session);

  if (!token) {
    return;
  }

  const socket = await openOrdersWebSocket(token);
  if (!socket) {
    session.reconnectTimer = setTimeout(() => {
      void ensureOrdersWatcher(chatId, bot);
    }, 5_000);
    return;
  }

  session.ordersWs = socket;

  socket.on("message", (raw: WebSocket.RawData) => {
    const payloadText = String(raw ?? "");

    try {
      const payload = JSON.parse(payloadText) as OrderLiveMessage;
      if (payload.type !== "order.updated" || !payload.order) {
        return;
      }

      void trackOrderUpdate(bot, chatId, payload.order).catch(() => undefined);
    } catch {
      // Ignore malformed messages.
    }
  });

  socket.on("close", () => {
    const currentSession = getSession(chatId);
    currentSession.ordersWs = undefined;

    if (!currentSession.token) {
      return;
    }

    currentSession.reconnectTimer = setTimeout(() => {
      void ensureOrdersWatcher(chatId, bot);
    }, 5_000);
  });

  socket.on("error", () => {
    // Reconnect is handled by close event.
  });
}

function startLiveTracking(chatId: number, bot: Telegraf<Context>) {
  startPolling(chatId, bot);
  void ensureOrdersWatcher(chatId, bot);
}

function requireAuth(ctx: Context, chatId: number) {
  const session = getSession(chatId);
  if (!session.token || !session.user) {
    void ctx.reply("Please login first: /login", mainMenuKeyboard());
    return null;
  }

  if (session.user.role !== "Admin") {
    void ctx.reply("This bot is for Admin accounts only.");
    return null;
  }

  return session;
}

const bot = TELEGRAM_BOT_TOKEN ? new Telegraf(TELEGRAM_BOT_TOKEN) : null;

if (!bot) {
  console.warn("ADMIN_TELEGRAM_BOT_TOKEN is not set. Admin Telegram bot is disabled.");
} else {
  async function performLogin(ctx: Context, chatId: number, email: string, password: string) {
    const session = getSession(chatId);

    try {
      const auth = await authLogin(email, password);
      if (auth.user.role !== "Admin") {
        session.loginStep = undefined;
        session.pendingEmail = undefined;
        await ctx.reply("❌ This bot accepts only Admin accounts.");
        return;
      }

      clearLiveTracking(session);
      session.token = auth.accessToken;
      session.user = auth.user;
      session.loginStep = undefined;
      session.pendingEmail = undefined;
      session.lastOrderStatuses.clear();
      session.lastOrderCouriers.clear();

      await ctx.reply(
        `✅ Logged in as ${auth.user.email} (${auth.user.role}).\n${helpText()}`,
        mainMenuKeyboard()
      );

      startLiveTracking(chatId, bot!);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Login failed";
      await ctx.reply(`❌ ${message}`);
    }
  }

  bot.start(async (ctx) => {
    if (!ctx.chat) {
      return;
    }

    const chatId = ctx.chat.id;
    const session = getSession(chatId);
    session.loginStep = "email";
    session.pendingEmail = undefined;

    await ctx.reply("FOODO Admin Bot\n\nEnter admin email:", mainMenuKeyboard());
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(helpText(), mainMenuKeyboard());
  });

  bot.command("login", async (ctx) => {
    if (!ctx.chat) {
      return;
    }

    const chatId = ctx.chat.id;
    const session = getSession(chatId);
    session.loginStep = "email";
    session.pendingEmail = undefined;

    await ctx.reply("Enter admin email:", mainMenuKeyboard());
  });

  bot.command("dashboard", async (ctx) => {
    if (!ctx.chat) {
      return;
    }

    const chatId = ctx.chat.id;
    const session = requireAuth(ctx, chatId);
    if (!session) {
      return;
    }

    try {
      const metrics = await fetchDashboardMetrics(session.token!);
      const top = metrics.topProducts.length
        ? metrics.topProducts.map((item, index) => `${index + 1}. ${item.name} x${item.count}`).join("\n")
        : "No sales in last 24h";

      await ctx.reply(
        [
          "📊 Admin dashboard",
          `Active orders: ${metrics.activeOrders}`,
          `Completed today: ${metrics.completedToday}`,
          `Average ETA: ${metrics.averageEta} min`,
          `Active couriers: ${metrics.activeCouriers}`,
          `Revenue today: ${formatMoney(metrics.revenueToday)}`,
          "",
          "Top products (24h):",
          top,
          "",
          `Updated: ${new Date(metrics.updatedAt).toLocaleString()}`
        ].join("\n")
      );
    } catch (error) {
      if (isUnauthorizedError(error)) {
        clearLiveTracking(session);
        session.token = undefined;
        session.user = undefined;
        session.lastOrderStatuses.clear();
        session.lastOrderCouriers.clear();
        await ctx.reply("Session expired. Please login again with /login.");
        return;
      }

      const message = error instanceof Error ? error.message : "Cannot load dashboard";
      await ctx.reply(`❌ ${message}`);
    }
  });

  bot.command("orders", async (ctx) => {
    if (!ctx.chat) {
      return;
    }

    const chatId = ctx.chat.id;
    const session = requireAuth(ctx, chatId);
    if (!session) {
      return;
    }

    const args = extractCommandArgs((ctx.message as { text?: string })?.text);
    const status = args[0]?.toLowerCase();
    const allowedStatuses = new Set(["all", "pending", "cooking", "delivery", "done"]);

    if (status && !allowedStatuses.has(status)) {
      await ctx.reply("Usage: /orders [all|pending|cooking|delivery|done]");
      return;
    }

    try {
      const orders = await fetchAdminOrders(session.token!, status);
      if (!orders.length) {
        await ctx.reply("No orders found.");
        return;
      }

      const lines = orders.slice(0, 15).map((order) => {
        session.lastOrderStatuses.set(order.id, order.status);
        session.lastOrderCouriers.set(order.id, order.delivery?.courierId ?? "");
        const courier = order.delivery?.courierName ? `, courier ${order.delivery.courierName}` : "";
        return `#${shortId(order.id)} • ${statusLabel(order.status)} • ${formatMoney(order.total)}${courier}`;
      });

      await sendChunkedReply(
        ctx,
        `📋 Orders (${orders.length})${status ? ` [${status}]` : ""}\n\n${lines.join("\n")}\n\nDetails: /order <order_id>`
      );
    } catch (error) {
      if (isUnauthorizedError(error)) {
        clearLiveTracking(session);
        session.token = undefined;
        session.user = undefined;
        session.lastOrderStatuses.clear();
        session.lastOrderCouriers.clear();
        await ctx.reply("Session expired. Please login again with /login.");
        return;
      }

      const message = error instanceof Error ? error.message : "Cannot load orders";
      await ctx.reply(`❌ ${message}`);
    }
  });

  bot.command("order", async (ctx) => {
    if (!ctx.chat) {
      return;
    }

    const chatId = ctx.chat.id;
    const session = requireAuth(ctx, chatId);
    if (!session) {
      return;
    }

    const args = extractCommandArgs((ctx.message as { text?: string })?.text);
    const orderId = args[0];

    if (!orderId) {
      await ctx.reply("Usage: /order <order_id>");
      return;
    }

    try {
      const order = await fetchOrderById(orderId, session.token!);
      session.lastOrderStatuses.set(order.id, order.status);
      session.lastOrderCouriers.set(order.id, order.delivery?.courierId ?? "");

      const items = order.items.length
        ? order.items
            .map((item) => `${item.name} x${item.quantity} = ${formatMoney(item.lineTotal)}`)
            .join("\n")
        : "No items";

      const delivery = order.delivery
        ? [
            `Courier: ${order.delivery.courierName}`,
            `ETA: ${order.delivery.etaMinutes} min`,
            `Delivery status: ${statusLabel(order.delivery.status)}`,
            `Delivery address: ${order.delivery.address}`
          ].join("\n")
        : "Courier: not assigned";

      await sendChunkedReply(
        ctx,
        [
          `📦 Order ${order.id}`,
          `User: ${order.userId}`,
          `Status: ${statusLabel(order.status)}`,
          `Total: ${formatMoney(order.total)}`,
          `Address: ${order.address}`,
          delivery,
          "",
          "Items:",
          items
        ].join("\n")
      );
    } catch (error) {
      if (isUnauthorizedError(error)) {
        clearLiveTracking(session);
        session.token = undefined;
        session.user = undefined;
        session.lastOrderStatuses.clear();
        session.lastOrderCouriers.clear();
        await ctx.reply("Session expired. Please login again with /login.");
        return;
      }

      const message = error instanceof Error ? error.message : "Cannot load order details";
      await ctx.reply(`❌ ${message}`);
    }
  });

  bot.command("setstatus", async (ctx) => {
    if (!ctx.chat) {
      return;
    }

    const chatId = ctx.chat.id;
    const session = requireAuth(ctx, chatId);
    if (!session) {
      return;
    }

    const args = extractCommandArgs((ctx.message as { text?: string })?.text);
    const [orderId, statusRaw] = args;
    const status = statusRaw as OrderStatus | undefined;
    const valid = new Set<OrderStatus>(["pending", "cooking", "delivery", "done"]);

    if (!orderId || !status || !valid.has(status)) {
      await ctx.reply("Usage: /setstatus <order_id> <pending|cooking|delivery|done>");
      return;
    }

    try {
      const updated = await updateAdminOrderStatus(orderId, status, session.token!);
      session.lastOrderStatuses.set(updated.id, updated.status);
      session.lastOrderCouriers.set(updated.id, updated.delivery?.courierId ?? "");
      await ctx.reply(`✅ Order #${shortId(updated.id)} -> ${statusLabel(updated.status)}`);
    } catch (error) {
      if (isUnauthorizedError(error)) {
        clearLiveTracking(session);
        session.token = undefined;
        session.user = undefined;
        session.lastOrderStatuses.clear();
        session.lastOrderCouriers.clear();
        await ctx.reply("Session expired. Please login again with /login.");
        return;
      }

      const message = error instanceof Error ? error.message : "Cannot set status";
      await ctx.reply(`❌ ${message}`);
    }
  });

  bot.command("couriers", async (ctx) => {
    if (!ctx.chat) {
      return;
    }

    const chatId = ctx.chat.id;
    const session = requireAuth(ctx, chatId);
    if (!session) {
      return;
    }

    try {
      const [couriers, stats] = await Promise.all([
        fetchCouriers(session.token!),
        fetchDeliveryStats(session.token!)
      ]);

      const byId = new Map(stats.couriers.map((item) => [item.courierId, item]));
      const lines = couriers.map((courier) => {
        const stat = byId.get(courier.id);
        const active = stat?.activeCount ?? 0;
        const completed = stat?.completedCount ?? 0;
        const avg = stat?.avgDeliveryMinutes ?? 0;
        return `${courier.id}\n${courier.name} (${courier.isAvailable ? "free" : "busy"})\nactive ${active}, done ${completed}, avg ${avg} min`;
      });

      await sendChunkedReply(
        ctx,
        [
          `🚚 Couriers (${couriers.length})`,
          `Active routes: ${stats.activeRoutes}`,
          `Completed routes: ${stats.completedRoutes}`,
          `Average ETA: ${stats.averageEtaMinutes} min`,
          "",
          lines.join("\n\n")
        ].join("\n")
      );
    } catch (error) {
      if (isUnauthorizedError(error)) {
        clearLiveTracking(session);
        session.token = undefined;
        session.user = undefined;
        session.lastOrderStatuses.clear();
        session.lastOrderCouriers.clear();
        await ctx.reply("Session expired. Please login again with /login.");
        return;
      }

      const message = error instanceof Error ? error.message : "Cannot load couriers";
      await ctx.reply(`❌ ${message}`);
    }
  });

  bot.command("assign", async (ctx) => {
    if (!ctx.chat) {
      return;
    }

    const chatId = ctx.chat.id;
    const session = requireAuth(ctx, chatId);
    if (!session) {
      return;
    }

    const args = extractCommandArgs((ctx.message as { text?: string })?.text);
    const [orderId, courierId] = args;

    if (!orderId || !courierId) {
      await ctx.reply("Usage: /assign <order_id> <courier_id>");
      return;
    }

    try {
      const order = await fetchOrderById(orderId, session.token!);
      const route = await assignCourierManual(order, courierId, session.token!);

      session.lastOrderCouriers.set(route.orderId, route.courierId);
      await ctx.reply(
        `✅ Courier assigned\nOrder: #${shortId(route.orderId)}\nCourier: ${route.courierName}\nETA: ${route.etaMinutes} min`
      );
    } catch (error) {
      if (isUnauthorizedError(error)) {
        clearLiveTracking(session);
        session.token = undefined;
        session.user = undefined;
        session.lastOrderStatuses.clear();
        session.lastOrderCouriers.clear();
        await ctx.reply("Session expired. Please login again with /login.");
        return;
      }

      const message = error instanceof Error ? error.message : "Cannot assign courier";
      await ctx.reply(`❌ ${message}`);
    }
  });

  bot.command("products", async (ctx) => {
    if (!ctx.chat) {
      return;
    }

    const chatId = ctx.chat.id;
    const session = requireAuth(ctx, chatId);
    if (!session) {
      return;
    }

    try {
      const products = await fetchProducts();
      if (!products.length) {
        await ctx.reply("No products found.");
        return;
      }

      const lowStock = products
        .slice()
        .sort((a, b) => a.stock - b.stock)
        .slice(0, 12)
        .map((product) => `${product.id}\n${product.name} • ${product.category} • stock ${product.stock} • ${formatMoney(product.price)}`);

      await sendChunkedReply(
        ctx,
        `📦 Low stock products\n\n${lowStock.join("\n\n")}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cannot load products";
      await ctx.reply(`❌ ${message}`);
    }
  });

  bot.on("text", async (ctx) => {
    if (!ctx.chat || !ctx.message || !("text" in ctx.message)) {
      return;
    }

    const text = ctx.message.text.trim();
    if (text.startsWith("/")) {
      return;
    }

    const chatId = ctx.chat.id;
    const session = getSession(chatId);

    if (session.loginStep === "email") {
      session.pendingEmail = text;
      session.loginStep = "password";
      await ctx.reply("Enter password:");
      return;
    }

    if (session.loginStep === "password") {
      const email = session.pendingEmail;
      session.pendingEmail = undefined;
      session.loginStep = undefined;

      if (!email) {
        await ctx.reply("Please run /login again.");
        return;
      }

      await performLogin(ctx, chatId, email, text);
    }
  });
}

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ service: "tg-admin-bot", status: "ok" });
});

if (bot) {
  app.post(WEBHOOK_PATH, bot.webhookCallback(WEBHOOK_PATH));
} else {
  app.post(WEBHOOK_PATH, (_req, res) => {
    res.status(503).json({ message: "ADMIN_TELEGRAM_BOT_TOKEN is not configured" });
  });
}

const server = app.listen(PORT, async () => {
  console.log(`tg-admin-bot listening on ${PORT}`);

  if (!bot) {
    return;
  }

  try {
    await bot.telegram.setMyCommands([
      { command: "start", description: "Start admin login flow" },
      { command: "login", description: "Login as admin" },
      { command: "help", description: "Show command help" },
      { command: "dashboard", description: "Admin dashboard metrics" },
      { command: "orders", description: "List orders: /orders [status]" },
      { command: "order", description: "Order details: /order <id>" },
      { command: "setstatus", description: "Set status: /setstatus <id> <status>" },
      { command: "couriers", description: "Courier list and stats" },
      { command: "assign", description: "Assign courier: /assign <order> <courier>" },
      { command: "products", description: "Low stock products" }
    ]);

    if (!TELEGRAM_WEBHOOK_URL) {
      console.log(
        "ADMIN_TELEGRAM_WEBHOOK_URL is not set. Configure webhook externally to use POST /telegram/webhook."
      );
      return;
    }

    const webhook = `${TELEGRAM_WEBHOOK_URL.replace(/\/+$/, "")}${WEBHOOK_PATH}`;
    await bot.telegram.setWebhook(webhook);
    console.log(`Admin Telegram webhook configured: ${webhook}`);
  } catch (error) {
    console.error(`Failed to configure admin bot webhook: ${(error as Error).message}`);
  }
});

function shutdown() {
  for (const session of sessions.values()) {
    clearLiveTracking(session);
  }

  server.close(() => {
    process.exit(0);
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
