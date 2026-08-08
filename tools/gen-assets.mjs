// 올림포스 도시 — 절차적 SVG 에셋 생성기
// ART_DIRECTION.md(파스텔·단순 아이소메트릭·둥근 모서리) 기준을 코드로 옮긴 것.
// 실행: node tools/gen-assets.mjs  (assets/ 아래에 .svg 파일들을 생성한다)
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT_BUILDINGS = path.join(ROOT, "assets/buildings");
const OUT_BOARD = path.join(ROOT, "assets/board");
const OUT_MONSTERS = path.join(ROOT, "assets/monsters");
const OUT_WORLDMAP = path.join(ROOT, "assets/worldmap");
const OUT_TITLE = path.join(ROOT, "assets/title");
const OUT_HEROES = path.join(ROOT, "assets/heroes");
mkdirSync(OUT_BUILDINGS, { recursive: true });
mkdirSync(OUT_BOARD, { recursive: true });
mkdirSync(OUT_MONSTERS, { recursive: true });
mkdirSync(OUT_WORLDMAP, { recursive: true });
mkdirSync(OUT_TITLE, { recursive: true });
mkdirSync(OUT_HEROES, { recursive: true });

// data/heroes.js는 브라우저 전역 `const HEROES = [...]`이므로 같은 방식으로 평가해 재사용한다
const heroesSrc = readFileSync(path.join(ROOT, "data/heroes.js"), "utf8");
const heroesMod = { exports: {} };
new Function("module", "exports", `${heroesSrc}\nmodule.exports = HEROES;`)(heroesMod, heroesMod.exports);
const HEROES = heroesMod.exports;

// ---------- 공통 팔레트 (style.css :root 값과 동일하게 유지) ----------
const P = {
  ivory: "#F4E9D8",
  ivoryDeep: "#EADFC7",
  roof: "#E7A26B",
  roofDeep: "#D6864C",
  wood: "#B5651D",
  woodDeep: "#8F4E17",
  stone: "#B9B4A8",
  stoneDeep: "#8F897C",
  food: "#7FB069",
  foodDeep: "#5E8B4C",
  gold: "#E8B93B",
  goldDeep: "#C4941F",
  ink: "#3A2E1F",
  white: "#FFF8EC",
  red: "#C0433A",
  road: "#D8C39C",
  roadDeep: "#B89F72",
  grassPale: "#DCE8C6",
  grassMid: "#C9DDAE",
};

// SVG의 기본 preserveAspectRatio(xMidYMid meet)는 background-size:100% 100%로
// 요청해도 뷰박스 비율을 지켜 레터박스(위아래 또는 좌우 여백)를 남긴다 — floor.svg처럼
// 뷰박스 비율과 실제 배치 비율이 다른 배경은 완전히 비균등 스트레치가 되어야 하므로
// preserveAspectRatio="none"을 명시한다(정사각형 아이콘류는 어차피 비율이 같아 무해함).
const svg = (inner, vb = "0 0 100 100") => {
  const [, , w, h] = vb.split(" ").map(Number);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${w}" height="${h}" preserveAspectRatio="none">${inner}</svg>\n`;
};

// ---------- 색상 유틸 & 그라디언트(평면 단색 대신 입체감을 준다) ----------
function shade(hex, percent) {
  const num = parseInt(hex.slice(1), 16);
  let r = (num >> 16) & 0xff, g = (num >> 8) & 0xff, b = num & 0xff;
  const t = percent < 0 ? 0 : 255;
  const p = Math.abs(percent);
  r = Math.round((t - r) * p + r);
  g = Math.round((t - g) * p + g);
  b = Math.round((t - b) * p + b);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
let uidCounter = 0;
const uid = (prefix) => `${prefix}${uidCounter++}`;
// 세로 그라디언트(위쪽 밝게 → 아래쪽 어둡게) — 벽/지붕의 기본 입체감
function vGrad(c1, c2) {
  const id = uid("vg");
  return { id: `url(#${id})`, defs: `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient>` };
}
// 대각 그라디언트(좌상단 밝게 → 우하단 어둡게) — 둥근 몸통/머리에 사용해 공 같은 입체감
function dGrad(c1, c2) {
  const id = uid("dg");
  return { id: `url(#${id})`, defs: `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient>` };
}
// 광택 하이라이트 — 둥근 형태 위에 옅은 흰 타원을 얹어 매끈한 느낌을 더한다
const gloss = (cx, cy, rx, ry = rx * 0.55, rot = -25) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${P.white}" opacity="0.4" transform="rotate(${rot} ${cx} ${cy})"/>`;

// 둥근 사각 벽체 — 세로 그라디언트 + 판자/석재 이음선 텍스처
const wall = (x, y, w, h, fill, stroke = P.ink, r = 6) => {
  const g = vGrad(shade(fill, 0.24), shade(fill, -0.16));
  let s = `${g.defs}<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${g.id}" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round"/>`;
  for (let ly = y + 8.5; ly < y + h - 3; ly += 8.5) {
    s += `<line x1="${x + 2}" y1="${ly}" x2="${x + w - 2}" y2="${ly}" stroke="${shade(fill, -0.22)}" stroke-width="1" opacity="0.35"/>`;
  }
  return s;
};

// 삼각 지붕 — 그라디언트 + 기와 결
const roofTri = (cx, y, halfW, h, fill, stroke = P.ink) => {
  const x1 = cx - halfW, x2 = cx + halfW, apexY = y - h;
  const g = vGrad(shade(fill, 0.2), shade(fill, -0.2));
  let s = `${g.defs}<path d="M ${x1} ${y} L ${cx} ${apexY} L ${x2} ${y} Z" fill="${g.id}" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round"/>`;
  for (let i = 1; i <= 3; i++) {
    const t = i / 4;
    const lx1 = x1 + (cx - x1) * t, ly1 = y + (apexY - y) * t;
    const lx2 = x2 + (cx - x2) * t;
    s += `<line x1="${lx1}" y1="${ly1}" x2="${lx2}" y2="${ly1}" stroke="${shade(fill, -0.3)}" stroke-width="1.3" opacity="0.5"/>`;
  }
  return s;
};

// 사다리꼴 지붕(넓은 건물용) — 그라디언트 + 기와 결
const roofTrap = (x, y, w, h, inset, fill, stroke = P.ink) => {
  const g = vGrad(shade(fill, 0.2), shade(fill, -0.2));
  let s = `${g.defs}<path d="M ${x} ${y} L ${x + inset} ${y - h} L ${x + w - inset} ${y - h} L ${x + w} ${y} Z" fill="${g.id}" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round"/>`;
  for (let i = 1; i <= 2; i++) {
    const t = i / 3;
    const lx1 = x + inset * t, ly = y - h * t;
    const lx2 = x + w - inset * t;
    s += `<line x1="${lx1}" y1="${ly}" x2="${lx2}" y2="${ly}" stroke="${shade(fill, -0.3)}" stroke-width="1.3" opacity="0.5"/>`;
  }
  return s;
};

const circleWindow = (cx, cy, r, fill = P.ivory) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${P.ink}" stroke-width="1.6"/>
   <circle cx="${cx - r * 0.3}" cy="${cy - r * 0.3}" r="${r * 0.3}" fill="${P.white}" opacity="0.55"/>`;

const rectWindow = (x, y, w, h, fill = P.ivory) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${fill}" stroke="${P.ink}" stroke-width="1.6"/>
   <line x1="${x + w / 2}" y1="${y + 1.2}" x2="${x + w / 2}" y2="${y + h - 1.2}" stroke="${P.ink}" stroke-width="1" opacity="0.4"/>`;

const flag = (x, y, h, fill) =>
  `<line x1="${x}" y1="${y}" x2="${x}" y2="${y - h}" stroke="${P.ink}" stroke-width="2" stroke-linecap="round"/>
   <path d="M ${x} ${y - h} L ${x + 14} ${y - h + 4} L ${x} ${y - h + 8} Z" fill="${fill}" stroke="${P.ink}" stroke-width="1.6" stroke-linejoin="round"/>`;

const door = (cx, y, w, h, fill = P.woodDeep) => {
  const g = vGrad(shade(fill, 0.22), shade(fill, -0.14));
  return `${g.defs}<path d="M ${cx - w / 2} ${y} L ${cx - w / 2} ${y - h + w / 2} A ${w / 2} ${w / 2} 0 0 1 ${cx + w / 2} ${y - h + w / 2} L ${cx + w / 2} ${y} Z" fill="${g.id}" stroke="${P.ink}" stroke-width="1.8"/>
   <line x1="${cx}" y1="${y - h + w / 2}" x2="${cx}" y2="${y}" stroke="${P.ink}" stroke-width="1" opacity="0.35"/>
   <circle cx="${cx + w * 0.2}" cy="${y - h * 0.4}" r="1.1" fill="${P.gold}"/>`;
};

// 낮은 지반 그림자 — 부드러운 블러로 공중에 뜬 느낌 없이 자연스럽게 안착
const ground = (cx, y, w) => {
  const id = uid("bl");
  return `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.4"/></filter>
   <ellipse cx="${cx}" cy="${y}" rx="${w}" ry="4" fill="${P.ink}" opacity="0.16" filter="url(#${id})"/>`;
};

const star = (cx, cy, r, fill = P.gold) => {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const ang = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${cx + Math.cos(ang) * rad},${cy + Math.sin(ang) * rad}`);
  }
  const g = vGrad(shade(fill, 0.3), shade(fill, -0.15));
  return `${g.defs}<polygon points="${pts.join(" ")}" fill="${g.id}" stroke="${P.ink}" stroke-width="1.2" stroke-linejoin="round"/>`;
};

// ---------- 건물별 생성기: (tier 1~3) => svg 문자열 ----------
const builders = {};

builders.castle = (t) => {
  const w = 58 + t * 6, h = 34 + t * 4, x = 50 - w / 2, y = 84;
  const towerW = 16;
  let s = ground(50, 90, 34 + t * 3);
  s += wall(x, y - h, w, h, P.ivoryDeep);
  s += wall(x - towerW * 0.3, y - h - 10, towerW, h + 10, P.ivoryDeep);
  s += wall(x + w - towerW * 0.7, y - h - 10, towerW, h + 10, P.ivoryDeep);
  s += roofTri(x - towerW * 0.3 + towerW / 2, y - h - 10, 11, 14, P.roof);
  s += roofTri(x + w - towerW * 0.7 + towerW / 2, y - h - 10, 11, 14, P.roof);
  s += roofTrap(x + 4, y - h, w - 8, 16, 6, P.roofDeep);
  s += door(50, y, 14, 20);
  s += circleWindow(50 - w / 4, y - h + 14, 4.5);
  s += circleWindow(50 + w / 4, y - h + 14, 4.5);
  if (t >= 2) { s += flag(x - towerW * 0.3 + towerW / 2, y - h - 24, 14, P.gold); s += flag(x + w - towerW * 0.7 + towerW / 2, y - h - 24, 14, P.gold); }
  if (t >= 3) { s += star(50, y - h - 20, 6); s += rectWindow(x + w / 2 - 5, y - h + 6, 10, 8, P.gold); }
  return svg(s);
};

builders.tavern = (t) => {
  const w = 50 + t * 5, h = 30 + t * 3, x = 50 - w / 2, y = 86;
  let s = ground(50, 90, 30 + t * 2);
  s += wall(x, y - h, w, h, P.wood);
  s += roofTrap(x - 4, y - h, w + 8, 18 + t * 2, 8, P.roofDeep);
  s += door(50, y, 13, 18);
  s += rectWindow(x + 6, y - h + 10, 9, 8);
  s += rectWindow(x + w - 15, y - h + 10, 9, 8);
  // 맥주잔 간판(이모지 대신 벡터로 직접 그림 — 헤드리스/이모지폰트 미탑재 환경 대응)
  const mugY = y - h - 10;
  const mg = dGrad(shade(P.gold, 0.25), shade(P.gold, -0.15));
  s += `${mg.defs}<circle cx="50" cy="${mugY}" r="8" fill="${mg.id}" stroke="${P.ink}" stroke-width="2"/>`;
  s += `<rect x="46.5" y="${mugY - 4.5}" width="6" height="7" rx="1" fill="${P.white}" stroke="${P.ink}" stroke-width="1.2"/>`;
  s += `<path d="M 52.5 ${mugY - 3} q 3.4 0 3.4 2.4 q 0 2.4 -3.4 2.4" fill="none" stroke="${P.ink}" stroke-width="1.2"/>`;
  s += `<rect x="46.5" y="${mugY - 5.6}" width="6" height="1.8" rx="0.9" fill="${P.food}" stroke="${P.ink}" stroke-width="0.8"/>`;
  if (t >= 2) s += flag(x + 6, y - h - 2, 12, P.red);
  if (t >= 3) { s += flag(x + w - 6, y - h - 2, 12, P.red); s += star(50, y - h - 22, 5); }
  return svg(s);
};

builders.barracks = (t) => {
  const w = 46 + t * 5, h = 28 + t * 3, x = 50 - w / 2, y = 86;
  let s = ground(50, 90, 28 + t * 2);
  s += wall(x, y - h, w, h, P.stone);
  s += roofTrap(x - 3, y - h, w + 6, 14 + t, 6, P.stoneDeep);
  s += door(50, y, 12, 16, "#5b4636");
  s += rectWindow(x + 6, y - h + 9, 8, 7);
  s += rectWindow(x + w - 14, y - h + 9, 8, 7);
  // 교차 창(칼) 문장 — 뒤에 방패꼴 배지를 깔아 무게감을 더함
  const cx = 50, cy = y - h - 6;
  const badge = dGrad(shade(P.stone, 0.22), shade(P.stoneDeep, -0.1));
  s += `${badge.defs}<circle cx="${cx}" cy="${cy}" r="11" fill="${badge.id}" stroke="${P.ink}" stroke-width="1.8" opacity="0.9"/>`;
  s += `<line x1="${cx - 9}" y1="${cy - 9}" x2="${cx + 9}" y2="${cy + 9}" stroke="${P.ivory}" stroke-width="3" stroke-linecap="round"/>`;
  s += `<line x1="${cx + 9}" y1="${cy - 9}" x2="${cx - 9}" y2="${cy + 9}" stroke="${P.ivory}" stroke-width="3" stroke-linecap="round"/>`;
  if (t >= 2) s += flag(x + 4, y - h - 2, 12, P.red);
  if (t >= 3) { s += flag(x + w - 4, y - h - 2, 12, P.red); s += circleWindow(50, y - h + 2, 5, P.gold); }
  return svg(s);
};

builders.farm = (t) => {
  const y = 88;
  let s = ground(50, 92, 32 + t * 2);
  // 헛간
  const w = 34, h = 20, x = 50 - w / 2 - 10;
  s += wall(x, y - h, w, h, P.wood);
  s += roofTri(x + w / 2, y - h, w / 2 + 4, 16, P.food);
  s += rectWindow(x + w / 2 - 4, y - h + 8, 8, 7);
  // 곡물 사일로
  const sx = 50 + 14, sr = 9 + t;
  const silo = vGrad(shade(P.foodDeep, 0.2), shade(P.foodDeep, -0.16));
  s += `${silo.defs}<rect x="${sx - sr}" y="${y - 34 - t * 3}" width="${sr * 2}" height="${34 + t * 3}" rx="${sr}" fill="${silo.id}" stroke="${P.ink}" stroke-width="2.5"/>`;
  s += `<line x1="${sx}" y1="${y - 30 - t * 3}" x2="${sx}" y2="${y - 6}" stroke="${shade(P.foodDeep, -0.3)}" stroke-width="1" opacity="0.4"/>`;
  const siloCap = dGrad(shade(P.food, 0.22), shade(P.food, -0.1));
  s += `${siloCap.defs}<ellipse cx="${sx}" cy="${y - 34 - t * 3}" rx="${sr}" ry="4" fill="${siloCap.id}" stroke="${P.ink}" stroke-width="2"/>`;
  if (t >= 2) s += `<circle cx="${sx}" cy="${y - 10}" r="4" fill="${P.gold}"/>`;
  if (t >= 3) { s += star(sx, y - 40 - t * 3, 5); s += `<circle cx="${x + 8}" cy="${y - h - 6}" r="4" fill="${P.gold}"/>`; }
  return svg(s);
};

builders.lumber = (t) => {
  const y = 88;
  let s = ground(50, 92, 32 + t * 2);
  const w = 40, h = 18, x = 50 - w / 2;
  s += wall(x, y - h, w, h, P.woodDeep, P.ink, 4);
  s += roofTrap(x - 2, y - h, w + 4, 12 + t, 5, P.wood);
  // 통나무 더미 — 나이테 결을 추가해 통나무 단면 느낌을 강화
  for (let i = 0; i < 3; i++) {
    const lx = x + 8 + i * 9;
    const lg = dGrad(shade(P.wood, 0.22), shade(P.wood, -0.14));
    s += `${lg.defs}<circle cx="${lx}" cy="${y - 2}" r="6" fill="${lg.id}" stroke="${P.ink}" stroke-width="2"/>`;
    s += `<circle cx="${lx}" cy="${y - 2}" r="4.1" fill="none" stroke="${P.woodDeep}" stroke-width="0.9" opacity="0.6"/>`;
    s += `<circle cx="${lx}" cy="${y - 2}" r="2.4" fill="${P.woodDeep}"/>`;
  }
  if (t >= 2) s += `<path d="M ${x + w - 10} ${y - h - 2} l 5 -12 l 5 12 z" fill="${P.stone}" stroke="${P.ink}" stroke-width="1.6"/>`; // 도끼머리 느낌 삼각
  if (t >= 3) s += star(50, y - h - 12, 5);
  return svg(s);
};

builders.quarry = (t) => {
  const y = 90;
  let s = ground(50, 93, 32 + t * 2);
  const rocks = [
    { cx: 38, cy: y - 10, r: 14 }, { cx: 58, cy: y - 16, r: 17 + t * 2 }, { cx: 70, cy: y - 6, r: 10 },
  ];
  rocks.forEach((r, i) => {
    const base = i === 1 ? P.stone : P.stoneDeep;
    const rg = dGrad(shade(base, 0.24), shade(base, -0.2));
    s += `${rg.defs}<polygon points="${r.cx - r.r},${r.cy + r.r * 0.6} ${r.cx - r.r * 0.5},${r.cy - r.r} ${r.cx + r.r * 0.4},${r.cy - r.r * 0.9} ${r.cx + r.r},${r.cy + r.r * 0.5} ${r.cx + r.r * 0.2},${r.cy + r.r}` +
      `" fill="${rg.id}" stroke="${P.ink}" stroke-width="2.4" stroke-linejoin="round"/>`;
    // 결정면 하이라이트 선 — 바위가 여러 면으로 깎인 느낌
    s += `<line x1="${r.cx - r.r * 0.5}" y1="${r.cy - r.r}" x2="${r.cx + r.r * 0.15}" y2="${r.cy - r.r * 0.1}" stroke="${shade(base, -0.32)}" stroke-width="1.3" opacity="0.5" stroke-linecap="round"/>`;
  });
  if (t >= 2) s += `<polygon points="55,${y - 30} 60,${y - 42} 65,${y - 30} 60,${y - 24}" fill="${P.gold}" stroke="${P.ink}" stroke-width="1.6" stroke-linejoin="round"/>`;
  if (t >= 3) s += star(50, y - 38, 5);
  return svg(s);
};

