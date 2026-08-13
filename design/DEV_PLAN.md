# DEV_PLAN — 올림포스 도시 (가제)

> 개발 계획서 · 작성일 2026-08-10
> 관련 문서: [CONCEPT.md](CONCEPT.md) · [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md) · [ASSET_LIST.md](ASSET_LIST.md)

> ⚠️ **2026-08-12 갱신**: 아래 1-3절 "미구현/비어 있음"의 **"저장소 관리"** 항목과 M1·M5는
> 이 문서 작성 시점 기준이다. 그날 바로 git 저장소를 정리했고, 이어서 백엔드를
> Node.js/SQLite(`server/`)에서 Firebase(Firestore + Cloud Functions + Firebase Auth,
> `functions/`)로 교체를 시도했다 — **하지만 그 Firebase 시도는 이후 전부 폐기됐다**
> (`functions/`·`firebase.json` 등 관련 파일 삭제, 저장소에 흔적 없음). **지금 실제로
> 배포되어 매 `main` 푸시마다 GitHub Actions로 자동 배포되는 백엔드는 Cloudflare
> Workers**(Hono + D1 + Durable Objects, `workers/`)다. `server/`는 `server-legacy/`로
> 이름을 바꿔 참고용으로만 남겼다. 1-1·1-2절 표와 5절 하단 검증 기록에서 최신 상태를 본다
> — **기존 검증 기록 항목은 당시 사실 그대로 보존**했고(문서 자체 규칙, 4-4절 참고),
> 그 위에 2026-08-12 항목을 새로 추가하는 방식으로 갱신했다.

---

## 0. 이 계획의 전제

이 프로젝트는 **"앞으로 만들 게임"이 아니라 "이미 상당 부분 만들어진 게임"이다.**
컨셉 기획서에 적힌 핵심 시스템 4축(영웅·전투·건물 레벨업·대인 전략)은 전부 코드에 존재하며
동작한다. 따라서 이 계획서의 목적은 신규 기능 나열이 아니라

1. **무엇이 진짜로 끝났고 무엇이 검증되지 않았는지 구분하고**
2. **남은 위험을 우선순위대로 처리하는 것**

에 있다.

---

## 1. 현재 상태

### 1-1. 구현 완료 (동작 확인됨)

| 영역 | 내용 |
|---|---|
| 건물 | 11종 · 최대 Lv.20 · 성 상한 규칙 · 선행 조건 7종 · 조건 체크리스트 UI |
| 자원 | 4종 생산/소비 · 초당 생산량 표시 · 저장 상한 · 오프라인 12시간 소급 |
| 영웅 | 도감 300명(★1~★8 + 까미) · 다중 특성(전투/건물/이동) · 강화 0~5강 |
| 여관 | 10분 주기 · 레벨별 5~8슬롯 · 수동 초기화 누적 비용 · 레이드 확정 소환권 |
| 병영 | 병종 5종 · 훈련 대기열 · 레벨별 해금 |
| 부대 | 3부대 × 영웅 3명 · 병종 자유 편성 · 전투력 산출 · 비대칭 손실 판정 |
| 아카데미 | 연구 30종 × Lv.5 · 3중 해금 조건 · 티어별 비용 급증 곡선 |
| PvE | 야생 몬스터 8슬롯(Lv.1~30) · NPC 성 20개("🏯 침략") · 보스 레이드 6종 체인 |
| 백엔드 | **Cloudflare Workers**(Hono + D1 + Durable Objects, `workers/`) — 계정/세이브 동기화/정복 맵 200×200/공격·지원·철수·약탈/보호막·텔레포트. Firebase 이식을 시도했다가 폐기하고 이 구조로 정착, `main` 푸시마다 GitHub Actions로 자동 배포 중(실제 운영 배포 확인됨) |
| 치트 방지 | 자원·병사 증가 상한 · 레이드 예외 · 자체 구현 IP 레이트리밋(D1 기반, 외부 인증 서비스 의존 없음) |
| 화면 | 로그인 · 타이틀 · 도시 보드 · 정복(PvP) 맵 · "🏯 침략"(NPC 성) 모달 · 종료 · 설명서 · 튜토리얼 · 영웅 열람 |
| 에셋 | 절차적 SVG 360장 (`tools/gen-assets.mjs`로 일괄 재생성 가능) |

