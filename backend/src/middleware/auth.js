const jwt = require('jsonwebtoken');
const { mongoose } = require('@jobmesh/shared');
const { unauthorized } = require('../utils/AppError');

function createAuthenticate({ jwtSecret }) {
  return function authenticate(req, _res, next) {
    const [scheme, token] = (req.get('authorization') || '').split(' ');
    if (scheme !== 'Bearer' || !token) return next(unauthorized('Missing bearer token'));

    try {
      const payload = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
      if (!mongoose.isValidObjectId(payload.sub)) return next(unauthorized('Invalid token subject'));
      req.user = { id: payload.sub };
      return next();
    } catch {
      return next(unauthorized('Invalid or expired token'));
    }
  };
}

module.exports = { createAuthenticate };
