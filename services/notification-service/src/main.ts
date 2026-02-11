import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3005);
  await app.listen(port);
  console.log(`notification-service listening on ${port}`);
}

void bootstrap();