### 1-2. 구현됐으나 검증 부족 (**가장 큰 위험**)

| 영역 | 왜 위험한가 |
|---|---|
| **비동기 PvP 전 경로** | Firebase 에뮬레이터 시절 4계정 시나리오(공격→전투→약탈→귀환, 지원→주둔→합산→철수, 지원군 자동 철수)를 스크립트로 재현해 통과시켰다(2026-08-11 검증 기록 참고). 이후 Firebase는 폐기하고 Cloudflare Workers로 정착했다 — `workers/test/`에 개별 시나리오 검증 스크립트(`integration.attack.manual.mjs`, `integration.sweep.manual.mjs`, `pvp-recall-and-losscap-check.mjs`, `pvp-result-notification-check.mjs` 등)가 쌓여 있어 부분적으로는 검증됐지만, **이 문서 5절의 정식 검증 기록으로 종합 정리된 적은 아직 없다** |
| **약탈률 10%** | 근거 없이 임의 책정한 값. 너무 낮으면 공격할 이유가 없고 너무 높으면 접속 못 하는 유저가 이탈한다 |
| **PvP 전력 비대칭** | 서버 전투는 연구·방어탑을 빼고 계산한다. 연구를 만렙까지 올린 유저와 아닌 유저가 PvP에서 동등해져 **투자 보람이 사라진다** |
| ~~PvP 스윕 정밀도 저하~~ | **해결(2026-08-12)** — Durable Object Alarm API로 미션 도착 시각에 정확히 스윕하도록 재구현(`SYSTEM_DESIGN.md` 11-2절). 폴링도 분 단위 지연도 없다 |
| **후반 밸런스** | 성 Lv.15~20 구간, 연구 티어 8~10 구간을 실제로 도달해 체감한 기록이 없다. 다만 성 Lv.19→20(최종) 특별 해금 조건과 PvE 전투력 위계(필드<NPC 성<레이드)는 2026-08-12에 재설계·검증했다(5절 하단 참고) |

### 1-3. 미구현 / 비어 있음

| 항목 | 현황 |
|---|---|
| WebSocket 실시간 알림 | 서버에 인증 스켈레톤만 있었고 클라이언트는 전혀 연결하지 않았다 — Firebase 이식 시 폐기(죽은 코드였음). 필요해지면 Firestore 실시간 리스너(`onSnapshot`)로 대체하는 편이 훨씬 자연스럽다 |
| 영웅 개별 원화 | 300명 전부 절차 생성 SVG. 상위 등급 대표 초상이 없다 |
| UI 에셋 | `assets/ui/` 폴더가 비어 있다 |
| 사운드 | 전무 (ART_DIRECTION에 방향만 기록) |
| 랭킹·길드·채팅 | 비목표 (CONCEPT 8절) |
| ~~저장소 관리~~ | ~~git 저장소가 아니다...~~ **2026-08-10 해결** — git 저장소 정리 완료, `.gitignore`가 비밀값을 제외하도록 구성됨 |

---

## 2. 마일스톤

### M1 — 저장소·문서 정리 (0.5일) — ✅ 완료 (2026-08-10~11)

- [x] 이중 중첩 폴더 해소
- [x] git 초기화/원본 저장소 연결, `.gitignore`가 비밀값·DB를 제외하는지 확인
- [x] `GAME_DESIGN.md` 상단에 "v0.1 기록 · 최신 사양은 SYSTEM_DESIGN.md" 배너 추가
- [x] 수치 SoT 원칙 공지
- [x] **(추가)** 백엔드를 Firebase로 전면 교체하면서 `server/` → `server-legacy/`로 이름 변경,
      `functions/`(Cloud Functions) 신설, `firebase.json`/`firestore.rules`/`firestore.indexes.json` 추가

