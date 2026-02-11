import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { AppModule } from "./app.module";
import type { DeliveryRoute } from "./delivery/models/delivery-route.model";
import { DeliveryService } from "./delivery/delivery.service";

interface AuthPayload {
  sub: string;
  role?: string;
}

interface DeliveryLiveMessage {
  type: "delivery.updated";
  emittedAt: string;
  route: DeliveryRoute;
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
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: true
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const deliveryService = app.get(DeliveryService);
  const webSocketServer = new WebSocketServer({ noServer: true });
  const socketAuthMap = new WeakMap<WebSocket, AuthPayload>();
  const liveClients = new Set<{ socket: WebSocket; auth: AuthPayload }>();

  const unsubscribeRouteUpdates = deliveryService.onRouteUpdated((route) => {
    const message: DeliveryLiveMessage = {
      type: "delivery.updated",
      emittedAt: new Date().toISOString(),
      route
    };

    const payload = JSON.stringify(message);
    for (const client of liveClients) {
      if (client.socket.readyState !== client.socket.OPEN) {
        continue;
      }
      if (client.auth.role === "Admin" || client.auth.sub === route.courierId) {
        client.socket.send(payload);
      }
    }
  });

  webSocketServer.on("connection", (socket) => {
    const auth = socketAuthMap.get(socket);
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

  const port = Number(process.env.PORT ?? 3004);
  await app.listen(port);
  const httpServer = app.getHttpServer() as {
    on: (
      event: "upgrade",
      listener: (request: IncomingMessage, socket: any, head: Buffer) => void
    ) => void;
  };

  httpServer.on("upgrade", (request, socket, head) => {
    const host = request.headers.host ?? "localhost";
    const url = new URL(request.url ?? "", `http://${host}`);
    if (url.pathname !== "/delivery/ws") {
      return;
    }

    const token = extractBearerTokenFromWsRequest(request);
    const auth = decodeAuthPayload(token);
    if (!auth) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (ws) => {
      socketAuthMap.set(ws, auth);
      webSocketServer.emit("connection", ws, request);
    });
  });

  process.on("SIGINT", () => {
    unsubscribeRouteUpdates();
    webSocketServer.close();
  });
  process.on("SIGTERM", () => {
    unsubscribeRouteUpdates();
    webSocketServer.close();
  });
  console.log(`delivery-service listening on ${port}`);
}

void bootstrap();
