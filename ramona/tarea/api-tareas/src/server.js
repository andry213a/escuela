import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();
const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ROOT_DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const DATA_FILE = path.join(DATA_DIR, 'tareas.json');
const DB_MODE = (process.env.DB_MODE || 'json').toLowerCase();
const JSON_FILE = process.env.JSON_FILE
  ? path.resolve(ROOT_DIR, process.env.JSON_FILE)
  : DATA_FILE;
const DATABASE_URL = process.env.DATABASE_URL || '';
const VALID_STATUS = new Set(['pendiente', 'en_progreso', 'hecha']);

const usePostgres = DB_MODE === 'neon' || DB_MODE === 'postgres' || DB_MODE === 'postgrest';
const pool = usePostgres
  ? new Pool({ connectionString: DATABASE_URL })
  : null;

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(JSON_FILE);
  } catch {
    const initial = { lastId: 0, tareas: [] };
    await fs.writeFile(JSON_FILE, JSON.stringify(initial, null, 2), 'utf8');
  }
}

async function loadData() {
  await ensureDataFile();
  const raw = await fs.readFile(JSON_FILE, 'utf8');
  return JSON.parse(raw);
}

async function saveData(data) {
  await fs.writeFile(JSON_FILE, JSON.stringify(data, null, 2), 'utf8');
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

async function ensurePg() {
  if (!usePostgres) return;
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL no configurada');
  }
  await pool.query(
    `CREATE TABLE IF NOT EXISTS tareas (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pendiente',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`
  );
}

async function listTareas() {
  if (!usePostgres) {
    const data = await loadData();
    return data.tareas.map(withDefaultStatus);
  }
  await ensurePg();
  const r = await pool.query(
    'SELECT id, title, status FROM tareas ORDER BY id DESC'
  );
  return r.rows.map(withDefaultStatus);
}

async function getTarea(id) {
  if (!usePostgres) {
    const data = await loadData();
    const tarea = data.tareas.find(t => t.id === id);
    return tarea ? withDefaultStatus(tarea) : null;
  }
  await ensurePg();
  const r = await pool.query(
    'SELECT id, title, status FROM tareas WHERE id = $1',
    [id]
  );
  if (r.rows.length === 0) return null;
  return withDefaultStatus(r.rows[0]);
}

async function createTarea(title, status) {
  if (!usePostgres) {
    const data = await loadData();
    const id = data.lastId + 1;
    data.lastId = id;
    const tarea = { id, title, status };
    data.tareas.unshift(tarea);
    await saveData(data);
    return tarea;
  }
  await ensurePg();
  const r = await pool.query(
    'INSERT INTO tareas (title, status) VALUES ($1, $2) RETURNING id, title, status',
    [title, status]
  );
  return withDefaultStatus(r.rows[0]);
}

async function updateTarea(id, fields) {
  if (!usePostgres) {
    const data = await loadData();
    const idx = data.tareas.findIndex(t => t.id === id);
    if (idx === -1) return null;
    if (fields.title) data.tareas[idx].title = fields.title;
    if (fields.status) data.tareas[idx].status = fields.status;
    await saveData(data);
    return withDefaultStatus({ id, ...data.tareas[idx] });
  }
  await ensurePg();
  const updates = [];
  const values = [];
  let i = 1;
  if (fields.title) {
    updates.push(`title = $${i++}`);
    values.push(fields.title);
  }
  if (fields.status) {
    updates.push(`status = $${i++}`);
    values.push(fields.status);
  }
  if (updates.length === 0) return null;
  values.push(id);
  const r = await pool.query(
    `UPDATE tareas SET ${updates.join(', ')} WHERE id = $${i} RETURNING id, title, status`,
    values
  );
  if (r.rows.length === 0) return null;
  return withDefaultStatus(r.rows[0]);
}

async function deleteTarea(id) {
  if (!usePostgres) {
    const data = await loadData();
    const before = data.tareas.length;
    data.tareas = data.tareas.filter(t => t.id !== id);
    if (data.tareas.length === before) return false;
    await saveData(data);
    return true;
  }
  await ensurePg();
  const r = await pool.query('DELETE FROM tareas WHERE id = $1', [id]);
  return r.rowCount > 0;
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
      const tarea = await createTarea(clean, cleanStatus);
      return sendJson(res, 201, tarea);
    } catch {
      return sendJson(res, 500, { error: 'DB error' });
    }
  }

  if (pathname === '/tareas' && req.method === 'GET') {
    try {
      const tareas = await listTareas();
      return sendJson(res, 200, tareas);
    } catch {
      return sendJson(res, 500, { error: 'DB error' });
    }
  }

  const match = pathname.match(/^\/tareas\/(\d+)$/);
  if (match) {
    const id = Number(match[1]);

    if (req.method === 'GET') {
      try {
        const tarea = await getTarea(id);
        if (!tarea) return sendJson(res, 404, { error: 'Tarea no encontrada' });
        return sendJson(res, 200, tarea);
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
        const updated = await updateTarea(id, {
          title: clean || null,
          status: cleanStatus || null
        });
        if (!updated) return sendJson(res, 404, { error: 'Tarea no encontrada' });
        return sendJson(res, 200, updated);
      } catch {
        return sendJson(res, 500, { error: 'DB error' });
      }
    }

    if (req.method === 'DELETE') {
      try {
        const ok = await deleteTarea(id);
        if (!ok) return sendJson(res, 404, { error: 'Tarea no encontrada' });
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
  console.log(`Pagina corriendo en http://localhost:${PORT}`);
});
