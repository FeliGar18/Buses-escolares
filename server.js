/**
 * Plataforma de seguimiento de buses escolares en tiempo real
 * -----------------------------------------------------------
 * Backend: Express (API REST + archivos estáticos) + Socket.IO (tiempo real)
 * Persistencia: PostgreSQL si hay DATABASE_URL, si no archivo JSON (ver db.js).
 *
 * Roles:
 *   - admin     -> crea/edita rutas, marca paradas, registra buses (public/admin.html)
 *   - chofer    -> emite su ubicación GPS y edita su ruta          (public/driver.html)
 *   - apoderado -> ve el bus en tiempo real por un link            (public/track.html)
 */

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { init } = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ubicaciones EN VIVO (en memoria, no se persisten). { [busId]: {lat,lng,speed,heading,ts} }
const liveLocations = {};

// Helper: arma un bus con su ruta y ubicación en vivo
async function enrichBus(store, b) {
  return {
    ...b,
    live: liveLocations[b.id] || null,
    route: b.routeId ? await store.getRoute(b.routeId) : null,
  };
}

// El servidor arranca una vez la capa de datos está lista
init().then((store) => {
  // ---------------------------------------------------------------- Rutas ----
  app.get('/api/routes', async (req, res) => {
    res.json(await store.getRoutes());
  });

  app.get('/api/routes/:id', async (req, res) => {
    const r = await store.getRoute(req.params.id);
    if (!r) return res.status(404).json({ error: 'Ruta no encontrada' });
    res.json(r);
  });

  app.post('/api/routes', async (req, res) => {
    if (!req.body.name) return res.status(400).json({ error: 'Falta el nombre de la ruta' });
    res.status(201).json(await store.createRoute(req.body));
  });

  app.put('/api/routes/:id', async (req, res) => {
    const r = await store.updateRoute(req.params.id, req.body);
    if (!r) return res.status(404).json({ error: 'Ruta no encontrada' });
    res.json(r);
  });

  app.delete('/api/routes/:id', async (req, res) => {
    await store.deleteRoute(req.params.id);
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- Buses ----
  app.get('/api/buses', async (req, res) => {
    const buses = await store.getBuses();
    res.json(await Promise.all(buses.map((b) => enrichBus(store, b))));
  });

  app.get('/api/buses/:id', async (req, res) => {
    const b = await store.getBus(req.params.id);
    if (!b) return res.status(404).json({ error: 'Bus no encontrado' });
    res.json(await enrichBus(store, b));
  });

  app.post('/api/buses', async (req, res) => {
    if (!req.body.name) return res.status(400).json({ error: 'Falta el nombre del bus' });
    res.status(201).json(await store.createBus(req.body));
  });

  app.put('/api/buses/:id', async (req, res) => {
    const b = await store.updateBus(req.params.id, req.body);
    if (!b) return res.status(404).json({ error: 'Bus no encontrado' });
    res.json(b);
  });

  app.delete('/api/buses/:id', async (req, res) => {
    await store.deleteBus(req.params.id);
    delete liveLocations[req.params.id];
    res.json({ ok: true });
  });

  // ---------------------------------------------- Tiempo real (Socket.IO) ----
  io.on('connection', (socket) => {
    socket.on('subscribe', (busId) => {
      socket.join('bus:' + busId);
      if (liveLocations[busId]) socket.emit('location:update', { busId, ...liveLocations[busId] });
    });
    socket.on('unsubscribe', (busId) => socket.leave('bus:' + busId));

    socket.on('driver:location', (data) => {
      const { busId, lat, lng, speed, heading } = data || {};
      if (!busId || typeof lat !== 'number' || typeof lng !== 'number') return;
      const loc = { lat, lng, speed: speed || 0, heading: heading || 0, ts: Date.now() };
      liveLocations[busId] = loc;
      io.to('bus:' + busId).emit('location:update', { busId, ...loc });
      io.to('admin').emit('location:update', { busId, ...loc });
    });

    socket.on('driver:status', (data) => {
      const { busId, active } = data || {};
      if (!busId) return;
      if (!active) delete liveLocations[busId];
      io.to('bus:' + busId).emit('bus:status', { busId, active });
      io.to('admin').emit('bus:status', { busId, active });
    });

    socket.on('admin:join', () => socket.join('admin'));
  });

  server.listen(PORT, () => {
    console.log(`\n🚌 Plataforma de buses escolares corriendo en:`);
    console.log(`   http://localhost:${PORT}\n`);
    console.log(`   Inicio (apoderados):  http://localhost:${PORT}/`);
    console.log(`   Admin (rutas):        http://localhost:${PORT}/admin.html`);
    console.log(`   Chofer (GPS):         http://localhost:${PORT}/driver.html\n`);
  });
}).catch((e) => {
  console.error('❌ Error al iniciar la base de datos:', e);
  process.exit(1);
});
