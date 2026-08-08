import { Module } from '@nestjs/common';
import { AnalysisModule } from '../analysis/analysis.module';
import { HealthController } from './health.controller';

@Module({
  imports: [AnalysisModule],
  controllers: [HealthController],
})
export class HealthModule {}
