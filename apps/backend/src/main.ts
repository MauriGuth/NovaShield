import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Detrás del proxy de Railway TODAS las requests llegan desde la IP del
  // proxy. Sin esto, `req.ip` es siempre la misma y el ThrottlerGuard reparte
  // UN solo cupo entre todos los usuarios: el día de una campaña masiva el
  // backend responde 429 a todo el mundo. `1` = confiar en exactamente un
  // salto (el proxy), no en cualquier X-Forwarded-For que mande el cliente.
  app.set('trust proxy', 1);

  app.setGlobalPrefix('v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  app.enableCors({
    // En producción restringir a los orígenes reales (app + panel web).
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? true,
  });

  // 0.0.0.0 explícito: dentro de un contenedor, escuchar solo en localhost deja
  // el servicio inalcanzable desde afuera y el proxy responde 502 sin que en
  // los logs de la app aparezca nada raro.
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  console.log(`Nova Shield API escuchando en 0.0.0.0:${port}`);
}
bootstrap();