builders.storage = (t) => {
  const w = 44 + t * 4, h = 26 + t * 2, x = 50 - w / 2, y = 88;
  let s = ground(50, 92, 30 + t * 2);
  s += wall(x, y - h, w, h, P.roof, P.ink, 5);
  s += roofTrap(x - 3, y - h, w + 6, 12 + t, 5, P.roofDeep);
  // 상자 더미 — 대각 띠(끈)로 나무 상자 느낌을 더함
  const cr1 = vGrad(shade(P.wood, 0.2), shade(P.wood, -0.14));
  s += `${cr1.defs}<rect x="${x + 6}" y="${y - 16}" width="14" height="14" rx="2" fill="${cr1.id}" stroke="${P.ink}" stroke-width="2"/>`;
  s += `<line x1="${x + 6}" y1="${y - 16}" x2="${x + 20}" y2="${y - 2}" stroke="${P.ink}" stroke-width="1" opacity="0.3"/>`;
  const cr2 = vGrad(shade(P.woodDeep, 0.2), shade(P.woodDeep, -0.14));
  s += `${cr2.defs}<rect x="${x + w - 22}" y="${y - 20}" width="16" height="18" rx="2" fill="${cr2.id}" stroke="${P.ink}" stroke-width="2"/>`;
  s += `<line x1="${x + w - 22}" y1="${y - 20}" x2="${x + w - 6}" y2="${y - 2}" stroke="${P.ink}" stroke-width="1" opacity="0.3"/>`;
  if (t >= 2) {
    const cr3 = vGrad(shade(P.gold, 0.2), shade(P.gold, -0.14));
    s += `${cr3.defs}<rect x="${50 - 7}" y="${y - 24}" width="14" height="12" rx="2" fill="${cr3.id}" stroke="${P.ink}" stroke-width="2"/>`;
  }
  if (t >= 3) s += star(50, y - h - 8, 5);
  return svg(s);
};

builders.academy = (t) => {
  const w = 52 + t * 5, y = 88, colH = 26 + t * 2;
  let s = ground(50, 92, 30 + t * 2);
  s += roofTri(50, y - colH, w / 2 + 4, 16, P.ivoryDeep);
  s += wall(50 - w / 2 + 2, y - colH + 2, w - 4, 4, P.ivory, P.ink, 2);
  const colW = 6, gap = (w - 8 - colW * 4) / 3;
  const colG = vGrad(P.ivory, shade(P.ivory, -0.14));
  for (let i = 0; i < 4; i++) {
    s += `${i === 0 ? colG.defs : ""}<rect x="${50 - w / 2 + 4 + i * (colW + gap)}" y="${y - colH + 5}" width="${colW}" height="${colH - 5}" fill="${colG.id}" stroke="${P.ink}" stroke-width="2"/>`;
    s += `<line x1="${50 - w / 2 + 4 + i * (colW + gap) + colW * 0.3}" y1="${y - colH + 7}" x2="${50 - w / 2 + 4 + i * (colW + gap) + colW * 0.3}" y2="${y - 6}" stroke="${P.white}" stroke-width="0.8" opacity="0.5"/>`;
  }
  const baseG = vGrad(shade(P.ivoryDeep, 0.1), shade(P.ivoryDeep, -0.18));
  s += `${baseG.defs}<rect x="${50 - w / 2 + 2}" y="${y - 4}" width="${w - 4}" height="4" fill="${baseG.id}" stroke="${P.ink}" stroke-width="2"/>`;
  if (t >= 2) {
    // 페디먼트 위 태양 문장(이모지 대신 벡터 — 신전 박공의 장식 원반 느낌)
    const sy = y - colH - 7;
    s += `<circle cx="50" cy="${sy}" r="4.6" fill="${P.gold}" stroke="${P.ink}" stroke-width="1.4"/>`;
    for (let i = 0; i < 8; i++) {
      const ang = (Math.PI / 4) * i;
      const x1 = 50 + Math.cos(ang) * 6, y1 = sy + Math.sin(ang) * 6;
      const x2 = 50 + Math.cos(ang) * 8.4, y2 = sy + Math.sin(ang) * 8.4;
      s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${P.gold}" stroke-width="1.6" stroke-linecap="round"/>`;
    }
  }
  if (t >= 3) s += star(50, y - colH - 16, 5);
  return svg(s);
};

builders.defense = (t) => {
  const y = 90, w = 22 + t * 2, h = 40 + t * 6, x = 50 - w / 2;
  let s = ground(50, 92, 22);
  s += wall(x, y - h, w, h, P.stone, P.ink, 4);
  const parapet = vGrad(shade(P.stoneDeep, 0.16), shade(P.stoneDeep, -0.16));
  s += `${parapet.defs}<rect x="${x - 2}" y="${y - h - 8}" width="${w + 4}" height="10" fill="${parapet.id}" stroke="${P.ink}" stroke-width="2"/>`;
  for (let i = 0; i < 3; i++) s += `${parapet.defs}<rect x="${x - 1 + i * (w / 3 + 1)}" y="${y - h - 13}" width="6" height="6" fill="${parapet.id}" stroke="${P.ink}" stroke-width="1.6"/>`;
  s += circleWindow(50, y - h + 12, 4, P.ink);
  if (t >= 2) s += flag(50, y - h - 8, 14, P.red);
  if (t >= 3) s += star(50, y - h - 24, 5);
  return svg(s);
};

builders.watch = (t) => {
  const y = 90, w = 16 + t, h = 46 + t * 7, x = 50 - w / 2;
  let s = ground(50, 92, 18);
  s += wall(x, y - h, w, h, P.stoneDeep, P.ink, 4);
  s += roofTri(50, y - h, w / 2 + 5, 14, P.roof);
  s += circleWindow(50, y - h + 14, 3.6, P.gold);
  s += circleWindow(50, y - h + 26, 3.6, P.ink);
  if (t >= 2) s += flag(50, y - h - 12, 14, P.gold);
  if (t >= 3) s += star(50, y - h - 26, 5);
  return svg(s);
};

builders.wallgate = (t) => {
  // 성벽 배지/미리보기용 아이콘(9-slice 텍스처와 별개)
  const w = 70, h = 26 + t * 2, x = 50 - w / 2, y = 82;
  let s = ground(50, 86, 34);
  s += wall(x, y - h, w, h, P.stone, P.ink, 3);
  const crenG = vGrad(shade(P.stone, 0.14), shade(P.stone, -0.16));
  for (let i = 0; i < 6; i++) s += `${crenG.defs}<rect x="${x - 2 + i * (w / 6 + 0.2)}" y="${y - h - 6}" width="${w / 6 - 2}" height="8" fill="${crenG.id}" stroke="${P.ink}" stroke-width="1.6"/>`;
  s += door(50, y, 14, 18, P.stoneDeep);
  if (t >= 2) s += flag(x + 8, y - h - 6, 12, P.red);
  if (t >= 3) s += flag(x + w - 8, y - h - 6, 12, P.red);
  return svg(s);
};

// ---------- 몬스터(일반 10종 + 엘리트 3종) ----------
const monsterBuilders = {};
const legPair = (cx, y, spread, len, fill) => {
  const g = vGrad(shade(fill, 0.14), shade(fill, -0.2));
  return `${g.defs}<line x1="${cx - spread}" y1="${y}" x2="${cx - spread}" y2="${y + len}" stroke="${g.id}" stroke-width="5" stroke-linecap="round"/>
   <line x1="${cx + spread}" y1="${y}" x2="${cx + spread}" y2="${y + len}" stroke="${g.id}" stroke-width="5" stroke-linecap="round"/>`;
};
const hornPair = (cx, cy, fill) => {
  const g = vGrad(shade(fill, 0.2), shade(fill, -0.15));
  return `${g.defs}<path d="M ${cx - 5} ${cy} Q ${cx - 10} ${cy - 10} ${cx - 4} ${cy - 13}" fill="none" stroke="${g.id}" stroke-width="3" stroke-linecap="round"/>
   <path d="M ${cx + 5} ${cy} Q ${cx + 10} ${cy - 10} ${cx + 4} ${cy - 13}" fill="none" stroke="${g.id}" stroke-width="3" stroke-linecap="round"/>`;
};
const wingPair = (cx, cy, fill) => {
  const g = dGrad(shade(fill, 0.2), shade(fill, -0.18));
  return `${g.defs}<path d="M ${cx - 8} ${cy} Q ${cx - 34} ${cy - 6} ${cx - 30} ${cy + 20} Q ${cx - 16} ${cy + 12} ${cx - 8} ${cy + 10} Z" fill="${g.id}" stroke="${P.ink}" stroke-width="2.2" stroke-linejoin="round"/>
   <path d="M ${cx + 8} ${cy} Q ${cx + 34} ${cy - 6} ${cx + 30} ${cy + 20} Q ${cx + 16} ${cy + 12} ${cx + 8} ${cy + 10} Z" fill="${g.id}" stroke="${P.ink}" stroke-width="2.2" stroke-linejoin="round"/>
   <path d="M ${cx - 12} ${cy + 2} Q ${cx - 23} ${cy + 5} ${cx - 22} ${cy + 16}" fill="none" stroke="${shade(fill, -0.3)}" stroke-width="1.1" opacity="0.55"/>
   <path d="M ${cx + 12} ${cy + 2} Q ${cx + 23} ${cy + 5} ${cx + 22} ${cy + 16}" fill="none" stroke="${shade(fill, -0.3)}" stroke-width="1.1" opacity="0.55"/>`;
};
// 둥근 몸통/머리에 공용으로 쓰는 대각 그라디언트 채움 + 광택
const roundFill = (fill) => dGrad(shade(fill, 0.22), shade(fill, -0.16));
// 단순한 점 눈 대신 살짝 곡선을 준 눈 — 표정이 살아있게
const eyes = (cx, cy, spread, r, fill = P.ink) =>
  `<circle cx="${cx - spread}" cy="${cy}" r="${r}" fill="${fill}"/><circle cx="${cx + spread}" cy="${cy}" r="${r}" fill="${fill}"/>
   <circle cx="${cx - spread + r * 0.3}" cy="${cy - r * 0.3}" r="${r * 0.32}" fill="${P.white}" opacity="0.85"/>
   <circle cx="${cx + spread + r * 0.3}" cy="${cy - r * 0.3}" r="${r * 0.32}" fill="${P.white}" opacity="0.85"/>`;
const smile = (cx, cy, w) =>
  `<path d="M ${cx - w} ${cy} Q ${cx} ${cy + w * 0.7} ${cx + w} ${cy}" fill="none" stroke="${P.ink}" stroke-width="1.6" stroke-linecap="round" opacity="0.75"/>`;

// ---------- 몬스터용: 관절이 꺾인 팔다리(원판 블롭이 아니라 실제 생물처럼 보이게) ----------
// 엉덩이/어깨(hx,hy) → 무릎/팔꿈치(꺾임) → 발/손 끝까지 두 구간 곡선. 발끝에 작은 발(굽/발톱) 표시.
function bentLimb(hx, hy, kx, ky, fx, fy, width, fill, footType = "paw") {
  const g = vGrad(shade(fill, 0.12), shade(fill, -0.22));
  let s = `${g.defs}<path d="M ${hx} ${hy} Q ${kx} ${ky} ${fx} ${fy}" fill="none" stroke="${g.id}" stroke-width="${width}" stroke-linecap="round"/>`;
  if (footType === "hoof") {
    s += `<ellipse cx="${fx}" cy="${fy}" rx="${width * 0.62}" ry="${width * 0.42}" fill="${P.ink}" opacity="0.85" transform="rotate(20 ${fx} ${fy})"/>`;
  } else if (footType === "claw") {
    s += `<path d="M ${fx - width * 0.5} ${fy} l -3 4 M ${fx} ${fy + width * 0.3} l -1 5 M ${fx + width * 0.5} ${fy} l 3 4" stroke="${shade(fill, -0.3)}" stroke-width="1.6" stroke-linecap="round"/>`;
  } else {
    s += `<circle cx="${fx}" cy="${fy}" r="${width * 0.55}" fill="${shade(fill, -0.08)}"/>`;
  }
  return s;
}
// 뾰족귀 한 쌍(사티로스/미노타우로스/케르베로스 등 짐승형 얼굴에 사용)
const earPair = (cx, cy, spread, size, fill) => {
  const g = vGrad(shade(fill, 0.15), shade(fill, -0.2));
  return `${g.defs}<path d="M ${cx - spread} ${cy} L ${cx - spread - size * 0.6} ${cy - size} L ${cx - spread + size * 0.5} ${cy - size * 0.3} Z" fill="${g.id}" stroke="${P.ink}" stroke-width="1.8" stroke-linejoin="round"/>
   <path d="M ${cx + spread} ${cy} L ${cx + spread + size * 0.6} ${cy - size} L ${cx + spread - size * 0.5} ${cy - size * 0.3} Z" fill="${g.id}" stroke="${P.ink}" stroke-width="1.8" stroke-linejoin="round"/>`;
};
// 주둥이(코~입 돌출부, 미노타우로스/켄타우로스 말머리/케르베로스 개주둥이에 사용)
const muzzle = (cx, cy, w, h, fill) => {
  const g = vGrad(shade(fill, 0.14), shade(fill, -0.18));
  return `${g.defs}<ellipse cx="${cx}" cy="${cy}" rx="${w}" ry="${h}" fill="${g.id}" stroke="${P.ink}" stroke-width="2"/>
   <ellipse cx="${cx - w * 0.35}" cy="${cy + h * 0.15}" rx="${w * 0.16}" ry="${h * 0.22}" fill="${P.ink}" opacity="0.7"/>
   <ellipse cx="${cx + w * 0.35}" cy="${cy + h * 0.15}" rx="${w * 0.16}" ry="${h * 0.22}" fill="${P.ink}" opacity="0.7"/>`;
};

