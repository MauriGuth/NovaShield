import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { FamilyMemberEntity } from './family.entities';
import { FamilyService } from './family.service';

/** Request con el integrante ya autenticado colgado por el guard. */
export interface FamilyRequest extends Request {
  familyMember: FamilyMemberEntity;
}

/**
 * Autenticación por token de dispositivo (bearer). No hay usuarios ni
 * contraseñas todavía: el token se emitió al crear/unirse a la familia y
 * identifica a UN integrante en UN dispositivo.
 */
@Injectable()
export class FamilyAuthGuard implements CanActivate {
  constructor(private readonly family: FamilyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FamilyRequest>();
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    const member = token ? await this.family.memberFromToken(token) : null;
    if (!member) {
      throw new UnauthorizedException(
        'Tu sesión de familia no es válida. Volvé a unirte con el código.',
      );
    }

    request.familyMember = member;
    return true;
  }
}

/** Inyecta el integrante autenticado en el handler. */
export const CurrentMember = createParamDecorator(
  (_: unknown, context: ExecutionContext): FamilyMemberEntity =>
    context.switchToHttp().getRequest<FamilyRequest>().familyMember,
);
