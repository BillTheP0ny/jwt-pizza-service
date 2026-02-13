const request = require('supertest');
const app = require('../app.js');

// ---- helpers ----
function randomEmail() {
  return `user_${Math.random().toString(36).slice(2, 10)}@jwt.com`;
}

function authHeader(token) {
  // IMPORTANT: lowercase header name matches Express req.headers.authorization
  return { authorization: `Bearer ${token}` };
}

async function registerDiner(name = 'pizza diner') {
  const email = randomEmail();
  const password = 'diner';

  const res = await request(app).post('/api/auth').send({ name, email, password });

  expect(res.status).toBe(200);
  expect(res.body.token).toBeTruthy();

  return { ...res.body.user, password, token: res.body.token };
}

// ✅ Retry admin login in CI (default admin user can be created async on first DB init)
async function login(email, password) {
  const isAdmin = email === 'a@jwt.com' && password === 'admin';

  for (let i = 0; i < (isAdmin ? 10 : 1); i++) {
    const res = await request(app).put('/api/auth').send({ email, password });

    if (res.status === 200) {
      expect(res.body.token).toBeTruthy();
      return res.body; // { user, token }
    }

    if (isAdmin) {
      // wait a bit and retry
      await new Promise((r) => setTimeout(r, 200));
      continue;
    }

    // Non-admin should not retry
    expect(res.status).toBe(200);
  }

  throw new Error('Admin login never became available after retries');
}

// ---- tests ----
describe('user list/delete', () => {
  test('list users unauthorized (no token)', async () => {
    const res = await request(app).get('/api/user?page=1&limit=10&name=*');
    expect(res.status).toBe(401);
  });

  test('list users forbidden for non-admin (diner token)', async () => {
    const diner = await registerDiner();

    // sanity check token works
    const me = await request(app).get('/api/user/me').set(authHeader(diner.token));
    expect(me.status).toBe(200);

    const res = await request(app)
      .get('/api/user?page=1&limit=10&name=*')
      .set(authHeader(diner.token));

    expect(res.status).toBe(403);
  });

  test('list users ok for admin', async () => {
    const adminLogin = await login('a@jwt.com', 'admin');

    const res = await request(app)
      .get('/api/user?page=1&limit=10&name=*')
      .set(authHeader(adminLogin.token));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
    expect(typeof res.body.more).toBe('boolean');

    if (res.body.users.length > 0) {
      const u = res.body.users[0];
      expect(u).toHaveProperty('id');
      expect(u).toHaveProperty('name');
      expect(u).toHaveProperty('email');
      expect(u).toHaveProperty('roles');
      expect(Array.isArray(u.roles)).toBe(true);
    }
  });

  test('list users supports name filter (admin)', async () => {
    const adminLogin = await login('a@jwt.com', 'admin');

    const uniqueName = `filterme-${Date.now()}`;
    const created = await registerDiner(uniqueName);

    const res = await request(app)
      .get(`/api/user?page=1&limit=10&name=${encodeURIComponent(uniqueName)}`)
      .set(authHeader(adminLogin.token));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
    expect(res.body.users.some((u) => u.email === created.email)).toBe(true);
  });

  test('delete user forbidden for non-admin', async () => {
    const diner = await registerDiner();

    const res = await request(app)
      .delete(`/api/user/${diner.id}`)
      .set(authHeader(diner.token));

    expect(res.status).toBe(403);
  });

  test('admin can delete user', async () => {
    const diner = await registerDiner('to delete');
    const adminLogin = await login('a@jwt.com', 'admin');

    const del = await request(app)
      .delete(`/api/user/${diner.id}`)
      .set(authHeader(adminLogin.token));

    expect([200, 204]).toContain(del.status);

    // user should be gone: login should fail
    const loginRes = await request(app)
      .put('/api/auth')
      .send({ email: diner.email, password: diner.password });

    expect([401, 404]).toContain(loginRes.status);
  });

  test('list users supports paging (admin)', async () => {
    const adminLogin = await login('a@jwt.com', 'admin');

    const res = await request(app)
      .get('/api/user?page=1&limit=1&name=*')
      .set(authHeader(adminLogin.token));

    expect(res.status).toBe(200);
    expect(res.body.users.length).toBeLessThanOrEqual(1);
    expect(typeof res.body.more).toBe('boolean');
  });
});
