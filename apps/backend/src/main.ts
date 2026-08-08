import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
