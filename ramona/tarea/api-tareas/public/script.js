const API = '/tareas';

async function fetchTareas() {
  try {
    const r = await fetch(API);
    const tareas = await r.json();
    const ul = document.getElementById('lista');
    ul.innerHTML = '';
    tareas.forEach(t => {
      const li = document.createElement('li');
      const status = t.status || 'pendiente';
      li.innerHTML = `<span>${escapeHtml(t.title)}</span>
        <select class="status-select" onchange="cambiarEstado(${t.id}, this.value)">
          ${statusOptions(status)}
        </select>
        <span class="chip ${status}">${formatStatus(status)}</span>
        <span class="item-actions">
          <button class="ghost" onclick="editar(${t.id})">&#9998;</button>
          <button class="danger" onclick="eliminar(${t.id})">&#128465;</button>
        </span>`;
      ul.appendChild(li);
    });
  } catch (err) {
    alert('Error obteniendo tareas: ' + err.message);
  }
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function formatStatus(status) {
  if (status === 'en_progreso') return 'En progreso';
  if (status === 'hecha') return 'Hecha';
  return 'Pendiente';
}

function statusOptions(current) {
  const opts = [
    { v: 'pendiente', t: 'Pendiente' },
    { v: 'en_progreso', t: 'En progreso' },
    { v: 'hecha', t: 'Hecha' }
  ];
  return opts.map(o => `<option value="${o.v}" ${o.v === current ? 'selected' : ''}>${o.t}</option>`).join('');
}

document.getElementById('add').addEventListener('click', async () => {
  const titleEl = document.getElementById('title');
  const statusEl = document.getElementById('status');
  const title = titleEl.value.trim();
  if (!title) return alert('Escribe algo.');
  try {
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, status: statusEl.value })
    });
    if (!r.ok) {
      const err = await r.json();
      throw new Error(err.error || JSON.stringify(err));
    }
    titleEl.value = '';
    fetchTareas();
  } catch (err) {
    alert('Error creando tarea: ' + err.message);
  }
});

async function eliminar(id) {
  if (!confirm('Eliminar tarea?')) return;
  await fetch(API + '/' + id, { method: 'DELETE' });
  fetchTareas();
}

async function editar(id) {
  const nuevo = prompt('Nuevo título:');
  if (nuevo === null) return;
  const title = nuevo.trim();
  if (!title) return alert('Título vacío.');
  const r = await fetch(API + '/' + id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title })
  });
  if (!r.ok) {
    const err = await r.json();
    return alert('Error: ' + (err.error || JSON.stringify(err)));
  }
  fetchTareas();
}

async function cambiarEstado(id, status) {
  const r = await fetch(API + '/' + id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });
  if (!r.ok) {
    const err = await r.json();
    alert('Error: ' + (err.error || JSON.stringify(err)));
  }
  fetchTareas();
}

fetchTareas();
