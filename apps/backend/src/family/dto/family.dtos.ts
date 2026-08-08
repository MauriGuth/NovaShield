import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

/** Nombre visible: se muestra tal cual a la familia, sin markup posible. */
const NAME_PATTERN = /^[\p{L}\p{N} .,'‑-]+$/u;

export class CreateFamilyDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Length(2, 40)
  @Matches(NAME_PATTERN, { message: 'El nombre tiene caracteres no permitidos.' })
  name: string;

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Length(2, 30)
  @Matches(NAME_PATTERN, { message: 'El nombre tiene caracteres no permitidos.' })
  displayName: string;
}

export class JoinFamilyDto {
  @IsString()
  @Length(6, 16)
  inviteCode: string;

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Length(2, 30)
  @Matches(NAME_PATTERN, { message: 'El nombre tiene caracteres no permitidos.' })
  displayName: string;
}

/**
 * Snapshot de estado. Espejo de ReportFamilyStatusRequest del contrato: SOLO
 * booleanos, contadores y el score. Los topes evitan contadores absurdos de un
 * cliente roto o malicioso.
 */
export class ReportStatusDto {
  @IsBoolean()
  shieldActive: boolean;

  @IsOptional()
  @IsISO8601()
  blocklistUpdatedAt: string | null = null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  deviceScanScore: number | null = null;

  @IsInt()
  @Min(0)
  @Max(1_000_000)
  blockedCount: number;

  @IsInt()
  @Min(0)
  @Max(1_000_000)
  alertCount: number;
}
