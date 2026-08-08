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

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
