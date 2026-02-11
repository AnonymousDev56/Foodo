import express from "express";
import { Markup, Telegraf, type Context } from "telegraf";
import WebSocket from "ws";

type Role = "Customer" | "Courier" | "Admin";
type DeliveryStatus = "assigned" | "cooking" | "delivery" | "done";
type OrderStatus = "pending" | "cooking" | "delivery" | "done";

interface User {
  id: string;
  email: string;
  role: Role;
}

interface AuthResponse {
  accessToken: string;
  user: User;
}

interface DeliveryItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
}

interface DeliveryRoute {
  id: string;
  orderId: string;
  userId: string;
  courierId: string;
  courierName: string;
  address: string;
  etaMinutes: number;
  status: DeliveryStatus;
  total: number;
  items: DeliveryItem[];
  createdAt: string;
  updatedAt: string;
}

interface DeliveryLiveMessage {
  type: "delivery.updated";
  emittedAt: string;
  route: DeliveryRoute;
}

interface CourierSession {
  token?: string;
  user?: User;
  loginStep?: "email" | "password";
  pendingEmail?: string;
  deliveryWs?: WebSocket;
  reconnectTimer?: NodeJS.Timeout;
  pollingTimer?: NodeJS.Timeout;
  lastRouteStatuses: Map<string, DeliveryStatus>;
}

class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const PORT = Number(process.env.PORT ?? 3007);
const TELEGRAM_BOT_TOKEN = process.env.COURIER_TELEGRAM_BOT_TOKEN ?? "";
const TELEGRAM_WEBHOOK_URL = process.env.COURIER_TELEGRAM_WEBHOOK_URL?.trim();
const AUTH_API_URL = process.env.AUTH_API_URL ?? "http://127.0.0.1:3001";
const DELIVERY_API_URL = process.env.DELIVERY_API_URL ?? "http://127.0.0.1:3004";
const ORDERS_API_URL = process.env.ORDERS_API_URL ?? "http://127.0.0.1:3002";
const WEBHOOK_PATH = "/telegram/webhook";
const POLLING_INTERVAL_MS = 15_000;
const MAX_TEXT_CHUNK = 3400;

const sessions = new Map<number, CourierSession>();

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
      lastRouteStatuses: new Map()
    });
  }
  return sessions.get(chatId)!;
}

function clearWebSocket(session: CourierSession) {
  if (session.reconnectTimer) {
    clearTimeout(session.reconnectTimer);
    session.reconnectTimer = undefined;
  }

  if (session.deliveryWs) {
    try {
      session.deliveryWs.close();
    } catch {
      // Ignore close errors.
    }
    session.deliveryWs = undefined;
  }
}

function clearPolling(session: CourierSession) {
  if (session.pollingTimer) {
    clearInterval(session.pollingTimer);
    session.pollingTimer = undefined;
  }
}

