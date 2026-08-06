// 올림포스 도시 — 절차적 SVG 에셋 생성기
// ART_DIRECTION.md(파스텔·단순 아이소메트릭·둥근 모서리) 기준을 코드로 옮긴 것.
// 실행: node tools/gen-assets.mjs  (assets/ 아래에 .svg 파일들을 생성한다)
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT_BUILDINGS = path.join(ROOT, "assets/buildings");
const OUT_BOARD = path.join(ROOT, "assets/board");
mkdirSync(OUT_BUILDINGS, { recursive: true });
mkdirSync(OUT_BOARD, { recursive: true });

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
};

const svg = (inner, vb = "0 0 100 100") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${inner}</svg>\n`;

// 둥근 사각 벽체
const wall = (x, y, w, h, fill, stroke = P.ink, r = 6) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round"/>`;

// 삼각 지붕
const roofTri = (cx, y, halfW, h, fill, stroke = P.ink) => {
  const x1 = cx - halfW, x2 = cx + halfW, apexY = y - h;
  return `<path d="M ${x1} ${y} L ${cx} ${apexY} L ${x2} ${y} Z" fill="${fill}" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round"/>`;
};

// 사다리꼴 지붕(넓은 건물용)
const roofTrap = (x, y, w, h, inset, fill, stroke = P.ink) =>
  `<path d="M ${x} ${y} L ${x + inset} ${y - h} L ${x + w - inset} ${y - h} L ${x + w} ${y} Z" fill="${fill}" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round"/>`;

const circleWindow = (cx, cy, r, fill = P.ivory) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${P.ink}" stroke-width="1.6"/>`;

const rectWindow = (x, y, w, h, fill = P.ivory) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${fill}" stroke="${P.ink}" stroke-width="1.6"/>`;

const flag = (x, y, h, fill) =>
  `<line x1="${x}" y1="${y}" x2="${x}" y2="${y - h}" stroke="${P.ink}" stroke-width="2" stroke-linecap="round"/>
   <path d="M ${x} ${y - h} L ${x + 14} ${y - h + 4} L ${x} ${y - h + 8} Z" fill="${fill}" stroke="${P.ink}" stroke-width="1.6" stroke-linejoin="round"/>`;

const door = (cx, y, w, h, fill = P.woodDeep) =>
  `<path d="M ${cx - w / 2} ${y} L ${cx - w / 2} ${y - h + w / 2} A ${w / 2} ${w / 2} 0 0 1 ${cx + w / 2} ${y - h + w / 2} L ${cx + w / 2} ${y} Z" fill="${fill}" stroke="${P.ink}" stroke-width="1.8"/>`;

// 낮은 지반 base(모든 건물이 같은 기준선 위에 서 있다는 느낌)
const ground = (cx, y, w) =>
  `<ellipse cx="${cx}" cy="${y}" rx="${w}" ry="4" fill="${P.ink}" opacity="0.12"/>`;