### M2 — 비동기 PvP 실전 검증 (2~3일) ★ 최우선 리스크

- [x] **(에뮬레이터 기준)** 테스트 계정 4개로 시나리오 전수 검증 — 공격 도착→전투 판정→약탈
      →귀환, 지원 파병→주둔→전력 합산→해제, **지원군 자동 철수**(공격자가 먼저 도착하면
      미도착 지원군이 전부 `returning`), 신규 보호 30분간 공격 차단. 전부 통과 (2026-08-11)
- [x] ~~실제 Firebase 프로젝트에서 동일 시나리오 재검증~~ **경로 자체가 폐기됨(2026-08-12)**
      — Firebase를 포기하고 Cloudflare Workers로 정착했다. 아래 항목으로 대체:
- [ ] **Cloudflare Workers 실배포**에서 다인 PvP 시나리오를 이 문서에 정식 기록으로 재검증
      (`workers/test/*.manual.mjs`가 부분적으로 존재하지만 종합 기록은 아직 없음, 5절
      2026-08-12 항목 참고)
- [ ] 약탈률·보호막 지속시간·이동 기준시간(60초/타일) 튜닝
- [x] 결과를 이 문서 하단 "검증 기록"에 남긴다 — 2026-08-11·2026-08-12 항목까지 기록됨

### M3 — 서버 신뢰성 (3~4일)

- [ ] `saveState`(구 `PUT /api/state`) 낙관적 동시성 제어 — 현재(D1)는 행 전체를 그대로
      덮어쓰는 방식이라 원본과 동일한 수준의 완화(anticheat 델타 검사)만 있고, 완전한 버전
      충돌 감지는 아님
- [ ] **연구·방어탑 보정을 서버 전투 계산에 이식** — 최소한 `troopPercent`와 `defensePercent`
      집계값만이라도 세이브에 캐싱해 Workers가 읽게 한다
- [ ] 레이드 클리어 서버 검증 — 최소한 "선행 보스 처치 + 쿨타임" 정합성만이라도 서버가 확인
- [x] ~~PvP 스윕을 Cloud Tasks 기반 정밀 스케줄링으로 승격할지 결정(현재 1분 주기)~~
      **해결(2026-08-12)** — Durable Object Alarm API로 이미 밀리초 단위 정밀 스윕 중.
      Cloud Tasks 자체가 Firebase 전용 개념이라 더 이상 해당 없음

### M4 — 콘텐츠·온보딩 (3~5일)

- [ ] 영웅 초상 상위 등급부터 — ★8(8명) → 까미 → ★7(17명) 순 (`ASSET_LIST.md` 4절)
- [ ] 첫 진입 온보딩 보강 — 특히 **정복 맵 첫 진입**(성 Lv.5) 시점의 안내가 현재 없다
- [ ] 감시탑 정보 공개 UI — 지금은 "Lv.N+ 필요" 텍스트뿐. 어느 정도 올려야 하는지 직관적으로
- [ ] 전투 보고서 화면 — 누가/언제/얼마나 약탈했는지 다시 볼 수 있게
- [ ] `assets/ui/` 채우기

### M5 — 배포 (1~2일)

> ⚠️ **2026-08-12 갱신**: 아래 Firebase 관련 항목들은 당시 계획대로 진행하다가 **결국
> 폐기됐다.** 실제로 완료된 배포는 Cloudflare Workers 쪽이다 — 정적 클라이언트와 API가
> 같은 Worker에서 함께 서빙되고(`workers/wrangler.jsonc`의 `assets`), `main`에 `workers/**`
> 또는 프론트 파일이 반영될 때마다 `.github/workflows/cloudflare-deploy.yml`이
> `wrangler deploy`로 자동 배포한다. `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`/
> `JWT_SECRET`을 GitHub Secrets에 등록해두면 그 뒤로는 완전 자동이며, 이 세션에서도 실제
> 배포 성공을 여러 차례 확인했다.

