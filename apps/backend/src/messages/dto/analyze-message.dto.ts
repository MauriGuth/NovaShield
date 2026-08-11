import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import type { MessageSource } from '@novashield/shared';

const SOURCES: MessageSource[] = ['sms', 'notification', 'email', 'manual'];

export class AnalyzeMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(8192)
  text: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  sender?: string;

  @IsIn(SOURCES)
  source: MessageSource;

  /** `false` apaga Web Risk + IA (tope del plan gratuito). Ver shared/messages. */
  @IsOptional()
  @IsBoolean()
  deepAnalysis?: boolean;
}
