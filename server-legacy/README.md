# 올림포스 도시 — 멀티플레이 백엔드 (레거시, 더 이상 사용하지 않음)

> ⚠️ **현재 백엔드는 이 Node/SQLite 서버가 아니라 `../functions/`(Firebase Cloud
> Functions + Firestore + Firebase Auth)입니다.** 이 디렉터리는 삭제하지 않고
> 이전 구현을 참고용으로만 남겨둔 것입니다 — 새로 배포/실행하지 마세요.
> 라우트·데이터 모델·PvP 스윕 로직의 이식 매핑은 `../functions/README.md`를 참고합니다.

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
cp .env.example .env
# .env를 열어 JWT_SECRET에 아래 명령으로 만든 값을 채워 넣는다(안 채워도 동작은 하지만 권장):
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
npm start
# http://localhost:8787/api/health 로 확인
```

`npm run dev`는 파일 변경 시 자동 재시작(`node --watch`)한다.

## 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `8787` | HTTP/WebSocket 리슨 포트 |
| `JWT_SECRET` | (아래 참고) | 로그인 토큰 서명 키 |
| `CORS_ORIGIN` | `*` | 클라이언트가 다른 origin(GitHub Pages 등)에서 서빙될 때 허용할 origin |
| `DB_PATH` | `server/data/olympus.db` | SQLite 파일 경로 |

`server/.env` 파일(있으면 자동으로 읽음, `.env.example` 참고)이나 실제 환경변수로 설정한다.
`server/.env`는 `.gitignore`에 포함되어 있어 **절대 커밋되지 않는다** — 코드가 아무리 공개되어
있어도(예: 이 저장소를 그대로 GitHub Pages로 서빙하는 경우) 거기엔 실제 비밀값이 담기지 않는다.

`JWT_SECRET`을 코드에 고정값으로 두지 않는다. 아무것도 설정하지 않으면 서버가 처음 켜질 때
이 인스턴스 전용 비밀값을 무작위로 생성해 `server/data/.jwt-secret`에 저장하고 이후 재시작마다
재사용한다(`server/data/`도 `.gitignore` 처리되어 커밋되지 않음) — 로컬 테스트는 아무 설정 없이도
바로 동작하지만, **실제로 여러 사람이 접속하는 배포에서는 반드시 `JWT_SECRET`을 직접 설정**해야
한다. 설정하지 않으면 그 서버가 재배포될 때마다(호스팅에 따라 `server/data/`가 초기화되면) 기존
로그인 토큰이 전부 무효화될 수 있고, 여러 인스턴스를 동시에 띄우는 구성에서는 인스턴스마다 서로
다른 비밀값이 생겨 토큰이 서로 호환되지 않는다.

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
  나를 향한 outbound 공격 미션이 있으면 차단.
- `POST /api/items/use-teleport` → 무작위 빈 칸으로 재배치. 보호막 활성 중이거나 내가 origin인
  진행 중 미션(출정/주둔/귀환)이 있으면 차단.

### 플레이어 간 공격·수성전·지원군 (5단계) — `server/src/pvp.js`, `combat.js`, `troops.js`
기존 싱글플레이 부대 3슬롯(`armies[0..2]`)을 그대로 재사용 — 대상 스쿼드의 `heroIds`가 그
출정에 자동으로 딸려간다(부대가 PvE 임무 중이면 정복 임무로 못 보냄, 반대도 서버가 막는다).
전투력 계산은 game.js의 armyStats()를 그대로 이식했지만 **연구 보너스·방어탑 보정은 포함하지
않는다**(RESEARCH_DEFS 30개 항목 전체를 서버로 옮기는 건 범위 밖으로 판단 — 영웅+병사 기본
스탯만으로 계산해 양쪽에 공평하게 적용). 전투 길이는 몬스터처럼 "레벨"이 없어 고정
10초(`PVP_BATTLE_DURATION_SECONDS`)로 둠.

- `POST /api/conquest/attack { targetPlayerId, squadIndex, comp }` → `{ missionId, arriveAt, travelSeconds, distance }`.
  보호 중인 상대는 공격 불가. 즉시 병사를 `troopsByType`에서 차감(귀환해야 돌려받음).
- `POST /api/conquest/reinforce { targetPlayerId, squadIndex, comp }` → 위와 동일 응답 모양.
  도착하면 전투 없이 'stationed'(주둔) 상태가 되어, 그 타깃이 공격받을 때마다 방어 측 전력에
  자동 합산된다(원래 주인이 철수시키기 전까지 계속).
- `POST /api/conquest/recall { missionId }` → 주둔 중인 내 지원군을 자진 철수(왕복 동일 소요시간).
- `GET /api/conquest/missions` → 나와 관련된(내가 보냈거나, 나를 향한) 모든 미션 목록.

**판정 로직**(`pvp.js`의 `sweepOnce`, 서버가 5초 간격으로 자체 실행 — 상대가 오프라인이어도
정확한 시각에 처리됨):
1. 공격 미션 도착 시각이 지나면: 수비 측 = 방어자의 홈 병력(`troopsByType`, 이미 출정 중인
   병력은 애초에 troopsByType에서 빠져 있어 자동 제외) + 그 타깃에 현재 'stationed'인 모든
   지원군을 합산해 판정. 이긴 쪽은 최대 60%, 진 쪽은 최대 100%까지 병력 손실(game.js
   resolveBattle과 동일한 비대칭). 공격자가 이기면 방어자 보유 자원의 10%를 약탈(`LOOT_PERCENT`,
   구체적 수치가 요청서에 없어 임의 책정). 공격 미션은 'returning'으로 전환.
2. 바로 그 순간, 같은 타깃을 향해 아직 도착 못한(outbound) 지원군은 전부 자동으로 'returning'
   전환(왕복 대칭 — 요청하신 "지원군보다 공격자가 먼저 도착하면 지원군은 철수" 규칙).
3. 지원군 도착 시각이 지나면(전투 없이): 'stationed'로 전환.
4. 귀환 시각이 지나면: 생존 병력을 origin의 `troopsByType`에 돌려주고 미션 행 삭제.

**알려진 한계(동시성)**: 클라이언트는 자기 `state`를 주기적으로 통째로 PUT하는데, 서버가 PvP
판정으로 `troopsByType`/`res`를 바꾼 직후 클라이언트가 그걸 모른 채 예전 값으로 다시 덮어쓸 수
있는 이론적 경우가 있다. 완화책으로 클라이언트가 `GET /api/conquest/missions`를 주기적으로
조회하다 내 미션 중 하나라도 상태가 바뀐 걸 감지하면 즉시 `GET /api/state`를 다시 받아
`troopsByType`/`res`만 병합해 반영한다(`game.js`의 `adoptServerDeltaFields`) — 대부분의 경우를
막아주지만 완벽한 낙관적 동시성 제어는 아니다.

### 치트 방지(부분적) — `server/src/anticheat.js`, `server/src/rateLimit.js`

`PUT /api/state`는 원래 클라이언트가 보낸 게임 상태를 검증 없이 그대로 저장했다 — 즉 자기
계정으로 로그인만 했으면 `res.gold`나 `troopsByType`를 임의의 큰 수로 바꿔치기하는 게 가능했고,
그 값을 그대로 신뢰하는 아이템 구매(`items.js`)·PvP 파병(`pvp.js`)도 함께 무력화됐다. 이 게임
전체(자원 생산·건물 레벨업·훈련)를 서버가 처음부터 다시 계산하는 권위 있는 구조로 바꾸는 건
이번 멀티플레이 전환급의 큰 작업이라, 대신 `PUT /api/state`에 "물리적으로 가능한 범위"만 넉넉하게
검증하는 부분적 완화를 넣었다:

- **자원/병사 증가 상한**: 직전 저장 이후 경과 시간(최대 `OFFLINE_CAP_SECONDS`=12시간, game.js의
  오프라인 진행 상한과 동일) 동안 이론상 가능한 최대 생산량(부지 14칸을 전부 해당 자원 건물로,
  레벨 80·보너스 4배까지 넉넉하게 가정)을 넘는 증가는 거부한다. 병사도 같은 방식(병영 14개가
  전부 그 병종만 훈련한다고 가정)으로 훈련 속도 상한을 둔다.
- **레이드 보상 예외**: 보스 레이드는 한 번에 최대 120만(자원)+72만(골드)이라는 큰 보상을 주므로
  위 상한만으로는 오탐이 난다. `state.raids[bossId].defeated`가 `false→true`로 바뀐 걸 감지하면
  그 보스의 실제 보상만큼만 그 저장에 한해 추가로 허용한다.
- **작은 일회성 획득 여유분**: 몬스터 처치 보상 같은 작은 즉시 지급을 위해 저장 1회당 자원별
  20,000의 flat 여유를 추가로 둔다(가장 작은 레이드 보상 5만보다는 작게 잡아, 레이드 전이 없이
  그 여유분만으로 큰 금액을 우회하지 못하게 함).
- **로그인/회원가입 레이트리밋**: IP당 15분에 20회(`rateLimiter`, 메모리 기반, 별도 패키지 없음).
  닉네임 무차별 대입을 늦춘다.

**이 완화가 막지 못하는 것(의도적으로 범위 밖)**: 건물 레벨·영웅 강화·영웅 보유(가챠 결과)·연구
레벨은 전혀 검증하지 않는다. 레이드도 "실제로 그 보스와 전투했는지"는 서버가 확인할 방법이 없어,
`defeated` 플래그만 조작하면 그 보스의 보상(최대 6종 보스 합계 자원 약 292만+골드 약 175만, 각
보스당 한 번만)을 실제 전투 없이 얻는 게 이론상 가능하다 — 다만 이 값은 정확히 "실제로 그 레이드를
클리어했을 때 받는 것과 동일한, 유한한" 금액이라 무한 증식은 아니다. 완전히 막으려면 서버가
진행(생산·건물·전투) 자체를 계산하는 구조로 다시 설계해야 한다.