- [x] 클라이언트 정적 호스팅 — ~~GitHub Pages~~ → **Cloudflare Workers Assets로 대체**
      (별도 정적 호스팅 불필요, API와 한 오리진에서 서빙)
- [x] ~~서버 호스팅 선정~~ → (Firebase 시도는 폐기) → **Cloudflare Workers**로 정착,
      별도 서버 인스턴스 관리 불필요
- [x] `JWT_SECRET` 명시적 설정 — GitHub Secrets에 등록, 배포 시 `wrangler secret put`으로 주입
- [x] ~~`data/olympus.db`를 영구 디스크에~~ **D1(관리형 SQLite 호환 DB)로 대체돼 해당 없음**
- [x] D1 데이터베이스/마이그레이션 자동화 — 배포 워크플로가 `olympus-sng-db`를 조회하고
      없으면 생성, `wrangler d1 migrations apply --remote`까지 매 배포마다 실행
- [x] `CORS_ORIGIN` 관련 항목 없음 — 클라이언트와 API가 같은 Worker/오리진에서 서빙되므로
      CORS 헤더 자체가 불필요(`workers/src/index.js` 상단 주석). server-legacy는 GitHub
      Pages ↔ 별도 백엔드 구조라 CORS가 필수였던 것과 대비된다

---

## 3. 리스크

| # | 리스크 | 영향 | 완화책 |
|---|---|---|---|
| R1 | **클라이언트 권위 구조** — 건물·영웅·연구·레이드가 서버 미검증 | 치트로 진행도 조작 가능. 랭킹을 도입하면 즉시 무의미해진다 | 부분 완화는 이미 있다(자원·병사 상한, `workers/src/lib/anticheat.js`). **랭킹을 도입하지 않는 한 치명적이지 않다** |
| R2 | **상태 덮어쓰기 경합** | PvP 판정 결과가 사라져 병력·자원이 되살아난다 | 현재는 미션 상태 변화 감지 후 부분 병합으로 완화(세 백엔드에 걸쳐 동일 방식 유지). M3에서 개선 검토 |
| R3 | **소수 유저 시 정복 맵 공허** | 200×200에 몇 명이면 서로 못 찾는다 | 초기 스폰을 맵 중앙 일부 영역에 몰거나 유효 맵 크기를 동적 축소. 실제 배포 후 확인 |
| R4 | **PvP에 연구·방어탑 미반영** | 성장 투자가 대인전에서 무의미해져 성장 동기가 꺾인다 | M3에서 집계값 캐싱 방식으로 이식 |
| R5 | **영웅 300명 초상 물량** | 절차 생성 SVG만으로는 상위 등급의 상징성이 약하다 | 등급 역순 단계적 제작 |
| R6 | ~~PvP 스윕 정밀도~~ | ~~Cloud Scheduler 최소 1분 간격이라 판정이 늦어질 수 있다~~ | **해결(2026-08-12)** — Durable Object Alarm API로 정밀 스윕 재구현. 아래 항목 없음 |
| R7 | **후반 밸런스 미검증** | Lv.15~20 구간이 지루하거나 불가능할 수 있다 | M2와 함께 시뮬레이션 스크립트로 자원 곡선 검증 |

---

## 4. 검증 방법

### 4-1. 다인 PvP 시나리오 테스트 (M2)

> ⚠️ 아래는 Firebase 에뮬레이터 시절 절차였다(2026-08-11 검증 기록에서 실제로 이렇게
> 수행함). Firebase 시도가 폐기된 지금은 Cloudflare Workers 기준으로 다시 써야 한다.

