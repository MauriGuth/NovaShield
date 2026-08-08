import { Module } from '@nestjs/common';
import { AnalysisController } from './analysis.controller';
import { AnalysisService } from './analysis.service';
import { BlocklistService } from './layers/blocklist.service';
import { HeuristicsService } from './layers/heuristics.service';
import { LlmService } from './layers/llm.service';
import { WebRiskService } from './layers/webrisk.service';

@Module({
  controllers: [AnalysisController],
  providers: [
    AnalysisService,
    BlocklistService,
    HeuristicsService,
    WebRiskService,
    LlmService,
  ],
  exports: [BlocklistService, WebRiskService, LlmService],
})
export class AnalysisModule {}
