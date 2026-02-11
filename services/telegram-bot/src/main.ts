import express from "express";
import { Markup, Telegraf, type Context } from "telegraf";
import WebSocket from "ws";

interface AuthResponse {
  accessToken: string;
  user: User;
}

interface User {
  id: string;
  email: string;
  role: "Customer" | "Courier" | "Admin";
}

interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  stock: number;
}

interface CreateOrderItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
}

interface Order {
  id: string;
  userId: string;
  status: "pending" | "cooking" | "delivery" | "done";
  total: number;
  delivery?: {
    courierName: string;
    etaMinutes: number;
  };
}

interface OrderLiveMessage {
  type: "order.updated";
  emittedAt: string;
  order: Order;
}

interface ChatCartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
}

interface ChatSession {
  token?: string;
  user?: User;
  cart: Map<string, ChatCartItem>;
  loginStep?: "email" | "password";
  pendingEmail?: string;
  orderWs?: WebSocket;
  reconnectTimer?: NodeJS.Timeout;
  lastOrderStatuses: Map<string, string>;
}

const PORT = Number(process.env.PORT ?? 3006);
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const TELEGRAM_WEBHOOK_URL = process.env.TELEGRAM_WEBHOOK_URL?.trim();
const AUTH_API_URL = process.env.AUTH_API_URL ?? "http://127.0.0.1:3001";
const WAREHOUSE_API_URL = process.env.WAREHOUSE_API_URL ?? "http://127.0.0.1:3003";
const ORDERS_API_URL = process.env.ORDERS_API_URL ?? "http://127.0.0.1:3002";
const WEBHOOK_PATH = "/telegram/webhook";
const MAX_TEXT_CHUNK = 3400;
const MAX_INLINE_CATALOG_BUTTONS = 8;

const sessions = new Map<number, ChatSession>();

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
      cart: new Map(),
      lastOrderStatuses: new Map()
    });
  }
  return sessions.get(chatId)!;
}

function clearWatcher(session: ChatSession) {
  if (session.reconnectTimer) {
    clearTimeout(session.reconnectTimer);
    session.reconnectTimer = undefined;
  }
  if (session.orderWs) {
    try {
      session.orderWs.close();
    } catch {
      // Ignore close errors.
    }
    session.orderWs = undefined;
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
    default:
      return status;
  }
}

function formatMoney(value: number) {
  return `$${value.toFixed(2)}`;
}

function cartSubtotal(cart: Map<string, ChatCartItem>) {
  let subtotal = 0;
  for (const item of cart.values()) {
    subtotal += item.price * item.quantity;
  }
  return Number(subtotal.toFixed(2));
}

function mainMenuKeyboard() {
  return Markup.keyboard([
    ["/catalog", "/cart"],
    ["/checkout", "/orders"],
    ["/login", "/menu"]
  ]).resize();
}

function buildCatalogInlineKeyboard(products: Product[]) {
  const buttons = products
    .slice(0, MAX_INLINE_CATALOG_BUTTONS)
    .map((product) =>
      Markup.button.callback(
        `➕ ${product.name.slice(0, 22)}`,
        `add:${product.id}`
      )
    );

  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let index = 0; index < buttons.length; index += 2) {
    rows.push(buttons.slice(index, index + 2));
  }

  return Markup.inlineKeyboard(rows);
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
        throw new Error(buildMessageError(payload, `HTTP ${response.status}`));
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
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email, password })
    },
    "Auth service is unavailable"
  );
}

async function fetchCatalog() {
  return requestJson<Product[]>(
    WAREHOUSE_API_URL,
    "/products",
    {
      method: "GET"
    },
    "Warehouse service is unavailable"
  );
}

async function fetchProductById(productId: string) {
  return requestJson<Product>(
    WAREHOUSE_API_URL,
    `/products/${productId}`,
    {
      method: "GET"
    },
    "Product lookup failed"
  );
}