monsterBuilders.centaur = () => {
  const bodyFill = "#C9A574", skin = "#E8B98A";
  const bg = roundFill(bodyFill), hg = roundFill(skin), tg = roundFill(skin);
  let s = ground(50, 86, 30);
  s += bentLimb(30, 68, 25, 77, 22, 84, 7, bodyFill, "hoof");
  s += bentLimb(41, 73, 38, 80, 35, 86, 6.5, bodyFill, "hoof");
  s += bentLimb(59, 73, 62, 80, 65, 86, 6.5, bodyFill, "hoof");
  s += bentLimb(70, 68, 75, 77, 78, 84, 7, bodyFill, "hoof");
  s += `${bg.defs}<ellipse cx="50" cy="64" rx="28" ry="16" fill="${bg.id}" stroke="${P.ink}" stroke-width="2.6"/>`;
  s += gloss(41, 56, 8, 4);
  s += `<path d="M 77 56 Q 90 58 85 74" fill="none" stroke="${shade(bodyFill, -0.1)}" stroke-width="5" stroke-linecap="round"/>`;
  s += `${tg.defs}<rect x="36" y="36" width="18" height="26" rx="8" fill="${tg.id}" stroke="${P.ink}" stroke-width="2.4"/>`;
  s += bentLimb(34, 44, 24, 40, 18, 48, 4.5, skin, "paw");
  s += bentLimb(52, 44, 60, 42, 66, 46, 4.5, skin, "paw");
  s += `${hg.defs}<circle cx="45" cy="30" r="9" fill="${hg.id}" stroke="${P.ink}" stroke-width="2.4"/>`;
  s += gloss(42, 27, 3, 1.6);
  s += eyes(45, 30, 3.2, 1.3);
  s += smile(45, 34, 2.4);
  return svg(s);
};
monsterBuilders.satyr = () => {
  const fur = "#8C6A46", skin = "#E8B98A";
  const bg = roundFill(skin), hg = roundFill(skin);
  let s = ground(50, 88, 22);
  s += bentLimb(44, 58, 40, 70, 36, 84, 7, fur, "hoof");
  s += bentLimb(56, 58, 60, 70, 64, 84, 7, fur, "hoof");
  s += `${bg.defs}<ellipse cx="50" cy="58" rx="15" ry="19" fill="${bg.id}" stroke="${P.ink}" stroke-width="2.6"/>`;
  s += gloss(45, 51, 4, 2.2);
  s += bentLimb(38, 52, 30, 58, 26, 66, 3.6, skin, "paw");
  s += bentLimb(62, 52, 70, 58, 74, 64, 3.6, skin, "paw");
  s += `${hg.defs}<circle cx="50" cy="32" r="11" fill="${hg.id}" stroke="${P.ink}" stroke-width="2.6"/>`;
  s += gloss(46, 28, 3.4, 1.8);
  s += earPair(50, 33, 12, 7, fur);
  s += hornPair(50, 25, P.ivoryDeep);
  s += eyes(50, 34, 4, 1.6);
  s += smile(50, 39, 3);
  return svg(s);
};
monsterBuilders.harpy = () => {
  const feather = "#8A7B6B", skin = "#E8B98A";
  const bg = roundFill(feather), hg = roundFill(skin);
  let s = ground(50, 90, 24);
  s += wingPair(50, 56, feather);
  s += `${bg.defs}<ellipse cx="50" cy="62" rx="13" ry="19" fill="${bg.id}" stroke="${P.ink}" stroke-width="2.4"/>`;
  s += `<path d="M 45 79 L 38 90 L 46 82 Z M 55 79 L 62 90 L 54 82 Z" fill="${shade(feather, -0.1)}" stroke="${P.ink}" stroke-width="1.4" stroke-linejoin="round"/>`;
  s += bentLimb(45, 76, 41, 82, 38, 88, 4.2, feather, "claw");
  s += bentLimb(55, 76, 59, 82, 62, 88, 4.2, feather, "claw");
  s += `${hg.defs}<circle cx="50" cy="38" r="10" fill="${hg.id}" stroke="${P.ink}" stroke-width="2.4"/>`;
  s += gloss(46, 34, 3, 1.6);
  s += eyes(50, 37, 3.6, 1.4);
  s += `<path d="M 50 42 l 6 3 l -6 2 Z" fill="${P.gold}" stroke="${P.ink}" stroke-width="1.4"/>`;
  return svg(s);
};
monsterBuilders.cyclops = () => {
  const skin = "#9FAE8C";
  const bg = roundFill(skin), sg = roundFill(skin);
  let s = ground(50, 92, 28);
  s += bentLimb(40, 74, 36, 82, 33, 90, 8, skin, "paw");
  s += bentLimb(60, 74, 64, 82, 67, 90, 8, skin, "paw");
  s += `${bg.defs}<ellipse cx="50" cy="56" rx="23" ry="25" fill="${bg.id}" stroke="${P.ink}" stroke-width="2.6"/>`;
  s += `${sg.defs}<ellipse cx="27" cy="58" rx="9" ry="12" fill="${sg.id}" stroke="${P.ink}" stroke-width="2.4"/>
   <ellipse cx="73" cy="58" rx="9" ry="12" fill="${sg.id}" stroke="${P.ink}" stroke-width="2.4"/>`;
  s += bentLimb(24, 50, 18, 58, 14, 68, 5.5, skin, "paw");
  s += bentLimb(76, 50, 82, 58, 86, 68, 5.5, skin, "paw");
  s += gloss(41, 42, 6, 3.5);
  s += `<path d="M 40 44 Q 50 39 60 44" fill="none" stroke="${P.ink}" stroke-width="2" stroke-linecap="round" opacity="0.7"/>`;
  s += `<circle cx="50" cy="52" r="10" fill="${P.white}" stroke="${P.ink}" stroke-width="2.4"/>`;
  s += `<circle cx="50" cy="52" r="4.4" fill="${P.red}"/><circle cx="50" cy="52" r="1.6" fill="${P.ink}"/>`;
  s += `<circle cx="47.5" cy="49.5" r="1.4" fill="${P.white}" opacity="0.85"/>`;
  s += smile(50, 66, 5);
  return svg(s);
};
monsterBuilders.gorgon = () => {
  const skin = "#8FAE7C";
  const rg = roundFill(skin), hg = roundFill(skin), sg = roundFill(skin);
  let s = ground(50, 88, 22);
  s += `${rg.defs}<path d="M 38 80 Q 50 90 62 80 L 59 56 L 41 56 Z" fill="${rg.id}" stroke="${P.ink}" stroke-width="2.4"/>`;
  s += `${sg.defs}<path d="M 36 58 Q 33 50 40 47 L 45 56 Z" fill="${sg.id}" stroke="${P.ink}" stroke-width="2" stroke-linejoin="round"/>
   <path d="M 64 58 Q 67 50 60 47 L 55 56 Z" fill="${sg.id}" stroke="${P.ink}" stroke-width="2" stroke-linejoin="round"/>`;
  s += bentLimb(37, 52, 30, 58, 26, 66, 3.8, skin, "claw");
  s += bentLimb(63, 52, 70, 58, 74, 66, 3.8, skin, "claw");
  s += `${hg.defs}<circle cx="50" cy="42" r="14" fill="${hg.id}" stroke="${P.ink}" stroke-width="2.6"/>`;
  s += gloss(45, 37, 4, 2.2);
  for (let i = 0; i < 6; i++) {
    const ang = (Math.PI / 5) * i - Math.PI * 0.9;
    const x1 = 50 + Math.cos(ang) * 12, y1 = 42 + Math.sin(ang) * 12;
    const x2 = 50 + Math.cos(ang) * 21, y2 = 42 + Math.sin(ang) * 19;
    s += `<path d="M ${x1} ${y1} Q ${x2 + 4} ${y2 - 4} ${x2} ${y2}" fill="none" stroke="${P.foodDeep}" stroke-width="3" stroke-linecap="round"/>`;
  }
  s += `<circle cx="45" cy="42" r="1.8" fill="${P.gold}"/><circle cx="55" cy="42" r="1.8" fill="${P.gold}"/>`;
  s += smile(50, 47, 3);
  return svg(s);
};
monsterBuilders.minotaur = () => {
  const skin = "#8C6A46", furHead = "#5B4636";
  const tg = roundFill(skin), hg = roundFill(furHead);
  let s = ground(50, 92, 26);
  s += bentLimb(40, 72, 35, 82, 31, 90, 8, skin, "hoof");
  s += bentLimb(60, 72, 65, 82, 69, 90, 8, skin, "hoof");
  s += `${tg.defs}<rect x="29" y="50" width="42" height="27" rx="11" fill="${tg.id}" stroke="${P.ink}" stroke-width="2.6"/>`;
  s += bentLimb(30, 54, 22, 60, 16, 68, 5, skin, "paw");
  s += bentLimb(70, 54, 78, 60, 84, 68, 5, skin, "paw");
  s += `${hg.defs}<circle cx="50" cy="36" r="14" fill="${hg.id}" stroke="${P.ink}" stroke-width="2.6"/>`;
  s += gloss(45, 30, 3.8, 2);
  const bigHornG = vGrad(shade(P.ivoryDeep, 0.24), shade(P.ivoryDeep, -0.18));
  s += `${bigHornG.defs}<path d="M 39 27 Q 28 16 33 3" fill="none" stroke="${bigHornG.id}" stroke-width="4.2" stroke-linecap="round"/>
   <path d="M 61 27 Q 72 16 67 3" fill="none" stroke="${bigHornG.id}" stroke-width="4.2" stroke-linecap="round"/>`;
  s += muzzle(50, 44, 8, 6, shade(furHead, 0.18));
  s += eyes(50, 32, 5, 1.8);
  return svg(s);
};
monsterBuilders.griffin = () => {
  const fur = "#D6A24C", beak = P.gold;
  const bg = roundFill(fur), hg = roundFill(fur);
  let s = ground(50, 90, 26);
  s += bentLimb(38, 72, 34, 80, 31, 88, 6.5, fur, "claw");
  s += bentLimb(62, 72, 66, 80, 69, 88, 6.5, fur, "claw");
  s += wingPair(50, 52, fur);
  s += `${bg.defs}<ellipse cx="50" cy="62" rx="20" ry="16" fill="${bg.id}" stroke="${P.ink}" stroke-width="2.6"/>`;
  s += `${hg.defs}<circle cx="50" cy="40" r="11" fill="${hg.id}" stroke="${P.ink}" stroke-width="2.6"/>`;
  s += gloss(46, 36, 3.2, 1.8);
  s += eyes(50, 38, 3.6, 1.4);
  s += `<path d="M 50 42 l 9 3 l -9 4 Z" fill="${beak}" stroke="${P.ink}" stroke-width="1.6" stroke-linejoin="round"/>`;
  s += `<path d="M 68 74 Q 78 78 74 66" fill="none" stroke="${shade(fur, -0.1)}" stroke-width="4" stroke-linecap="round"/>`;
  return svg(s);
};
monsterBuilders.karkinos = () => {
  const shell = "#C9694A";
  const sg = roundFill(shell), c1 = roundFill(shell), c2 = roundFill(shell);
  let s = ground(50, 84, 28);
  s += `${sg.defs}<ellipse cx="50" cy="62" rx="27" ry="18" fill="${sg.id}" stroke="${P.ink}" stroke-width="2.6"/>`;
  s += gloss(42, 54, 7, 3.5);
  s += bentLimb(28, 58, 16, 48, 12, 40, 5, shell, "paw");
  s += `${c1.defs}<path d="M 12 40 Q 2 32 4 22 Q 14 26 18 38 Z" fill="${c1.id}" stroke="${P.ink}" stroke-width="2.4" stroke-linejoin="round"/>
   <path d="M 8 30 L 2 26 M 8 30 L 4 36" stroke="${P.ink}" stroke-width="2" stroke-linecap="round" fill="none"/>`;
  s += bentLimb(72, 58, 84, 48, 88, 40, 5, shell, "paw");
  s += `${c2.defs}<path d="M 88 40 Q 98 32 96 22 Q 86 26 82 38 Z" fill="${c2.id}" stroke="${P.ink}" stroke-width="2.4" stroke-linejoin="round"/>
   <path d="M 92 30 L 98 26 M 92 30 L 96 36" stroke="${P.ink}" stroke-width="2" stroke-linecap="round" fill="none"/>`;
  s += legPair(34, 76, 6, 8, shell); s += legPair(50, 78, 6, 8, shell); s += legPair(66, 76, 6, 8, shell);
  s += eyes(50, 56, 8, 2.2);
  return svg(s);
};
monsterBuilders.lamia = () => {
  const scale = "#7FA35C", skin = "#E8B98A";
  const tailC = shade(scale, -0.05);
  const tg = roundFill(skin);
  let s = ground(52, 90, 22);
  s += `<path d="M 50 56 Q 68 62 58 74" fill="none" stroke="${tailC}" stroke-width="17" stroke-linecap="round"/>`;
  s += `<path d="M 58 72 Q 48 80 62 88" fill="none" stroke="${tailC}" stroke-width="12" stroke-linecap="round"/>`;
  s += `<path d="M 61 87 Q 55 92 64 95" fill="none" stroke="${tailC}" stroke-width="6.5" stroke-linecap="round"/>`;
  s += `<path d="M 55 60 Q 60 62 58 66" fill="none" stroke="${shade(scale, -0.28)}" stroke-width="1.4" opacity="0.5"/>`;
  s += `<path d="M 55 78 Q 50 80 52 84" fill="none" stroke="${shade(scale, -0.28)}" stroke-width="1.4" opacity="0.5"/>`;
  s += bentLimb(42, 44, 34, 48, 29, 55, 3.4, skin, "paw");
  s += bentLimb(58, 44, 66, 48, 71, 54, 3.4, skin, "paw");
  s += `${tg.defs}<ellipse cx="50" cy="46" rx="11" ry="14" fill="${tg.id}" stroke="${P.ink}" stroke-width="2.4"/>`;
  s += gloss(46, 41, 3, 1.6);
  s += eyes(50, 44, 4, 1.4);
  s += smile(50, 50, 2.6);
  return svg(s);
};
monsterBuilders.empusa = () => {
  const skin = "#A85B4F";
  const bg = roundFill(skin), hg = roundFill(skin);
  let s = ground(50, 90, 20);
  s += `<line x1="44" y1="66" x2="42" y2="84" stroke="${shade(skin, -0.1)}" stroke-width="5" stroke-linecap="round"/>`;
  s += `<rect x="52" y="70" width="6" height="14" rx="2" fill="${P.stoneDeep}" stroke="${P.ink}" stroke-width="1.6"/>`;
  s += `${bg.defs}<ellipse cx="50" cy="58" rx="14" ry="18" fill="${bg.id}" stroke="${P.ink}" stroke-width="2.6"/>`;
  s += `${hg.defs}<circle cx="50" cy="36" r="10" fill="${hg.id}" stroke="${P.ink}" stroke-width="2.4"/>`;
  s += gloss(46, 32, 3, 1.6);
  const flameOuter = dGrad(shade(P.red, 0.15), shade(P.roofDeep, -0.05));
  const flameInner = dGrad(shade(P.gold, 0.35), P.gold);
  const tongue = (x, y, h, w, grad) => `<path d="M ${x - w} ${y} Q ${x - w * 1.3} ${y - h * 0.55} ${x} ${y - h} Q ${x + w * 1.3} ${y - h * 0.55} ${x + w} ${y} Z" fill="${grad.id}" stroke="${P.ink}" stroke-width="1.3" stroke-linejoin="round"/>`;
  s += `${flameOuter.defs}${tongue(42, 28, 13, 3.4, flameOuter)}${tongue(58, 28, 13, 3.4, flameOuter)}`;
  s += `${flameInner.defs}${tongue(50, 28, 17, 3.8, flameInner)}`;
  s += `<circle cx="46" cy="36" r="1.6" fill="${P.gold}"/><circle cx="54" cy="36" r="1.6" fill="${P.gold}"/>`;
  s += smile(50, 41, 2.6);
  return svg(s);
};
// 엘리트 3종 — 조금 더 크고 디테일이 많게, 송곳니로 더 사나운 인상을 준다
monsterBuilders.medusa = () => {
  const skin = "#7FA36A";
  const rg = roundFill(skin), hg = roundFill(skin), sg = roundFill(skin);
  let s = ground(50, 88, 26);
  s += `${rg.defs}<path d="M 33 84 Q 50 94 67 84 L 63 56 L 37 56 Z" fill="${rg.id}" stroke="${P.ink}" stroke-width="2.6"/>`;
  s += `${sg.defs}<path d="M 35 58 Q 31 48 40 44 L 46 56 Z" fill="${sg.id}" stroke="${P.ink}" stroke-width="2.2" stroke-linejoin="round"/>
   <path d="M 65 58 Q 69 48 60 44 L 54 56 Z" fill="${sg.id}" stroke="${P.ink}" stroke-width="2.2" stroke-linejoin="round"/>`;
  s += bentLimb(36, 52, 27, 58, 22, 66, 4.2, skin, "claw");
  s += bentLimb(64, 52, 73, 58, 78, 66, 4.2, skin, "claw");
  s += `${hg.defs}<circle cx="50" cy="40" r="17" fill="${hg.id}" stroke="${P.ink}" stroke-width="2.8"/>`;
  s += gloss(43, 33, 5, 2.6);
  for (let i = 0; i < 9; i++) {
    const ang = (Math.PI / 8) * i - Math.PI * 1.02;
    const x1 = 50 + Math.cos(ang) * 15, y1 = 40 + Math.sin(ang) * 15;
    const x2 = 50 + Math.cos(ang) * 26, y2 = 40 + Math.sin(ang) * 23;
    s += `<path d="M ${x1} ${y1} Q ${x2 + 5} ${y2 - 5} ${x2} ${y2}" fill="none" stroke="${P.foodDeep}" stroke-width="3.4" stroke-linecap="round"/>`;
  }
  s += `<circle cx="44" cy="40" r="2.6" fill="${P.gold}"/><circle cx="56" cy="40" r="2.6" fill="${P.gold}"/>`;
  s += `<path d="M 46 48 l -1.6 4 M 54 48 l 1.6 4" stroke="${P.white}" stroke-width="2" stroke-linecap="round"/>`;
  return svg(s);
};
monsterBuilders.hydra = () => {
  const scale = "#4E8F5B";
  const bg = roundFill(scale);
  let s = ground(50, 90, 28);
  s += bentLimb(38, 82, 34, 88, 30, 92, 6, scale, "claw");
  s += bentLimb(62, 82, 66, 88, 70, 92, 6, scale, "claw");
  s += `${bg.defs}<ellipse cx="50" cy="78" rx="20" ry="10" fill="${bg.id}" stroke="${P.ink}" stroke-width="2.6"/>`;
  [[32, -18], [50, -30], [68, -18]].forEach(([nx, dy]) => {
    const headY = 78 + dy;
    const ng = roundFill(scale);
    s += `<path d="M ${nx} 74 Q ${nx - 6} ${headY + 20} ${nx} ${headY}" fill="none" stroke="${shade(scale, -0.06)}" stroke-width="7" stroke-linecap="round"/>`;
    for (let i = 1; i <= 2; i++) {
      const spy = 74 + (headY - 74) * (i / 3);
      s += `<polygon points="${nx - 1.8},${spy} ${nx + 1.8},${spy} ${nx},${spy - 3.6}" fill="${shade(scale, -0.22)}" stroke="${P.ink}" stroke-width="0.6"/>`;
    }
    s += `${ng.defs}<circle cx="${nx}" cy="${headY}" r="8" fill="${ng.id}" stroke="${P.ink}" stroke-width="2.4"/>`;
    s += gloss(nx - 2.5, headY - 3, 2.2, 1.2);
    s += `<circle cx="${nx - 2.5}" cy="${headY - 1}" r="1.4" fill="${P.gold}"/><circle cx="${nx + 2.5}" cy="${headY - 1}" r="1.4" fill="${P.gold}"/>`;
    s += `<path d="M ${nx - 3} ${headY + 4} l 6 0 l -3 3 Z" fill="${P.white}" stroke="${P.ink}" stroke-width="0.8"/>`;
  });
  return svg(s);
};
monsterBuilders.cerberus = () => {
  const fur = "#4A4038";
  const bg = roundFill(fur);
  let s = ground(50, 90, 28);
  s += bentLimb(30, 70, 26, 78, 22, 86, 6.5, fur, "claw");
  s += bentLimb(42, 74, 40, 80, 38, 88, 6, fur, "claw");
  s += bentLimb(58, 74, 60, 80, 62, 88, 6, fur, "claw");
  s += bentLimb(70, 70, 74, 78, 78, 86, 6.5, fur, "claw");
  s += `${bg.defs}<ellipse cx="50" cy="66" rx="25" ry="16" fill="${bg.id}" stroke="${P.ink}" stroke-width="2.6"/>`;
  s += gloss(40, 58, 7, 3.5);
  [34, 50, 66].forEach((hx) => {
    const hg = roundFill(fur);
    s += earPair(hx, 36, 6, 6, fur);
    s += `${hg.defs}<circle cx="${hx}" cy="42" r="11" fill="${hg.id}" stroke="${P.ink}" stroke-width="2.6"/>`;
    s += gloss(hx - 3.5, 38, 3, 1.6);
    s += muzzle(hx, 49, 5.5, 4, shade(fur, 0.1));
    s += `<circle cx="${hx - 3}" cy="41" r="1.6" fill="${P.red}"/><circle cx="${hx + 3}" cy="41" r="1.6" fill="${P.red}"/>`;
  });
  return svg(s);
};
// 레이드 확장 보스 3종 — 엘리트 3종보다도 한 단계 더 위협적으로(더 크고 화려하게)
monsterBuilders.echidna = () => {
  const scale = "#8B6BA8", skin = "#E8B98A";
  const tailC = shade(scale, -0.05);
  const hg = roundFill(skin);
  let s = ground(50, 92, 28);
  s += `<path d="M 50 58 Q 72 64 60 78" fill="none" stroke="${tailC}" stroke-width="19" stroke-linecap="round"/>`;
  s += `<path d="M 60 76 Q 46 84 62 92" fill="none" stroke="${tailC}" stroke-width="14" stroke-linecap="round"/>`;
  s += `<path d="M 61 90 Q 52 96 66 98" fill="none" stroke="${tailC}" stroke-width="8" stroke-linecap="round"/>`;
  s += `<path d="M 55 62 Q 61 65 58 70" fill="none" stroke="${shade(scale, -0.28)}" stroke-width="1.6" opacity="0.5"/>`;
  s += `<path d="M 56 82 Q 50 85 53 89" fill="none" stroke="${shade(scale, -0.28)}" stroke-width="1.6" opacity="0.5"/>`;
  s += bentLimb(40, 46, 30, 50, 24, 58, 3.8, skin, "claw");
  s += bentLimb(60, 46, 70, 50, 76, 58, 3.8, skin, "claw");
  s += `${hg.defs}<ellipse cx="50" cy="46" rx="12.5" ry="16" fill="${hg.id}" stroke="${P.ink}" stroke-width="2.6"/>`;
  s += gloss(45, 40, 3.4, 1.8);
  for (let i = 0; i < 7; i++) {
    const ang = (Math.PI / 6) * i - Math.PI * 1.05;
    const x1 = 50 + Math.cos(ang) * 13, y1 = 38 + Math.sin(ang) * 13;
    const x2 = 50 + Math.cos(ang) * 23, y2 = 38 + Math.sin(ang) * 20;
    s += `<path d="M ${x1} ${y1} Q ${x2 + 4} ${y2 - 4} ${x2} ${y2}" fill="none" stroke="${scale}" stroke-width="3" stroke-linecap="round"/>`;
  }
  s += `<path d="M 42 32 L 45 24 L 50 30 L 55 24 L 58 32 Z" fill="${P.gold}" stroke="${P.ink}" stroke-width="1.6" stroke-linejoin="round"/>`;
  s += eyes(50, 44, 4, 1.8);
  s += smile(50, 50, 3);
  return svg(s);
};
monsterBuilders.typhon = () => {
  const hide = "#4A4A5E";
  const wingC = shade(hide, -0.1);
  const bg = roundFill(hide);
  let s = ground(50, 92, 32);
  const wing = (x, dir) => `<path d="M ${x} 54 Q ${x + dir * 24} 36 ${x + dir * 32} 52 Q ${x + dir * 22} 50 ${x + dir * 15} 60 Q ${x + dir * 8} 56 ${x} 64 Z" fill="${wingC}" stroke="${P.ink}" stroke-width="2.2" stroke-linejoin="round" opacity="0.94"/>`;
  s += wing(37, -1) + wing(63, 1);
  s += bentLimb(38, 78, 33, 86, 28, 92, 6.5, hide, "claw");
  s += bentLimb(62, 78, 67, 86, 72, 92, 6.5, hide, "claw");
  s += `${bg.defs}<ellipse cx="50" cy="66" rx="19" ry="20" fill="${bg.id}" stroke="${P.ink}" stroke-width="2.6"/>`;
  s += gloss(43, 58, 5, 2.6);
  // 뿔+주둥이가 있는 큰 머리 하나로 단순화(작은 목 2개는 날개와 겹쳐 시인성이
  // 떨어져서 제외) — 대신 턱 아래로 확실히 보이는 불길로 위협감을 준다
  const hg = roundFill(hide);
  s += earPair(50, 32, 8, 9, shade(hide, -0.15));
  s += `${hg.defs}<circle cx="50" cy="38" r="15" fill="${hg.id}" stroke="${P.ink}" stroke-width="2.8"/>`;
  s += gloss(43, 32, 4.2, 2.2);
  s += muzzle(50, 47, 6.5, 4.6, shade(hide, 0.08));
  s += `<circle cx="44" cy="36" r="2.4" fill="${P.red}"/><circle cx="56" cy="36" r="2.4" fill="${P.red}"/>`;
  const flameOuter = dGrad(shade(P.red, 0.15), shade(P.roofDeep, -0.05));
  const flameInner = dGrad(shade(P.gold, 0.35), P.gold);
  // 위가 아니라 아래로 향하는 불길(입에서 뿜어져 나오는 모습)
  const tongueDown = (x, y, h, w, grad) => `<path d="M ${x - w} ${y} Q ${x - w * 1.3} ${y + h * 0.55} ${x} ${y + h} Q ${x + w * 1.3} ${y + h * 0.55} ${x + w} ${y} Z" fill="${grad.id}" stroke="${P.ink}" stroke-width="1.3" stroke-linejoin="round"/>`;
  s += `${flameOuter.defs}${tongueDown(46, 53, 11, 3, flameOuter)}${tongueDown(54, 53, 11, 3, flameOuter)}`;
  s += `${flameInner.defs}${tongueDown(50, 53, 14, 3.4, flameInner)}`;
  return svg(s);
};
monsterBuilders.cronus = () => {
  const robe = "#5B4A3A", skin = "#C89A72", metal = "#8F7B4E";
  const rg = roundFill(robe), hg = roundFill(skin), blade = dGrad(shade(P.stone, 0.2), shade(P.stoneDeep, -0.1));
  let s = ground(50, 90, 24);
  s += `<line x1="70" y1="20" x2="34" y2="80" stroke="${shade(metal, -0.2)}" stroke-width="3" stroke-linecap="round"/>`;
  s += `${blade.defs}<path d="M 68 18 Q 84 20 80 34 Q 74 30 66 28 Z" fill="${blade.id}" stroke="${P.ink}" stroke-width="2" stroke-linejoin="round"/>`;
  s += `${rg.defs}<path d="M 32 88 Q 30 55 40 46 L 60 46 Q 70 55 68 88 Z" fill="${rg.id}" stroke="${P.ink}" stroke-width="2.6" stroke-linejoin="round"/>`;
  s += bentLimb(36, 54, 28, 62, 24, 72, 4.2, skin, "claw");
  s += bentLimb(64, 54, 72, 62, 76, 72, 4.2, skin, "claw");
  s += `${hg.defs}<circle cx="50" cy="38" r="13" fill="${hg.id}" stroke="${P.ink}" stroke-width="2.6"/>`;
  s += gloss(45, 33, 3.4, 1.8);
  s += `<path d="M 39 30 L 42 20 L 47 27 L 50 18 L 53 27 L 58 20 L 61 30 Z" fill="${P.gold}" stroke="${P.ink}" stroke-width="1.8" stroke-linejoin="round"/>`;
  s += `<circle cx="45" cy="38" r="2.4" fill="${P.gold}"/><circle cx="55" cy="38" r="2.4" fill="${P.gold}"/>`;
  s += `<path d="M 44 46 Q 50 43 56 46" fill="none" stroke="${P.ink}" stroke-width="1.6" stroke-linecap="round" opacity="0.7"/>`;
  return svg(s);
};

