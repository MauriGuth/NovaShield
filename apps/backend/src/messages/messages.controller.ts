import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import type { AnalyzeMessageResponse } from '@novashield/shared';
import { AnalyzeMessageDto } from './dto/analyze-message.dto';
import { MessagesService } from './messages.service';

@Controller('messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Post('analyze')
  @HttpCode(200)
  analyze(@Body() body: AnalyzeMessageDto): Promise<AnalyzeMessageResponse> {
    return this.messages.analyze(body);
  }
}
