import { createHash, randomBytes } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  FAMILY_MAX_MEMBERS,
  FamilyAuthResponse,
  FamilyMemberStatus,
  FamilyOverview,
} from '@novashield/shared';
import { Repository } from 'typeorm';
import { FamilyEntity, FamilyMemberEntity } from './family.entities';
import { formatInviteCode, generateInviteCode, normalizeInviteCode } from './invite-codes';
import { CreateFamilyDto, JoinFamilyDto, ReportStatusDto } from './dto/family.dtos';

/**
 * Modo Familia.
 *
 * Reglas que NO se negocian (son la promesa del feature):
 * - Un integrante entra solo si él mismo tipea el código en su teléfono, y ve
 *   sobre los demás exactamente lo mismo que los demás ven sobre él.
 * - El estado compartido son contadores, booleanos y un score. Este servicio
 *   jamás recibe ni guarda dominios, mensajes ni ubicaciones.
 * - El token se emite una vez y se guarda solo su hash.
 */
@Injectable()
export class FamilyService {
  constructor(
    @InjectRepository(FamilyEntity)
    private readonly families: Repository<FamilyEntity>,
    @InjectRepository(FamilyMemberEntity)
    private readonly members: Repository<FamilyMemberEntity>,
  ) {}

  async create(input: CreateFamilyDto): Promise<FamilyAuthResponse> {
    const family = await this.families.save(
      this.families.create({
        name: input.name,
        inviteCode: await this.uniqueInviteCode(),
      }),
    );

    const { member, token } = await this.addMember(family, input.displayName, 'admin', 0);
    return this.authResponse(family, member, token);
  }

  async join(input: JoinFamilyDto): Promise<FamilyAuthResponse> {
    const code = normalizeInviteCode(input.inviteCode);
    const family = await this.families.findOne({ where: { inviteCode: code } });
    if (!family) {
      // Mensaje único para código inexistente: no filtramos cuáles existen.
      throw new NotFoundException('Ese código de invitación no existe o venció.');
    }

    // El tope lo hace cumplir el índice único (familyId, seat), no este
    // chequeo: varias uniones simultáneas leen el mismo conteo y todas pasarían
    // el `if`. Se reintenta porque el asiento libre puede habérselo llevado
    // otra request en el intervalo — eso es exactamente lo que queremos que
    // pase, y el reintento lo resuelve sin devolverle un error raro al usuario.
    for (let attempt = 0; attempt < FAMILY_MAX_MEMBERS; attempt++) {
      const taken = await this.members.find({
        where: { familyId: family.id },
        select: { seat: true },
      });
      if (taken.length >= FAMILY_MAX_MEMBERS) {
        throw new ConflictException(
          `La familia ya tiene el máximo de ${FAMILY_MAX_MEMBERS} integrantes.`,
        );
      }

      const seat = firstFreeSeat(taken.map((m) => m.seat));
      if (seat === null) {
        throw new ConflictException(
          `La familia ya tiene el máximo de ${FAMILY_MAX_MEMBERS} integrantes.`,
        );
      }

      try {
        const { member, token } = await this.addMember(
          family,
          input.displayName,
          'member',
          seat,
        );
        return await this.authResponse(family, member, token);
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // Otro integrante se quedó con ese asiento: reintentamos con el siguiente.
      }
    }

    throw new ConflictException(
      'No pudimos sumarte en este momento. Probá de nuevo en unos segundos.',
    );
  }

  /** Resuelve el integrante autenticado a partir del token bearer. */
  async memberFromToken(token: string): Promise<FamilyMemberEntity | null> {
    if (!token) return null;
    return this.members.findOne({
      where: { tokenHash: hashToken(token) },
      relations: { family: true },
    });
  }

  async overview(member: FamilyMemberEntity): Promise<FamilyOverview> {
    const family =
      member.family ??
      (await this.families.findOneOrFail({ where: { id: member.familyId } }));
    const all = await this.members.find({
      where: { familyId: family.id },
      order: { seat: 'ASC' },
    });

    return {
      id: family.id,
      name: family.name,
      inviteCode: formatInviteCode(family.inviteCode),
      createdAt: family.createdAt.toISOString(),
      members: all.map((m) => ({
        id: m.id,
        displayName: m.displayName,
        role: m.role,
        joinedAt: m.joinedAt.toISOString(),
        status: m.status,
        isYou: m.id === member.id,
      })),
    };
  }

  async reportStatus(
    member: FamilyMemberEntity,
    input: ReportStatusDto,
  ): Promise<FamilyMemberStatus> {
    // Se copia campo por campo, nunca `...input`: si mañana el cliente manda
    // un campo de más, no queremos que un spread lo cuele en la base.
    const status: FamilyMemberStatus = {
      shieldActive: input.shieldActive,
      blocklistUpdatedAt: input.blocklistUpdatedAt ?? null,
      deviceScanScore: input.deviceScanScore ?? null,
      blockedCount: input.blockedCount,
      alertCount: input.alertCount,
      reportedAt: new Date().toISOString(),
    };

    await this.members.update(member.id, { status });
    return status;
  }

