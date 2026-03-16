import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'tareas.json');
const VALID_STATUS = new Set(['pendiente', 'en_progreso', 'hecha']);

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    const initial = { lastId: 0, tareas: [] };
    await fs.writeFile(DATA_FILE, JSON.stringify(initial, null, 2), 'utf8');
  }
}

async function loadData() {
  await ensureDataFile();
  const raw = await fs.readFile(DATA_FILE, 'utf8');
  return JSON.parse(raw);
}

async function saveData(data) {
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function normalizeStatus(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (!VALID_STATUS.has(v)) return null;
  return v;
}

function withDefaultStatus(tarea) {
  const status = normalizeStatus(tarea.status) || 'pendiente';
  return { ...tarea, status };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function getMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

async function serveStatic(req, res, pathname) {
  let filePath = path.join(PUBLIC_DIR, pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) return false;
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
  } catch {
    return false;
  }
  try {
    const content = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': getMime(filePath) });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // Static files and index
  if (req.method === 'GET' && (pathname === '/' || pathname.startsWith('/'))) {
    const ok = await serveStatic(req, res, pathname === '/' ? '/index.html' : pathname);
    if (ok) return;
  }

  // --- RUTAS CRUD ---
  if (pathname === '/tareas' && req.method === 'POST') {
    try {
      const { title, status } = await readJson(req);
      if (!title || typeof title !== 'string' || title.trim() === '') {
        return sendJson(res, 400, { error: 'title es requerido' });
      }
      const cleanStatus = normalizeStatus(status) || 'pendiente';
      const clean = title.trim();
      const data = await loadData();
      const id = data.lastId + 1;
      data.lastId = id;
      data.tareas.unshift({ id, title: clean, status: cleanStatus });
      await saveData(data);
      return sendJson(res, 201, { id, title: clean, status: cleanStatus });
    } catch {
      return sendJson(res, 500, { error: 'DB error' });
    }
  }

  if (pathname === '/tareas' && req.method === 'GET') {
    try {
      const data = await loadData();
      return sendJson(res, 200, data.tareas.map(withDefaultStatus));
    } catch {
      return sendJson(res, 500, { error: 'DB error' });
    }
  }

  const match = pathname.match(/^\/tareas\/(\d+)$/);
  if (match) {
    const id = Number(match[1]);

    if (req.method === 'GET') {
      try {
        const data = await loadData();
        const tarea = data.tareas.find(t => t.id === id);
        if (!tarea) return sendJson(res, 404, { error: 'Tarea no encontrada' });
        return sendJson(res, 200, withDefaultStatus(tarea));
      } catch {
        return sendJson(res, 500, { error: 'DB error' });
      }
    }

    if (req.method === 'PUT') {
      try {
        const { title, status } = await readJson(req);
        const hasTitle = typeof title === 'string' && title.trim() !== '';
        const hasStatus = typeof status === 'string' && status.trim() !== '';
        if (!hasTitle && !hasStatus) {
          return sendJson(res, 400, { error: 'title o status es requerido' });
        }
        const clean = hasTitle ? title.trim() : null;
        const cleanStatus = hasStatus ? normalizeStatus(status) : null;
        if (hasStatus && !cleanStatus) {
          return sendJson(res, 400, { error: 'status inválido' });
        }
        const data = await loadData();
        const idx = data.tareas.findIndex(t => t.id === id);
        if (idx === -1) return sendJson(res, 404, { error: 'Tarea no encontrada' });
        if (clean) data.tareas[idx].title = clean;
        if (cleanStatus) data.tareas[idx].status = cleanStatus;
        await saveData(data);
        return sendJson(res, 200, withDefaultStatus({ id, ...data.tareas[idx] }));
      } catch {
        return sendJson(res, 500, { error: 'DB error' });
      }
    }

    if (req.method === 'DELETE') {
      try {
        const data = await loadData();
        const before = data.tareas.length;
        data.tareas = data.tareas.filter(t => t.id !== id);
        if (data.tareas.length === before) {
          return sendJson(res, 404, { error: 'Tarea no encontrada' });
        }
        await saveData(data);
        return sendJson(res, 200, { success: true });
      } catch {
        return sendJson(res, 500, { error: 'DB error' });
      }
    }
  }

  sendJson(res, 404, { error: 'Ruta no encontrada' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`API corriendo en http://localhost:${PORT}`);
});
