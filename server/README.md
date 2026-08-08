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

## 현재 구현된 API (계정 시스템, 1단계)

- `POST /api/auth/register { nickname, password }` → `{ player, token }`
- `POST /api/auth/login { nickname, password }` → `{ player, token }`
- `GET /api/auth/me` (Bearer 토큰) → `{ player }`
- `GET /api/state` (Bearer 토큰) → `{ state, updatedAt }` — 저장된 게임 상태 없으면 `state: null`
- `PUT /api/state { state }` (Bearer 토큰) → 게임 상태 전체 스냅샷 저장
- `GET /api/health` → `{ ok: true }`
- `WS /ws?token=...` — 연결만 인증하는 최소 스켈레톤. 정복 맵/전투 알림 등은 이후 단계에서 이
  소켓으로 서버→클라이언트 푸시를 보낸다.

정복 맵, 이동속도, PvP 전투, 아이템(보호막/이동)은 이후 단계에서 이 서버에 계속 추가된다.
