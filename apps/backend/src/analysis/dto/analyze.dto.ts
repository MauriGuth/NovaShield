import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AnalyzeDto {
  /** URL o texto pegado/compartido; el backend extrae el primer enlace. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  url: string;
}
