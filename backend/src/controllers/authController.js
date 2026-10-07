function createAuthController({ authService }) {
  return {
    async register(req, res) {
      const result = await authService.register(req.validated.body);
      res.status(201).json(result);
    },
    async login(req, res) {
      res.json(await authService.login(req.validated.body));
    },
    async me(req, res) {
      res.json({ user: await authService.getProfile(req.user.id) });
    },
  };
}

module.exports = { createAuthController };