**현재(Workers) 기준 절차**:
```bash
cd workers && npm install
node --test test/*.test.js  # lib.test.js/auth.test.js 등 유닛 테스트(DB 불필요)
npx wrangler dev --config wrangler.dev-api-only.jsonc --port 8790  # 로컬 D1 + Durable Object로 API만 기동
node test/integration.attack.manual.mjs   # (다른 터미널) 공격→전투→약탈→귀환 시나리오
node test/integration.sweep.manual.mjs    # Durable Object 알람 스윕 동작 확인
```
로컬 `wrangler dev`는 Durable Object의 Alarm API를 실제와 동일하게(같은 지연 시간 그대로)
실행한다 — Firebase 에뮬레이터가 Cloud Scheduler를 흉내내지 못해 필요했던 "스윕 수동
트리거용 콜러블" 같은 우회 자체가 필요 없어졌다. 대신 `integration.sweep.manual.mjs`처럼
실제 이동 시간(예: 인접 타일 60초)만큼 실제로 대기하는 방식으로 검증한다.

**(참고, 폐기된 절차) Firebase 에뮬레이터 시절**:
```bash
npm install
node scripts/sync-heroes.js
npx firebase emulators:start --only firestore,auth,functions
```
계정 여러 개로 Firebase Auth(이메일/비밀번호, 닉네임을 합성 이메일로 변환) → `conquestSpawn`
콜러블 → 각 시나리오를 `scripts/dev-test/pvp-scenario.mjs` 같은 스크립트로 실행하고
`pvpMissionsMine` 콜러블로 상태 전이를 추적했다. 에뮬레이터는 Cloud Scheduler를 직접
흉내내지 못해 `pvpSweepManual`(에뮬레이터 전용 콜러블)로 스윕을 즉시 트리거해야 했다.

### 4-2. 확률 시뮬레이션

여관 롤 10,000회를 돌려 실제 등급 분포가 `ROLL_TABLE`과 일치하는지, 연구 최대 시
★6 이상이 **1.74%** 부근에 수렴하는지 확인한다. (SYSTEM_DESIGN 4-2 표와 대조)

### 4-3. 자원 곡선 시뮬레이션

성 Lv.1 → Lv.20까지의 누적 자원 요구량과, 각 시점의 초당 생산량으로 도달 소요 시간을 계산한다.
**목표**: 특정 구간에서 대기 시간이 비정상적으로 튀지 않을 것.
`levelCostFactor`의 구간 경계(Lv.5/10/15)에서 특히 주의해서 본다.

### 4-4. 문서–코드 정합성

수치를 바꿀 때마다 `SYSTEM_DESIGN.md`의 해당 표를 함께 갱신한다.
`ROLL_TABLE` / `TROOP_TYPES` / `RAID_BOSSES` / `LEVEL_REQUIREMENTS` / `CASTLE_UNLOCK_GATES` /
`TAVERN_CYCLE` / `BASE_CAP` / `LOOT_PERCENT`가 특히 자주 어긋난다. 2026-08-12에는
`RAID_BOSSES.powerMult`(80% 하향)와 몬스터 21~30구간 성장률, `CASTLE_UNLOCK_GATES`(신규)가
바뀌었는데도 문서가 한동안 안 맞았던 사례였다.

---

## 5. 검증 기록

> 검증을 수행할 때마다 이 절에 **아래에 이어서** 추가한다. 기존 기록은 수정하지 않는다.

### 2026-08-10 — 문서 작성 시점 코드 대조 [완료]

- `game.js` / `server/src/*.js`의 상수를 전수 확인해 `SYSTEM_DESIGN.md`에 실측값으로 반영
- 영웅 300명을 파싱해 등급별 인원(50/50/45/57/40/32/17/8+까미 1)·특성 개수(1/1/1/1/2/2/3/3)·
  스탯 범위·특성 타입 분포(combat 211 / building 207 / movement 6)를 산출해 기재
