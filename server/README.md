# 올림포스 도시 — 멀티플레이 백엔드

클라이언트(`../game.js`, `../index.html`)는 여전히 빌드 도구 없는 정적 파일이라 GitHub
Pages 등에 그대로 둘 수 있다. 이 `/server`가 계정·정복(PvP) 맵·아이템처럼 여러 플레이어가
공유해야 하는 상태를 담당하는 별도의 Node.js 프로세스다. 클라이언트는 `fetch`/`WebSocket`으로
이 서버에 접속한다.

## 요구 사항

- **Node.js 22.5 이상 필수.** DB에 외부 서비스 대신 Node 내장 `node:sqlite`
  (실험적 기능)를 쓰기 때문에 별도 DB 설치나 네이티브 모듈 컴파일이 필요 없다 — 파일 하나
  (`data/olympus.db`)로 동작한다.

## 로컬 실행

```bash
cd server
npm install
JWT_SECRET="아무-긴-랜덤-문자열" npm start
# http://localhost:8787/api/health 로 확인
```

`npm run dev`는 파일 변경 시 자동 재시작(`node --watch`)한다.

## 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `8787` | HTTP/WebSocket 리슨 포트 |
| `JWT_SECRET` | (개발용 고정값) | **배포 시 반드시 지정.** 로그인 토큰 서명 키 |
| `CORS_ORIGIN` | `*` | 클라이언트가 다른 origin(GitHub Pages 등)에서 서빙될 때 허용할 origin |
| `DB_PATH` | `server/data/olympus.db` | SQLite 파일 경로 |

## 배포

Render / Railway / Fly.io 같은 Node 호스팅이나 직접 관리하는 VPS 어디든, "Node 22+ 런타임에서
`npm install && npm start`를 실행하고 포트를 노출"할 수 있으면 그대로 배포된다. 외부 DB나
캐시 서비스를 따로 프로비저닝할 필요가 없다 — 단, `data/olympus.db`가 재배포마다 초기화되지
않도록 영구 디스크(persistent volume)에 두어야 한다(호스트마다 방식이 다르니 해당 호스팅의
"persistent disk/volume" 설정을 확인).

## 현재 구현된 API

### 계정 (1단계)
- `POST /api/auth/register { nickname, password }` → `{ player, token }`
- `POST /api/auth/login { nickname, password }` → `{ player, token }`
- `GET /api/auth/me` (Bearer 토큰) → `{ player }`
- `GET /api/state` (Bearer 토큰) → `{ state, updatedAt }` — 저장된 게임 상태 없으면 `state: null`
- `PUT /api/state { state }` (Bearer 토큰) → 게임 상태 전체 스냅샷 저장
- `GET /api/health` → `{ ok: true }`
- `WS /ws?token=...` — 연결만 인증하는 최소 스켈레톤. 정복 맵/전투 알림 등은 이후 단계에서 이
  소켓으로 서버→클라이언트 푸시를 보낸다(아직 미사용).

### 정복 맵 (2단계) — `server/src/conquest.js`
- `GET /api/conquest/me` → `{ tile, unlocked, mapWidth, mapHeight }` — 성 레벨 5 이상(서버에
  저장된 game_states 기준)부터 `unlocked:true`
- `POST /api/conquest/spawn` → `{ tile }` — 200x200 맵의 무작위 빈 칸에 배정(멱등), 30분 보호
- `GET /api/conquest/tiles?x0&y0&x1&y1` → `{ tiles: [{x,y,nickname,protectedUntil}] }`

### 이동속도 (4단계) — `server/src/movement.js`, `server/src/heroes.js`
- `GET /api/conquest/travel-time?x&y` → `{ distance, baseSeconds, bestSeconds, bestHeroBonus }` —
  체비쇼프 거리 기준, 최하급 병종/영웅 이동속도 특성 미적용 시(`baseSeconds`)와 보유 영웅 중
  최고 이동 보너스 적용 시(`bestSeconds`) 각각.

### 아이템: 보호막·성 이동 (4단계) — `server/src/items.js`
- `GET /api/items/me` → `{ items:{shield30,shield60,shield120,teleport}, costs:{...} }`
- `POST /api/items/buy { item }` → 골드로 구매(game_states.res.gold 차감)
- `POST /api/items/use-shield { tier: 30|60|120 }` → `world_tiles.protected_until`에 가산(중첩).
  `pvp_missions`에 나를 향한 march 단계 미션이 있으면 차단(현재는 그 표가 늘 비어있어 항상 통과).
- `POST /api/items/use-teleport` → 무작위 빈 칸으로 재배치. 보호막 활성 중이거나 내가 origin인
  진행 중 미션이 있으면 차단(역시 지금은 pvp_missions가 비어있어 후자는 항상 통과).

## 아직 없는 것

플레이어 간 공격/수성전·지원군(도착 순서 기반 합산 전투, 늦은 지원군 자동 철수)은 구현 전이다.
`pvp_missions` 테이블(스키마만 존재)이 그 자리인데, 이게 실제로 채워지기 시작하면 위 아이템
차단 조건들이 손댈 필요 없이 그대로 올바르게 동작하도록 미리 그 표를 조회하게 해뒀다.