  /**
   * Salir de la familia. Si no queda nadie, la familia se borra entera (con su
   * código); si se va el admin, se promueve al integrante más antiguo — una
   * familia sin admin no podría regenerar invitaciones el día que exista eso.
   */
  async leave(member: FamilyMemberEntity): Promise<void> {
    await this.members.delete(member.id);

    const remaining = await this.members.find({
      where: { familyId: member.familyId },
      order: { seat: 'ASC' },
    });

    if (remaining.length === 0) {
      await this.families.delete(member.familyId);
      return;
    }

    // La promoción se decide por el asiento más bajo, sin mirar si "ya hay un
    // admin": si dos admins se van casi a la vez, ambos hilos ven la misma
    // lista y con la comprobación previa ninguno promovía a nadie — la familia
    // quedaba sin admin. Promover siempre al asiento más bajo es idempotente:
    // dos ejecuciones concurrentes eligen al mismo y el resultado es correcto.
    const heir = remaining[0];
    if (heir.role !== 'admin') {
      await this.members.update(heir.id, { role: 'admin' });
    }
  }

  /**
   * Cambia el código de invitación. Es la salida cuando el código se filtró
   * (se reenvió al grupo de WhatsApp equivocado, que es lo que va a pasar en la
   * vida real): el viejo deja de funcionar al instante. No echa a nadie que ya
   * esté adentro — para eso está `removeMember`.
   */
  async rotateInviteCode(member: FamilyMemberEntity): Promise<FamilyOverview> {
    this.assertAdmin(member);
    await this.families.update(member.familyId, {
      inviteCode: await this.uniqueInviteCode(),
    });
    return this.overview(await this.reload(member));
  }

  /**
   * Saca a un integrante de la familia. Solo el admin, y no puede sacarse a sí
   * mismo (para eso está `leave`, que además maneja la sucesión).
   */
  async removeMember(admin: FamilyMemberEntity, memberId: string): Promise<FamilyOverview> {
    this.assertAdmin(admin);
    if (memberId === admin.id) {
      throw new ForbiddenException(
        'Para salir vos mismo usá "Salir de la familia".',
      );
    }

    const target = await this.members.findOne({ where: { id: memberId } });
    // Mismo mensaje para "no existe" y "es de otra familia": desde afuera no se
    // puede distinguir, así que no se puede sondear qué ids existen.
    if (!target || target.familyId !== admin.familyId) {
      throw new NotFoundException('Ese integrante no está en tu familia.');
    }

    await this.members.delete(target.id);
    return this.overview(admin);
  }

  // — Internos —

  private assertAdmin(member: FamilyMemberEntity): void {
    if (member.role !== 'admin') {
      throw new ForbiddenException(
        'Solo quien creó la familia puede hacer este cambio.',
      );
    }
  }

  /** Relee el integrante con su familia (para devolver datos frescos). */
  private async reload(member: FamilyMemberEntity): Promise<FamilyMemberEntity> {
    return (
      (await this.members.findOne({
        where: { id: member.id },
        relations: { family: true },
      })) ?? member
    );
  }

  private async addMember(
    family: FamilyEntity,
    displayName: string,
    role: 'admin' | 'member',
    seat: number,
  ): Promise<{ member: FamilyMemberEntity; token: string }> {
    const token = randomBytes(32).toString('base64url');
    const member = await this.members.save(
      this.members.create({
        familyId: family.id,
        displayName,
        role,
        seat,
        tokenHash: hashToken(token),
        status: null,
      }),
    );
    return { member, token };
  }

  private async authResponse(
    family: FamilyEntity,
    member: FamilyMemberEntity,
    token: string,
  ): Promise<FamilyAuthResponse> {
    return {
      family: await this.overview(member),
      memberId: member.id,
      memberToken: token,
    };
  }

  private async uniqueInviteCode(): Promise<string> {
    // 2^39 combinaciones hacen la colisión casi imposible, pero "casi" no es
    // una garantía de unicidad: se verifica contra la base igual.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateInviteCode();
      const exists = await this.families.exists({ where: { inviteCode: code } });
      if (!exists) return code;
    }
    throw new ConflictException('No pudimos generar un código. Probá de nuevo.');
  }
}

/**
 * SHA-256 alcanza (sin salt ni KDF lento) porque el token es aleatorio de 256
 * bits: no hay diccionario posible y el hash no es invertible. Un KDF con
 * costo solo agregaría latencia a cada request autenticada.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Primer asiento libre (0..FAMILY_MAX_MEMBERS-1), o null si están todos. */
export function firstFreeSeat(taken: number[]): number | null {
  const used = new Set(taken);
  for (let seat = 0; seat < FAMILY_MAX_MEMBERS; seat++) {
    if (!used.has(seat)) return seat;
  }
  return null;
}

/**
 * ¿El error es una violación de índice único? Cada driver la reporta distinto:
 * PostgreSQL con el código 23505, sqlite con "UNIQUE constraint failed".
 */
function isUniqueViolation(err: unknown): boolean {
  const candidate = err as { code?: string; message?: string; driverError?: { code?: string } };
  const code = candidate?.code ?? candidate?.driverError?.code;
  if (code === '23505' || code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT') {
    return true;
  }
  return /unique constraint|UNIQUE constraint failed/i.test(candidate?.message ?? '');
}
