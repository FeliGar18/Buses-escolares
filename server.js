/**
 * Plataforma de seguimiento de buses escolares en tiempo real
 * -----------------------------------------------------------
 * Backend: Express (API REST + archivos estáticos) + Socket.IO (tiempo real)
 * Persistencia: archivo JSON (data/db.json). Fácil de migrar a PostgreSQL/Mongo luego.
 *
 * Roles:
 *   - admin   -> crea rutas, marca paradas, registra buses   (public/admin.html)
 *   - chofer  -> emite su ubicación GPS                       (public/driver.html)
 *   - apoderado -> ve el bus en tiempo real por un link       (public/track.html)
 */

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'db.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Persistencia simple en JSON
// ---------------------------------------------------------------------------
function loadDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (e) {
    return { routes: [], buses: [] };
  }
}

function saveDB(db) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

let db = loadDB();

// Ubicaciones EN VIVO (en memoria, no se persisten). { [busId]: {lat,lng,speed,heading,ts} }
const liveLocations = {};

const uid = (p) => p + '_' + Math.random().toString(36).slice(2, 9);

// ---------------------------------------------------------------------------
// API REST
// ---------------------------------------------------------------------------

// --- Rutas ---
app.get('/api/routes', (req, res) => res.json(db.routes));

app.get('/api/routes/:id', (req, res) => {
  const r = db.routes.find((x) => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'Ruta no encontrada' });
  res.json(r);
});

app.post('/api/routes', (req, res) => {
  const { name, city, color, stops, path: routePath } = req.body;
  if (!name) return res.status(400).json({ error: 'Falta el nombre de la ruta' });
  const route = {
    id: uid('r'),
    name,
    city: city || '',
    color: color || '#2563eb',
    stops: (stops || []).map((s, i) => ({ id: uid('s'), order: i + 1, ...s })),
    path: routePath || [],
  };
  db.routes.push(route);
  saveDB(db);
  res.status(201).json(route);
});

app.put('/api/routes/:id', (req, res) => {
  const idx = db.routes.findIndex((x) => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Ruta no encontrada' });
  const { name, city, color, stops, path: routePath } = req.body;
  const r = db.routes[idx];
  if (name !== undefined) r.name = name;
  if (city !== undefined) r.city = city;
  if (color !== undefined) r.color = color;
  if (routePath !== undefined) r.path = routePath;
  if (stops !== undefined) {
    r.stops = stops.map((s, i) => ({ id: s.id || uid('s'), order: i + 1, ...s }));
  }
  saveDB(db);
  res.json(r);
});

app.delete('/api/routes/:id', (req, res) => {
  db.routes = db.routes.filter((x) => x.id !== req.params.id);
  db.buses = db.buses.map((b) => (b.routeId === req.params.id ? { ...b, routeId: null } : b));
  saveDB(db);
  res.json({ ok: true });
});

// --- Buses ---
app.get('/api/buses', (req, res) => {
  // Incluye la última ubicación en vivo si existe
  const list = db.buses.map((b) => ({
    ...b,
    live: liveLocations[b.id] || null,
    route: db.routes.find((r) => r.id === b.routeId) || null,
  }));
  res.json(list);
});

app.get('/api/buses/:id', (req, res) => {
  const b = db.buses.find((x) => x.id === req.params.id);
  if (!b) return res.status(404).json({ error: 'Bus no encontrado' });
  res.json({
    ...b,
    live: liveLocations[b.id] || null,
    route: db.routes.find((r) => r.id === b.routeId) || null,
  });
});

app.post('/api/buses', (req, res) => {
  const { name, plate, routeId, driverName } = req.body;
  if (!name) return res.status(400).json({ error: 'Falta el nombre del bus' });
  const bus = {
    id: uid('b'),
    name,
    plate: plate || '',
    routeId: routeId || null,
    driverName: driverName || '',
  };
  db.buses.push(bus);
  saveDB(db);
  res.status(201).json(bus);
});

app.put('/api/buses/:id', (req, res) => {
  const b = db.buses.find((x) => x.id === req.params.id);
  if (!b) return res.status(404).json({ error: 'Bus no encontrado' });
  const { name, plate, routeId, driverName } = req.body;
  if (name !== undefined) b.name = name;
  if (plate !== undefined) b.plate = plate;
  if (routeId !== undefined) b.routeId = routeId;
  if (driverName !== undefined) b.driverName = driverName;
  saveDB(db);
  res.json(b);
});

app.delete('/api/buses/:id', (req, res) => {
  db.buses = db.buses.filter((x) => x.id !== req.params.id);
  delete liveLocations[req.params.id];
  saveDB(db);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Tiempo real (Socket.IO)
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  // El apoderado se suscribe a un bus concreto para recibir sus posiciones
  socket.on('subscribe', (busId) => {
    socket.join('bus:' + busId);
    // Enviar la última posición conocida de inmediato
    if (liveLocations[busId]) {
      socket.emit('location:update', { busId, ...liveLocations[busId] });
    }
  });

  socket.on('unsubscribe', (busId) => socket.leave('bus:' + busId));

  // El chofer emite su posición
  socket.on('driver:location', (data) => {
    const { busId, lat, lng, speed, heading } = data || {};
    if (!busId || typeof lat !== 'number' || typeof lng !== 'number') return;
    const loc = { lat, lng, speed: speed || 0, heading: heading || 0, ts: Date.now() };
    liveLocations[busId] = loc;
    // Reenviar a apoderados suscritos a ese bus y al panel global
    io.to('bus:' + busId).emit('location:update', { busId, ...loc });
    io.to('admin').emit('location:update', { busId, ...loc });
  });

  // El chofer marca inicio/fin de recorrido
  socket.on('driver:status', (data) => {
    const { busId, active } = data || {};
    if (!busId) return;
    if (!active) delete liveLocations[busId];
    io.to('bus:' + busId).emit('bus:status', { busId, active });
    io.to('admin').emit('bus:status', { busId, active });
  });

  // El panel de admin escucha todos los buses
  socket.on('admin:join', () => socket.join('admin'));
});

server.listen(PORT, () => {
  console.log(`\n🚌 Plataforma de buses escolares corriendo en:`);
  console.log(`   http://localhost:${PORT}\n`);
  console.log(`   Inicio (apoderados):  http://localhost:${PORT}/`);
  console.log(`   Admin (rutas):        http://localhost:${PORT}/admin.html`);
  console.log(`   Chofer (GPS):         http://localhost:${PORT}/driver.html\n`);
});
