const express = require('express');
const { validate } = require('../middleware/validate');
const { registerSchema, loginSchema } = require('../validation/schemas');
const { createAuthController } = require('../controllers/authController');

function authRoutes({ authService, authenticate, rateLimit, config }) {
  const router = express.Router();
  const controller = createAuthController({ authService });
  const authLimiter = rateLimit({
    bucket: 'auth',
    limit: config.rateLimit.authPerWindow,
    windowMs: config.rateLimit.windowMs,
    key: (req) => req.ip,
  });

  router.post('/register', authLimiter, validate({ body: registerSchema }), controller.register);
  router.post('/login', authLimiter, validate({ body: loginSchema }), controller.login);
  router.get('/me', authenticate, controller.me);
  return router;
}

module.exports = { authRoutes };