- 연구 30종을 파싱해 전부 Lv.5 시 누적 효과 산출 (troop +230% / defense +220% /
  production +180% / gold +230% / 영입 −70% / 초기화 −75% / rarityBoost 15.5)
- 연구 최대 시 ★6 이상 등장 확률이 **1.74%**로 계산됨을 확인 (코드 주석의 "약 1.8%"와 일치)
- **미검증**: 실제 플레이·다인 PvP는 이번 범위 밖. M2에서 수행

### 2026-08-11 — 백엔드 Firebase 전면 교체 + 에뮬레이터 통합 검증 [완료]

- `server/`(Node.js + Express + SQLite, 15개 모듈)를 전부 분석해 `functions/`(Firebase Cloud
  Functions + Firestore + Firebase Auth)로 포팅. 순수 로직(`troops`/`movement`/`combat`/
  `anticheat`/`heroes`)은 수치 변경 없이 그대로 이식하고 유닛 테스트 10건 통과 확인
- `data/heroes.js`를 브라우저 전역·Node `module.exports` 겸용으로 한 줄 수정해, 기존의
  "텍스트를 읽어 `new Function`으로 감싸는" 편법 없이 정식 `require`로 재사용하게 개선
- Firestore 데이터 모델: `players/{uid}`(세이브 전체), `playerItems/{uid}`, `worldTiles/{x}_{y}`
  (좌표를 문서 ID로 써서 트랜잭션 기반 원자적 타일 선점), `pvpMissions/{id}`
- Firebase Auth는 닉네임을 `u-<hex>@olympus-sng.local` 형태의 합성 이메일로 매핑해 사용 —
  이메일 자체의 유일성 제약이 곧 닉네임 유일성 보장이라 별도 예약 컬렉션이 필요 없음을 확인
- **버그 수정**: `server-legacy/src/items.js`의 보호막/성 이동 사용 차단 로직이 `pvp.js`가
  실제로 쓰는 phase 값(`outbound`/`stationed`/`returning`)이 아니라 쓰인 적 없는 값
  (`march`/`battle`/`return`)을 검사하고 있어 사실상 항상 통과되는 죽은 코드였다. Firebase
  이식본(`functions/src/lib/items.js`)에서 올바른 phase 값으로 바로잡았다
- PvP 스윕(5초 주기 `setInterval` → Cloud Scheduler 1분 주기 `onSchedule`)을 각 미션별
  Firestore 트랜잭션으로 재작성 — 트랜잭션 안에서 미션의 phase를 재확인한 뒤에만 전이시켜,
  기존 SQLite/단일 프로세스가 암묵적으로 보장하던 "이중 처리 방지"를 명시적으로 재구현
- Firebase Local Emulator Suite(Firestore/Auth/Functions)로 다음을 전부 실행·통과 확인:
  - 회원가입 → 프로필 등록 → 상태 저장 → 재로그인 → 정상 증가분 통과/비정상 급증 거부(anticheat)
  - 정복 맵: 성 레벨 미달 시 spawn 거부, 해금 후 spawn 성공(멱등 확인), 아이템 구매/보호막
    사용/성 이동(신규 보호 30분 중 텔레포트 차단 포함), 좌표 이동 트랜잭션 자체 검증
  - PvP 4계정 시나리오: 지원군 도착→주둔, 공격 도착→전투 판정(승리·약탈), 아직 미도착인
    지원군이 공격 판정과 동시에 자동 철수, 패배 측 100% 전멸, 귀환 후 생존 병력 복귀
  - **실제 Chromium 브라우저**(Playwright)로 index.html을 직접 조작 — 회원가입, 게임 시작,
    자원 생산 틱, 새로고침 후 세션 유지(Firebase Auth), 정복 맵 해금/참가, 인벤토리 모달의
    정복 아이템 섹션 로딩까지 콘솔 에러 없이 통과
