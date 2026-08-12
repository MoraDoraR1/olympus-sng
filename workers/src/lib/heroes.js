// 원본은 ../../../data/heroes.js(클라이언트 <script> 전역 겸 CommonJS module.exports 겸용).
// Firebase Functions는 별도 디렉터리만 배포 패키징하는 제약 때문에 파일을 복사해 써야
// 했지만, Cloudflare Workers(esbuild 기반 번들링)는 import 그래프를 그대로 따라가므로
// 레포 바깥(레포 루트 기준으로는 안이지만 workers/ 바깥) 파일을 직접 import해도 된다 —
// 복사/동기화 스크립트가 필요 없다.
import heroesModule from "../../../data/heroes.js";

const { HEROES } = heroesModule;
export { HEROES };
export const HERO_BY_ID = Object.fromEntries(HEROES.map((h) => [h.id, h]));
