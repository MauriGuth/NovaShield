import {
  Controller,
  Get,
  Header,
  Req,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { BlocklistMetadata } from '@novashield/shared';
import { ShieldService } from './shield.service';

@Controller('shield')
export class ShieldController {
  constructor(private readonly shield: ShieldService) {}

  /**
   * Mientras las fuentes de amenazas no hayan cargado, estos endpoints
   * responden 503 en vez de servir una lista vacía. Un 503 hace que el
   * dispositivo conserve la lista que ya tiene; una lista vacía la reemplazaría
   * por nada y dejaría el escudo sin bloquear, diciendo que está activo.
   */
  private assertReady(): void {
    if (!this.shield.isReady) {
      throw new ServiceUnavailableException(
        'La lista de bloqueo todavía se está cargando. Reintentá en unos minutos.',
      );
    }
  }

  /**
   * Metadatos para decidir si hace falta re-descargar la lista (y para avisarle
   * al usuario cuántos MB va a consumir antes de bajarla con datos móviles).
   */
  @Get('metadata')
  metadata(): BlocklistMetadata {
    this.assertReady();
    return this.shield.getMetadata();
  }

  /**
   * Lista de bloqueo en binario: hashes de 8 bytes ordenados. Con ETag, así el
   * dispositivo que ya tiene la versión vigente recibe un 304 y no gasta datos.
   */
  @Get('blocklist')
  @Header('Content-Type', 'application/octet-stream')
  @Header('Cache-Control', 'public, max-age=86400')
  blocklist(@Req() req: Request, @Res() res: Response): void {
    this.assertReady();
    const { buffer, version } = this.shield.getHashes();
    const etag = `"${version}"`;

    res.setHeader('ETag', etag);
    res.setHeader('X-Blocklist-Version', version);

    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    res.send(buffer);
  }
}