function clearLiveTracking(session: CourierSession) {
  clearWebSocket(session);
  clearPolling(session);
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

function shortId(value: string) {
  return value.length > 8 ? value.slice(0, 8) : value;
}

function statusLabel(status: DeliveryStatus | OrderStatus) {
  switch (status) {
    case "assigned":
      return "assigned";
    case "pending":
      return "pending";
    case "cooking":
      return "cooking";
    case "delivery":
      return "delivery";
    case "done":
      return "done";
    default:
      return status;
  }
}

function formatMoney(value: number) {
  return `$${value.toFixed(2)}`;
}

function toOrderStatus(status: DeliveryStatus): OrderStatus {
  switch (status) {
    case "assigned":
      return "pending";
    case "cooking":
      return "cooking";
    case "delivery":
      return "delivery";
    case "done":
      return "done";
    default:
      return "pending";
  }
}

function mainMenuKeyboard() {
  return Markup.keyboard([
    ["/deliveries", "/help"],
    ["/accept", "/pickup", "/deliver"],
    ["/login"]
  ]).resize();
}

function helpText() {
  return [
    "FOODO Courier Bot",
    "",
    "Commands:",
    "/start - start login flow",
    "/login - login again",
    "/deliveries - my active deliveries",
    "/details <order_id> - full delivery info",
    "/accept <order_id> - accept delivery (assigned -> cooking)",
    "/pickup <order_id> - picked up (cooking -> delivery)",
    "/deliver <order_id> - delivered (delivery -> done)",
    "/help - show this menu"
  ].join("\n");
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

async function fetchCourierActiveRoutes(courierId: string, token: string) {
  return requestJson<DeliveryRoute[]>(
    DELIVERY_API_URL,
    `/delivery/courier/${courierId}/active`,
    {
      method: "GET",
      headers: authHeaders(token)
    },
    "Delivery service is unavailable"
  );
}

async function fetchDeliveryByOrder(orderId: string, token: string) {
  return requestJson<DeliveryRoute>(
    DELIVERY_API_URL,
    `/delivery/${orderId}`,
    {
      method: "GET",
      headers: authHeaders(token)
    },
    "Delivery lookup failed"
  );
}

async function patchDeliveryStatus(orderId: string, status: DeliveryStatus, token: string) {
  return requestJson<DeliveryRoute>(
    DELIVERY_API_URL,
    `/delivery/${orderId}/status`,
    {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify({ status })
    },
    "Unable to update delivery status"
  );
}

async function syncOrderStatus(orderId: string, status: DeliveryStatus, token: string) {
  try {
    await requestJson<Record<string, unknown>>(
      ORDERS_API_URL,
      `/orders/${orderId}/status`,
      {
        method: "PATCH",
        headers: authHeaders(token),
        body: JSON.stringify({ status: toOrderStatus(status) })
      },
      "Order sync failed"
    );
  } catch {
    // Delivery-service already syncs order status. This is a best-effort fallback.
  }
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

async function openDeliveryWebSocket(token: string) {
  const candidates = getBaseUrlCandidates(DELIVERY_API_URL);

  for (const candidate of candidates) {
    const wsUrl = `${candidate.replace(/^http/, "ws")}/delivery/ws?token=${encodeURIComponent(token)}`;

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

async function sendRouteAssignedNotification(bot: Telegraf<Context>, chatId: number, route: DeliveryRoute) {
  await bot.telegram.sendMessage(
    chatId,
    [
      `📦 New delivery assigned: ${shortId(route.orderId)}`,
      `Status: ${statusLabel(route.status)}`,
      `ETA: ${route.etaMinutes} min`,
      `Address: ${route.address}`,
      `Use /details ${route.orderId}`
    ].join("\n")
  );
}

async function sendRouteStatusNotification(
  bot: Telegraf<Context>,
  chatId: number,
  route: DeliveryRoute,
  previousStatus: DeliveryStatus
) {
  await bot.telegram.sendMessage(
    chatId,
    [
      `🔔 Delivery ${shortId(route.orderId)} status updated`,
      `${statusLabel(previousStatus)} -> ${statusLabel(route.status)}`,
      `ETA: ${route.etaMinutes} min`,
      route.courierName ? `Courier: ${route.courierName}` : ""
    ]
      .filter(Boolean)
      .join("\n")
  );
}

async function trackRouteUpdate(
  bot: Telegraf<Context>,
  chatId: number,
  route: DeliveryRoute,
  options?: { silentNewRoute?: boolean }
) {
  const session = getSession(chatId);
  const previousStatus = session.lastRouteStatuses.get(route.orderId);

  if (!previousStatus) {
    session.lastRouteStatuses.set(route.orderId, route.status);
    if (!options?.silentNewRoute) {
      await sendRouteAssignedNotification(bot, chatId, route);
    }
    return;
  }

  if (previousStatus !== route.status) {
    session.lastRouteStatuses.set(route.orderId, route.status);
    await sendRouteStatusNotification(bot, chatId, route, previousStatus);
  }
}

async function pollCourierRoutes(
  bot: Telegraf<Context>,
  chatId: number,
  options?: { silentNewRoute?: boolean }
) {
  const session = getSession(chatId);
  if (!session.token || !session.user) {
    return;
  }

  try {
    const routes = await fetchCourierActiveRoutes(session.user.id, session.token);

    const activeOrderIds = new Set<string>();
    for (const route of routes) {
      if (route.courierId !== session.user.id) {
        continue;
      }
      activeOrderIds.add(route.orderId);
      await trackRouteUpdate(bot, chatId, route, options);
    }

    for (const [orderId, previousStatus] of [...session.lastRouteStatuses.entries()]) {
      if (!activeOrderIds.has(orderId) && previousStatus !== "done") {
        session.lastRouteStatuses.set(orderId, "done");
        await bot.telegram.sendMessage(
          chatId,
          `✅ Delivery ${shortId(orderId)} is no longer active (probably completed).`
        );
      }
    }
  } catch (error) {
    if (isUnauthorizedError(error)) {
      clearLiveTracking(session);
      session.token = undefined;
      session.user = undefined;
      session.loginStep = undefined;
      session.pendingEmail = undefined;
      session.lastRouteStatuses.clear();
      await bot.telegram.sendMessage(chatId, "Session expired. Please login again with /login.");
    }
  }
}

async function ensureDeliveryWatcher(chatId: number, bot: Telegraf<Context>) {
  const session = getSession(chatId);
  const token = session.token;
  clearWebSocket(session);

  if (!token) {
    return;
  }

  const socket = await openDeliveryWebSocket(token);
  if (!socket) {
    session.reconnectTimer = setTimeout(() => {
      void ensureDeliveryWatcher(chatId, bot);
    }, 5_000);
    return;
  }

  session.deliveryWs = socket;

  socket.on("message", (raw: WebSocket.RawData) => {
    const payloadText = String(raw ?? "");
    const currentSession = getSession(chatId);

    try {
      const payload = JSON.parse(payloadText) as DeliveryLiveMessage;
      if (payload.type !== "delivery.updated" || !payload.route || !currentSession.user) {
        return;
      }

      if (payload.route.courierId !== currentSession.user.id) {
        return;
      }

      void trackRouteUpdate(bot, chatId, payload.route).catch(() => undefined);
    } catch {
      // Ignore malformed events.
    }
  });

  socket.on("close", () => {
    const currentSession = getSession(chatId);
    currentSession.deliveryWs = undefined;
    if (!currentSession.token) {
      return;
    }
    currentSession.reconnectTimer = setTimeout(() => {
      void ensureDeliveryWatcher(chatId, bot);
    }, 5_000);
  });

  socket.on("error", () => {
    // Reconnect is handled on close.
  });
}

function startPolling(chatId: number, bot: Telegraf<Context>) {
  const session = getSession(chatId);
  clearPolling(session);

  void pollCourierRoutes(bot, chatId, { silentNewRoute: true });

  session.pollingTimer = setInterval(() => {
    void pollCourierRoutes(bot, chatId);
  }, POLLING_INTERVAL_MS);
}

function startLiveTracking(chatId: number, bot: Telegraf<Context>) {
  startPolling(chatId, bot);
  void ensureDeliveryWatcher(chatId, bot);
}

function requireAuth(ctx: Context, chatId: number) {
  const session = getSession(chatId);
  if (!session.token || !session.user) {
    void ctx.reply("Please login first: /login", mainMenuKeyboard());
    return null;
  }

  if (session.user.role !== "Courier") {
    void ctx.reply("This bot is for Courier accounts only.");
    return null;
  }

  return session;
}

function routeDetailsText(route: DeliveryRoute) {
  const items = route.items.length
    ? route.items
        .map((item) => `${item.name} x${item.quantity} = ${formatMoney(item.price * item.quantity)}`)
        .join("\n")
    : "No items";

  return [
    `📦 Delivery ${route.orderId}`,
    `Status: ${statusLabel(route.status)}`,
    `ETA: ${route.etaMinutes} min`,
    `Total: ${formatMoney(route.total)}`,
    `Address: ${route.address}`,
    `Courier: ${route.courierName}`,
    `Created: ${new Date(route.createdAt).toLocaleString()}`,
    "",
    "Items:",
    items
  ].join("\n");
}

const bot = TELEGRAM_BOT_TOKEN ? new Telegraf(TELEGRAM_BOT_TOKEN) : null;

if (!bot) {
  console.warn("COURIER_TELEGRAM_BOT_TOKEN is not set. Courier Telegram bot is disabled.");
} else {
  async function performLogin(ctx: Context, chatId: number, email: string, password: string) {
    const session = getSession(chatId);

    try {
      const auth = await authLogin(email, password);
      if (auth.user.role !== "Courier") {
        session.loginStep = undefined;
        session.pendingEmail = undefined;
        await ctx.reply("❌ This bot accepts only Courier accounts.");
        return;
      }

      clearLiveTracking(session);
      session.token = auth.accessToken;
      session.user = auth.user;
      session.loginStep = undefined;
      session.pendingEmail = undefined;
      session.lastRouteStatuses.clear();

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

  async function handleStatusCommand(
    ctx: Context,
    command: "accept" | "pickup" | "deliver",
    orderId: string
  ) {
    if (!ctx.chat) {
      return;
    }

    const chatId = ctx.chat.id;
    const session = requireAuth(ctx, chatId);
    if (!session) {
      return;
    }

    try {
      const route = await fetchDeliveryByOrder(orderId, session.token!);
      if (route.courierId !== session.user!.id) {
        await ctx.reply("❌ Invalid order_id for your courier account.");
        return;
      }

      let nextStatus: DeliveryStatus | null = null;
      let skipMessage = "";

      if (command === "accept") {
        if (route.status === "assigned") {
          nextStatus = "cooking";
        } else if (route.status === "cooking") {
          skipMessage = "Order already accepted and cooking.";
        } else {
          skipMessage = `Cannot accept from status ${statusLabel(route.status)}.`;
        }
      }

      if (command === "pickup") {
        if (route.status === "cooking") {
          nextStatus = "delivery";
        } else if (route.status === "delivery") {
          skipMessage = "Order is already in delivery.";
        } else if (route.status === "assigned") {
          skipMessage = "Accept first: /accept <order_id>.";
        } else {
          skipMessage = `Cannot pickup from status ${statusLabel(route.status)}.`;
        }
      }

      if (command === "deliver") {
        if (route.status === "delivery") {
          nextStatus = "done";
        } else if (route.status === "done") {
          skipMessage = "Order already delivered.";
        } else {
          skipMessage = "Mark pickup first: /pickup <order_id>.";
        }
      }

      if (!nextStatus) {
        await ctx.reply(skipMessage || "No status update required.");
        return;
      }

      const updated = await patchDeliveryStatus(orderId, nextStatus, session.token!);
      session.lastRouteStatuses.set(updated.orderId, updated.status);
      await syncOrderStatus(updated.orderId, updated.status, session.token!);

      await ctx.reply(
        `✅ Delivery ${shortId(updated.orderId)} -> ${statusLabel(updated.status)}\nETA: ${updated.etaMinutes} min`
      );
    } catch (error) {
      if (isUnauthorizedError(error)) {
        clearLiveTracking(session);
        session.token = undefined;
        session.user = undefined;
        session.lastRouteStatuses.clear();
        await ctx.reply("Session expired. Please login again with /login.");
        return;
      }

      const message = error instanceof Error ? error.message : "Status update failed";
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

    await ctx.reply(
      "FOODO Courier Bot\n\nEnter courier email:",
      mainMenuKeyboard()
    );
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

    await ctx.reply("Enter courier email:", mainMenuKeyboard());
  });

  bot.command("deliveries", async (ctx) => {
    if (!ctx.chat) {
      return;
    }

    const chatId = ctx.chat.id;
    const session = requireAuth(ctx, chatId);
    if (!session) {
      return;
    }

    try {
      const routes = await fetchCourierActiveRoutes(session.user!.id, session.token!);
      if (!routes.length) {
        await ctx.reply("No active deliveries.");
        return;
      }

      for (const route of routes) {
        session.lastRouteStatuses.set(route.orderId, route.status);
      }

      const lines = routes.map(
        (route) =>
          `#${shortId(route.orderId)} • ${statusLabel(route.status)} • ETA ${route.etaMinutes}m • ${formatMoney(route.total)}\n${route.address}`
      );

      await sendChunkedReply(
        ctx,
        `🚚 Active deliveries (${routes.length})\n\n${lines.join("\n\n")}\n\nDetails: /details <order_id>`
      );
    } catch (error) {
      if (isUnauthorizedError(error)) {
        clearLiveTracking(session);
        session.token = undefined;
        session.user = undefined;
        session.lastRouteStatuses.clear();
        await ctx.reply("Session expired. Please login again with /login.");
        return;
      }

      const message = error instanceof Error ? error.message : "Cannot load deliveries";
      await ctx.reply(`❌ ${message}`);
    }
  });

  bot.command("details", async (ctx) => {
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
      await ctx.reply("Usage: /details <order_id>");
      return;
    }

    try {
      const route = await fetchDeliveryByOrder(orderId, session.token!);
      if (route.courierId !== session.user!.id) {
        await ctx.reply("❌ Invalid order_id for your courier account.");
        return;
      }

      session.lastRouteStatuses.set(route.orderId, route.status);
      await sendChunkedReply(ctx, routeDetailsText(route));
    } catch (error) {
      if (isUnauthorizedError(error)) {
        clearLiveTracking(session);
        session.token = undefined;
        session.user = undefined;
        session.lastRouteStatuses.clear();
        await ctx.reply("Session expired. Please login again with /login.");
        return;
      }

      const message = error instanceof Error ? error.message : "Cannot load delivery details";
      await ctx.reply(`❌ ${message}`);
    }
  });

  bot.command("accept", async (ctx) => {
    const args = extractCommandArgs((ctx.message as { text?: string })?.text);
    const orderId = args[0];
    if (!orderId) {
      await ctx.reply("Usage: /accept <order_id>");
      return;
    }
    await handleStatusCommand(ctx, "accept", orderId);
  });

  bot.command("pickup", async (ctx) => {
    const args = extractCommandArgs((ctx.message as { text?: string })?.text);
    const orderId = args[0];
    if (!orderId) {
      await ctx.reply("Usage: /pickup <order_id>");
      return;
    }
    await handleStatusCommand(ctx, "pickup", orderId);
  });

  bot.command("deliver", async (ctx) => {
    const args = extractCommandArgs((ctx.message as { text?: string })?.text);
    const orderId = args[0];
    if (!orderId) {
      await ctx.reply("Usage: /deliver <order_id>");
      return;
    }
    await handleStatusCommand(ctx, "deliver", orderId);
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
  res.json({ service: "tg-courier-bot", status: "ok" });
});

if (bot) {
  app.post(WEBHOOK_PATH, bot.webhookCallback(WEBHOOK_PATH));
} else {
  app.post(WEBHOOK_PATH, (_req, res) => {
    res.status(503).json({ message: "COURIER_TELEGRAM_BOT_TOKEN is not configured" });
  });
}

const server = app.listen(PORT, async () => {
  console.log(`tg-courier-bot listening on ${PORT}`);

  if (!bot) {
    return;
  }

  try {
    await bot.telegram.setMyCommands([
      { command: "start", description: "Start login flow" },
      { command: "login", description: "Login as courier" },
      { command: "help", description: "Show command help" },
      { command: "deliveries", description: "List active deliveries" },
      { command: "details", description: "Details: /details <order_id>" },
      { command: "accept", description: "Accept: /accept <order_id>" },
      { command: "pickup", description: "Pickup: /pickup <order_id>" },
      { command: "deliver", description: "Deliver: /deliver <order_id>" }
    ]);

    if (!TELEGRAM_WEBHOOK_URL) {
      console.log(
        "COURIER_TELEGRAM_WEBHOOK_URL is not set. Configure webhook externally to use POST /telegram/webhook."
      );
      return;
    }

    const webhook = `${TELEGRAM_WEBHOOK_URL.replace(/\/+$/, "")}${WEBHOOK_PATH}`;
    await bot.telegram.setWebhook(webhook);
    console.log(`Courier Telegram webhook configured: ${webhook}`);
  } catch (error) {
    console.error(`Failed to configure courier bot webhook: ${(error as Error).message}`);
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
