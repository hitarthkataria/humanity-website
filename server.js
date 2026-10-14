const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
  '.hdr': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json'
};

const routeMap = {
  '/': 'index.html',
  '/humans': 'humans.html',
  '/developers': 'developers.html',
  '/enterprises': 'enterprises.html',
  '/protocol': 'protocol.html',
  '/mission': 'mission.html',
  '/ecosystem': 'ecosystem.html',
  '/proof-of-trust': 'proof-of-trust.html',
  '/contact': 'contact.html',
  '/blog': 'blog.html',
  '/industries': 'industries.html',
  '/use-cases': 'use-cases.html',
  '/manifesto': 'manifesto.html'
};

const server = http.createServer((req, res) => {
  // CORS & Security headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Normalize URL
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(parsedUrl.pathname);

  // Strip trailing slash except root
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }

  // Animation routing
  if (pathname === '/animations/homepage-hero') {
    const heroAnim = path.join(PUBLIC_DIR, 'animations', 'animations', 'homepage-hero');
    if (fs.existsSync(heroAnim)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(heroAnim).pipe(res);
      return;
    }
  }

  // Animation assets routing (/vendor/, /src/, /assets/peach/)
  if (pathname.startsWith('/vendor/') || pathname.startsWith('/src/') || pathname.startsWith('/assets/peach/')) {
    const animAsset = path.join(PUBLIC_DIR, 'animations', pathname);
    if (fs.existsSync(animAsset) && !fs.statSync(animAsset).isDirectory()) {
      const ext = path.extname(animAsset).toLowerCase();
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      fs.createReadStream(animAsset).pipe(res);
      return;
    }
  }

  // Check known route alias
  if (routeMap[pathname]) {
    pathname = '/' + routeMap[pathname];
  }

  let filePath = path.join(PUBLIC_DIR, pathname);

  // If path doesn't have an extension and exists as .html
  if (!path.extname(filePath) && fs.existsSync(filePath + '.html')) {
    filePath += '.html';
  }

  // Check if file exists
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>404 Not Found</h1><p><a href="/">Return to Home</a></p>');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`  Veritas Website Server is running!`);
  console.log(`  Local URL:   http://localhost:${PORT}/`);
  console.log(`==================================================\n`);
});