// ---------- 월드맵: 성채 아이콘(내 도시 1 + NPC 4티어) ----------
const worldmapBuilders = {};
const wmCastleBase = (accent, big) => {
  const s0 = big ? 1.15 : 1;
  let s = ground(50, 92 * s0, 30 * s0);
  s += wall(50 - 22 * s0, 60 * s0, 44 * s0, 30 * s0, P.ivoryDeep);
  s += wall(50 - 30 * s0, 50 * s0, 12 * s0, 40 * s0, P.ivoryDeep);
  s += wall(50 + 18 * s0, 50 * s0, 12 * s0, 40 * s0, P.ivoryDeep);
  s += roofTri(50 - 24 * s0, 50 * s0, 8 * s0, 12 * s0, accent);
  s += roofTri(50 + 24 * s0, 50 * s0, 8 * s0, 12 * s0, accent);
  s += roofTrap(50 - 20 * s0, 60 * s0, 40 * s0, 12 * s0, 5 * s0, accent);
  s += door(50, 90 * s0, 10 * s0, 14 * s0);
  return s;
};
worldmapBuilders.mine = () => svg(wmCastleBase(P.gold, true) + flag(50, 40, 14, P.gold));
worldmapBuilders.t1 = () => svg(wmCastleBase(P.stone, false));
worldmapBuilders.t2 = () => svg(wmCastleBase(P.roof, false));
worldmapBuilders.t3 = () => svg(wmCastleBase(P.wood, false) + flag(50 - 30, 46, 10, P.red));
worldmapBuilders.t4 = () => svg(wmCastleBase(P.red, false) + flag(50 - 30, 46, 10, P.red) + flag(50 + 30, 46, 10, P.red));

// ---------- 월드맵 배경(대륙 지도, 1600×1000) ----------
// 성채가 화면 전역(0~100%)에 흩뿌려지므로 지평선/하늘 없는 완전한 탑다운 지형으로 구성
const worldmapBg = () => svg(
  `<defs>
     <linearGradient id="sea" x1="0" y1="0" x2="1" y2="1">
       <stop offset="0" stop-color="#BFE0DE"/><stop offset="1" stop-color="#A9D2CF"/>
     </linearGradient>
   </defs>
   <rect width="1600" height="1000" fill="url(#sea)"/>
   <path d="M 40 60 Q 500 -10 900 70 Q 1300 30 1560 140 Q 1600 500 1540 860 Q 1200 1010 850 950 Q 450 1020 60 900 Q -20 500 40 60 Z"
     fill="${P.ivory}" opacity="0.9"/>
   <path d="M 120 140 Q 550 90 880 170 Q 1230 130 1480 230 Q 1500 520 1460 800 Q 1180 920 860 880 Q 500 940 150 830 Q 90 480 120 140 Z"
     fill="${P.food}" opacity="0.32"/>
   <path d="M 260 260 Q 600 220 900 300 Q 1150 270 1360 360 Q 1360 560 1300 720 Q 1020 800 760 760 Q 480 800 260 700 Q 220 470 260 260 Z"
     fill="${P.foodDeep}" opacity="0.22"/>
   ${[[300, 260], [640, 190], [980, 250], [1280, 200], [520, 560], [1080, 620], [220, 720], [1380, 650]].map(([cx, cy], i) => {
     const s = 26 + (i % 3) * 8;
     return `<path d="M ${cx - s} ${cy + s * 0.6} L ${cx} ${cy - s} L ${cx + s} ${cy + s * 0.6} Z" fill="${P.stoneDeep}" opacity="0.3"/>
             <path d="M ${cx - s * 0.4} ${cy + s * 0.6} L ${cx} ${cy - s * 0.1} L ${cx + s * 0.4} ${cy + s * 0.6} Z" fill="${P.ivoryDeep}" opacity="0.5"/>`;
   }).join("")}
   ${Array.from({ length: 16 }).map((_, i) => {
     const cx = 160 + (i * 187) % 1360, cy = 140 + (i * 233) % 760;
     return `<circle cx="${cx}" cy="${cy}" r="9" fill="${P.foodDeep}" opacity="0.28"/><circle cx="${cx + 12}" cy="${cy + 6}" r="6" fill="${P.foodDeep}" opacity="0.22"/>`;
   }).join("")}
   <path d="M 100 900 Q 500 830 800 900 Q 1150 840 1520 900" stroke="${P.roofDeep}" stroke-width="4" stroke-dasharray="2 14" fill="none" opacity="0.4" stroke-linecap="round"/>`,
  "0 0 1600 1000"
);

// ---------- 타이틀 화면 배경(올림포스 산/구름 실루엣) ----------
const titleBg = () => svg(
  `<defs>
     <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
       <stop offset="0" stop-color="#F7E9C9"/><stop offset="1" stop-color="${P.ivory}"/>
     </linearGradient>
   </defs>
   <rect width="1600" height="900" fill="url(#sky)"/>
   <path d="M -50 620 L 260 320 L 430 480 L 620 260 L 900 620 Z" fill="${P.roofDeep}" opacity="0.28"/>
   <path d="M 500 650 L 820 280 L 1060 470 L 1300 330 L 1650 650 Z" fill="${P.stoneDeep}" opacity="0.24"/>
   <path d="M 780 420 L 900 300 L 960 360 L 900 400 Z" fill="${P.white}" opacity="0.5"/>
   ${[[220, 200, 70], [420, 260, 100], [1200, 220, 90], [1400, 300, 60], [760, 160, 80]].map(([cx, cy, w]) =>
     `<ellipse cx="${cx}" cy="${cy}" rx="${w}" ry="${w * 0.36}" fill="${P.white}" opacity="0.55"/>`
   ).join("")}
   <path d="M 720 900 Q 800 560 900 460 Q 1000 560 1020 900 Z" fill="${P.ivoryDeep}" opacity="0.4"/>
   ${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="${770 + i * 30}" y="${560 + i % 2 * 10}" width="10" height="${330 - i * 30}" fill="${P.ivoryDeep}" opacity="0.5"/>`).join("")}`,
  "0 0 1600 900"
);

const emptyPlot = () => svg(
  `${ground(50, 68, 22)}
   <rect x="30" y="36" width="40" height="28" rx="5" fill="none" stroke="${P.ink}" stroke-width="3" stroke-dasharray="6 5" opacity="0.55"/>
   <line x1="50" y1="42" x2="50" y2="58" stroke="${P.ink}" stroke-width="3" stroke-linecap="round" opacity="0.5"/>
   <line x1="42" y1="50" x2="58" y2="50" stroke="${P.ink}" stroke-width="3" stroke-linecap="round" opacity="0.5"/>`
);

// ---------- 성 내부(보드) 배경 — game.js TILE_LAYOUT 좌표를 그대로 반영한 레이아웃 인지형 배경 ----------
// #board는 CSS Grid다. 1·2·9·10열은 성벽과의 여백용 얇은 열(20px), 3~8열은 건물이 실제로
// 놓이는 정사각형 칸(240px)이다 — 이 배열/gap/padding 값은 style.css #board와 반드시 동일해야
// 한다. 뷰박스 크기를 이 실제 픽셀 합과 1:1로 맞추면(아래 VB_W/VB_H) background-size:100% 100%로
// 늘려도 왜곡 없이 정확히 겹쳐진다.
const COL_W = [20, 20, 240, 240, 240, 240, 240, 240, 20, 20];
const CELL_ROW_H = 240;
const CELL_GAP = 22;
const CELL_PAD = 16;
const VB_W = CELL_PAD * 2 + COL_W.reduce((a, b) => a + b, 0) + CELL_GAP * (COL_W.length - 1);
const VB_H = CELL_PAD * 2 + CELL_ROW_H * 4 + CELL_GAP * 3;
function colLeft(col) {
  let x = CELL_PAD;
  for (let i = 0; i < col - 1; i++) x += COL_W[i] + CELL_GAP;
  return x;
}
function colCenter(col, span) {
  let w = 0;
  for (let i = 0; i < span; i++) w += COL_W[col - 1 + i];
  w += (span - 1) * CELL_GAP;
  return colLeft(col) + w / 2;
}
function rowCenter(row) {
  return CELL_PAD + (row - 1) * (CELL_ROW_H + CELL_GAP) + CELL_ROW_H / 2;
}
const TILE_LAYOUT_REF = [
  ["plot11", 3, 1, 1], ["defense", 4, 1, 1], ["watch", 7, 1, 1], ["plot12", 8, 1, 1],
  ["plot1", 3, 2, 1], ["academy", 4, 2, 1], ["castle", 5, 2, 2], ["storage", 7, 2, 1], ["plot2", 8, 2, 1],
  ["plot13", 3, 3, 1], ["plot3", 4, 3, 1], ["tavern", 5, 3, 2], ["plot4", 7, 3, 1], ["plot14", 8, 3, 1],
  ["plot5", 3, 4, 1], ["plot6", 4, 4, 1], ["plot7", 5, 4, 1], ["plot8", 6, 4, 1], ["plot9", 7, 4, 1], ["plot10", 8, 4, 1],
];
const TILE_POS = TILE_LAYOUT_REF.map(([id, col, row, span]) => ({ id, x: colCenter(col, span), y: rowCenter(row) }));
const posOf = (id) => TILE_POS.find((t) => t.id === id);
// 살짝 휜 곡선 + 가장자리 흙 스펙클로 자로 잰 듯한 직선/원 느낌을 피한다(자연스러운 흙길)
// 뷰박스 단위 = 실제 픽셀이므로 폭 값도 실제 도로 두께(px) 그대로 쓴다
function roadLine(x1, y1, x2, y2, rng) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const wobble = (rng() - 0.5) * Math.min(36, len * 0.1);
  const cx = mx + nx * wobble, cy = my + ny * wobble;
  let s = `<path d="M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}" fill="none" stroke="${P.roadDeep}" stroke-width="46" stroke-linecap="round"/>`;
  s += `<path d="M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}" fill="none" stroke="${P.road}" stroke-width="32" stroke-linecap="round"/>`;
  const steps = Math.max(5, Math.round(len / 35));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * cx + t * t * x2;
    const py = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * cy + t * t * y2;
    const side = rng() < 0.5 ? -1 : 1;
    const off = 12 + rng() * 15;
    s += `<circle cx="${px + nx * side * off}" cy="${py + ny * side * off}" r="${1.5 + rng() * 2.4}" fill="${pick(rng, [P.roadDeep, P.grassMid])}" opacity="0.5"/>`;
  }
  return s;
}
function roadPad(x, y, r, rng) {
  let s = `<circle cx="${x}" cy="${y}" r="${r + 7}" fill="${P.road}" opacity="0.3"/>`;
  s += `<circle cx="${x}" cy="${y}" r="${r}" fill="${P.roadDeep}"/><circle cx="${x}" cy="${y}" r="${r - 6}" fill="${P.road}"/>`;
  for (let i = 0; i < 10; i++) {
    const ang = rng() * Math.PI * 2, rr = r * (0.55 + rng() * 0.5);
    s += `<circle cx="${x + Math.cos(ang) * rr}" cy="${y + Math.sin(ang) * rr}" r="${1 + rng()}" fill="${P.roadDeep}" opacity="0.4"/>`;
  }
  return s;
}
const boardFloor = () => {
  const rng = mulberry32(778);
  // 도로가 아닌 전체 영역은 초록 잔디가 기본값(요청: "도로가 아닌 곳은 초록색")
  let grass = `<rect width="${VB_W}" height="${VB_H}" fill="${P.grassPale}"/>`;
  // 완만한 명암 패치로 밋밋한 단색 초록을 피함(뷰박스=실제 픽셀이므로 비율값을 그때그때 곱해 구함)
  const fx = (f) => (f * VB_W).toFixed(1), fy = (f) => (f * VB_H).toFixed(1);
  grass += `<path d="M ${fx(-0.01)} 0 Q ${fx(0.25)} ${fy(0.163)} ${fx(0.5)} ${fy(0.026)} Q ${fx(0.75)} ${fy(-0.081)} ${fx(1.01)} ${fy(0.109)} L ${fx(1.01)} ${fy(-0.026)} L ${fx(-0.01)} ${fy(-0.026)} Z" fill="${P.grassMid}" opacity="0.5"/>`;
  grass += `<path d="M ${fx(-0.01)} ${fy(1.026)} Q ${fx(0.26)} ${fy(0.865)} ${fx(0.52)} ${fy(1)} Q ${fx(0.78)} ${fy(1.109)} ${fx(1.01)} ${fy(0.945)} L ${fx(1.01)} ${fy(1.026)} L ${fx(-0.01)} ${fy(1.026)} Z" fill="${P.grassMid}" opacity="0.5"/>`;
  grass += `<ellipse cx="${fx(0.15)}" cy="${fy(0.5)}" rx="${fx(0.14)}" ry="${fy(0.225)}" fill="${P.grassMid}" opacity="0.35"/>`;
  grass += `<ellipse cx="${fx(0.85)}" cy="${fy(0.55)}" rx="${fx(0.15)}" ry="${fy(0.238)}" fill="${P.grassMid}" opacity="0.35"/>`;
  for (let i = 0; i < 220; i++) {
    const x = rng() * VB_W, y = rng() * VB_H;
    const roll = rng();
    if (roll < 0.6) grass += grassTuft(x, y, pick(rng, [P.foodDeep, P.food]));
    else if (roll < 0.88) grass += `<circle cx="${x}" cy="${y}" r="${1.5 + rng() * 1.8}" fill="${P.food}" opacity="0.4"/>`;
    else grass += `<circle cx="${x}" cy="${y}" r="${1.2 + rng()}" fill="${P.gold}" opacity="0.55"/>`;
  }

  const castle = posOf("castle"), tavern = posOf("tavern");
  let roads = "";
  // 중앙 대로를 성문 위쪽 끝→성→여관→마을 남쪽 끝, 세 구간으로 나눈다 — 한 곡선으로 이으면
  // 중간에 낀 성/여관 좌표가 흔들림 때문에 실제 칸 중심에서 벗어나 버린다.
  roads += roadLine(castle.x, CELL_PAD, castle.x, castle.y, rng);
  roads += roadLine(castle.x, castle.y, tavern.x, tavern.y, rng);
  roads += roadLine(tavern.x, tavern.y, tavern.x, VB_H - CELL_PAD, rng);
  [1, 2, 3, 4].forEach((row) => {
    const rowTiles = TILE_POS.filter((t) => Math.abs(t.y - rowCenter(row)) < 1).sort((a, b) => a.x - b.x);
    if (rowTiles.length < 2) return;
    // 같은 이유로 그 행에 있는 타일들을 하나의 긴 곡선이 아니라 인접 타일끼리 짧게 잇는다
    for (let i = 0; i < rowTiles.length - 1; i++) {
      roads += roadLine(rowTiles[i].x, rowTiles[i].y, rowTiles[i + 1].x, rowTiles[i + 1].y, rng);
    }
  });
  TILE_POS.forEach((t) => { roads += roadPad(t.x, t.y, t.id === "castle" || t.id === "tavern" ? 60 : 42, rng); });

  return svg(grass + roads, `0 0 ${VB_W} ${VB_H}`);
};

// ---------- 왕국 화면(도시맵) 배경 — 성벽 밖 야생 지역이 앉아 있는 타일링 배경 ----------
// #kingdom-stage 전체(몬스터 배너 + 성벽/보드)의 뒤판. 보드 안쪽 floor.svg보다 살짝
// 더 "야외" 느낌(풀숲 덤불)을 주되, 카드/성벽 위에 텍스트가 계속 올라가므로 톤은 낮게 유지.
const grassTuft = (cx, cy, fill) =>
  `<path d="M ${cx} ${cy} Q ${cx - 3} ${cy - 9} ${cx - 1} ${cy - 13} Q ${cx} ${cy - 8} ${cx} ${cy - 13} Q ${cx + 1} ${cy - 8} ${cx + 2} ${cy - 13} Q ${cx + 4} ${cy - 9} ${cx} ${cy}"
     fill="none" stroke="${fill}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
