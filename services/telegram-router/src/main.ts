import express, { type Request, type Response } from "express";

const PORT = Number(process.env.PORT ?? 3008);
const CUSTOMER_WEBHOOK_TARGET =
  process.env.CUSTOMER_WEBHOOK_TARGET ?? "http://127.0.0.1:3006/telegram/webhook";
const COURIER_WEBHOOK_TARGET =
  process.env.COURIER_WEBHOOK_TARGET ?? "http://127.0.0.1:3007/telegram/webhook";
const ADMIN_WEBHOOK_TARGET =
  process.env.ADMIN_WEBHOOK_TARGET ?? "http://127.0.0.1:3009/telegram/webhook";

const app = express();
app.use(express.json({ limit: "1mb" }));

async function forwardWebhook(
  req: Request,
  res: Response,
  targetUrl: string,
  targetName: "customer-bot" | "courier-bot" | "admin-bot"
) {
  try {
    const upstream = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(req.body ?? {})
    });

    const text = await upstream.text();
    const contentType = upstream.headers.get("content-type") ?? "application/json; charset=utf-8";

    res.status(upstream.status);
    res.setHeader("content-type", contentType);
    res.send(text);
  } catch (error) {
    res.status(502).json({
      message: `${targetName} is unavailable`,
      error: (error as Error).message
    });
  }
}

app.get("/health", (_req, res) => {
  res.json({
    service: "telegram-router",
    status: "ok",
    routes: {
      customer: "/telegram/customer/webhook",
      courier: "/telegram/courier/webhook",
      admin: "/telegram/admin/webhook"
    },
    targets: {
      customer: CUSTOMER_WEBHOOK_TARGET,
      courier: COURIER_WEBHOOK_TARGET,
      admin: ADMIN_WEBHOOK_TARGET
    }
  });
});

app.post("/telegram/customer/webhook", async (req, res) => {
  await forwardWebhook(req, res, CUSTOMER_WEBHOOK_TARGET, "customer-bot");
});

app.post("/telegram/courier/webhook", async (req, res) => {
  await forwardWebhook(req, res, COURIER_WEBHOOK_TARGET, "courier-bot");
});

app.post("/telegram/admin/webhook", async (req, res) => {
  await forwardWebhook(req, res, ADMIN_WEBHOOK_TARGET, "admin-bot");
});

app.listen(PORT, () => {
  console.log(`telegram-router listening on ${PORT}`);
  console.log(`Customer webhook route: /telegram/customer/webhook -> ${CUSTOMER_WEBHOOK_TARGET}`);
  console.log(`Courier webhook route: /telegram/courier/webhook -> ${COURIER_WEBHOOK_TARGET}`);
  console.log(`Admin webhook route: /telegram/admin/webhook -> ${ADMIN_WEBHOOK_TARGET}`);
});
