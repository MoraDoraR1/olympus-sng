# 올림포스 도시 — Firebase 백엔드

`server-legacy/`(Node.js + Express + SQLite)를 대체하는 백엔드다. Firestore + Cloud
Functions(콜러블/스케줄) + Firebase Auth로 구성되며, 클라이언트(`../index.html`, `../game.js`)는
여전히 빌드 도구 없는 정적 파일이라 GitHub Pages 등에 그대로 둘 수 있다.

## 디렉터리 구조

```
functions/
  index.js              # Cloud Functions 엔트리포인트 (전부 여기서 export)
  src/
    lib/                # 순수 로직 + Firestore 접근 (콜러블/스케줄이 이 모듈들을 호출)
      admin.js           firebase-admin 초기화(Firestore 핸들)
      troops.js          병종 5종 상수 (game.js TROOP_TYPES와 동일)
      movement.js        이동 시간/속도 공식
      combat.js          PvP 전투 판정 공식
      heroes.js          ../../data/heroes.js를 require (겸용 export)
      anticheat.js        state 저장 시 자원/병사 증가량 검증
      conquest.js         정복 맵 타일 선점/조회/이동시간 계산
      items.js            보호막/성 이동 아이템
      pvp.js              공격/지원/철수 디스패치 + 스윕(판정 처리)
      validation.js       닉네임 형식 검증
    callable/            # 클라이언트가 httpsCallable로 직접 호출하는 함수들
    scheduled/           # Cloud Scheduler로 주기 실행되는 함수(PvP 스윕)
  test/                 # node --test 유닛 테스트 (순수 로직만, DB 불필요)
  data/                 # (git 미포함, 생성물) sync-heroes.js가 여기에 heroes.js 복사
```

## 로컬 개발 (에뮬레이터)

```bash
npm install                 # 저장소 루트에서 (firebase-tools 등 devDependency 설치)
cd functions && npm install # functions 자체 의존성(firebase-admin, firebase-functions)
cd ..
npm run emulators           # sync-heroes 실행 후 Firestore/Auth/Functions 에뮬레이터 기동
```

에뮬레이터가 뜨면 `http://127.0.0.1:4000`에서 Emulator UI를 볼 수 있다. 클라이언트를 로컬에서
띄우려면 별도 정적 서버로 저장소 루트를 서빙하면 된다(`python3 -m http.server 8600` 등) —
`firebase-config.js`가 기본적으로 에뮬레이터를 가리키도록 설정되어 있다.

`scripts/dev-test/`에 회원가입/상태저장, 정복맵/아이템, PvP 4계정 시나리오, 실제 브라우저
(Playwright) 스모크 테스트 스크립트가 있다 — 전부 위 에뮬레이터가 떠 있어야 동작한다.

## 데이터 모델 (Firestore)

| 컬렉션 | 문서 ID | 설명 |
|---|---|---|
| `players` | `{uid}` | `nickname`, `createdAt`, `state`(게임 상태 전체 — `res`/`tiles`/`troopsByType`/`owned`/`research`/`tavern`/`armies`/`monsters`/`worldCastles`/`raids`/`raidShards`/`raidTickets`), `updatedAt`. **본인만 read 가능, write는 Functions(Admin SDK)만 가능** |
| `playerItems` | `{uid}` | `shield30`/`shield60`/`shield120`/`teleport` 개수. players와 동일한 접근 정책 |
| `worldTiles` | `{x}_{y}` | 좌표를 문서 ID로 써서 "존재하면 실패"만으로 원자적 타일 선점(트랜잭션). `playerId`, `nickname`(스폰 시점에 복사 — players는 본인만 읽을 수 있어 지도에 다른 사람 닉네임을 보여주려면 여기 복사해 둬야 한다), `spawnedAt`, `protectedUntil`. 로그인한 사용자에게 전체 공개 read |
| `pvpMissions` | 자동 ID | `kind`(attack/reinforce), `originPlayerId`, `originSquadIndex`, `targetPlayerId`, `comp`, `heroIds`, `phase`(outbound/stationed/returning), `departAt`, `arriveAt`, `returnArriveAt`, `result`. 당사자만 read 가능 |

## 인증 — 닉네임을 어떻게 Firebase Auth에 얹었나

이 게임은 닉네임+비밀번호로 로그인하지만 Firebase Auth는 이메일 기반이다. 그래서
`nickname` → `u-<UTF8 바이트의 hex>@olympus-sng.local` 형태의 **결정론적 합성 이메일**로
변환해 `createUserWithEmailAndPassword`/`signInWithEmailAndPassword`를 그대로 쓴다
(hex 인코딩은 한글 닉네임이 이메일 로컬파트에 그대로 들어가면 생길 수 있는 형식 오류를
피하기 위함). 이 매핑이 곧 닉네임 유일성 보장이다 — 같은 닉네임으로 가입하면 같은 이메일이
되어 Firebase Auth가 자체적으로 "이미 사용 중" 에러를 낸다. 별도의 "닉네임 예약" 컬렉션이
필요 없다.

