"use strict";
const { verifyToken } = require("./auth");

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const player = token ? verifyToken(token) : null;
  if (!player) return res.status(401).json({ error: "로그인이 필요합니다." });
  req.player = player;
  next();
}

module.exports = { requireAuth };
