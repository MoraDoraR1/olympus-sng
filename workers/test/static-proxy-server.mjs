// 로컬 브라우저 통합 테스트 전용: 레포 루트 정적 파일을 서빙하면서 /api/*만 wrangler dev
// (--config wrangler.dev-api-only.jsonc)로 프록시한다. 실제 배포에서는 Cloudflare Workers
// Assets가 이 역할을 하나(같은 오리진), 이 샌드박스의 wrangler dev는 assets.directory를
// 켜면 리로드 루프에 빠지는 문제가 있어(README 참고) 같은 오리진 구성만 별도로 재현한다.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const API_TARGET = "http://127.0.0.1:8790";
const PORT = 8791;

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith("/api/")) {
    const target = API_TARGET + req.url;
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    try {
      const upstream = await fetch(target, {
        method: req.method,
        headers: { "Content-Type": "application/json", ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}) },
        body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
      });
      const text = await upstream.text();
      res.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") || "application/json" });
      res.end(text);
    } catch (e) {
      res.writeHead(502);
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }
  let filePath = path.join(ROOT, req.url === "/" ? "/index.html" : req.url.split("?")[0]);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`static+proxy server on http://127.0.0.1:${PORT}`));
