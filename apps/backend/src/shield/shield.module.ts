import { Module } from '@nestjs/common';
import { AnalysisModule } from '../analysis/analysis.module';
import { ShieldController } from './shield.controller';
import { ShieldService } from './shield.service';

@Module({
  imports: [AnalysisModule],
  controllers: [ShieldController],
  providers: [ShieldService],
})
export class ShieldModule {}
