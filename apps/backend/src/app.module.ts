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
    // Endpoint público: límite básico por IP hasta tener cuentas/autenticación.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 30 }]),
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