const kingdomBg = () => svg(
  `<rect width="200" height="200" fill="${P.ivory}"/>
   <path d="M -10 40 Q 60 20 120 45 Q 170 60 210 35 L 210 -10 L -10 -10 Z" fill="${P.food}" opacity="0.10"/>
   <path d="M -10 170 Q 70 190 140 165 Q 180 150 210 175 L 210 210 L -10 210 Z" fill="${P.food}" opacity="0.10"/>
   ${[[24, 30], [150, 18], [70, 70], [175, 95], [30, 120], [110, 150], [185, 170], [55, 185], [140, 55]]
     .map(([x, y]) => grassTuft(x, y, P.foodDeep)).join("")}
   ${[[45, 55], [130, 40], [95, 110], [20, 150], [160, 130], [65, 25]]
     .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.8" fill="${P.gold}" opacity="0.5"/>`).join("")}
   ${[[80, 20], [15, 90], [155, 75], [110, 180], [190, 40]]
     .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6" fill="${P.ivoryDeep}" opacity="0.6"/>`).join("")}`,
  "0 0 200 200"
);

// 성벽 9-slice용 반복 스트립 — 자로 잰 격자 대신 크기가 들쭉날쭉한 부정형 석재로 자연스럽게
const wallStrip = () => {
  const rng = mulberry32(4242);
  let s = `<rect width="120" height="40" fill="${P.stoneDeep}"/>`;
  [6, 25].forEach((y, ri) => {
    let x = ri % 2 ? -14 : -4;
    while (x < 128) {
      const w = 18 + rng() * 13;
      const h = 13 + rng() * 4;
      const jitterY = (rng() - 0.5) * 3;
      s += `<rect x="${x}" y="${y + jitterY}" width="${w}" height="${h}" rx="3" fill="${pick(rng, [P.stone, P.stoneDeep])}" stroke="${P.ink}" stroke-width="1.2" opacity="0.9"/>`;
      x += w + 2 + rng() * 2;
    }
  });
  for (let i = 0; i < 46; i++) {
    s += `<circle cx="${rng() * 120}" cy="${rng() * 40}" r="${0.5 + rng()}" fill="${P.ink}" opacity="0.12"/>`;
  }
  s += `<rect x="0" y="0" width="120" height="40" fill="none" stroke="${P.ink}" stroke-width="2"/>`;
  return svg(s, "0 0 120 40");
};

// ---------- 영웅 초상화(300명) ----------
// ASSET_LIST.md 4절의 "파츠 조합형" 권고를 그대로 코드로 구현: id를 시드로 한
// 결정적(deterministic) 난수로 매번 같은 결과가 나오도록 하되, 300명 각자 다른
// 조합(피부·머리색·머리모양·수염·의상색)이 나오게 한다. 등급이 높을수록 장신구가
// 화려해지고(머리띠→월계관→금관+오라), ★8 아홉 명(신급)은 이름별로 상징 아이템을
// 직접 지정해 더 상징성 있게 만든다.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const SKIN_TONES = ["#F0C9A0", "#E8B98A", "#D6A26B", "#C98B5C", "#8C5A3C"];
const HAIR_COLORS = ["#2B2118", "#3A2A1C", "#5B3A29", "#6B4423", "#8C6A46", "#3A3A3A", "#B8AA95", "#A8582E"];
const CLOTH_COLORS = ["#7FA35C", "#4C8FE0", "#C0433A", "#9B59D0", "#5B7A8F", "#B5651D", "#4E8F5B", "#C9694A", "#3E7C8A", "#A0527A"];