async function fetchOrders(accessToken: string) {
  return requestJson<Order[]>(
    ORDERS_API_URL,
    "/orders/my",
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`
      }
    },
    "Orders service is unavailable"
  );
}

async function checkout(accessToken: string, items: CreateOrderItem[]) {
  return requestJson<Order>(
    ORDERS_API_URL,
    "/orders",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({ items })
    },
    "Checkout failed"
  );
}

async function addProductToCart(session: ChatSession, productId: string) {
  const product = await fetchProductById(productId);
  const current = session.cart.get(product.id);
  const nextQuantity = (current?.quantity ?? 0) + 1;

  if (nextQuantity > product.stock) {
    throw new Error(`Not enough stock. Available: ${product.stock}`);
  }

  session.cart.set(product.id, {
    productId: product.id,
    name: product.name,
    price: product.price,
    quantity: nextQuantity
  });

  return {
    product,
    quantity: nextQuantity,
    subtotal: cartSubtotal(session.cart)
  };
}

async function openOrdersWebSocket(accessToken: string) {
  const candidates = getBaseUrlCandidates(ORDERS_API_URL);

  for (const candidate of candidates) {
    const wsUrl = `${candidate.replace(/^http/, "ws")}/orders/ws?token=${encodeURIComponent(accessToken)}`;

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

async function ensureOrderWatcher(chatId: number, bot: Telegraf<Context>) {
  const session = getSession(chatId);
  const token = session.token;

  clearWatcher(session);

  if (!token) {
    return;
  }

  const socket = await openOrdersWebSocket(token);
  if (!socket) {
    session.reconnectTimer = setTimeout(() => {
      void ensureOrderWatcher(chatId, bot);
    }, 5_000);
    return;
  }

  session.orderWs = socket;

  socket.on("message", (raw: WebSocket.RawData) => {
    const currentSession = getSession(chatId);
    const payloadText = String(raw ?? "");

    try {
      const payload = JSON.parse(payloadText) as OrderLiveMessage;
      if (payload.type !== "order.updated" || !payload.order) {
        return;
      }

      const nextStatus = payload.order.status;
      const previousStatus = currentSession.lastOrderStatuses.get(payload.order.id);
      currentSession.lastOrderStatuses.set(payload.order.id, nextStatus);

      if (previousStatus === nextStatus) {
        return;
      }

      const etaText = payload.order.delivery?.etaMinutes
        ? `\nETA: ${payload.order.delivery.etaMinutes} min`
        : "";
      const courierText = payload.order.delivery?.courierName
        ? `\nCourier: ${payload.order.delivery.courierName}`
        : "";

      void bot.telegram
        .sendMessage(
          chatId,
          `🔔 Order ${shortId(payload.order.id)} status: ${statusLabel(nextStatus)}${etaText}${courierText}`
        )
        .catch(() => undefined);
    } catch {
      // Ignore malformed events.
    }
  });

  socket.on("close", () => {
    const currentSession = getSession(chatId);
    if (!currentSession.token) {
      return;
    }
    currentSession.orderWs = undefined;
    currentSession.reconnectTimer = setTimeout(() => {
      void ensureOrderWatcher(chatId, bot);
    }, 5_000);
  });

  socket.on("error", () => {
    // close event will trigger reconnect.
  });
}

function requireAuth(ctx: Context, chatId: number) {
  const session = getSession(chatId);
  if (!session.token || !session.user) {
    void ctx.reply("Please login first: /login", mainMenuKeyboard());
    return null;
  }
  return session;
}

const bot = TELEGRAM_BOT_TOKEN ? new Telegraf(TELEGRAM_BOT_TOKEN) : null;

if (!bot) {
  console.warn("TELEGRAM_BOT_TOKEN is not set. Telegram commands are disabled.");
} else {
  async function performLogin(ctx: Context, chatId: number, email: string, password: string) {
    const session = getSession(chatId);
    try {
      const auth = await authLogin(email, password);
      session.token = auth.accessToken;
      session.user = auth.user;
      session.loginStep = undefined;
      session.pendingEmail = undefined;
      session.lastOrderStatuses.clear();

      await ctx.reply(
        `✅ Logged in as ${auth.user.email} (${auth.user.role}).\nAvailable: /catalog /add <product_id> /cart /checkout /orders`
      );

      await ensureOrderWatcher(chatId, bot!);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Login failed";
      await ctx.reply(`❌ ${message}`);
    }
  }

  bot.start(async (ctx) => {
    await ctx.reply(
      "FOODO Telegram Bot\n\nUse /login to authorize.\nThen: /catalog, /add <product_id>, /cart, /checkout, /orders",
      mainMenuKeyboard()
    );
  });

  bot.command("menu", async (ctx) => {
    await ctx.reply("Menu is enabled. Pick a command below.", mainMenuKeyboard());
  });

  bot.command("login", async (ctx) => {
    if (!ctx.chat) {
      return;
    }

    const chatId = ctx.chat.id;
    const session = getSession(chatId);
    const args = extractCommandArgs((ctx.message as { text?: string })?.text);

    if (args.length >= 2) {
      const email = args[0];
      const password = args.slice(1).join(" ");
      await performLogin(ctx, chatId, email, password);
      return;
    }

    session.loginStep = "email";
    session.pendingEmail = undefined;
    await ctx.reply("Enter email:", mainMenuKeyboard());
  });

  bot.command("catalog", async (ctx) => {
    if (!ctx.chat) {
      return;
    }
    const chatId = ctx.chat.id;
    if (!requireAuth(ctx, chatId)) {
      return;
    }

    try {
      const products = await fetchCatalog();
      if (!products.length) {
        await ctx.reply("Catalog is empty");
        return;
      }

      const lines = products.map(
        (product) =>
          `${product.id}\n${product.name} • ${formatMoney(product.price)} • stock ${product.stock}`
      );
      await sendChunkedReply(
        ctx,
        `📦 Catalog (${products.length})\n\n${lines.join("\n\n")}\n\nAdd to cart: /add <product_id>`
      );
      await ctx.reply(
        "Quick add buttons:",
        buildCatalogInlineKeyboard(products)
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Catalog request failed";
      await ctx.reply(`❌ ${message}`);
    }
  });

  bot.command("add", async (ctx) => {
    if (!ctx.chat) {
      return;
    }
    const chatId = ctx.chat.id;
    const session = requireAuth(ctx, chatId);
    if (!session) {
      return;
    }

    const args = extractCommandArgs((ctx.message as { text?: string })?.text);
    const productId = args[0];

    if (!productId) {
      await ctx.reply("Usage: /add <product_id>");
      return;
    }

    try {
      const added = await addProductToCart(session, productId);
      await ctx.reply(
        `🛒 Added: ${added.product.name}\nQty: ${added.quantity}\nSubtotal: ${formatMoney(added.subtotal)}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to add product";
      await ctx.reply(`❌ ${message}`);
    }
  });

  bot.command("cart", async (ctx) => {
    if (!ctx.chat) {
      return;
    }
    const chatId = ctx.chat.id;
    const session = requireAuth(ctx, chatId);
    if (!session) {
      return;
    }

    if (!session.cart.size) {
      await ctx.reply("Cart is empty");
      return;
    }

    const lines = [...session.cart.values()].map(
      (item) =>
        `${item.name} x${item.quantity} = ${formatMoney(Number((item.price * item.quantity).toFixed(2)))}`
    );

    await ctx.reply(`🧺 Cart\n\n${lines.join("\n")}\n\nSubtotal: ${formatMoney(cartSubtotal(session.cart))}`);
  });

  bot.command("checkout", async (ctx) => {
    if (!ctx.chat) {
      return;
    }
    const chatId = ctx.chat.id;
    const session = requireAuth(ctx, chatId);
    if (!session) {
      return;
    }

    if (!session.cart.size) {
      await ctx.reply("Cart is empty. Use /catalog and /add first.");
      return;
    }

    const items: CreateOrderItem[] = [...session.cart.values()].map((item) => ({
      productId: item.productId,
      name: item.name,
      price: item.price,
      quantity: item.quantity
    }));

    try {
      const created = await checkout(session.token!, items);
      session.cart.clear();
      session.lastOrderStatuses.set(created.id, created.status);

      await ctx.reply(
        `✅ Order created\nID: ${created.id}\nStatus: ${statusLabel(created.status)}\nTotal: ${formatMoney(created.total)}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Checkout failed";
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

    try {
      const orders = await fetchOrders(session.token!);
      if (!orders.length) {
        await ctx.reply("No orders yet.");
        return;
      }

      const lines = orders.slice(0, 15).map((order) => {
        session.lastOrderStatuses.set(order.id, order.status);
        const eta = order.delivery?.etaMinutes ? `, ETA ${order.delivery.etaMinutes}m` : "";
        return `#${shortId(order.id)} • ${statusLabel(order.status)} • ${formatMoney(order.total)}${eta}`;
      });

      await sendChunkedReply(ctx, `📋 My orders\n\n${lines.join("\n")}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cannot load orders";
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
      session.loginStep = undefined;
      session.pendingEmail = undefined;

      if (!email) {
        await ctx.reply("Please run /login again.");
        return;
      }

      await performLogin(ctx, chatId, email, text);
    }
  });

  bot.on("callback_query", async (ctx) => {
    if (!("data" in ctx.callbackQuery)) {
      await ctx.answerCbQuery();
      return;
    }

    const data = String(ctx.callbackQuery.data ?? "");
    if (!data.startsWith("add:")) {
      await ctx.answerCbQuery();
      return;
    }

    const productId = data.replace(/^add:/, "").trim();
    if (!productId) {
      await ctx.answerCbQuery("Invalid product", { show_alert: true });
      return;
    }

    const chatId = ctx.chat?.id ?? ctx.from?.id;
    if (!chatId) {
      await ctx.answerCbQuery("Chat is unavailable", { show_alert: true });
      return;
    }

    const session = requireAuth(ctx, chatId);
    if (!session) {
      await ctx.answerCbQuery("Please login first", { show_alert: true });
      return;
    }

    try {
      const added = await addProductToCart(session, productId);
      await ctx.answerCbQuery("Added to cart");
      await ctx.reply(
        `🛒 Added: ${added.product.name}\nQty: ${added.quantity}\nSubtotal: ${formatMoney(added.subtotal)}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to add product";
      await ctx.answerCbQuery("Cannot add", { show_alert: true });
      await ctx.reply(`❌ ${message}`);
    }
  });
}

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ service: "telegram-bot", status: "ok" });
});

