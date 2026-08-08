import { FAMILY_MAX_MEMBERS } from '@novashield/shared';
import { DataSource } from 'typeorm';
import { FamilyEntity, FamilyMemberEntity } from './family.entities';
import { FamilyService, hashToken } from './family.service';
import { INVITE_CODE_LENGTH, generateInviteCode, normalizeInviteCode } from './invite-codes';
import { CreateFamilyDto, JoinFamilyDto, ReportStatusDto } from './dto/family.dtos';

/**
 * Tests contra una base sqlite en memoria de verdad (no repos mockeados): lo
 * que se prueba acá es exactamente lo que ejecuta producción, cambiando solo
 * el motor por debajo.
 */
describe('FamilyService', () => {
  let dataSource: DataSource;
  let service: FamilyService;

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [FamilyEntity, FamilyMemberEntity],
      synchronize: true,
    });
    await dataSource.initialize();
    service = new FamilyService(
      dataSource.getRepository(FamilyEntity),
      dataSource.getRepository(FamilyMemberEntity),
    );
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  const createDto = (over: Partial<CreateFamilyDto> = {}): CreateFamilyDto =>
    Object.assign(new CreateFamilyDto(), {
      name: 'Los Pérez',
      displayName: 'Mamá',
      ...over,
    });

  const statusDto = (over: Partial<ReportStatusDto> = {}): ReportStatusDto =>
    Object.assign(new ReportStatusDto(), {
      shieldActive: true,
      blocklistUpdatedAt: null,
      deviceScanScore: 85,
      blockedCount: 3,
      alertCount: 1,
      ...over,
    });

  it('crear una familia devuelve el token una sola vez y guarda solo el hash', async () => {
    const res = await service.create(createDto());

    expect(res.memberToken).toHaveLength(43); // 32 bytes base64url
    expect(res.family.members).toHaveLength(1);
    expect(res.family.members[0].role).toBe('admin');
    expect(res.family.inviteCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const stored = await dataSource
      .getRepository(FamilyMemberEntity)
      .findOneByOrFail({ id: res.memberId });
    expect(stored.tokenHash).toBe(hashToken(res.memberToken));
    expect(stored.tokenHash).not.toContain(res.memberToken);
  });

  it('unirse con el código funciona aunque venga con guiones y minúsculas', async () => {
    const created = await service.create(createDto());
    const joined = await service.join(
      Object.assign(new JoinFamilyDto(), {
        inviteCode: created.family.inviteCode.toLowerCase(), // "abcd-efgh"
        displayName: 'Abuela',
      }),
    );

    expect(joined.family.id).toBe(created.family.id);
    expect(joined.family.members).toHaveLength(2);
    expect(joined.family.members.find((m) => m.isYou)?.displayName).toBe('Abuela');
  });

  it('un código inexistente da not found sin filtrar nada', async () => {
    await expect(
      service.join(
        Object.assign(new JoinFamilyDto(), {
          inviteCode: 'ZZZZ-ZZZZ',
          displayName: 'Nadie',
        }),
      ),
    ).rejects.toThrow('no existe');
  });

  it('respeta el máximo de integrantes', async () => {
    const created = await service.create(createDto());
    for (let i = 1; i < FAMILY_MAX_MEMBERS; i++) {
      await service.join(
        Object.assign(new JoinFamilyDto(), {
          inviteCode: created.family.inviteCode,
          displayName: `Primo ${i}`,
        }),
      );
    }
    await expect(
      service.join(
        Object.assign(new JoinFamilyDto(), {
          inviteCode: created.family.inviteCode,
          displayName: 'Uno más',
        }),
      ),
    ).rejects.toThrow('máximo');
  });

  it('el token resuelve al integrante y un token inventado no', async () => {
    const res = await service.create(createDto());
    const member = await service.memberFromToken(res.memberToken);
    expect(member?.id).toBe(res.memberId);

    expect(await service.memberFromToken('token-falso')).toBeNull();
    expect(await service.memberFromToken('')).toBeNull();
  });

  it('el snapshot guarda SOLO los campos del contrato y el servidor pone reportedAt', async () => {
    const res = await service.create(createDto());
    const member = (await service.memberFromToken(res.memberToken))!;

    const dirty = statusDto();
    (dirty as unknown as Record<string, unknown>).visitedDomains = ['secreto.com'];
    const status = await service.reportStatus(member, dirty);

    expect(status.reportedAt).toBeTruthy();
    expect(Object.keys(status).sort()).toEqual([
      'alertCount',
      'blockedCount',
      'blocklistUpdatedAt',
      'deviceScanScore',
      'reportedAt',
      'shieldActive',
    ]);

    const stored = await dataSource
      .getRepository(FamilyMemberEntity)
      .findOneByOrFail({ id: member.id });
    expect(JSON.stringify(stored.status)).not.toContain('secreto.com');
  });

  it('el overview muestra el estado de todos y marca isYou', async () => {
    const created = await service.create(createDto());
    const admin = (await service.memberFromToken(created.memberToken))!;
    await service.reportStatus(admin, statusDto({ deviceScanScore: 40 }));

    const joined = await service.join(
      Object.assign(new JoinFamilyDto(), {
        inviteCode: created.family.inviteCode,
        displayName: 'Abuela',
      }),
    );
    const abuela = (await service.memberFromToken(joined.memberToken))!;

    const overview = await service.overview(abuela);
    const adminRow = overview.members.find((m) => m.role === 'admin')!;
    expect(adminRow.status?.deviceScanScore).toBe(40);
    expect(adminRow.isYou).toBe(false);
    expect(overview.members.find((m) => m.isYou)?.displayName).toBe('Abuela');
  });

  it('al salir el último integrante la familia y su código desaparecen', async () => {
    const created = await service.create(createDto());
    const admin = (await service.memberFromToken(created.memberToken))!;
    await service.leave(admin);

    expect(
      await dataSource.getRepository(FamilyEntity).exists({ where: { id: created.family.id } }),
    ).toBe(false);
    await expect(
      service.join(
        Object.assign(new JoinFamilyDto(), {
          inviteCode: created.family.inviteCode,
          displayName: 'Tarde',
        }),
      ),
    ).rejects.toThrow('no existe');
  });

  it('si se va el admin, el integrante más antiguo hereda el rol', async () => {
    const created = await service.create(createDto());
    const joined = await service.join(
      Object.assign(new JoinFamilyDto(), {
        inviteCode: created.family.inviteCode,
        displayName: 'Abuela',
      }),
    );

    const admin = (await service.memberFromToken(created.memberToken))!;
    await service.leave(admin);

    const abuela = (await service.memberFromToken(joined.memberToken))!;
    expect(abuela.role).toBe('admin');
  });

  it('el tope de integrantes aguanta uniones CONCURRENTES', async () => {
    // Chequear el conteo y después insertar deja una ventana en la que todas
    // las requests en vuelo leen el mismo número viejo: el tope lo tiene que
    // garantizar el índice único (familyId, seat), no el orden de llegada.
    const created = await service.create(createDto());
    const intentos = Array.from({ length: 25 }, (_, i) =>
      service
        .join(
          Object.assign(new JoinFamilyDto(), {
            inviteCode: created.family.inviteCode,
            displayName: `Primo ${i}`,
          }),
        )
        .then(() => 'ok' as const)
        .catch(() => 'rechazado' as const),
    );
    const resultados = await Promise.all(intentos);

    const total = await dataSource
      .getRepository(FamilyMemberEntity)
      .countBy({ familyId: created.family.id });
    expect(total).toBe(FAMILY_MAX_MEMBERS);
    expect(resultados.filter((r) => r === 'ok')).toHaveLength(FAMILY_MAX_MEMBERS - 1);
  });

  it('el asiento liberado por quien sale se reutiliza', async () => {
    const created = await service.create(createDto());
    const joined = await service.join(
      Object.assign(new JoinFamilyDto(), {
        inviteCode: created.family.inviteCode,
        displayName: 'Abuela',
      }),
    );
    const abuela = (await service.memberFromToken(joined.memberToken))!;
    await service.leave(abuela);

    // Sin reutilización, una familia con mucho movimiento agotaría los asientos
    // sin llegar nunca a tener 10 integrantes a la vez.
    const nuevo = await service.join(
      Object.assign(new JoinFamilyDto(), {
        inviteCode: created.family.inviteCode,
        displayName: 'Tío',
      }),
    );
    expect(nuevo.family.members).toHaveLength(2);
  });

  it('rotar el código invalida el anterior y solo lo puede hacer el admin', async () => {
    const created = await service.create(createDto());
    const joined = await service.join(
      Object.assign(new JoinFamilyDto(), {
        inviteCode: created.family.inviteCode,
        displayName: 'Abuela',
      }),
    );
    const viejo = created.family.inviteCode;

    const abuela = (await service.memberFromToken(joined.memberToken))!;
    await expect(service.rotateInviteCode(abuela)).rejects.toThrow('Solo quien creó');

    const admin = (await service.memberFromToken(created.memberToken))!;
    const actualizada = await service.rotateInviteCode(admin);
    expect(actualizada.inviteCode).not.toBe(viejo);

    await expect(
      service.join(
        Object.assign(new JoinFamilyDto(), { inviteCode: viejo, displayName: 'Colado' }),
      ),
    ).rejects.toThrow('no existe');
  });

  it('el admin puede sacar a un integrante pero no a sí mismo ni de otra familia', async () => {
    const created = await service.create(createDto());
    const joined = await service.join(
      Object.assign(new JoinFamilyDto(), {
        inviteCode: created.family.inviteCode,
        displayName: 'Colado',
      }),
    );
    const admin = (await service.memberFromToken(created.memberToken))!;

    await expect(service.removeMember(admin, admin.id)).rejects.toThrow('Salir de la familia');

    // Integrante de OTRA familia: mismo error que "no existe", no se filtra nada.
    const otra = await service.create(createDto({ name: 'Otros', displayName: 'Ajeno' }));
    await expect(service.removeMember(admin, otra.memberId)).rejects.toThrow(
      'no está en tu familia',
    );

    const overview = await service.removeMember(admin, joined.memberId);
    expect(overview.members).toHaveLength(1);
    expect(await service.memberFromToken(joined.memberToken)).toBeNull();
  });
});

describe('invite codes', () => {
  it('genera códigos del largo esperado sin confusables', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateInviteCode();
      expect(code).toHaveLength(INVITE_CODE_LENGTH);
      expect(code).not.toMatch(/[01OIL]/);
    }
  });

  it('normaliza guiones, espacios y minúsculas', () => {
    expect(normalizeInviteCode(' abcd-2345 ')).toBe('ABCD2345');
  });
});