const star = (cx, cy, r, fill = P.gold) => {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const ang = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${cx + Math.cos(ang) * rad},${cy + Math.sin(ang) * rad}`);
  }
  return `<polygon points="${pts.join(" ")}" fill="${fill}" stroke="${P.ink}" stroke-width="1.2" stroke-linejoin="round"/>`;
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
  s += `<circle cx="50" cy="${mugY}" r="8" fill="${P.gold}" stroke="${P.ink}" stroke-width="2"/>`;
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
  // 교차 창(칼) 문장
  const cx = 50, cy = y - h - 6;
  s += `<line x1="${cx - 9}" y1="${cy - 9}" x2="${cx + 9}" y2="${cy + 9}" stroke="${P.stoneDeep}" stroke-width="3" stroke-linecap="round"/>`;
  s += `<line x1="${cx + 9}" y1="${cy - 9}" x2="${cx - 9}" y2="${cy + 9}" stroke="${P.stoneDeep}" stroke-width="3" stroke-linecap="round"/>`;
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
  s += `<rect x="${sx - sr}" y="${y - 34 - t * 3}" width="${sr * 2}" height="${34 + t * 3}" rx="${sr}" fill="${P.foodDeep}" stroke="${P.ink}" stroke-width="2.5"/>`;
  s += `<ellipse cx="${sx}" cy="${y - 34 - t * 3}" rx="${sr}" ry="4" fill="${P.food}" stroke="${P.ink}" stroke-width="2"/>`;
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
  // 통나무 더미
  for (let i = 0; i < 3; i++) {
    s += `<circle cx="${x + 8 + i * 9}" cy="${y - 2}" r="6" fill="${P.wood}" stroke="${P.ink}" stroke-width="2"/>`;
    s += `<circle cx="${x + 8 + i * 9}" cy="${y - 2}" r="2.4" fill="${P.woodDeep}"/>`;
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
    s += `<polygon points="${r.cx - r.r},${r.cy + r.r * 0.6} ${r.cx - r.r * 0.5},${r.cy - r.r} ${r.cx + r.r * 0.4},${r.cy - r.r * 0.9} ${r.cx + r.r},${r.cy + r.r * 0.5} ${r.cx + r.r * 0.2},${r.cy + r.r}` +
      `" fill="${i === 1 ? P.stone : P.stoneDeep}" stroke="${P.ink}" stroke-width="2.4" stroke-linejoin="round"/>`;
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
  // 상자 더미
  s += `<rect x="${x + 6}" y="${y - 16}" width="14" height="14" rx="2" fill="${P.wood}" stroke="${P.ink}" stroke-width="2"/>`;
  s += `<rect x="${x + w - 22}" y="${y - 20}" width="16" height="18" rx="2" fill="${P.woodDeep}" stroke="${P.ink}" stroke-width="2"/>`;
  if (t >= 2) s += `<rect x="${50 - 7}" y="${y - 24}" width="14" height="12" rx="2" fill="${P.gold}" stroke="${P.ink}" stroke-width="2"/>`;
  if (t >= 3) s += star(50, y - h - 8, 5);
  return svg(s);
};

builders.academy = (t) => {
  const w = 52 + t * 5, y = 88, colH = 26 + t * 2;
  let s = ground(50, 92, 30 + t * 2);
  s += roofTri(50, y - colH, w / 2 + 4, 16, P.ivoryDeep);
  s += wall(50 - w / 2 + 2, y - colH + 2, w - 4, 4, P.ivory, P.ink, 2);
  const colW = 6, gap = (w - 8 - colW * 4) / 3;
  for (let i = 0; i < 4; i++) {
    s += `<rect x="${50 - w / 2 + 4 + i * (colW + gap)}" y="${y - colH + 5}" width="${colW}" height="${colH - 5}" fill="${P.ivory}" stroke="${P.ink}" stroke-width="2"/>`;
  }
  s += `<rect x="${50 - w / 2 + 2}" y="${y - 4}" width="${w - 4}" height="4" fill="${P.ivoryDeep}" stroke="${P.ink}" stroke-width="2"/>`;
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
  s += `<rect x="${x - 2}" y="${y - h - 8}" width="${w + 4}" height="10" fill="${P.stoneDeep}" stroke="${P.ink}" stroke-width="2"/>`;
  for (let i = 0; i < 3; i++) s += `<rect x="${x - 1 + i * (w / 3 + 1)}" y="${y - h - 13}" width="6" height="6" fill="${P.stoneDeep}" stroke="${P.ink}" stroke-width="1.6"/>`;
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
  for (let i = 0; i < 6; i++) s += `<rect x="${x - 2 + i * (w / 6 + 0.2)}" y="${y - h - 6}" width="${w / 6 - 2}" height="8" fill="${P.stone}" stroke="${P.ink}" stroke-width="1.6"/>`;
  s += door(50, y, 14, 18, P.stoneDeep);
  if (t >= 2) s += flag(x + 8, y - h - 6, 12, P.red);
  if (t >= 3) s += flag(x + w - 8, y - h - 6, 12, P.red);
  return svg(s);
};

