import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import type { AnalyzeResponse } from '@novashield/shared';
import { AnalysisService } from './analysis.service';
import { AnalyzeDto } from './dto/analyze.dto';

@Controller('analyze')
export class AnalysisController {
  constructor(private readonly analysis: AnalysisService) {}

  @Post()
  @HttpCode(200)
  analyze(@Body() body: AnalyzeDto): Promise<AnalyzeResponse> {
    return this.analysis.analyze(body.url);
  }
}