function leaf(cx, cy, ang, fill) {
  return `<ellipse cx="${cx}" cy="${cy}" rx="4.2" ry="2.1" fill="${fill}" stroke="${P.ink}" stroke-width="0.9" transform="rotate(${ang} ${cx} ${cy})"/>`;
}
function laurel(bothSides, color) {
  const side = (mult) => {
    let s = "";
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      s += leaf(50 + mult * (23 + t * 5), 38 - t * 15, mult * (25 + t * 25), color);
    }
    return s;
  };
  return side(1) + (bothSides ? side(-1) : "");
}
function hairShape(style, color) {
  if (style === 0) // 짧은 스타일
    return `<path d="M 27 50 Q 28 27 50 25 Q 72 27 73 50 Q 66 34 50 32 Q 34 34 27 50 Z" fill="${color}" stroke="${P.ink}" stroke-width="2.2" stroke-linejoin="round"/>`;
  if (style === 1) // 풍성한 웨이브
    return `<path d="M 23 55 Q 17 26 50 22 Q 83 26 77 55 Q 78 42 68 40 Q 72 30 50 28 Q 28 30 32 40 Q 22 42 23 55 Z" fill="${color}" stroke="${P.ink}" stroke-width="2.2" stroke-linejoin="round"/>`;
  // 긴 머리(어깨까지)
  return `<path d="M 25 52 Q 16 30 50 24 Q 84 30 75 52 Q 80 70 74 88 Q 68 72 70 54 Q 70 34 50 30 Q 30 34 30 54 Q 32 72 26 88 Q 20 70 25 52 Z" fill="${color}" stroke="${P.ink}" stroke-width="2.2" stroke-linejoin="round"/>`;
}
function beardShape(color) {
  return `<path d="M 38 62 Q 40 76 50 78 Q 60 76 62 62 Q 62 70 50 72 Q 38 70 38 62 Z" fill="${color}" stroke="${P.ink}" stroke-width="1.8" stroke-linejoin="round"/>`;
}
// ★8 신급 9명 전용 상징 아이템(작은 배지로 초상 오른쪽 아래에 얹는다)
const GOD_SYMBOL = {
  292: (c) => `<path d="M -6 4 Q -2 -8 8 -6 Q 4 -2 -2 2 Q -6 6 -6 4 Z" fill="${P.stone}" stroke="${P.ink}" stroke-width="1.2" transform="translate(50 50)"/>` , // 크로노스: 낫
  293: (c) => `<path d="M -6 8 L -6 -8 M -3 8 L -3 -6 M 0 8 L 0 -8 M -6 -8 Q -3 -12 0 -8" fill="none" stroke="${P.stoneDeep}" stroke-width="1.6" stroke-linecap="round" transform="translate(50 50)"/>`, // 포세이돈: 삼지창
  294: (c) => `<circle r="6" fill="${P.gold}" stroke="${P.ink}" stroke-width="1.2" transform="translate(50 50)"/>` + Array.from({ length: 8 }).map((_, i) => { const a = i * Math.PI / 4; return `<line x1="${50 + Math.cos(a) * 7}" y1="${50 + Math.sin(a) * 7}" x2="${50 + Math.cos(a) * 10}" y2="${50 + Math.sin(a) * 10}" stroke="${P.gold}" stroke-width="1.4" stroke-linecap="round"/>`; }).join(""), // 아폴론: 태양
  295: (c) => `<path d="M 0 -6 Q 6 -6 6 0 Q 6 6 0 8 Q -6 6 -6 0 Q -6 -6 0 -6 Z" fill="#E091B0" stroke="${P.ink}" stroke-width="1.2" transform="translate(50 50)"/>`, // 아프로디테: 장미
  296: (c) => `<path d="M -2 -8 L 3 -1 L -1 -1 L 4 8 L -6 -2 L -1 -2 Z" fill="${P.gold}" stroke="${P.ink}" stroke-width="1" transform="translate(50 50)"/>`, // 제우스: 번개
  297: (c) => `<path d="M 0 -7 Q 5 -3 3 4 Q 0 8 -3 4 Q -5 -3 0 -7 Z" fill="#9B59D0" stroke="${P.ink}" stroke-width="1.2" transform="translate(50 50)"/><circle cx="50" cy="45" r="1.4" fill="${P.gold}"/>`, // 헤라: 공작깃털
  298: (c) => `<path d="M -5 8 L -5 -8 M 0 8 L 0 -10 M 5 8 L 5 -8 M -5 -8 Q 0 -12 5 -8" fill="none" stroke="#4A3A5C" stroke-width="1.6" stroke-linecap="round" transform="translate(50 50)"/>`, // 하데스: 두갈래창(빈덴트)
  299: (c) => `<ellipse cx="-5" cy="-2" rx="4" ry="2" fill="${P.food}" stroke="${P.ink}" stroke-width="1" transform="translate(50 50) rotate(-20)"/><ellipse cx="0" cy="-6" rx="4" ry="2" fill="${P.food}" stroke="${P.ink}" stroke-width="1" transform="translate(50 50) rotate(10)"/><ellipse cx="5" cy="-2" rx="4" ry="2" fill="${P.foodDeep}" stroke="${P.ink}" stroke-width="1" transform="translate(50 50) rotate(35)"/>`, // 가이아: 이파리
  // ★7 17명
  275: (c) => `<path d="M 0 -8 Q 7 0 0 8" fill="none" stroke="${P.woodDeep}" stroke-width="1.6" stroke-linecap="round" transform="translate(50 50)"/><line x1="0" y1="-8" x2="0" y2="8" stroke="${P.ink}" stroke-width="0.8" transform="translate(50 50)"/>`, // 오디세우스: 활
  276: (c) => `<path d="M -1 8 L 1 -2 L -3 -2 L 2 -9" fill="none" stroke="${P.roofDeep}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" transform="translate(50 50)"/>`, // 프로메테우스: 불꽃 횃불
  277: (c) => `<rect x="-3" y="-8" width="6" height="14" rx="2" fill="${P.stone}" stroke="${P.ink}" stroke-width="1.2" transform="translate(50 50)"/><line x1="0" y1="-8" x2="0" y2="6" stroke="${P.stoneDeep}" stroke-width="1" transform="translate(50 50)"/>`, // 헥토르: 방패
  278: (c) => `<circle r="7" fill="none" stroke="${P.stoneDeep}" stroke-width="1.4" transform="translate(50 50)"/><path d="M -7 0 Q 0 -3 7 0 M -5 -5 Q 0 0 -5 5" fill="none" stroke="${P.stoneDeep}" stroke-width="0.8" transform="translate(50 50)"/>`, // 아틀라스: 천구
  279: (c) => `<circle r="5" fill="${P.gold}" stroke="${P.ink}" stroke-width="1" transform="translate(50 50)"/>` + Array.from({ length: 6 }).map((_, i) => { const a = i * Math.PI / 3; return `<line x1="${50 + Math.cos(a) * 6}" y1="${50 + Math.sin(a) * 6}" x2="${50 + Math.cos(a) * 9}" y2="${50 + Math.sin(a) * 9}" stroke="${P.roof}" stroke-width="1.3" stroke-linecap="round"/>`; }).join(""), // 헬리오스: 태양 수레바퀴
  280: (c) => `<path d="M -4 8 L 4 8 L 3 -2 Q 0 -8 -3 -2 Z" fill="${P.roof}" stroke="${P.ink}" stroke-width="1.2" transform="translate(50 50)"/>`, // 헤스티아: 화로 불꽃
  281: (c) => `<path d="M 0 -8 L 0 6 M -4 6 Q 0 10 4 6" fill="none" stroke="${P.gold}" stroke-width="1.6" stroke-linecap="round" transform="translate(50 50)"/><path d="M -3 -8 L 0 -4 L 3 -8" fill="none" stroke="${P.gold}" stroke-width="1.2" transform="translate(50 50)"/>`, // 데메테르: 밀 이삭
  282: (c) => `<line x1="0" y1="-8" x2="0" y2="8" stroke="${P.stoneDeep}" stroke-width="1.4" transform="translate(50 50)"/><path d="M -4 -4 Q 0 -8 4 -4 Q 0 -1 -4 -4 Z M -4 0 Q 0 -4 4 0 Q 0 3 -4 0 Z" fill="none" stroke="${P.gold}" stroke-width="1" transform="translate(50 50)"/>`, // 헤르메스: 카두케우스
  283: (c) => `<circle cx="-2" cy="-2" r="2.6" fill="#9B59D0" stroke="${P.ink}" stroke-width="0.8" transform="translate(50 50)"/><circle cx="2" cy="1" r="2.6" fill="#9B59D0" stroke="${P.ink}" stroke-width="0.8" transform="translate(50 50)"/><circle cx="-1" cy="4" r="2.6" fill="#9B59D0" stroke="${P.ink}" stroke-width="0.8" transform="translate(50 50)"/>`, // 디오니소스: 포도송이
  284: (c) => `<rect x="-1" y="-8" width="2" height="12" fill="${P.stoneDeep}" transform="translate(50 50)"/><path d="M -6 -8 L 6 -8 L 6 -5 L -6 -5 Z" fill="${P.stone}" stroke="${P.ink}" stroke-width="1" transform="translate(50 50)"/>`, // 헤파이스토스: 망치
  285: (c) => `<line x1="0" y1="-9" x2="0" y2="9" stroke="${P.stoneDeep}" stroke-width="1.6" transform="translate(50 50)"/><path d="M -3 -9 L 0 -13 L 3 -9 Z" fill="${P.stone}" stroke="${P.ink}" stroke-width="1" transform="translate(50 50)"/>`, // 아킬레우스: 창
  286: (c) => `<path d="M -7 3 Q -7 -6 0 -8 Q 7 -6 7 3 Q 0 8 -7 3 Z" fill="${P.roofDeep}" stroke="${P.ink}" stroke-width="1.3" stroke-linejoin="round" transform="translate(50 50)"/>`, // 헤라클레스: 사자 가죽
  287: (c) => `<circle r="4.5" fill="${P.ivory}" stroke="${P.ink}" stroke-width="1" transform="translate(50 50)"/><path d="M -2 -1 L -2 2 M 2 -1 L 2 2" stroke="${P.ink}" stroke-width="1" transform="translate(50 50)"/><path d="M -4.5 -3 L -6 -6 L -2 -4 Z M 4.5 -3 L 6 -6 L 2 -4 Z" fill="${P.stoneDeep}" transform="translate(50 50)"/>`, // 아테나: 부엉이
  288: (c) => `<path d="M -6 0 Q 0 -8 6 0" fill="none" stroke="${P.stoneDeep}" stroke-width="1.4" transform="translate(50 50)"/><path d="M 3 -6 A 6 6 0 1 0 3 6 A 5 5 0 1 1 3 -6 Z" fill="${P.ivory}" stroke="${P.ink}" stroke-width="0.8" transform="translate(48 47)"/>`, // 아르테미스: 활+초승달
  289: (c) => `<path d="M -1 8 L 1 8 L 1 -6 L 4 -6 L 0 -12 L -4 -6 L -1 -6 Z" fill="${P.stone}" stroke="${P.ink}" stroke-width="1" transform="translate(50 50)"/>`, // 아레스: 검
  290: (c) => `<circle r="5.5" fill="${P.red}" stroke="${P.ink}" stroke-width="1.2" transform="translate(50 50)"/><path d="M -5 -1 L 5 -1 M -3 -1 L 0 3 L 3 -1" fill="none" stroke="${P.ink}" stroke-width="0.7" transform="translate(50 50)"/>`, // 페르세포네: 석류
  291: (c) => `<circle cx="-4" cy="-3" r="1" fill="${P.ivory}" transform="translate(50 50)"/><circle cx="2" cy="-6" r="1.3" fill="${P.ivory}" transform="translate(50 50)"/><circle cx="5" cy="0" r="0.9" fill="${P.ivory}" transform="translate(50 50)"/><circle cx="-2" cy="5" r="1.1" fill="${P.ivory}" transform="translate(50 50)"/><circle cx="4" cy="5" r="0.8" fill="${P.ivory}" transform="translate(50 50)"/>`, // 우라노스: 별
  // ★6 32명
  243: (c) => `<path d="M -6 4 L 6 4 L 4 -6 Q 0 -10 -4 -6 Z" fill="${P.gold}" stroke="${P.ink}" stroke-width="1" transform="translate(50 50)"/>`, // 아가멤논: 왕관
  244: (c) => `<circle r="5" fill="none" stroke="${P.gold}" stroke-width="1.4" transform="translate(50 50)"/><rect x="-1" y="4" width="2" height="5" fill="${P.gold}" transform="translate(50 50)"/>`, // 헬레네: 손거울
  245: (c) => `<path d="M 0 -7 Q 5 -6 6 -1 Q 6 4 0 6 Q -6 4 -6 -1 Q -5 -6 0 -7 Z" fill="#3A2A4C" stroke="${P.ink}" stroke-width="1" transform="translate(50 50)"/><path d="M -2 -1 L 2 2 M 2 -1 L -1 3" stroke="${P.ivory}" stroke-width="0.7" transform="translate(50 50)"/>`, // 카산드라: 까마귀
  246: (c) => `<circle r="7" fill="${P.stone}" stroke="${P.ink}" stroke-width="1.3" transform="translate(50 50)"/><path d="M -7 3 Q 0 -8 7 3" fill="none" stroke="${P.ink}" stroke-width="1" opacity="0.4" transform="translate(50 50)"/>`, // 시시포스: 바위
  247: (c) => `<circle r="5.5" fill="${P.gold}" stroke="${P.ink}" stroke-width="1.2" transform="translate(50 50)"/><path d="M -8 -6 L -5 -8 M -3 -9 L -1 -10" stroke="${P.gold}" stroke-width="1" stroke-linecap="round" transform="translate(50 50)"/>`, // 미다스: 황금
  248: (c) => `<path d="M -6 -6 L 6 -6 L 5 6 Q 0 9 -5 6 Z" fill="${P.roof}" stroke="${P.ink}" stroke-width="1.2" stroke-linejoin="round" transform="translate(50 50)"/><line x1="-6" y1="-6" x2="6" y2="-6" stroke="${P.ink}" stroke-width="1.4" transform="translate(50 50)"/>`, // 판도라: 상자
  249: (c) => `<path d="M -6 6 Q -6 -6 0 -8 Q 6 -6 6 6" fill="none" stroke="${P.stoneDeep}" stroke-width="1.3" transform="translate(50 50)"/><circle cx="-2" cy="-1" r="0.9" fill="${P.ink}" transform="translate(50 50)"/><circle cx="2" cy="-1" r="0.9" fill="${P.ink}" transform="translate(50 50)"/>`, // 오이디푸스: 스핑크스
  250: (c) => `<path d="M 0 0 Q -8 -4 -9 2 Q -3 3 0 0 Z M 0 0 Q 8 -4 9 2 Q 3 3 0 0 Z" fill="${P.ivory}" stroke="${P.ink}" stroke-width="1" transform="translate(50 47)"/>`, // 이카로스: 밀랍 날개
  251: (c) => `<path d="M -6 4 Q -7 -4 0 -6 Q 7 -4 6 4 Q 3 1 0 3 Q -3 1 -6 4 Z" fill="#8C8378" stroke="${P.ink}" stroke-width="1.1" stroke-linejoin="round" transform="translate(50 50)"/><path d="M -3 -5 L -4 -8 M 3 -5 L 4 -8" stroke="${P.ink}" stroke-width="0.9" transform="translate(50 50)"/>`, // 로물루스: 늑대
  252: (c) => `<line x1="-6" y1="0" x2="6" y2="0" stroke="${P.stoneDeep}" stroke-width="1.6" transform="translate(50 50)"/><circle cx="-4" cy="0" r="1" fill="${P.ivory}" transform="translate(50 50)"/><circle cx="0" cy="0" r="1" fill="${P.ivory}" transform="translate(50 50)"/><circle cx="4" cy="0" r="1" fill="${P.ivory}" transform="translate(50 50)"/>`, // 오리온: 삼태성 벨트
  253: (c) => `<path d="M -5 6 Q -6 -6 3 -8 Q 8 -6 4 -2 Q 0 0 -2 4 Z" fill="${P.stone}" stroke="${P.ink}" stroke-width="1.1" stroke-linejoin="round" transform="translate(50 50)"/>`, // 페르세우스: 낫검
  254: (c) => `<circle r="3" fill="none" stroke="${P.red}" stroke-width="1.4" transform="translate(50 46)"/><path d="M 0 -3 Q 6 0 4 9" fill="none" stroke="${P.red}" stroke-width="1.1" transform="translate(50 50)"/>`, // 테세우스: 실타래
  255: (c) => `<path d="M -6 2 Q -7 -6 0 -7 Q 7 -6 6 2 Q 0 6 -6 2 Z" fill="${P.gold}" stroke="${P.ink}" stroke-width="1.2" stroke-linejoin="round" transform="translate(50 50)"/><path d="M -3 -3 Q 0 -1 3 -3" stroke="${P.goldDeep}" stroke-width="0.8" fill="none" transform="translate(50 50)"/>`, // 이아손: 황금 양털
  256: (c) => `<path d="M -7 4 L 7 4 L 4 -2 L -4 -2 Z" fill="${P.ivory}" stroke="${P.ink}" stroke-width="1.1" stroke-linejoin="round" transform="translate(50 50)"/><line x1="0" y1="-8" x2="0" y2="-2" stroke="${P.woodDeep}" stroke-width="1.2" transform="translate(50 50)"/>`, // 아이네아스: 배
  257: (c) => `<circle r="4.5" fill="${P.gold}" stroke="${P.ink}" stroke-width="1.1" transform="translate(50 50)"/><path d="M 0 -4.5 Q -2 -7 -4 -6" stroke="${P.food}" stroke-width="1" fill="none" transform="translate(50 50)"/>`, // 아탈란테: 황금 사과
  258: (c) => `<path d="M -6 8 L -6 -6 Q -6 -9 -2 -9 L 2 -9 Q 6 -9 6 -5 L 6 8" fill="none" stroke="${P.woodDeep}" stroke-width="1.4" stroke-linejoin="round" transform="translate(50 50)"/><line x1="-3" y1="8" x2="-3" y2="-4" stroke="${P.gold}" stroke-width="0.6" transform="translate(50 50)"/><line x1="0" y1="8" x2="0" y2="-6" stroke="${P.gold}" stroke-width="0.6" transform="translate(50 50)"/><line x1="3" y1="8" x2="3" y2="-4" stroke="${P.gold}" stroke-width="0.6" transform="translate(50 50)"/>`, // 오르페우스: 리라
  259: (c) => `<path d="M -8 2 Q -9 -3 -4 -3 Q -2 -7 2 -5 Q 6 -6 7 -1 Q 8 3 3 4" fill="${P.ivory}" stroke="${P.ink}" stroke-width="1" stroke-linejoin="round" transform="translate(50 50)"/>`, // 벨레로폰: 페가수스 날개
  260: (c) => `<ellipse rx="6" ry="7" fill="#5B7A8F" stroke="${P.ink}" stroke-width="1.1" transform="translate(50 51)"/><path d="M -6 -2 L 6 -2 M -5 1 L 5 1" stroke="${P.ink}" stroke-width="0.6" opacity="0.5" transform="translate(50 50)"/>`, // 레아: 포대기
  261: (c) => `<rect x="-5" y="-8" width="10" height="15" rx="2" fill="${P.stone}" stroke="${P.ink}" stroke-width="1.3" transform="translate(50 50)"/><line x1="0" y1="-8" x2="0" y2="7" stroke="${P.stoneDeep}" stroke-width="0.8" transform="translate(50 50)"/>`, // 아이아스: 탑방패
  262: (c) => `<path d="M -6 4 Q -6 -4 0 -6 Q 6 -4 6 4" fill="none" stroke="${P.wood}" stroke-width="1.6" stroke-linecap="round" transform="translate(50 50)"/><path d="M -3 -6 L -4 -9 M 3 -6 L 4 -9" stroke="${P.wood}" stroke-width="1.2" transform="translate(50 50)"/>`, // 카스토르: 말
  263: (c) => `<circle cx="-3" cy="0" r="4" fill="none" stroke="${P.woodDeep}" stroke-width="1.6" transform="translate(50 50)"/><circle cx="3" cy="0" r="4" fill="none" stroke="${P.woodDeep}" stroke-width="1.6" transform="translate(50 50)"/>`, // 폴룩스: 권투 글러브
  264: (c) => `<line x1="-7" y1="-4" x2="7" y2="-4" stroke="${P.stoneDeep}" stroke-width="1.2" transform="translate(50 50)"/><path d="M -7 -4 L -9 2 L -5 2 Z M 7 -4 L 5 2 L 9 2 Z" fill="none" stroke="${P.stoneDeep}" stroke-width="1" transform="translate(50 50)"/><line x1="0" y1="-9" x2="0" y2="-4" stroke="${P.stoneDeep}" stroke-width="1.2" transform="translate(50 50)"/>`, // 테미스: 저울
  265: (c) => `<path d="M 0 8 L 0 -4 M 0 -4 Q -6 -6 -7 -9 M 0 -4 Q 6 -6 7 -9 M 0 -1 Q -5 -3 -6 -6 M 0 -1 Q 5 -3 6 -6" fill="none" stroke="${P.food}" stroke-width="1.1" stroke-linecap="round" transform="translate(50 50)"/>`, // 레토: 야자수
  266: (c) => `<circle r="6" fill="${P.gold}" stroke="${P.ink}" stroke-width="1.2" transform="translate(50 50)"/><circle r="8.5" fill="none" stroke="${P.gold}" stroke-width="0.8" opacity="0.6" transform="translate(50 50)"/>`, // 히페리온: 광륜
  267: (c) => `<path d="M -8 2 Q -4 -2 0 2 Q 4 -2 8 2" fill="none" stroke="#3E7C8A" stroke-width="1.6" stroke-linecap="round" transform="translate(50 50)"/><path d="M -8 6 Q -4 2 0 6 Q 4 2 8 6" fill="none" stroke="#3E7C8A" stroke-width="1.2" opacity="0.6" stroke-linecap="round" transform="translate(50 50)"/>`, // 오케아노스: 파도
  268: (c) => `<path d="M 0 0 Q -8 -4 -9 2 Q -3 3 0 0 Z M 0 0 Q 8 -4 9 2 Q 3 3 0 0 Z" fill="${P.wood}" stroke="${P.ink}" stroke-width="1" transform="translate(50 47)"/>`, // 다이달로스: 날개
  269: (c) => `<path d="M -6 -6 L 6 -6 L 5 4 Q 0 7 -5 4 Z" fill="none" stroke="${P.stoneDeep}" stroke-width="1.3" stroke-linejoin="round" transform="translate(50 50)"/><circle cx="0" cy="-2" r="1.6" fill="#4E8F5B" transform="translate(50 50)"/>`, // 메데이아: 솥
  270: (c) => `<rect x="-1" y="-9" width="2" height="10" fill="${P.gold}" transform="translate(50 50)"/><circle cx="0" cy="-9" r="1.6" fill="${P.gold}" transform="translate(50 50)"/><ellipse cx="4" cy="4" rx="4" ry="2.4" fill="none" stroke="#9B59D0" stroke-width="1.1" transform="translate(50 50)"/>`, // 키르케: 마법 지팡이
  271: (c) => `<path d="M -6 -3 Q 0 -9 6 -3 Q 3 0 0 -2 Q -3 0 -6 -3 Z" fill="${P.red}" stroke="${P.ink}" stroke-width="1" transform="translate(50 46)"/><line x1="0" y1="-3" x2="0" y2="9" stroke="${P.gold}" stroke-width="1" transform="translate(50 47)"/>`, // 에로스: 화살+하트
  272: (c) => `<path d="M 0 0 Q -8 -4 -9 2 Q -3 3 0 0 Z M 0 0 Q 8 -4 9 2 Q 3 3 0 0 Z" fill="${P.gold}" stroke="${P.ink}" stroke-width="1" transform="translate(50 47)"/>`, // 니케: 황금 날개
  273: (c) => `<path d="M 4 -6 A 6 6 0 1 0 4 6 A 5 5 0 1 1 4 -6 Z" fill="#B8C4D9" stroke="${P.ink}" stroke-width="1" transform="translate(50 50)"/>`, // 셀레네: 초승달
  274: (c) => `<path d="M -1 8 L -1 -6 L -4 -6 L 0 -11 L 4 -6 L 1 -6 L 1 8" fill="${P.roofDeep}" stroke="${P.ink}" stroke-width="0.9" transform="translate(44 50)"/><path d="M -1 8 L -1 -6 L -4 -6 L 0 -11 L 4 -6 L 1 -6 L 1 8" fill="${P.roofDeep}" stroke="${P.ink}" stroke-width="0.9" transform="translate(56 50)"/>`, // 헤카테: 쌍횃불
  // ★5 40명
  203: (c) => `<path d="M -1 8 L 1 8 L 1 -6 L 4 -6 L 0 -12 L -4 -6 L -1 -6 Z" fill="${P.stoneDeep}" stroke="${P.ink}" stroke-width="0.9" transform="translate(50 50)"/>`, // 메넬라오스: 검
  204: (c) => `<path d="M -6 2 L 6 2 L 4 -6 Q 0 -9 -4 -6 Z" fill="none" stroke="${P.stoneDeep}" stroke-width="1.3" transform="translate(50 50)"/>`, // 프리아모스: 노쇠한 왕관
  205: (c) => `<path d="M 0 -8 L 0 6 M -3 6 Q 0 9 3 6" fill="none" stroke="${P.stoneDeep}" stroke-width="1.3" stroke-linecap="round" transform="translate(50 50)"/><path d="M -3 -8 L 3 -8 L 0 -12 Z" fill="${P.stoneDeep}" transform="translate(50 50)"/>`, // 파리스: 화살
  206: (c) => `<path d="M -6 -4 Q 0 -9 6 -4 L 5 4 Q 0 7 -5 4 Z" fill="#5B7A8F" stroke="${P.ink}" stroke-width="1" transform="translate(50 50)"/>`, // 헤카베: 왕비의 베일
  207: (c) => `<rect x="-5" y="-6" width="10" height="12" rx="2" fill="${P.stone}" stroke="${P.ink}" stroke-width="1.1" transform="translate(50 50)"/><line x1="-5" y1="-1" x2="5" y2="-1" stroke="${P.stoneDeep}" stroke-width="0.8" transform="translate(50 50)"/>`, // 파트로클로스: 빌려 입은 갑옷
  208: (c) => `<line x1="0" y1="-9" x2="0" y2="9" stroke="${P.stoneDeep}" stroke-width="1.4" transform="translate(50 50)"/><rect x="-4" y="-8" width="8" height="6" fill="${P.stone}" stroke="${P.ink}" stroke-width="0.9" transform="translate(50 50)"/>`, // 디오메데스: 창+방패
  209: (c) => `<rect x="-5" y="-7" width="10" height="13" rx="1.5" fill="${P.ivory}" stroke="${P.ink}" stroke-width="1" transform="translate(50 50)"/><line x1="-3" y1="-3" x2="3" y2="-3" stroke="${P.ink}" stroke-width="0.7" transform="translate(50 50)"/><line x1="-3" y1="0" x2="3" y2="0" stroke="${P.ink}" stroke-width="0.7" transform="translate(50 50)"/>`, // 네스토르: 지혜의 두루마리
  210: (c) => `<path d="M -4 -6 Q 0 -9 4 -6 L 4 6 Q 0 9 -4 6 Z" fill="#5B7A8F" stroke="${P.ink}" stroke-width="1" opacity="0.85" transform="translate(50 50)"/><circle cx="0" cy="2" r="1" fill="${P.ivory}" transform="translate(50 50)"/>`, // 안드로마케: 애도의 베일
  211: (c) => `<rect x="-6" y="-8" width="12" height="16" rx="1" fill="none" stroke="${P.woodDeep}" stroke-width="1.3" transform="translate(50 50)"/><line x1="-3" y1="-8" x2="-3" y2="8" stroke="${P.gold}" stroke-width="0.6" transform="translate(50 50)"/><line x1="0" y1="-8" x2="0" y2="8" stroke="${P.gold}" stroke-width="0.6" transform="translate(50 50)"/><line x1="3" y1="-8" x2="3" y2="8" stroke="${P.gold}" stroke-width="0.6" transform="translate(50 50)"/>`, // 페넬로페: 베틀
  212: (c) => `<path d="M -1 8 L 1 8 L 1 -4 L 3 -4 L 0 -9 L -3 -4 L -1 -4 Z" fill="${P.stoneDeep}" stroke="${P.ink}" stroke-width="0.8" transform="translate(50 50)"/>`, // 텔레마코스: 작은 창
  213: (c) => `<path d="M -1 8 L 1 8 L 1 -6 L 3 -6 L 0 -11 L -3 -6 L -1 -6 Z" fill="${P.red}" stroke="${P.ink}" stroke-width="0.8" transform="translate(50 50)"/>`, // 오레스테스: 복수의 검
  214: (c) => `<path d="M -5 6 L 3 -6 L 6 -4 L -2 8 Z" fill="${P.stoneDeep}" stroke="${P.ink}" stroke-width="1" stroke-linejoin="round" transform="translate(50 50)"/>`, // 클리타임네스트라: 도끼
  215: (c) => `<path d="M -4 6 L 4 6 L 3 -4 Q 0 -8 -3 -4 Z" fill="${P.red}" stroke="${P.ink}" stroke-width="1" transform="translate(50 50)"/>`, // 이피게네이아: 제단의 불꽃
  216: (c) => `<ellipse rx="5" ry="7" fill="none" stroke="${P.stoneDeep}" stroke-width="1.3" transform="translate(50 50)"/><path d="M -1 8 L 1 8 L 1 -2 L 3 -2 L 0 -7 L -3 -2 L -1 -2 Z" fill="${P.stoneDeep}" transform="translate(50 42)"/>`, // 엘렉트라: 유골 항아리+단검
  217: (c) => `<path d="M -6 3 Q 0 6 6 3" fill="none" stroke="#4C8FE0" stroke-width="1.4" transform="translate(50 50)"/><circle cx="0" cy="-4" r="2.6" fill="${P.food}" transform="translate(50 50)"/>`, // 탄탈로스: 닿지 않는 물+과일
  218: (c) => `<path d="M -6 4 Q -8 -4 -3 -6 M 6 4 Q 8 -4 3 -6" fill="none" stroke="${P.ivory}" stroke-width="1.6" stroke-linecap="round" transform="translate(50 50)"/>`, // 에우로페: 황소 뿔
  219: (c) => `<path d="M -6 4 Q -8 -6 0 -4 Q 8 -6 6 4 Q 0 8 -6 4 Z" fill="${P.ivory}" stroke="${P.ink}" stroke-width="1.1" stroke-linejoin="round" transform="translate(50 50)"/>`, // 레다: 백조
  220: (c) => `<circle cx="-3" cy="-4" r="1.2" fill="${P.gold}" transform="translate(50 50)"/><circle cx="2" cy="-7" r="1.4" fill="${P.gold}" transform="translate(50 50)"/><circle cx="4" cy="-1" r="1" fill="${P.gold}" transform="translate(50 50)"/><circle cx="-1" cy="1" r="1.1" fill="${P.gold}" transform="translate(50 50)"/>`, // 다나에: 황금비
  221: (c) => `<path d="M 0 -8 Q 4 -6 4 -1 Q 4 4 0 7 Q -1 4 -1 0" fill="none" stroke="#5E8B4C" stroke-width="1.4" transform="translate(50 50)"/><path d="M -2 -6 L 0 -8 L 2 -6 Z" fill="${P.ivory}" transform="translate(50 50)"/>`, // 카드모스: 용의 이빨
  222: (c) => `<path d="M -5 6 Q 0 8 5 6 Q 5 0 0 -3 Q -5 0 -5 6 Z" fill="${P.stoneDeep}" stroke="${P.ink}" stroke-width="1" transform="translate(50 50)"/>`, // 안티고네: 봉분
  223: (c) => `<path d="M 0 -8 Q 6 -6 5 0 Q 6 6 0 8 Q -6 6 -5 0 Q -6 -6 0 -8 Z" fill="#4C8FE0" stroke="${P.ink}" stroke-width="1" transform="translate(50 50)"/><path d="M -2 -3 Q 0 0 2 -3 M -2 1 Q 0 4 2 1" stroke="${P.ivory}" stroke-width="0.6" fill="none" transform="translate(50 50)"/>`, // 암피트리테: 조개
  224: (c) => `<path d="M -6 4 Q -6 -6 4 -6 Q 6 -2 2 2 Q -2 6 -6 4 Z" fill="${P.ivory}" stroke="${P.ink}" stroke-width="1.1" transform="translate(50 50)"/>`, // 트리톤: 소라
  225: (c) => `<path d="M -7 0 Q -3 -5 0 0 Q 3 5 7 0" fill="none" stroke="#3E7C8A" stroke-width="1.5" stroke-linecap="round" transform="translate(50 50)"/>`, // 프로테우스: 변화하는 물결
  226: (c) => `<path d="M -6 -2 Q 0 -6 6 -2 M -6 2 Q 0 6 6 2" fill="none" stroke="#B9B4A8" stroke-width="1.2" stroke-linecap="round" transform="translate(50 50)"/>`, // 아이올로스: 바람
  227: (c) => `<path d="M -7 1 Q -2 -3 0 1 Q 2 5 7 1" fill="none" stroke="#3E7C8A" stroke-width="1.3" transform="translate(50 50)"/>`, // 네레우스: 파도
  228: (c) => `<path d="M -6 4 Q -7 -4 0 -6 Q 7 -4 6 4 Q 3 1 0 3 Q -3 1 -6 4 Z" fill="#A89A8A" stroke="${P.ink}" stroke-width="1" stroke-linejoin="round" transform="translate(50 50)"/>`, // 레무스: 늑대
  229: (c) => `<path d="M -1 8 L 1 8 L 1 -2 L 4 -2 L 0 -9 L -4 -2 L -1 -2 Z" fill="${P.red}" stroke="${P.ink}" stroke-width="0.8" transform="translate(50 50)"/>`, // 디도: 화장단의 불꽃
  230: (c) => `<rect x="-5" y="-7" width="10" height="13" rx="1" fill="${P.ivory}" stroke="${P.ink}" stroke-width="1" transform="translate(50 50)"/><line x1="-3" y1="-3" x2="3" y2="-3" stroke="${P.ink}" stroke-width="0.7" transform="translate(50 50)"/>`, // 누마: 법전 서판
  231: (c) => `<path d="M -1 8 L 1 8 L 1 -6 L 3 -6 L 0 -11 L -3 -6 L -1 -6 Z" fill="${P.stoneDeep}" stroke="${P.ink}" stroke-width="0.8" transform="translate(50 50)"/>`, // 투르누스: 창
  232: (c) => `<path d="M -1 8 L 1 8 L 1 -6 L 3 -6 L 0 -11 L -3 -6 L -1 -6 Z" fill="#4E8F5B" stroke="${P.ink}" stroke-width="0.8" transform="translate(45 46)"/><path d="M 4 -6 Q 8 -4 4 2" fill="none" stroke="${P.woodDeep}" stroke-width="1.2" transform="translate(50 50)"/>`, // 카밀라: 창+화살통
  233: (c) => `<rect x="-5" y="0" width="10" height="6" fill="${P.stone}" stroke="${P.ink}" stroke-width="1" transform="translate(50 50)"/><path d="M -3 0 L 0 -6 L 3 0" fill="none" stroke="${P.red}" stroke-width="1" transform="translate(50 50)"/>`, // 에우안드로스: 제단
  234: (c) => `<path d="M -6 -2 Q 0 -8 6 -2 Q 6 2 0 4 Q -6 2 -6 -2 Z" fill="#E091B0" stroke="${P.ink}" stroke-width="1" transform="translate(50 50)"/>`, // 라비니아: 신부의 화관
  235: (c) => `<line x1="0" y1="-9" x2="0" y2="9" stroke="${P.gold}" stroke-width="1.6" stroke-linecap="round" transform="translate(50 50)"/><circle cx="0" cy="-9" r="2" fill="${P.gold}" transform="translate(50 50)"/>`, // 라티누스: 왕홀
  236: (c) => `<path d="M -3 8 L 3 8 L 2 -2 Q 0 -8 -2 -2 Z" fill="${P.gold}" stroke="${P.ink}" stroke-width="1" transform="translate(50 46)"/>`, // 아스카니우스: 머리 위 불꽃 징조
  237: (c) => `<path d="M -1 8 L 1 8 L 1 -6 L 3 -6 L 0 -11 L -3 -6 L -1 -6 Z" fill="${P.stone}" stroke="${P.ink}" stroke-width="0.8" transform="translate(50 50)"/>`, // 니수스: 검
  238: (c) => `<rect x="-4" y="-6" width="8" height="12" rx="2" fill="${P.stoneDeep}" stroke="${P.ink}" stroke-width="1" transform="translate(50 50)"/>`, // 에우리알루스: 작은 방패
  239: (c) => `<path d="M -4 8 L -4 -6 Q -4 -9 0 -9 Q 4 -9 4 -6 L 4 8" fill="none" stroke="${P.ivory}" stroke-width="1.4" transform="translate(50 50)"/>`, // 갈라테이아: 대리석상 실루엣
  240: (c) => `<rect x="-1" y="-8" width="2" height="10" fill="${P.stoneDeep}" transform="translate(50 50)"/><path d="M -5 -8 L 5 -8 L 3 -6 L -3 -6 Z" fill="${P.stone}" stroke="${P.ink}" stroke-width="0.8" transform="translate(50 50)"/>`, // 피그말리온: 조각칼
  241: (c) => `<path d="M 4 -6 A 6 6 0 1 0 4 6 A 5 5 0 1 1 4 -6 Z" fill="#B8C4D9" stroke="${P.ink}" stroke-width="1" opacity="0.7" transform="translate(50 50)"/><path d="M -4 2 Q 0 4 4 2" stroke="${P.ink}" stroke-width="0.8" fill="none" transform="translate(50 55)"/>`, // 엔디미온: 잠든 눈썹+달
  242: (c) => `<circle r="5" fill="${P.roof}" stroke="${P.ink}" stroke-width="1" transform="translate(50 50)"/>` + Array.from({ length: 6 }).map((_, i) => { const a = i * Math.PI / 3; return `<line x1="${50 + Math.cos(a) * 6}" y1="${50 + Math.sin(a) * 6}" x2="${50 + Math.cos(a) * 8.5}" y2="${50 + Math.sin(a) * 8.5}" stroke="${P.red}" stroke-width="1.2" stroke-linecap="round"/>`; }).join(""), // 파에톤: 추락하는 태양마차
  // ★4 실존 신화 인물 51명(이리스~트리프톨레모스, 146~196)
  146: (c) => `<path d="M -8 4 A 8 8 0 0 1 8 4" fill="none" stroke="${P.gold}" stroke-width="1.6" transform="translate(50 50)"/><path d="M -6 4 A 6 6 0 0 1 6 4" fill="none" stroke="#4C8FE0" stroke-width="1.6" transform="translate(50 50)"/><path d="M -4 4 A 4 4 0 0 1 4 4" fill="none" stroke="#7FA35C" stroke-width="1.6" transform="translate(50 50)"/>`, // 이리스: 무지개
  147: (c) => `<path d="M -4 -6 L 4 -6 L 3 6 Q 0 8 -3 6 Z" fill="none" stroke="${P.gold}" stroke-width="1.3" transform="translate(50 50)"/>`, // 헤베: 청춘의 술잔
  148: (c) => `<ellipse rx="6" ry="7" fill="#E091B0" stroke="${P.ink}" stroke-width="1" opacity="0.85" transform="translate(50 51)"/>`, // 에일레이티이아: 포대기
  149: (c) => `<circle r="5.5" fill="${P.gold}" stroke="${P.ink}" stroke-width="1.1" transform="translate(50 50)"/><path d="M -5.5 0 L 5.5 0" stroke="${P.red}" stroke-width="1.2" transform="translate(50 50)"/>`, // 에리스: 갈라진 황금사과(불화)
  150: (c) => `<path d="M -6 -6 Q 0 -10 6 -6 L 4 8 L -4 8 Z" fill="none" stroke="${P.stoneDeep}" stroke-width="1.2" transform="translate(50 50)"/>`, // 네메시스: 응보의 자
  151: (c) => `<path d="M -6 2 Q -6 -6 0 -6 Q 6 -6 6 2 Q 3 5 0 2 Q -3 5 -6 2 Z" fill="${P.ivory}" stroke="${P.ink}" stroke-width="1" transform="translate(50 50)"/><circle cx="-2" cy="-1" r="0.8" fill="${P.ink}" transform="translate(50 50)"/><circle cx="2" cy="-1" r="0.8" fill="${P.ink}" transform="translate(50 50)"/>`, // 모모스: 풍자의 가면
  152: (c) => `<ellipse rx="3.5" ry="5" fill="#9B59D0" stroke="${P.ink}" stroke-width="1" transform="translate(50 50) rotate(20)"/>`, // 히프노스: 양귀비
  153: (c) => `<path d="M -1 8 L -1 -6 L -4 -6 L 0 -11 L 4 -6 L 1 -6 L 1 8" fill="none" stroke="${P.stoneDeep}" stroke-width="1" transform="translate(50 52) rotate(180)"/>`, // 타나토스: 꺼진 횃불
  154: (c) => `<path d="M -6 2 Q -6 -3 -2 -3 Q -2 -6 2 -5 Q 6 -5 6 -1 Q 8 2 4 3 Q 0 4 -6 2 Z" fill="${P.ivory}" stroke="${P.ink}" stroke-width="1" opacity="0.85" transform="translate(50 50)"/>`, // 모르페우스: 꿈 구름
  155: (c) => `<path d="M 0 -8 Q 6 -6 6 0 Q 6 6 0 8 Q 4 4 4 0 Q 4 -4 0 -8 Z" fill="#3A2A4C" stroke="${P.ink}" stroke-width="1" transform="translate(50 50)"/><circle cx="2" cy="-3" r="0.7" fill="${P.ivory}" transform="translate(50 50)"/>`, // 닉스: 밤의 초승달
  156: (c) => `<circle r="6" fill="#241C2E" stroke="${P.ink}" stroke-width="1" opacity="0.75" transform="translate(50 50)"/>`, // 에레보스: 어둠
  157: (c) => `<path d="M -7 3 A 7 7 0 0 1 7 3" fill="${P.roof}" stroke="${P.ink}" stroke-width="1.1" transform="translate(50 51)"/>`, // 에오스: 새벽빛
  158: (c) => `<circle cx="0" cy="0" r="1.6" fill="${P.ivory}" transform="translate(50 50)"/>` + Array.from({ length: 8 }).map((_, i) => { const a = i * Math.PI / 4; return `<line x1="${50 + Math.cos(a) * 2.4}" y1="${50 + Math.sin(a) * 2.4}" x2="${50 + Math.cos(a) * 6}" y2="${50 + Math.sin(a) * 6}" stroke="${P.ivory}" stroke-width="1" stroke-linecap="round"/>`; }).join(""), // 아스트라이오스: 별
  159: (c) => `<path d="M -5 -5 L 0 0 L -5 5 M 5 -5 L 0 0 L 5 5" stroke="${P.stoneDeep}" stroke-width="1.4" stroke-linecap="round" transform="translate(50 50)"/>`, // 페르세스: 파괴(균열)
  160: (c) => `<circle cx="-4" cy="2" r="1" fill="${P.ivory}" transform="translate(50 50)"/><circle cx="0" cy="-3" r="1.2" fill="${P.ivory}" transform="translate(50 50)"/><circle cx="4" cy="2" r="1" fill="${P.ivory}" transform="translate(50 50)"/><path d="M -4 2 L 0 -3 L 4 2" fill="none" stroke="${P.ivory}" stroke-width="0.6" opacity="0.6" transform="translate(50 50)"/>`, // 크리오스: 별자리
  161: (c) => `<rect x="-6" y="-7" width="12" height="14" rx="1" fill="${P.ivory}" stroke="${P.ink}" stroke-width="1" transform="translate(50 50)"/><line x1="-3" y1="-3" x2="3" y2="-3" stroke="${P.ink}" stroke-width="0.6" transform="translate(50 50)"/><line x1="-3" y1="0" x2="3" y2="0" stroke="${P.ink}" stroke-width="0.6" transform="translate(50 50)"/><line x1="-3" y1="3" x2="3" y2="3" stroke="${P.ink}" stroke-width="0.6" transform="translate(50 50)"/>`, // 코이오스: 지성의 서판
  162: (c) => `<path d="M 0 -8 L 0 8 M -4 0 L 4 0" stroke="${P.stoneDeep}" stroke-width="1.1" transform="translate(50 50)"/><circle r="6.5" fill="none" stroke="${P.stoneDeep}" stroke-width="0.9" transform="translate(50 50)"/>`, // 이아페토스: 필멸의 모래시계(단순화)
  163: (c) => `<rect x="-5" y="-7" width="10" height="13" rx="1" fill="none" stroke="${P.woodDeep}" stroke-width="1.2" transform="translate(50 50)"/><line x1="-3" y1="-3" x2="3" y2="-3" stroke="${P.woodDeep}" stroke-width="0.7" transform="translate(50 50)"/><line x1="-3" y1="0" x2="3" y2="0" stroke="${P.woodDeep}" stroke-width="0.7" transform="translate(50 50)"/>`, // 므네모시네: 기억의 두루마리
  164: (c) => `<path d="M 4 -6 A 6 6 0 1 0 4 6 A 5 5 0 1 1 4 -6 Z" fill="${P.gold}" stroke="${P.ink}" stroke-width="1" transform="translate(50 50)"/><circle cx="-4" cy="-4" r="0.9" fill="${P.gold}" transform="translate(50 50)"/>`, // 포이베: 예언의 초승달+별
  165: (c) => `<path d="M -7 2 Q -3 -2 0 2 Q 3 -2 7 2" fill="none" stroke="#3E7C8A" stroke-width="1.4" stroke-linecap="round" transform="translate(50 50)"/><path d="M -7 5 Q -3 1 0 5 Q 3 1 7 5" fill="none" stroke="#3E7C8A" stroke-width="1" opacity="0.6" stroke-linecap="round" transform="translate(50 50)"/>`, // 테티스(티탄): 원천의 물결
  166: (c) => `<path d="M -6 2 Q -6 -3 -2 -3 Q -2 -6 2 -5 Q 6 -5 6 -1 Q 8 2 4 3 Q 0 4 -6 2 Z" fill="${P.ivory}" stroke="${P.ink}" stroke-width="1" transform="translate(50 50)"/>`, // 클리메네: 구름
  167: (c) => `<line x1="-6" y1="-6" x2="4" y2="4" stroke="${P.ivory}" stroke-width="1.4" stroke-linecap="round" transform="translate(50 50)"/><path d="M 4 4 L 7 2 M 4 4 L 2 7" stroke="${P.ivory}" stroke-width="1" stroke-linecap="round" transform="translate(50 50)"/>`, // 아스테리아: 별똥별
  168: (c) => `<path d="M -6 0 Q -6 -5 -1 -4 Q 0 -6 1 -4 Q 6 -5 6 0 Q 6 4 0 6 Q -6 4 -6 0 Z" fill="${P.ivory}" stroke="${P.ink}" stroke-width="1" transform="translate(50 50)"/>`, // 디오네: 비둘기(단순화한 하트형 몸)
  169: (c) => `<path d="M -4.5 -3 L -6 -6 L -2 -4 Z M 4.5 -3 L 6 -6 L 2 -4 Z" fill="${P.stoneDeep}" transform="translate(50 50)"/><circle r="4.5" fill="${P.ivory}" stroke="${P.ink}" stroke-width="1" transform="translate(50 50)"/>`, // 메티스: 지혜의 부엉이(작게)
  170: (c) => `<path d="M -7 -3 Q -3 0 -7 3 Q -1 1 2 4 Q 5 6 7 3" fill="none" stroke="#4A3A5C" stroke-width="1.4" stroke-linecap="round" transform="translate(50 50)"/>`, // 스틱스: 저승의 강
  171: (c) => `<line x1="0" y1="-9" x2="0" y2="9" stroke="${P.woodDeep}" stroke-width="1.3" transform="translate(50 50)"/><path d="M -3 -6 L 3 -6 L 0 -9 Z" fill="${P.woodDeep}" transform="translate(50 50)"/><path d="M -1 9 Q -4 6 -2 2" fill="none" stroke="${P.ivory}" stroke-width="0.8" transform="translate(50 50)"/>`, // 클로토: 실을 잣는 물레가락
  172: (c) => `<line x1="-7" y1="0" x2="7" y2="0" stroke="${P.stoneDeep}" stroke-width="1.2" transform="translate(50 50)"/><line x1="-4" y1="-1.5" x2="-4" y2="1.5" stroke="${P.stoneDeep}" stroke-width="0.8" transform="translate(50 50)"/><line x1="0" y1="-1.5" x2="0" y2="1.5" stroke="${P.stoneDeep}" stroke-width="0.8" transform="translate(50 50)"/><line x1="4" y1="-1.5" x2="4" y2="1.5" stroke="${P.stoneDeep}" stroke-width="0.8" transform="translate(50 50)"/>`, // 라케시스: 실의 길이를 재는 자
  173: (c) => `<circle cx="-3" cy="0" r="3" fill="none" stroke="${P.stoneDeep}" stroke-width="1.1" transform="translate(50 50)"/><circle cx="3" cy="0" r="3" fill="none" stroke="${P.stoneDeep}" stroke-width="1.1" transform="translate(50 50)"/><line x1="0" y1="0" x2="7" y2="-6" stroke="${P.stoneDeep}" stroke-width="1.1" transform="translate(50 50)"/>`, // 아트로포스: 운명을 끊는 가위
  174: (c) => `<rect x="-1" y="-8" width="2" height="9" fill="${P.stoneDeep}" transform="translate(50 50)"/><path d="M -1 -8 Q -5 -6 -6 -2" fill="none" stroke="${P.stoneDeep}" stroke-width="1" transform="translate(50 50)"/>`, // 칼리오페: 서사시의 깃펜
  175: (c) => `<rect x="-5" y="-7" width="10" height="13" rx="1" fill="${P.ivory}" stroke="${P.ink}" stroke-width="1" transform="translate(50 50)"/><line x1="-3" y1="-3" x2="3" y2="-3" stroke="${P.ink}" stroke-width="0.6" transform="translate(50 50)"/><line x1="-3" y1="0" x2="3" y2="0" stroke="${P.ink}" stroke-width="0.6" transform="translate(50 50)"/>`, // 클리오: 역사의 두루마리
  176: (c) => `<path d="M -5 -2 Q 0 -7 5 -2 Q 2 0 0 -1 Q -2 0 -5 -2 Z" fill="${P.red}" stroke="${P.ink}" stroke-width="0.9" transform="translate(50 47)"/><path d="M -5 6 L -5 -2 Q -5 -5 -2 -5 L 2 -5 Q 5 -5 5 -3 L 5 6" fill="none" stroke="${P.woodDeep}" stroke-width="1" transform="translate(50 50)"/>`, // 에라토: 사랑노래의 하트+리라
  177: (c) => `<path d="M -1 8 L -1 -8 Q 3 -8 3 -4 Q 3 0 -1 0" fill="none" stroke="${P.stoneDeep}" stroke-width="1.3" transform="translate(50 50)"/><circle cx="0" cy="-5" r="0.6" fill="${P.stoneDeep}" transform="translate(50 50)"/><circle cx="0" cy="-2" r="0.6" fill="${P.stoneDeep}" transform="translate(50 50)"/>`, // 에우테르페: 아울로스(피리)
  178: (c) => `<path d="M -6 2 Q -6 -6 0 -6 Q 6 -6 6 2 Q 3 5 0 2 Q -3 5 -6 2 Z" fill="#3A2A4C" stroke="${P.ink}" stroke-width="1" transform="translate(50 50)"/><path d="M -2 0 Q 0 3 2 0" stroke="${P.ivory}" stroke-width="0.7" fill="none" transform="translate(50 50)"/>`, // 멜포메네: 비극의 가면(찡그림)
  179: (c) => `<path d="M -5 3 Q -6 -4 0 -6 Q 6 -4 5 3 Q 0 6 -5 3 Z" fill="${P.ivory}" stroke="${P.ink}" stroke-width="1" transform="translate(50 50)"/><path d="M -2 -6 L -2 -9 M 2 -6 L 2 -9" stroke="${P.ink}" stroke-width="0.8" transform="translate(50 50)"/>`, // 폴림니아: 찬가의 새
  180: (c) => `<path d="M -6 4 Q -2 -6 2 0 Q 6 6 4 -4" fill="none" stroke="${P.roofDeep}" stroke-width="1.4" stroke-linecap="round" transform="translate(50 50)"/>`, // 테릅시코레: 춤추는 리본
  181: (c) => `<circle r="5.5" fill="none" stroke="${P.gold}" stroke-width="1.2" transform="translate(50 50)"/><circle cx="-2" cy="-2" r="0.8" fill="${P.gold}" transform="translate(50 50)"/><circle cx="2" cy="1" r="0.7" fill="${P.gold}" transform="translate(50 50)"/><circle cx="0" cy="3" r="0.6" fill="${P.gold}" transform="translate(50 50)"/>`, // 우라니아: 천문의 별구
  182: (c) => `<path d="M -6 2 Q -6 -6 0 -6 Q 6 -6 6 2 Q 3 5 0 2 Q -3 5 -6 2 Z" fill="${P.food}" stroke="${P.ink}" stroke-width="1" transform="translate(50 50)"/><path d="M -2 -1 Q 0 2 2 -1" stroke="${P.ink}" stroke-width="0.8" fill="none" transform="translate(50 50)"/>`, // 탈리아: 희극의 가면(웃음)
  183: (c) => `<path d="M 0 -7 Q 4 -4 3 1 Q 2 6 0 7 Q -2 6 -3 1 Q -4 -4 0 -7 Z" fill="${P.gold}" stroke="${P.ink}" stroke-width="1" opacity="0.9" transform="translate(50 50)"/>`, // 아글라이아: 광채의 꽃잎
  184: (c) => `<path d="M 0 -7 Q 4 -4 3 1 Q 2 6 0 7 Q -2 6 -3 1 Q -4 -4 0 -7 Z" fill="${P.food}" stroke="${P.ink}" stroke-width="1" opacity="0.9" transform="translate(50 50)"/>`, // 에우프로시네: 즐거움의 꽃잎(다른 색)
  185: (c) => `<ellipse rx="7" ry="4" fill="#9B59D0" stroke="${P.ink}" stroke-width="1" opacity="0.85" transform="translate(50 51)"/>`, // 파시테아: 휴식의 방석
  186: (c) => `<path d="M -6 -2 Q 0 -7 6 -2 M -6 2 Q 0 7 6 2" fill="none" stroke="#B8C4D9" stroke-width="1.3" stroke-linecap="round" transform="translate(50 50)"/>`, // 보레아스: 북풍(차가운 색)
  187: (c) => `<ellipse cx="-2" cy="0" rx="3" ry="1.6" fill="#E091B0" transform="translate(50 50) rotate(-15)"/><ellipse cx="2" cy="1" rx="3" ry="1.6" fill="#E091B0" transform="translate(50 50) rotate(15)"/>`, // 제피로스: 서풍(꽃잎)
  188: (c) => `<path d="M -6 -2 Q 0 -7 6 -2 M -6 2 Q 0 7 6 2" fill="none" stroke="${P.roof}" stroke-width="1.3" stroke-linecap="round" transform="translate(50 50)"/>`, // 노토스: 남풍(따뜻한 색)
  189: (c) => `<path d="M -6 -2 Q 0 -7 6 -2 M -6 2 Q 0 7 6 2" fill="none" stroke="${P.gold}" stroke-width="1.3" stroke-linecap="round" transform="translate(50 50)"/>`, // 에우로스: 동풍(황금빛)
  190: (c) => `<rect x="-6" y="-2" width="2.4" height="9" fill="${P.wood}" stroke="${P.ink}" stroke-width="0.6" transform="translate(50 50)"/><rect x="-3.2" y="-4" width="2.4" height="11" fill="${P.wood}" stroke="${P.ink}" stroke-width="0.6" transform="translate(50 50)"/><rect x="-0.4" y="-6" width="2.4" height="13" fill="${P.wood}" stroke="${P.ink}" stroke-width="0.6" transform="translate(50 50)"/><rect x="2.4" y="-4" width="2.4" height="11" fill="${P.wood}" stroke="${P.ink}" stroke-width="0.6" transform="translate(50 50)"/>`, // 판: 팬파이프
  191: (c) => `<path d="M -4 -6 L 4 -6 L 3 6 Q 0 8 -3 6 Z" fill="${P.roofDeep}" stroke="${P.ink}" stroke-width="1.1" transform="translate(50 50)"/>`, // 실레노스: 포도주 잔
  192: (c) => `<circle cx="-2" cy="0" r="3" fill="${P.red}" stroke="${P.ink}" stroke-width="0.8" transform="translate(50 50)"/><path d="M -2 -3 Q 0 -6 3 -6" fill="none" stroke="${P.foodDeep}" stroke-width="1" transform="translate(50 50)"/>`, // 프리아포스: 정원의 열매
  193: (c) => `<line x1="0" y1="-9" x2="0" y2="9" stroke="${P.stoneDeep}" stroke-width="1.4" transform="translate(50 50)"/><path d="M -4 -4 Q 0 -6 0 -1 Q 0 4 -4 4 M -4 -4 Q -6 -2 -4 0 Q -2 2 -4 4" fill="none" stroke="#5E8B4C" stroke-width="1" transform="translate(50 50)"/>`, // 아스클레피오스: 아스클레피오스의 지팡이(뱀)
  194: (c) => `<path d="M -6 0 Q -3 -5 0 0 Q 3 5 6 0 Q 3 2 0 0 Q -3 2 -6 0 Z" fill="#3E7C8A" stroke="${P.ink}" stroke-width="1" transform="translate(50 50)"/>`, // 글라우코스: 물고기 꼬리
  195: (c) => `<path d="M 0 -7 Q 5 -5 5 0 Q 5 5 0 7 Q -5 5 -5 0 Q -5 -5 0 -7 Z" fill="${P.gold}" stroke="${P.ink}" stroke-width="1" transform="translate(50 50)"/><path d="M -5 0 L 5 0 M -3 -4 L 3 4 M 3 -4 L -3 4" stroke="${P.goldDeep}" stroke-width="0.5" transform="translate(50 50)"/>`, // 아리스타이오스: 벌집
  196: (c) => `<path d="M 0 -8 L 0 4 M -4 4 Q 0 7 4 4" fill="none" stroke="${P.gold}" stroke-width="1.4" stroke-linecap="round" transform="translate(50 50)"/><path d="M -3 -8 L 0 -4 L 3 -8" fill="none" stroke="${P.gold}" stroke-width="1" transform="translate(50 50)"/>`, // 트리프톨레모스: 농경의 밀 이삭
};
const GOD_AURA = {
  292: "#9C9C9C", 293: "#4C8FE0", 294: "#E8B93B", 295: "#E091B0", 296: "#3B5BA6", 297: "#9B59D0", 298: "#4A3A5C", 299: "#7FB069",
  275: "#8F4E17", 276: "#D6864C", 277: "#B5651D", 278: "#5B7A8F", 279: "#E7A26B", 280: "#C0433A", 281: "#E8B93B", 282: "#B8AA95",
  283: "#9B59D0", 284: "#8F897C", 285: "#8F4E17", 286: "#B5651D", 287: "#5B7A8F", 288: "#B9B4A8", 289: "#C0433A", 290: "#8F4E17", 291: "#3A2A4C",
  243: "#E8B93B", 244: "#E091B0", 245: "#3A2A4C", 246: "#8F897C", 247: "#E8B93B", 248: "#D6864C", 249: "#B9B4A8", 250: "#EADFC7",
  251: "#8C8378", 252: "#3B5BA6", 253: "#8F897C", 254: "#C0433A", 255: "#E8B93B", 256: "#EADFC7", 257: "#E8B93B", 258: "#8F4E17",
  259: "#EADFC7", 260: "#5B7A8F", 261: "#8F897C", 262: "#B5651D", 263: "#8F4E17", 264: "#8F897C", 265: "#5E8B4C", 266: "#E8B93B",
  267: "#3E7C8A", 268: "#B5651D", 269: "#5E8B4C", 270: "#9B59D0", 271: "#C0433A", 272: "#E8B93B", 273: "#B8C4D9", 274: "#D6864C",
};

