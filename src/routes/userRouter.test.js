const request = require('supertest');
const app = require('../app.js');

// ---- helpers ----
function randomEmail() {
  return `user_${Math.random().toString(36).slice(2, 10)}@jwt.com`;
}

function authHeader(token) {
  // IMPORTANT: use lowercase header name to match Express req.headers.authorization
  return { authorization: `Bearer ${token}` };
}

async function registerDiner() {
  const email = randomEmail();
  const password = 'diner';
  const name = 'pizza diner';

  const res = await request(app).post('/api/auth').send({ name, email, password });

  expect(res.status).toBe(200);
  expect(res.body.token).toBeTruthy();

  return { ...res.body.user, password, token: res.body.token };
}

async function login(email, password) {
  const res = await request(app).put('/api/auth').send({ email, password });

  expect(res.status).toBe(200);
  expect(res.body.token).toBeTruthy();

  return res.body; // { user, token }
}

// ---- tests ----
describe('user list/delete', () => {
  test('list users unauthorized (no token)', async () => {
    const res = await request(app).get('/api/user');
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
  });

  test('delete user forbidden for non-admin', async () => {
    const diner = await registerDiner();

    const res = await request(app)
      .delete(`/api/user/${diner.id}`)
      .set(authHeader(diner.token));

    expect(res.status).toBe(403);
  });

  test('admin can delete user', async () => {
    const diner = await registerDiner();
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

  test('list users supports paging and name filter (admin)', async () => {
    const adminLogin = await login('a@jwt.com', 'admin');

    const res = await request(app)
      .get('/api/user?page=1&limit=1&name=a*')
      .set(authHeader(adminLogin.token));

    expect(res.status).toBe(200);
    expect(res.body.users.length).toBeLessThanOrEqual(1);
    expect(typeof res.body.more).toBe('boolean');
  });
});