가입 성공 후 클라이언트가 `registerProfile({nickname})` 콜러블을 한 번 호출해 `players/{uid}`
문서에 닉네임을 남긴다.

## Cloud Functions 목록

| 함수 | 종류 | 대응하는 server-legacy 라우트 |
|---|---|---|
| `registerProfile` | callable | (신규 — Firebase Auth 가입 직후 닉네임 등록) |
| `saveState` | callable | `PUT /api/state` |
| `conquestSpawn` | callable | `POST /api/conquest/spawn` |
| `conquestTravelTime` | callable | `GET /api/conquest/travel-time` |
| `itemsBuy` / `itemsUseShield` / `itemsUseTeleport` | callable | `POST /api/items/buy` 등 |
| `pvpMissionsMine` | callable | `GET /api/conquest/missions` |
| `pvpAttack` / `pvpReinforce` | callable | `POST /api/conquest/attack` / `reinforce` |
| `pvpRecall` | callable | `POST /api/conquest/recall` |
| `pvpSweep` | scheduled (1분 주기) | `setInterval(sweepOnce, 5000)` |
| `pvpSweepManual` | callable (에뮬레이터 전용) | (신규 — 로컬 테스트에서 스윕을 즉시 트리거) |

`GET /api/state`, `GET /api/conquest/me`, `GET /api/conquest/tiles`, `GET /api/items/me`는
별도 함수로 만들지 않았다 — 전부 보안 규칙(`../firestore.rules`)이 허용하는 범위에서
클라이언트가 Firestore를 직접 read하면 되기 때문이다(본인 문서, 또는 공개 read인
`worldTiles`).

## PvP 스윕 — 5초 → 1분, 그리고 이중 처리 방지

server-legacy는 단일 Node 프로세스의 `setInterval(sweepOnce, 5000)` + 동기식 SQLite 호출
덕분에 "묵시적으로" 이중 처리가 안전했다. Cloud Functions에는 상주 프로세스가 없고 Cloud
Scheduler의 최소 간격은 1분이라, `pvpSweep`은 1분마다 도착 시각이 지난 미션들을 훑는다
(판정 정밀도가 5초→최대 1분으로 낮아지는 트레이드오프가 있다 — 필요해지면 미션별로 정확한
도착 시각에 Cloud Task를 예약하는 방식으로 승격할 수 있다).

이중 처리 방지는 각 미션 판정을 **Firestore 트랜잭션 하나로 감싸고, 트랜잭션 안에서 미션을
다시 읽어 phase가 여전히 기대한 값일 때만 전이시키는 방식**으로 명시적으로 구현했다
(`src/lib/pvp.js`의 `resolveAttack`/`arriveReinforcement`/`completeReturn`). 공격 판정은
공격자/방어자 상태, 주둔 중인 지원군 전부, 아직 미도착인 지원군까지 한 트랜잭션 안에서
읽고 쓴다.

## 알려진 차이점 / 의도적으로 고친 부분

- **`items.js`의 방어막/텔레포트 차단 버그 수정**: server-legacy는 `pvp_missions`의 phase를
  `'march'`/`'battle'`/`'return'`으로 검사했는데, 실제 `pvp.js`가 쓰는 값은
  `'outbound'`/`'stationed'`/`'returning'`이었다. 즉 이 차단 로직이 **항상 무력화**돼
  있었다. 이식 시 올바른 phase 값으로 바로잡았다 — 지금은 실제로 "공격받는 중엔 보호막
  못 씀", "출정/귀환 중엔 성 이동 못 씀"이 동작한다.
- **`heroes.js` 로딩 방식 개선**: server-legacy는 `data/heroes.js`(브라우저 전역 스크립트)를
  텍스트로 읽어 `new Function`으로 감싸는 편법을 썼다. `data/heroes.js` 끝에
  `module.exports` 겸용 코드를 추가해 이제는 정식 `require`로 재사용한다.

## 배포 (내일 할 일)

1. https://console.firebase.google.com 에서 프로젝트 생성 후 웹 앱 추가, `firebaseConfig` 확보
2. `../firebase-config.js`의 `firebaseConfig`를 실제 값으로 교체, `USE_EMULATORS = false`
3. `../.firebaserc`의 `"default"` 프로젝트 ID를 실제 프로젝트 ID로 교체
4. Firebase 콘솔에서 Firestore 사용 설정 + Authentication → 이메일/비밀번호 로그인 활성화
5. 저장소 루트에서 `firebase deploy --only functions,firestore`
6. `firebase-config.js` 커밋 후 GitHub Pages가 보는 `main`에 반영
