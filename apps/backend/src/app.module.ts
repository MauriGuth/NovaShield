import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalysisModule } from './analysis/analysis.module';
import { buildDatabaseOptions } from './database';
import { FamilyModule } from './family/family.module';
import { HealthModule } from './health/health.module';
import { MessagesModule } from './messages/messages.module';
import { ShieldModule } from './shield/shield.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    // Endpoint público: límite por IP hasta tener cuentas/autenticación.
    // Requiere `trust proxy` en main.ts para que la IP sea la del cliente y
    // no la del proxy. 60/min es el techo del escáner; la descarga de la lista
    // (más pesada pero menos frecuente) y la familia tienen el suyo en cada
    // controller. El mensaje va en el idioma del usuario: la app lo muestra
    // tal cual.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 60 }],
      errorMessage:
        'Demasiadas consultas seguidas. Esperá un momento y probá de nuevo.',
    }),
    TypeOrmModule.forRoot(buildDatabaseOptions()),
    AnalysisModule,
    MessagesModule,
    ShieldModule,
    HealthModule,
    FamilyModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
