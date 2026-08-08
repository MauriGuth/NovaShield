process.env.BLOCKLIST_DISABLE_REFRESH = '1';
process.env.FAMILY_DB_PATH = ':memory:';

import { ValidationPipe, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module';

describe('Modo Familia (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('flujo completo: crear → unirse → reportar estado → ver overview → salir', async () => {
    const server = app.getHttpServer();

    const created = await request(server)
      .post('/v1/family')
      .send({ name: 'Los Pérez', displayName: 'Mamá' })
      .expect(201);
    expect(created.body.memberToken).toBeTruthy();
    const { inviteCode } = created.body.family;

    const joined = await request(server)
      .post('/v1/family/join')
      .send({ inviteCode, displayName: 'Abuela' })
      .expect(200);
    expect(joined.body.family.members).toHaveLength(2);

    await request(server)
      .put('/v1/family/me/status')
      .set('Authorization', `Bearer ${joined.body.memberToken}`)
      .send({
        shieldActive: true,
        deviceScanScore: 65,
        blockedCount: 2,
        alertCount: 0,
      })
      .expect(200);

    const overview = await request(server)
      .get('/v1/family/me')
      .set('Authorization', `Bearer ${created.body.memberToken}`)
      .expect(200);
    const abuela = overview.body.members.find(
      (m: { displayName: string }) => m.displayName === 'Abuela',
    );
    expect(abuela.status.deviceScanScore).toBe(65);
    expect(abuela.status.reportedAt).toBeTruthy();

    await request(server)
      .post('/v1/family/leave')
      .set('Authorization', `Bearer ${joined.body.memberToken}`)
      .expect(204);

    const after = await request(server)
      .get('/v1/family/me')
      .set('Authorization', `Bearer ${created.body.memberToken}`)
      .expect(200);
    expect(after.body.members).toHaveLength(1);
  });

  it('sin token (o con token inventado) responde 401', async () => {
    await request(app.getHttpServer()).get('/v1/family/me').expect(401);
    await request(app.getHttpServer())
      .get('/v1/family/me')
      .set('Authorization', 'Bearer token-falso')
      .expect(401);
  });

  it('la validación rechaza nombres vacíos y snapshots con campos de más', async () => {
    const server = app.getHttpServer();

    await request(server)
      .post('/v1/family')
      .send({ name: '', displayName: 'X' })
      .expect(400);

    const created = await request(server)
      .post('/v1/family')
      .send({ name: 'Familia Test', displayName: 'Yo' })
      .expect(201);

    // whitelist:true — el campo extra se descarta y el resto se acepta.
    const res = await request(server)
      .put('/v1/family/me/status')
      .set('Authorization', `Bearer ${created.body.memberToken}`)
      .send({
        shieldActive: false,
        blockedCount: 0,
        alertCount: 0,
        visitedDomains: ['secreto.com'],
      })
      .expect(200);
    expect(JSON.stringify(res.body)).not.toContain('secreto.com');
  });

  it('un snapshot con score fuera de rango se rechaza', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/family')
      .send({ name: 'Otra Familia', displayName: 'Yo' })
      .expect(201);

    await request(app.getHttpServer())
      .put('/v1/family/me/status')
      .set('Authorization', `Bearer ${created.body.memberToken}`)
      .send({ shieldActive: true, deviceScanScore: 150, blockedCount: 0, alertCount: 0 })
      .expect(400);
  });
});