// 사람 형태 초상의 공용 뼈대(옷/목/얼굴/눈/입) — 신화 인물·일반 영웅 공용으로 재사용
function portraitBase(skin, cloth, hairColor, hairStyle, hasBeard) {
  let s = `<path d="M 18 96 Q 50 72 82 96 L 82 100 L 18 100 Z" fill="${cloth}" stroke="${P.ink}" stroke-width="2.4" stroke-linejoin="round"/>`;
  s += `<rect x="43" y="68" width="14" height="16" fill="${skin}" stroke="${P.ink}" stroke-width="1.6"/>`;
  s += `<circle cx="50" cy="54" r="22" fill="${skin}" stroke="${P.ink}" stroke-width="2.6"/>`;
  if (hasBeard) s += beardShape(hairColor);
  s += hairShape(hairStyle, hairColor);
  s += `<circle cx="43" cy="55" r="2" fill="${P.ink}"/><circle cx="57" cy="55" r="2" fill="${P.ink}"/>`;
  s += `<path d="M 45 64 Q 50 67 55 64" stroke="${P.ink}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`;
  return s;
}

// 실제 그리스·로마 신화에 없는 "가상(이름 없는) 영웅" 판정 — ★1~3 전원 + ★4 중 아래 6명
// (병영 취사병/궁수 견습생 등 이름 없는 필러 캐릭터). 나머지는 전부 실존 신화 인물.
const GENERIC_R4_IDS = new Set([197, 198, 199, 200, 201, 202]);
function isGenericHero(hero) {
  if (hero.secret) return false; // 까미(고양이)는 별도 처리
  if (hero.rarity <= 3) return true;
  if (hero.rarity === 4) return GENERIC_R4_IDS.has(hero.id);
  return false;
}

