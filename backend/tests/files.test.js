const request = require('supertest');
const { connectTestDb, disconnectTestDb, clearDb, buildTestApp, registerUser } = require('./helpers');

describe('Files API', () => {
  let app;
  let token;

  beforeAll(connectTestDb);
  beforeEach(async () => {
    ({ app } = buildTestApp());
    ({ token } = await registerUser(app));
  });
  afterEach(clearDb);
  afterAll(disconnectTestDb);

  const upload = (name, content) =>
    request(app)
      .post('/api/files')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from(content), name);

  it('uploads a CSV and uses it as job input', async () => {
    const res = await upload('customers.csv', 'id,name,email\n1,Asha,asha@example.com\n').expect(201);
    expect(res.body.file).toMatchObject({ kind: 'UPLOAD', category: 'csv', originalName: 'customers.csv' });

    await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'CSV_PROCESSING', payload: { fileId: res.body.file.id } })
      .expect(202);

    const download = await request(app)
      .get(res.body.file.downloadUrl)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(download.text).toContain('asha@example.com');
  });

  it('rejects a CSV as input for an image job', async () => {
    const res = await upload('customers.csv', 'id\n1\n').expect(201);
    const job = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'IMAGE_PROCESSING', payload: { fileId: res.body.file.id } })
      .expect(400);
    expect(job.body.error.message).toMatch(/not valid input for IMAGE_PROCESSING/);
  });

  it('rejects unsupported file types', async () => {
    const res = await upload('malware.exe', 'MZ').expect(400);
    expect(res.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it("does not serve another user's files", async () => {
    const res = await upload('customers.csv', 'id\n1\n').expect(201);
    const other = await registerUser(app);
    await request(app).get(res.body.file.downloadUrl).set('Authorization', `Bearer ${other.token}`).expect(404);
  });
});