- **미검증(내일 이후)**: 실제 Firebase 프로젝트 연결 후 동일 시나리오 재확인, Cloud Scheduler
  1분 주기 스윕이 실제로 정확히 도는지, GitHub Pages 재배포 후 실사용자 흐름

### 2026-08-12 — Firebase 시도 폐기 확인 + Cloudflare Workers가 실배포 백엔드임을 재확인, PvE 밸런스 3건 수정 [완료]

- **Firebase 시도는 결국 폐기됐다.** 저장소 전체를 검색해도 `firebase`라는 문자열이
  코드/설정에 전혀 남아있지 않음을 확인(`functions/`·`firebase.json` 등 삭제됨,
  `chore: hello-score 제거 + Firebase 백엔드 시도 정리` 커밋). 2026-08-11 검증 기록은
  **당시엔 사실이었지만 그 이후 뒤집힌 결정**으로 남겨둔다(문서 자체 append-only 원칙)
- **현재 실제로 배포되어 있는 백엔드는 Cloudflare Workers**(`workers/`, Hono + D1 +
  Durable Object `PvpCoordinator`)임을 직접 확인 — 이번 세션에서 `game.js`/`index.html`을
  4차례 수정해 `main`에 병합·푸시했고, 매번 `.github/workflows/cloudflare-deploy.yml`
  GitHub Actions가 자동 기동해 **전부 `completed`/`success`로 종료**되는 것을 워크플로
  실행 결과로 직접 확인했다(`wrangler d1 migrations apply --remote` 포함)
- CONCEPT.md/SYSTEM_DESIGN.md/DEV_PLAN.md에 남아있던 "현재 백엔드는 Firebase" 서술을
  전부 Cloudflare Workers 기준으로 정정. 이 재검토 과정에서 API 엔드포인트 목록이
  `/api/conquest/all-tiles` · `/api/conquest/mission-paths` · `/api/conquest/missions/ack`
  3개를 누락하고 있던 것도 함께 발견해 SYSTEM_DESIGN.md 11-2절에 추가했다
- **PvE 밸런스 3건**을 로컬 서버(`server-legacy` + 정적 프록시) + Playwright로 직접
  검증하며 순서대로 수정:
  1. 성 Lv.19→20(최종) 특별 해금 조건 신설: 병영 Lv.15 + 여관 Lv.15 + 레이드 보스 메두사
     처치 (`CASTLE_UNLOCK_GATES`, SYSTEM_DESIGN.md 2-4절에 신규 문서화)
  2. 레이드 보스 전력 배율 80% 하향(×4~×17 → ×0.8~×3.4) — 권장 전투력이 유저가 도달하기엔
     너무 높다는 피드백에 따른 조정. 그 부작용으로 필드 몬스터 Lv.30이 레이드 첫 보스보다
     강해지는 역전이 생겨, 몬스터 21~30구간 성장률도 함께 완만하게 낮춰 필드<월드맵 성<레이드
     위계를 되살렸다
  3. NPC 성 20개("침략") 진입 경로 복구 — 정복(PvP) 맵이 `#screen-worldmap`/`#btn-worldmap`
     DOM을 물려받으며 이 기능이 진입 경로 없이 붕 떠 있던 것을 발견, 레이드 모달과 같은
     패턴으로 별도 모달("🏯 침략")을 새로 만들어 복구
- 세 건 모두 커밋마다 `main` 병합→푸시→GitHub Actions 자동 배포까지 완료하고 배포 결과
  (`conclusion: success`)를 확인한 뒤 다음 작업으로 넘어갔다
- **미검증**: 이번 세션 변경 사항의 다인 실사용자 체감(레이드 난이도가 실제로 적절해졌는지),
  `workers/test/`의 기존 PvP 시나리오 스크립트들을 정식으로 재실행해 이 문서에 종합
  기록하는 것 — 여전히 M2의 과제로 남아있다

### 2026-08-13 — 수치 밸런스 시뮬레이션 + 전체 기능 회귀 점검 [완료]

