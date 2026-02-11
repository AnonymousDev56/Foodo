import "reflect-metadata";
import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { AppModule } from "./app.module";
import type { DashboardMetricsSnapshot } from "./orders/dashboard-metrics.service";
import { DashboardMetricsService } from "./orders/dashboard-metrics.service";
import type { OrderRecord } from "./orders/orders.service";
import { OrdersService } from "./orders/orders.service";

interface AuthPayload {
  sub: string;
  role?: string;
}

interface OrderLiveMessage {
  type: "order.updated";
  emittedAt: string;
  order: OrderRecord;
}

interface DashboardLiveMessage {
  type: "dashboardUpdate";
  data: DashboardMetricsSnapshot;
}

function extractBearerTokenFromWsRequest(request: IncomingMessage) {
  const host = request.headers.host ?? "localhost";
  const url = new URL(request.url ?? "", `http://${host}`);
  return url.searchParams.get("token");
}

function decodeAuthPayload(token?: string | null) {
  if (!token) {
    return null;
  }

  const [, payloadPart] = token.split(".");
  if (!payloadPart) {
    return null;
  }

  try {
    const payloadRaw = Buffer.from(payloadPart, "base64url").toString("utf8");
    const payload = JSON.parse(payloadRaw) as AuthPayload;
    if (!payload.sub) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

async function bootstrap() {
  const logger = new Logger("OrdersBootstrap");
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: true
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const ordersService = app.get(OrdersService);
  const dashboardMetricsService = app.get(DashboardMetricsService);

  const ordersWsServer = new WebSocketServer({ noServer: true });
  const dashboardWsServer = new WebSocketServer({ noServer: true });
  const orderSocketAuthMap = new WeakMap<WebSocket, AuthPayload>();
  const dashboardSocketAuthMap = new WeakMap<WebSocket, AuthPayload>();
  const liveClients = new Set<{ socket: WebSocket; auth: AuthPayload }>();
  const dashboardClients = new Set<WebSocket>();

  const broadcastDashboardSnapshot = async (force = false) => {
    if (!dashboardClients.size) {
      return;
    }

    try {
      const snapshot = await dashboardMetricsService.getMetrics({ force });
      const message: DashboardLiveMessage = {
        type: "dashboardUpdate",
        data: snapshot
      };

      const payload = JSON.stringify(message);
      for (const socket of dashboardClients) {
        if (socket.readyState !== socket.OPEN) {
          continue;
        }
        socket.send(payload);
      }
    } catch (error) {
      logger.warn(`Dashboard WS broadcast failed: ${(error as Error).message}`);
    }
  };

  const unsubscribeOrderUpdates = ordersService.onOrderUpdated((order) => {
    const message: OrderLiveMessage = {
      type: "order.updated",
      emittedAt: new Date().toISOString(),
      order
    };

    const payload = JSON.stringify(message);
    for (const client of liveClients) {
      if (client.socket.readyState !== client.socket.OPEN) {
        continue;
      }
      if (client.auth.role === "Admin" || client.auth.sub === order.userId) {
        client.socket.send(payload);
      }
    }

    void broadcastDashboardSnapshot(true);
  });

  ordersWsServer.on("connection", (socket) => {
    const auth = orderSocketAuthMap.get(socket);
    if (!auth) {
      socket.close(1008, "Unauthorized");
      return;
    }

    const client = { socket, auth };
    liveClients.add(client);
    socket.on("close", () => {
      liveClients.delete(client);
    });
    socket.on("error", () => {
      liveClients.delete(client);
    });
  });

  dashboardWsServer.on("connection", (socket) => {
    const auth = dashboardSocketAuthMap.get(socket);
    if (!auth || auth.role !== "Admin") {
      socket.close(1008, "Forbidden");
      return;
    }

    dashboardClients.add(socket);
    void broadcastDashboardSnapshot(true);

    socket.on("close", () => {
      dashboardClients.delete(socket);
    });
    socket.on("error", () => {
      dashboardClients.delete(socket);
    });
  });

  const dashboardTimer = setInterval(() => {
    void broadcastDashboardSnapshot(false);
  }, 4_000);

  const port = Number(process.env.PORT ?? 3002);
  await app.listen(port);
  const httpServer = app.getHttpServer() as {
    on: (event: "upgrade", listener: (request: IncomingMessage, socket: any, head: Buffer) => void) => void;
  };

  httpServer.on("upgrade", (request, socket, head) => {
    const host = request.headers.host ?? "localhost";
    const url = new URL(request.url ?? "", `http://${host}`);
    if (url.pathname !== "/orders/ws" && url.pathname !== "/ws/admin-dashboard") {
      return;
    }

    const token = extractBearerTokenFromWsRequest(request);
    const auth = decodeAuthPayload(token);
    if (!auth) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    if (url.pathname === "/orders/ws") {
      ordersWsServer.handleUpgrade(request, socket, head, (ws) => {
        orderSocketAuthMap.set(ws, auth);
        ordersWsServer.emit("connection", ws, request);
      });
      return;
    }

    if (url.pathname === "/ws/admin-dashboard") {
      if (auth.role !== "Admin") {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }

      dashboardWsServer.handleUpgrade(request, socket, head, (ws) => {
        dashboardSocketAuthMap.set(ws, auth);
        dashboardWsServer.emit("connection", ws, request);
      });
    }
  });

  process.on("SIGINT", () => {
    unsubscribeOrderUpdates();
    clearInterval(dashboardTimer);
    ordersWsServer.close();
    dashboardWsServer.close();
  });
  process.on("SIGTERM", () => {
    unsubscribeOrderUpdates();
    clearInterval(dashboardTimer);
    ordersWsServer.close();
    dashboardWsServer.close();
  });
  console.log(`orders-service listening on ${port}`);
}

void bootstrap();
