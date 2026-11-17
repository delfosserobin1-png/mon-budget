// Petit serveur de fichiers statiques, sans dépendance, pour ouvrir l'appli dans un navigateur
// pendant le développement et pour les tests de bout en bout.
// Usage : node tools/serve.mjs [port] [dossier]      (par défaut : port 5173, dossier www)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

/**
 * startServer({ port, root, prefix })
 *   prefix : sert le dossier sous un sous-chemin (« /mon-budget/ »), comme le fait un hébergeur
 *            qui range chaque site dans son dossier — utile pour vérifier que l'appli n'a besoin
 *            d'aucune adresse absolue.
 * Renvoie { server, port, url, close(), setRoot(dossier) } ; setRoot change le dossier servi sans
 * arrêter le serveur (les tests s'en servent pour simuler la publication d'une nouvelle version).
 */
export function startServer({ port = 5173, root, prefix = '/' } = {}) {
  let base = resolve(root || join(fileURLToPath(new URL('..', import.meta.url)), 'www'));
  const mount = `/${String(prefix).replace(/^\/+|\/+$/g, '')}/`.replace('//', '/');
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let rel = decodeURIComponent(url.pathname);
      if (!rel.startsWith(mount)) throw new Error('hors du dossier servi');
      rel = rel.slice(mount.length - 1);
      if (rel.endsWith('/')) rel += 'index.html';
      const file = normalize(join(base, rel));
      if (file !== base && !file.startsWith(base + sep)) {
        res.writeHead(403).end('Interdit');
        return;
      }
      const info = await stat(file);
      if (!info.isFile()) throw new Error('not a file');
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Introuvable');
    }
  });
  return new Promise((resolveStart, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port;
      resolveStart({
        server,
        port: actual,
        url: `http://127.0.0.1:${actual}${mount}`,
        close: () =>
          new Promise((r) => {
            server.close(r);
            if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
          }),
        setRoot: (next) => {
          base = resolve(next);
        },
      });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.argv[2]) || 5173;
  const root = process.argv[3];
  const s = await startServer({ port, root });
  console.log(`Mon Budget est servi sur ${s.url} (Ctrl+C pour arrêter)`);
}