if (bot) {
  app.post(WEBHOOK_PATH, bot.webhookCallback(WEBHOOK_PATH));
} else {
  app.post(WEBHOOK_PATH, (_req, res) => {
    res.status(503).json({
      message: "TELEGRAM_BOT_TOKEN is not configured"
    });
  });
}

const server = app.listen(PORT, async () => {
  console.log(`telegram-bot listening on ${PORT}`);

  if (!bot) {
    return;
  }

  try {
    await bot.telegram.setMyCommands([
      { command: "start", description: "Start bot and show help" },
      { command: "menu", description: "Show quick action buttons" },
      { command: "login", description: "Login with your FOODO account" },
      { command: "catalog", description: "View product catalog" },
      { command: "add", description: "Add product: /add <product_id>" },
      { command: "cart", description: "Show cart" },
      { command: "checkout", description: "Create order from cart" },
      { command: "orders", description: "Show my orders" }
    ]);

    if (!TELEGRAM_WEBHOOK_URL) {
      console.log(
        "TELEGRAM_WEBHOOK_URL is not set. Bot will accept updates on POST /telegram/webhook after webhook is configured externally."
      );
      return;
    }

    const webhook = `${TELEGRAM_WEBHOOK_URL.replace(/\/+$/, "")}${WEBHOOK_PATH}`;
    await bot.telegram.setWebhook(webhook);
    console.log(`Telegram webhook configured: ${webhook}`);
  } catch (error) {
    console.error(`Failed to set Telegram webhook: ${(error as Error).message}`);
  }
});

function shutdown() {
  for (const session of sessions.values()) {
    clearWatcher(session);
  }
  server.close(() => {
    process.exit(0);
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
