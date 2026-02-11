const express = require('express');
const { asyncHandler, StatusCodeError } = require('../endpointHelper.js');
const { DB, Role } = require('../database/database.js');
const { authRouter, setAuth } = require('./authRouter.js');

const userRouter = express.Router();

userRouter.docs = [
  {
    method: 'GET',
    path: '/api/user/me',
    requiresAuth: true,
    description: 'Get authenticated user',
    example: `curl -X GET localhost:3000/api/user/me -H 'Authorization: Bearer tttttt'`,
    response: { id: 1, name: '常用名字', email: 'a@jwt.com', roles: [{ role: 'admin' }] },
  },
  {
    method: 'PUT',
    path: '/api/user/:userId',
    requiresAuth: true,
    description: 'Update user',
    example: `curl -X PUT localhost:3000/api/user/1 -d '{"name":"常用名字", "email":"a@jwt.com", "password":"admin"}' -H 'Content-Type: application/json' -H 'Authorization: Bearer tttttt'`,
    response: { user: { id: 1, name: '常用名字', email: 'a@jwt.com', roles: [{ role: 'admin' }] }, token: 'tttttt' },
  },
  {
    method: 'GET',
    path: '/api/user?page=1&limit=10&name=*',
    requiresAuth: true,
    description: 'Gets a list of users (admin only)',
    example: `curl -X GET localhost:3000/api/user?page=1&limit=10&name=* -H 'Authorization: Bearer tttttt'`,
    response: {
      users: [
        { id: 3, name: 'Kai Chen', email: 'd@jwt.com', roles: [{ role: 'diner' }] },
        { id: 5, name: 'Buddy', email: 'b@jwt.com', roles: [{ role: 'admin' }] },
      ],
      more: true,
    },
  },
  {
    method: 'DELETE',
    path: '/api/user/:userId',
    requiresAuth: true,
    description: 'Deletes a user (admin only)',
    example: `curl -X DELETE localhost:3000/api/user/3 -H 'Authorization: Bearer tttttt'`,
    response: {},
  },
];

// GET /api/user/me
userRouter.get(
  '/me',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    res.json(req.user);
  })
);

// PUT /api/user/:userId (self or admin)
userRouter.put(
  '/:userId',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    const { name, email, password } = req.body;
    const userId = Number(req.params.userId);

    // user can update self, admin can update anyone
    if (req.user.id !== userId && !req.user.isRole(Role.Admin)) {
      throw new StatusCodeError('unauthorized', 403);
    }

    const updatedUser = await DB.updateUser(userId, name, email, password);
    const auth = await setAuth(updatedUser);
    res.json({ user: updatedUser, token: auth });
  })
);

// GET /api/user (admin only)
userRouter.get(
  '/',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    if (!req.user.isRole(Role.Admin)) {
      throw new StatusCodeError('unable to list users', 403);
    }

    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '10', 10), 1), 100);
    const name = (req.query.name || '*').toString();

    res.json(await DB.listUsers({ page, limit, name }));
  })
);

// DELETE /api/user/:userId (admin only)
userRouter.delete(
  '/:userId',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    if (!req.user.isRole(Role.Admin)) {
      throw new StatusCodeError('unable to delete user', 403);
    }

    const userId = parseInt(req.params.userId, 10);
    if (!userId) {
      throw new StatusCodeError('invalid userId', 400);
    }

    await DB.deleteUser(userId);
    res.status(204).end();
  })
);

module.exports = userRouter;