// ---------- 가상 영웅 전용 — 딱 10종 고정 템플릿을 그대로 복제해서 재사용 ----------
// (신화 속 실존 인물이 아닌) 151명의 "이름 없는" 영웅 전원이 이 10개 중 하나를
// hero.id % 10 으로 결정적으로 배정받아 그대로 복제한다 — 매번 새로 그리지 않는다.
const GENERIC_TEMPLATES = [
  () => svg(portraitBase("#E8B98A", "#8F897C", "#3A2A1C", 0, false) + // 0: 방패병(남)
    `<path d="M 20 60 Q 14 50 20 40 Q 30 36 30 50 Q 30 62 20 60 Z" fill="${P.stone}" stroke="${P.ink}" stroke-width="2" stroke-linejoin="round"/><line x1="20" y1="46" x2="20" y2="54" stroke="${P.stoneDeep}" stroke-width="1.4"/>`),
  () => svg(portraitBase("#D6A26B", "#C0433A", "#2B2118", 2, false) + // 1: 여전사(창)
    `<line x1="76" y1="20" x2="66" y2="70" stroke="${P.woodDeep}" stroke-width="2.4" stroke-linecap="round"/><path d="M 76 20 L 71 12 L 81 15 Z" fill="${P.stone}" stroke="${P.ink}" stroke-width="1.4" stroke-linejoin="round"/>`),
  () => svg(portraitBase("#F0C9A0", "#FFF8EC", "#B8AA95", 2, false) + // 2: 무녀/사제(여)
    `<circle cx="26" cy="70" r="4.4" fill="${P.gold}" stroke="${P.ink}" stroke-width="1.4"/><path d="M 26 74 L 26 82" stroke="${P.ink}" stroke-width="1.6"/><path d="M 22 66 Q 26 60 30 66" fill="none" stroke="${P.red}" stroke-width="1.6" stroke-linecap="round"/>`),
  () => svg(portraitBase("#C98B5C", "#B9B4A8", "#5B3A29", 0, true) + // 3: 석공/장인(남)
    `<rect x="70" y="60" width="4" height="16" rx="1.5" fill="${P.woodDeep}" stroke="${P.ink}" stroke-width="1.3"/><path d="M 66 58 L 78 58 L 74 50 L 70 50 Z" fill="${P.stoneDeep}" stroke="${P.ink}" stroke-width="1.4" stroke-linejoin="round"/>`),
  () => svg(portraitBase("#E8B98A", "#5E8B4C", "#6B4423", 0, true) + // 4: 목동/농부(남)
    `<path d="M 22 78 Q 20 50 26 34 Q 30 30 32 34 Q 26 48 28 78 Z" fill="${P.woodDeep}" stroke="${P.ink}" stroke-width="1.6" stroke-linejoin="round"/>`),
  () => svg(portraitBase("#D6A26B", "#9B59D0", "#3A2A1C", 1, false) + // 5: 약초꾼/치료사(여)
    leaf(72, 68, 20, P.food) + leaf(76, 74, -10, P.foodDeep) + leaf(70, 76, 50, P.food)),
  () => svg(portraitBase("#C98B5C", "#4E8F5B", "#2B2118", 0, false) + // 6: 궁수/정찰병(남)
    `<path d="M 74 30 Q 84 50 74 70" fill="none" stroke="${P.woodDeep}" stroke-width="2.2" stroke-linecap="round"/><line x1="74" y1="30" x2="74" y2="70" stroke="${P.ink}" stroke-width="0.9" opacity="0.6"/>`),
  () => svg(portraitBase("#F0C9A0", "#E7A26B", "#8C6A46", 0, false) + // 7: 상인(남)
    `<path d="M 22 72 Q 18 62 24 58 Q 32 58 30 68 Q 30 76 22 72 Z" fill="${P.woodDeep}" stroke="${P.ink}" stroke-width="1.6" stroke-linejoin="round"/><line x1="26" y1="58" x2="26" y2="54" stroke="${P.ink}" stroke-width="1.4"/>`),
  () => svg(portraitBase("#8C5A3C", "#3E7C8A", "#3A3A3A", 0, true) + // 8: 뱃사공/어부(남)
    `<path d="M 74 24 L 74 66 M 74 24 Q 66 30 74 36 Q 82 42 74 48" fill="none" stroke="${P.stoneDeep}" stroke-width="2" stroke-linecap="round"/>`),
  () => svg(portraitBase("#E8B98A", "#DCE8C6", "#7FB069", 2, false) + // 9: 숲의 정령(여)
    leaf(38, 30, -30, P.food) + leaf(50, 26, 0, P.foodDeep) + leaf(62, 30, 30, P.food)),
];

function heroPortrait(hero) {
  if (isGenericHero(hero)) return GENERIC_TEMPLATES[hero.id % GENERIC_TEMPLATES.length]();

  // 실존 신화 인물 — 인물별로 고유한 얼굴 시드는 유지하되, ★6 이상은 후광·월계관 등급을
  // 한 단계 더 올리고(품질 차등), GOD_SYMBOL이 등록된 인물은 그 인물만의 상징 배지를 추가로 얹는다.
  const rng = mulberry32(hero.id * 2654435761);
  const skin = pick(rng, SKIN_TONES);
  const hairColor = pick(rng, HAIR_COLORS);
  const cloth = pick(rng, CLOTH_COLORS);
  const hairStyle = Math.floor(rng() * 3);
  const hasBeard = rng() < 0.32;
  const r = hero.rarity;

  let s = "";
  if (r >= 6 || GOD_AURA[hero.id]) {
    s += `<circle cx="50" cy="54" r="29" fill="none" stroke="${GOD_AURA[hero.id] || P.gold}" stroke-width="2" opacity="0.5"/>`;
  }
  s += portraitBase(skin, cloth, hairColor, hairStyle, hasBeard);

  if (r === 4) s += `<path d="M 28 48 Q 50 40 72 48" stroke="${pick(rng, [P.gold, cloth, P.stoneDeep])}" stroke-width="3.2" fill="none" stroke-linecap="round"/>`;
  else if (r === 5) s += laurel(false, P.food);
  else if (r === 6) s += laurel(false, P.gold);
  else if (r === 7) s += laurel(true, P.gold);
  else if (r >= 8) {
    s += laurel(true, P.gold);
    s += `<path d="M 33 33 L 37 21 L 43 31 L 50 19 L 57 31 L 63 21 L 67 33 Z" fill="${P.gold}" stroke="${P.ink}" stroke-width="1.8" stroke-linejoin="round"/>`;
  }
  if (GOD_SYMBOL[hero.id]) {
    s += `<circle cx="72" cy="76" r="11" fill="${P.ivory}" stroke="${P.ink}" stroke-width="1.8"/>`;
    s += `<g transform="translate(22 26)">${GOD_SYMBOL[hero.id]()}</g>`;
  }
  return svg(s);
}
// 까미 전용 — 사람이 아니라 고양이(설정상 신화 인물이 아니라 강사님 고양이)
function kamiPortrait() {
  let s = `<circle cx="50" cy="54" r="29" fill="none" stroke="${P.gold}" stroke-width="2" opacity="0.6"/>`;
  s += `<path d="M 20 96 Q 50 76 80 96 L 80 100 L 20 100 Z" fill="#8C6A46" stroke="${P.ink}" stroke-width="2.4" stroke-linejoin="round"/>`;
  s += `<path d="M 29 38 L 22 16 L 42 32 Z" fill="#D9A066" stroke="${P.ink}" stroke-width="2.2" stroke-linejoin="round"/>`;
  s += `<path d="M 71 38 L 78 16 L 58 32 Z" fill="#D9A066" stroke="${P.ink}" stroke-width="2.2" stroke-linejoin="round"/>`;
  s += `<path d="M 31 36 L 27 22 L 39 33 Z" fill="#F0C9A0"/>`;
  s += `<path d="M 69 36 L 73 22 L 61 33 Z" fill="#F0C9A0"/>`;
  s += `<circle cx="50" cy="54" r="22" fill="#D9A066" stroke="${P.ink}" stroke-width="2.6"/>`;
  s += `<path d="M 40 33 L 42 41 M 50 31 L 50 39 M 60 33 L 58 41" stroke="#B5651D" stroke-width="2" stroke-linecap="round"/>`;
  s += `<ellipse cx="42" cy="55" rx="3" ry="4.4" fill="${P.ink}"/><ellipse cx="58" cy="55" rx="3" ry="4.4" fill="${P.ink}"/>`;
  s += `<circle cx="50" cy="59" r="1.8" fill="${P.red}"/>`;
  s += `<path d="M 50 60 L 46 64 M 50 60 L 54 64" stroke="${P.ink}" stroke-width="1.4" stroke-linecap="round"/>`;
  s += `<path d="M 23 55 L 36 57 M 23 62 L 36 60 M 77 55 L 64 57 M 77 62 L 64 60" stroke="${P.ink}" stroke-width="1.2" stroke-linecap="round" opacity="0.65"/>`;
  return svg(s);
}

// 최고 티어(3, 레벨 14+)는 은은한 금빛 외곽 광채를 더해 "여기까지 키웠다"는
// 성취감이 한눈에 보이도록 한다 — 건물 형태 자체(창문/깃발/별 장식)는 이미
// tier별로 달라지지만, 그것만으로는 차이가 약해서 별도 후처리로 확실히 강조.
function addTier3Glow(svgStr) {
  const m = svgStr.match(/^<svg ([^>]*)>([\s\S]*)<\/svg>\s*$/);
  if (!m) return svgStr;
  const [, attrs, inner] = m;
  const id = "t3glow";
  const defs = `<filter id="${id}" x="-45%" y="-45%" width="190%" height="190%"><feDropShadow dx="0" dy="0" stdDeviation="2.4" flood-color="${P.gold}" flood-opacity="0.9"/></filter>`;
  return `<svg ${attrs}>${defs}<g filter="url(#${id})">${inner}</g></svg>\n`;
}

// ---------- 파일로 쓰기 ----------
const slugMap = { castle: "castle", tavern: "tavern", barracks: "barracks", farm: "farm", lumber: "lumber", quarry: "quarry", storage: "storage", academy: "academy", defense: "defense", watch: "watch" };
let count = 0;
Object.entries(builders).forEach(([slug, fn]) => {
  if (slug === "wallgate") {
    for (let t = 1; t <= 3; t++) { writeFileSync(path.join(OUT_BUILDINGS, `wall_${t}.svg`), t === 3 ? addTier3Glow(fn(t)) : fn(t)); count++; }
    return;
  }
  for (let t = 1; t <= 3; t++) { writeFileSync(path.join(OUT_BUILDINGS, `${slug}_${t}.svg`), t === 3 ? addTier3Glow(fn(t)) : fn(t)); count++; }
});
writeFileSync(path.join(OUT_BUILDINGS, "empty.svg"), emptyPlot()); count++;
writeFileSync(path.join(OUT_BOARD, "floor.svg"), boardFloor()); count++;
writeFileSync(path.join(OUT_BOARD, "wall-strip.svg"), wallStrip()); count++;
writeFileSync(path.join(OUT_BOARD, "kingdom-bg.svg"), kingdomBg()); count++;

Object.entries(monsterBuilders).forEach(([key, fn]) => { writeFileSync(path.join(OUT_MONSTERS, `${key}.svg`), fn()); count++; });
Object.entries(worldmapBuilders).forEach(([key, fn]) => { writeFileSync(path.join(OUT_WORLDMAP, `castle_${key}.svg`), fn()); count++; });
writeFileSync(path.join(OUT_WORLDMAP, "background.svg"), worldmapBg()); count++;
writeFileSync(path.join(OUT_TITLE, "background.svg"), titleBg()); count++;

HEROES.forEach((hero) => {
  writeFileSync(path.join(OUT_HEROES, `${hero.id}.svg`), hero.secret ? kamiPortrait() : heroPortrait(hero));
  count++;
});

console.log(`생성 완료: ${count}개 SVG (assets/buildings, assets/board, assets/monsters, assets/worldmap, assets/title, assets/heroes: ${HEROES.length}명)`);
