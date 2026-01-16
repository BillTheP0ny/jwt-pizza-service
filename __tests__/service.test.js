const request = require('supertest');
const app = require('../src/service');

beforeAll(() => {
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ jwt: '1111111111' }),
  });
});

afterAll(() => {
  global.fetch.mockRestore();
});

async function login(email, password) {
  const res = await request(app).put('/api/auth').send({ email, password });
  expect(res.status).toBe(200);
  expect(res.body.token).toBeDefined();
  return res.body.token;
}

describe('JWT Pizza Service', () => {
  test('GET /api/order/menu returns menu', async () => {
    const res = await request(app).get('/api/order/menu');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('login as admin works', async () => {
    const res = await request(app)
      .put('/api/auth')
      .send({ email: 'a@jwt.com', password: 'admin' });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('a@jwt.com');
    expect(res.body.token).toBeDefined();
  });

  test('creating franchise without auth fails', async () => {
    const res = await request(app)
      .post('/api/franchise')
      .send({ name: 'BadFranchise', admins: [] });

    expect(res.status).toBe(401);
  });

  test('register new user works', async () => {
    const email = `t${Date.now()}@jwt.com`;
    const res = await request(app)
      .post('/api/auth')
      .send({ name: 'test user', email, password: 'test' });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email);
    expect(res.body.token).toBeDefined();
  });

  test('login fails with wrong password', async () => {
    const res = await request(app)
      .put('/api/auth')
      .send({ email: 'a@jwt.com', password: 'wrong' });

    expect(res.status).toBe(404);
  });

  test('GET /api/user/me works with token', async () => {
    const token = await login('a@jwt.com', 'admin');

    const res = await request(app)
      .get('/api/user/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('a@jwt.com');
    expect(res.body.id).toBeDefined();
  });

test('PUT /api/user/:userId updates user name', async () => {
  const token = await login('a@jwt.com', 'admin');

  const me = await request(app)
    .get('/api/user/me')
    .set('Authorization', `Bearer ${token}`);
  expect(me.status).toBe(200);

  const userId = me.body.id;

  const res = await request(app)
    .put(`/api/user/${userId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Admin Updated', email: me.body.email }); // ✅ include email

  expect(res.status).toBe(200);
  expect(res.body.user.name).toBeDefined();
  expect(res.body.token).toBeDefined();
});

  test('admin can create franchise and store', async () => {
    const token = await login('a@jwt.com', 'admin');

    const franchiseName = `pizzaPocket${Date.now()}`;
    const createFranchiseRes = await request(app)
      .post('/api/franchise')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: franchiseName, admins: [{ email: 'a@jwt.com' }] });

    expect(createFranchiseRes.status).toBe(200);
    const franchiseId = createFranchiseRes.body.id;
    expect(franchiseId).toBeDefined();

    const createStoreRes = await request(app)
      .post(`/api/franchise/${franchiseId}/store`)
      .set('Authorization', `Bearer ${token}`)
      .send({ franchiseId, name: 'SLC' });

    expect(createStoreRes.status).toBe(200);
    expect(createStoreRes.body.name).toBe('SLC');
    expect(createStoreRes.body.id).toBeDefined();
  });

  test('GET /api/franchise lists franchises', async () => {
    const res = await request(app).get('/api/franchise?page=0&limit=10&name=*');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('franchises');
  });

  // ✅ FIXED: use real menu item id/title/price
  test('diner can create order and view history', async () => {
    // create diner user
    const email = `d${Date.now()}@jwt.com`;
    const registerRes = await request(app)
      .post('/api/auth')
      .send({ name: 'diner', email, password: 'diner' });
    expect(registerRes.status).toBe(200);
    const dinerToken = registerRes.body.token;

    const adminToken = await login('a@jwt.com', 'admin');

    // ensure at least one menu item exists
    const addMenuRes = await request(app)
      .put('/api/order/menu')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: `Test${Date.now()}`, description: 'T', image: 't.png', price: 0.01 });
    expect(addMenuRes.status).toBe(200);

    // fetch menu and pick real item
    const menuRes = await request(app).get('/api/order/menu');
    expect(menuRes.status).toBe(200);
    expect(Array.isArray(menuRes.body)).toBe(true);
    expect(menuRes.body.length).toBeGreaterThan(0);
    const item = menuRes.body[0];

    // create franchise + store
    const franchiseName = `F${Date.now()}`;
    const frRes = await request(app)
      .post('/api/franchise')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: franchiseName, admins: [{ email: 'a@jwt.com' }] });
    expect(frRes.status).toBe(200);
    const franchiseId = frRes.body.id;

    const storeRes = await request(app)
      .post(`/api/franchise/${franchiseId}/store`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ franchiseId, name: 'SLC' });
    expect(storeRes.status).toBe(200);
    const storeId = storeRes.body.id;

    // create order as diner using real menu item
    const orderRes = await request(app)
      .post('/api/order')
      .set('Authorization', `Bearer ${dinerToken}`)
      .send({
        franchiseId,
        storeId,
        items: [{ menuId: item.id, description: item.title, price: item.price }],
      });

    expect(orderRes.status).toBe(200);
    expect(orderRes.body).toHaveProperty('jwt');

    // view order history
    const historyRes = await request(app)
      .get('/api/order')
      .set('Authorization', `Bearer ${dinerToken}`);

    expect(historyRes.status).toBe(200);
    expect(historyRes.body).toHaveProperty('orders');
  });
});

test('DELETE /api/auth logs out', async () => {
  const token = await login('a@jwt.com', 'admin');
  const res = await request(app)
    .delete('/api/auth')
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
});

test('GET /api/user/me without auth fails', async () => {
  const res = await request(app).get('/api/user/me');
  expect([401, 403]).toContain(res.status);
});