기존 코드를 새로 옮겨적지 않고, `game.js`의 실제 함수를 브라우저에서 직접 호출하는
방식(`window.__TEST_HOOK__`로 순수 함수·`RESEARCH_DEFS`·`RAID_BOSSES` 등을 노출)으로
"시뮬레이션이 실제 배포 코드와 어긋날 위험"을 원천 차단하고 전 시스템을 점검했다.

- **수치 시뮬레이션**(`upgradeCostFor`/`castleStats`/`monsterStats`/`raidBossStats`/
  `researchCostFor`/`ROLL_TABLE` 등을 직접 호출):
  - 건물 10종 × Lv.1~20 레벨업 비용 배율이 `levelCostRateForLevel` 표(1.18/1.32/1.58/2.4)와
    구간 경계(5/10/15) 포함해 전부 정확히 일치 — 불연속 버그 없음
  - 병종 7종 자원 효율: "전투 특화" 5종(민병대→아레스의 대전사)은 등급 오를수록 전투
    효율이 단조증가, "수송 특화" 2종(수송병/마차)은 같은 해금 레벨대 전투특화 병종보다
    수송 효율이 압도적으로 높음(설계 의도인 "역할 분화" 정상 확인)
  - 연구 30종 만렙 누적 효과가 2026-08-10 검증 기록치와 완전 일치(드리프트 없음)
  - **버그 발견 및 수정**: 필드 몬스터 Lv.30(150,001)·월드맵 성 Lv.20(220,400)·레이드
    최약체 메두사(당시 176,320)를 나란히 계산해보니 **메두사가 월드맵 성 Lv.20보다
    약했다** — "레이드는 항상 필드/월드맵보다 강해야 한다"는 2-4절/9-3절 원칙 위반.
    2026-08-12 "80% 하향" 조정이 메두사(powerMult 0.8 = 기준선의 80%)를 기준선(=월드맵
    성 Lv.20) 밑으로 떨어뜨린 게 원인 — 9-3절에 2026-08-13 항목으로 원인·수정 내역 기록
- **가챠 확률 시뮬레이션**: `rollHeroId()` 30만회 실행 결과가 `ROLL_TABLE`과 오차범위
  내 일치(까미 0.05%→0.053% 등), `rollHeroIdAtLeast(5|6)` 각 2만회에서 floor 미만 등급
  출현 0건(확정 소환권의 "최소 등급 보장"이 정확히 동작)
- **전체 기능 회귀(Playwright 실제 플레이)**: 건물 건설/레벨업 → 병영 훈련 → 여관 영입
  (★1/★6, 등급별 연출 포함) → 영웅 배치/군대 자동 편성 → 필드 몬스터 전투 → 침략(NPC
  성) 전투 → 레이드 보스 전투(전용 팝업, 메두사 승리 확인 — 위 수정 후에도 정상적으로
  이길 수 있는 범위) → 연구 → 정복(PvP) 맵 참가 → 새로고침 후 저장 지속성까지 전 구간
  콘솔 에러 없이 통과(외부 Google Fonts CDN 차단·의도된 PNG→SVG 초상 폴백 404 제외)
- **관찰 사항(버그 아님, 설계 특성)**: `PUT /api/state` 서버 동기화는 최대 15초
  스로틀(`SERVER_SYNC_INTERVAL_MS`)이 있고, 페이지를 새로고침하면 `bootAuth()`가
  로컬 상태 대신 **서버의 마지막 동기화본을 무조건 채택**한다(부분 병합 아님). 따라서
  마지막 동기화 후 15초 이내에 탭을 닫거나 새로고침하면 그 사이의 진행이 유실될 수
  있다 — 의도된 트레이드오프(문서화된 스팸 방지 목적)이지만, 완전히 없애려면
  `beforeunload` 시점에 남은 변경을 flush하는 별도 작업이 필요하다(이번 범위 밖으로
  남겨둠, 12절 결정 항목 후보)
