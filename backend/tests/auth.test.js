const request = require('supertest');
const { connectTestDb, disconnectTestDb, clearDb, buildTestApp, registerUser } = require('./helpers');

describe('Auth API', () => {
  let app;

  beforeAll(async () => {
    await connectTestDb();
    ({ app } = buildTestApp());
  });
  afterEach(clearDb);
  afterAll(disconnectTestDb);

  it('registers a user and returns a token without the password hash', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Asha', email: 'Asha@Example.com', password: 'super-secret-1' })
      .expect(201);

    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ name: 'Asha', email: 'asha@example.com' });
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it('rejects duplicate emails with 409', async () => {
    const { user } = await registerUser(app);
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Copy', email: user.email, password: 'another-password' })
      .expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('validates registration input', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: '', email: 'nope', password: 'short' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d) => d.path)).toEqual(
      expect.arrayContaining(['body.name', 'body.email', 'body.password']),
    );
  });

  it('logs in with correct credentials and rejects wrong ones identically', async () => {
    const { user, password } = await registerUser(app);

    const ok = await request(app).post('/api/auth/login').send({ email: user.email, password }).expect(200);
    expect(ok.body.token).toEqual(expect.any(String));

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'wrong-password' })
      .expect(401);
    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ghost@example.com', password: 'whatever-123' })
      .expect(401);
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
  });

  it('protects routes with JWT authentication', async () => {
    await request(app).get('/api/jobs').expect(401);
    await request(app).get('/api/jobs').set('Authorization', 'Bearer not-a-jwt').expect(401);

    const { token, user } = await registerUser(app);
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(me.body.user.id).toBe(user.id);
  });
});
