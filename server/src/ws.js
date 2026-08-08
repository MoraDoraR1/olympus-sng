"use strict";
// 실시간 푸시(피격 알림, 지원군 도착, 정복 맵 갱신 등)를 위한 최소 연결 레지스트리.
// 인증은 연결 URL의 ?token= 쿼리로 처리 — REST 로그인에서 이미 발급한 JWT를 재사용한다.
const { WebSocketServer } = require("ws");
const { verifyToken } = require("./auth");

const socketsByPlayer = new Map(); // playerId -> Set<ws>

function attach(server) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url, "http://localhost");
    const token = url.searchParams.get("token");
    const player = token ? verifyToken(token) : null;
    if (!player) {
      ws.close(4001, "unauthorized");
      return;
    }
    if (!socketsByPlayer.has(player.id)) socketsByPlayer.set(player.id, new Set());
    socketsByPlayer.get(player.id).add(ws);

    ws.on("close", () => {
      const set = socketsByPlayer.get(player.id);
      if (set) {
        set.delete(ws);
        if (set.size === 0) socketsByPlayer.delete(player.id);
      }
    });
  });

  return wss;
}

function sendToPlayer(playerId, payload) {
  const set = socketsByPlayer.get(playerId);
  if (!set) return;
  const data = JSON.stringify(payload);
  for (const ws of set) {
    if (ws.readyState === 1) ws.send(data);
  }
}

module.exports = { attach, sendToPlayer };
