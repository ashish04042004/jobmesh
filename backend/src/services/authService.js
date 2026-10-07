const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, toUserDTO } = require('@jobmesh/shared');
const { conflict, unauthorized } = require('../utils/AppError');

function createAuthService({ jwtSecret, jwtExpiresIn, bcryptRounds }) {
  // Compared against when the email is unknown so both login failure paths cost
  // one bcrypt comparison, preventing account enumeration through timing.
  const dummyHash = bcrypt.hashSync('jobmesh-timing-equalizer', bcryptRounds);

  const issueToken = (user) =>
    jwt.sign({ sub: String(user._id) }, jwtSecret, { algorithm: 'HS256', expiresIn: jwtExpiresIn });

  return {
    async register({ name, email, password }) {
      const passwordHash = await bcrypt.hash(password, bcryptRounds);
      try {
        const user = await User.create({ name, email, passwordHash });
        return { user: toUserDTO(user), token: issueToken(user) };
      } catch (err) {
        if (err?.code === 11000) throw conflict('An account with this email already exists');
        throw err;
      }
    },

    async login({ email, password }) {
      const user = await User.findOne({ email }).select('+passwordHash');
      const valid = await bcrypt.compare(password, user?.passwordHash ?? dummyHash);
      if (!user || !valid) throw unauthorized('Invalid email or password');
      return { user: toUserDTO(user), token: issueToken(user) };
    },

    async getProfile(userId) {
      const user = await User.findById(userId);
      if (!user) throw unauthorized('User no longer exists');
      return toUserDTO(user);
    },
  };
}

module.exports = { createAuthService };