const emptyPlot = () => svg(
  `${ground(50, 78, 22)}
   <rect x="30" y="46" width="40" height="28" rx="5" fill="none" stroke="${P.ink}" stroke-width="3" stroke-dasharray="6 5" opacity="0.55"/>
   <line x1="50" y1="52" x2="50" y2="68" stroke="${P.ink}" stroke-width="3" stroke-linecap="round" opacity="0.5"/>
   <line x1="42" y1="60" x2="58" y2="60" stroke="${P.ink}" stroke-width="3" stroke-linecap="round" opacity="0.5"/>`
);

// ---------- 바닥 텍스처(타일링) ----------
const floorTile = () => svg(
  `<rect width="100" height="100" fill="${P.ivory}"/>
   <circle cx="20" cy="24" r="2.2" fill="${P.ivoryDeep}" opacity="0.6"/>
   <circle cx="72" cy="14" r="1.6" fill="${P.ivoryDeep}" opacity="0.5"/>
   <circle cx="55" cy="60" r="2.4" fill="${P.ivoryDeep}" opacity="0.55"/>
   <circle cx="12" cy="70" r="1.8" fill="${P.ivoryDeep}" opacity="0.5"/>
   <circle cx="86" cy="55" r="2" fill="${P.ivoryDeep}" opacity="0.5"/>
   <circle cx="35" cy="88" r="1.6" fill="${P.ivoryDeep}" opacity="0.45"/>
   <circle cx="90" cy="90" r="2.2" fill="${P.ivoryDeep}" opacity="0.5"/>
   <path d="M 0 40 Q 25 34 50 42 T 100 38" stroke="${P.ivoryDeep}" stroke-width="1.4" fill="none" opacity="0.35"/>
   <path d="M 0 78 Q 30 84 60 76 T 100 80" stroke="${P.ivoryDeep}" stroke-width="1.4" fill="none" opacity="0.35"/>`,
  "0 0 100 100"
);

// 성벽 9-slice용 반복 스트립(가로로 이어붙일 벽돌 텍스처)
const wallStrip = () => svg(
  `<rect width="120" height="40" fill="${P.stone}"/>
   ${[0, 1].map((row) => [0, 1, 2, 3].map((col) => {
     const x = col * 30 + (row % 2 ? 15 : 0), y = row * 20;
     return `<rect x="${x - 15}" y="${y}" width="28" height="18" rx="2" fill="${row ? P.stoneDeep : P.stone}" stroke="${P.ink}" stroke-width="1.4" opacity="0.9"/>`;
   }).join("")).join("")}
   <rect x="0" y="0" width="120" height="40" fill="none" stroke="${P.ink}" stroke-width="2"/>`,
  "0 0 120 40"
);

// ---------- 파일로 쓰기 ----------
const slugMap = { castle: "castle", tavern: "tavern", barracks: "barracks", farm: "farm", lumber: "lumber", quarry: "quarry", storage: "storage", academy: "academy", defense: "defense", watch: "watch" };
let count = 0;
Object.entries(builders).forEach(([slug, fn]) => {
  if (slug === "wallgate") {
    for (let t = 1; t <= 3; t++) { writeFileSync(path.join(OUT_BUILDINGS, `wall_${t}.svg`), fn(t)); count++; }
    return;
  }
  for (let t = 1; t <= 3; t++) { writeFileSync(path.join(OUT_BUILDINGS, `${slug}_${t}.svg`), fn(t)); count++; }
});
writeFileSync(path.join(OUT_BUILDINGS, "empty.svg"), emptyPlot()); count++;
writeFileSync(path.join(OUT_BOARD, "floor.svg"), floorTile()); count++;
writeFileSync(path.join(OUT_BOARD, "wall-strip.svg"), wallStrip()); count++;

console.log(`생성 완료: ${count}개 SVG (assets/buildings, assets/board)`);
