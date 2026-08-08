import { Module } from '@nestjs/common';
import { AnalysisModule } from '../analysis/analysis.module';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

@Module({
  imports: [AnalysisModule],
  controllers: [MessagesController],
  providers: [MessagesService],
})
export class MessagesModule {}
