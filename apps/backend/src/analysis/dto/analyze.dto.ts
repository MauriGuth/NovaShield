import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class AnalyzeDto {
  /** URL o texto pegado/compartido; el backend extrae el primer enlace. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  url: string;

  /**
   * `false` pide análisis solo con las capas locales (listas + heurísticas).
   * Lo manda la app cuando el plan gratuito superó su tope diario, para no
   * gastar consultas pagas de Web Risk ni de IA.
   *
   * Es una señal de costo, NO de seguridad: el cliente puede mandar `true`
   * siempre, y lo peor que consigue es que gastemos nosotros. El límite real
   * de abuso lo pone el ThrottlerGuard, no este campo.
   */
  @IsOptional()
  @IsBoolean()
  deepAnalysis?: boolean;
}
