// Dev-server plugin: serves ../eval as /evaldata and stores posted results in
// ../eval/results. Used only by eval.html during `vite` (never in a build).
import type { Plugin } from 'vite';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';

const ROOT = resolve(__dirname, '../eval');

export function evalServer(): Plugin {
  return {
    name: 'eval-server',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/evaldata', (req, res) => {
        const url = new URL(req.url ?? '/', 'http://x');
        if (req.method === 'POST' && url.pathname === '/results') {
          const name = (url.searchParams.get('name') ?? 'run').replace(/[^a-z0-9._-]/gi, '_');
          let body = '';
          req.on('data', (c) => (body += c));
          req.on('end', () => {
            mkdirSync(join(ROOT, 'results'), { recursive: true });
            writeFileSync(join(ROOT, 'results', `${name}.json`), body);
            res.end('ok');
          });
          return;
        }
        const pathname = decodeURIComponent(url.pathname);
        const file = resolve(ROOT, `.${pathname}`);
        if (!file.startsWith(ROOT + sep) || !statSync(file, { throwIfNoEntry: false })?.isFile()) {
          res.statusCode = 404;
          res.end('not found');
          return;
        }
        res.setHeader('Content-Type', extname(file) === '.pdf' ? 'application/pdf' : 'text/plain; charset=utf-8');
        res.end(readFileSync(file));
      });
    },
  };
}
