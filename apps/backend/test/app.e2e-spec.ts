process.env.BLOCKLIST_DISABLE_REFRESH = '1';
process.env.FAMILY_DB_PATH = ':memory:';

import { ValidationPipe, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module';

describe('API v1 (e2e)', () => {
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

  it('GET /v1/health responde con el estado de las capas', () =>
    request(app.getHttpServer())
      .get('/v1/health')
      .expect(200)
      .expect((res) => {
        expect(res.body.status).toBe('ok');
        expect(res.body.layers.heuristics).toBe(true);
      }));

  it('POST /v1/analyze rechaza body sin url', () =>
    request(app.getHttpServer()).post('/v1/analyze').send({}).expect(400));

  it('POST /v1/analyze rechaza texto sin enlace', () =>
    request(app.getHttpServer())
      .post('/v1/analyze')
      .send({ url: 'hola mundo' })
      .expect(400));

  it('POST /v1/analyze analiza una URL con señales heurísticas', () =>
    request(app.getHttpServer())
      .post('/v1/analyze')
      .send({ url: 'https://mercadopago-premios.top/ganaste' })
      .expect(200)
      .expect((res) => {
        expect(['suspicious', 'malicious']).toContain(res.body.verdict);
        expect(
          res.body.reasons.map((r: { code: string }) => r.code),
        ).toContain('BRAND_IMPERSONATION');
      }));
});
