const express = require('express');
const { setAuthUser, authRouter } = require('./routes/authRouter.js');
const userRouter = require('./routes/userRouter.js');
const franchiseRouter = require('./routes/franchiseRouter.js');
const orderRouter = require('./routes/orderRouter.js');
const metrics = require('./metrics.js');


const app = express();

app.use(express.json());

// ✅ MUST come BEFORE the routers so req.user exists
app.use(setAuthUser);

app.use(metrics.requestTracker);


app.use('/api/auth', authRouter);
app.use('/api/user', userRouter);
app.use('/api/franchise', franchiseRouter);
app.use('/api/order', orderRouter);

module.exports = app;
