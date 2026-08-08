import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@novashield/shared';
import { BlocklistService } from '../analysis/layers/blocklist.service';
import { LlmService } from '../analysis/layers/llm.service';
import { WebRiskService } from '../analysis/layers/webrisk.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly blocklists: BlocklistService,
    private readonly webRisk: WebRiskService,
    private readonly llm: LlmService,
  ) {}

  @Get()
  health(): HealthResponse {
    return {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      blocklists: this.blocklists.stats,
      layers: {
        blocklists: this.blocklists.isReady,
        webrisk: this.webRisk.isEnabled,
        heuristics: true,
        ai: this.llm.isEnabled,
      },
    };
  }
}
