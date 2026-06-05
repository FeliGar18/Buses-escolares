/**
 * Capa de datos con doble backend:
 *   - Si existe DATABASE_URL  -> usa PostgreSQL (Supabase) → datos PERSISTENTES.
 *   - Si NO existe            -> usa archivo data/db.json   → respaldo local.
 *
 * Toda la API es async para que server.js no tenga que saber cuál se usa.
 * Modelo de datos (igual en ambos backends):
 *   route = { id, name, city, color, stops:[{id,order,name,lat,lng}], path:[] }
 *   bus   = { id, name, plate, routeId, driverName }
 */

const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'data', 'db.json');
const uid = (p) => p + '_' + Math.random().toString(36).slice(2, 9);

const USE_PG = !!process.env.DATABASE_URL;
let pool = null;

// ============================================================ JSON backend ===
function jsonLoad() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch (e) { return { routes: [], buses: [] }; }
}
function jsonSave(db) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

const jsonStore = {
  async getRoutes() { return jsonLoad().routes; },
  async getRoute(id) { return jsonLoad().routes.find((r) => r.id === id) || null; },
  async createRoute(data) {
    const db = jsonLoad();
    const route = {
      id: uid('r'),
      name: data.name,
      city: data.city || '',
      color: data.color || '#2563eb',
      stops: (data.stops || []).map((s, i) => ({ id: uid('s'), order: i + 1, name: s.name, lat: s.lat, lng: s.lng })),
      path: data.path || [],
    };
    db.routes.push(route); jsonSave(db); return route;
  },
  async updateRoute(id, data) {
    const db = jsonLoad();
    const r = db.routes.find((x) => x.id === id);
    if (!r) return null;
    if (data.name !== undefined) r.name = data.name;
    if (data.city !== undefined) r.city = data.city;
    if (data.color !== undefined) r.color = data.color;
    if (data.path !== undefined) r.path = data.path;
    if (data.stops !== undefined) r.stops = data.stops.map((s, i) => ({ id: s.id || uid('s'), order: i + 1, name: s.name, lat: s.lat, lng: s.lng }));
    jsonSave(db); return r;
  },
  async deleteRoute(id) {
    const db = jsonLoad();
    db.routes = db.routes.filter((x) => x.id !== id);
    db.buses = db.buses.map((b) => (b.routeId === id ? { ...b, routeId: null } : b));
    jsonSave(db); return true;
  },
  async getBuses() { return jsonLoad().buses; },
  async getBus(id) { return jsonLoad().buses.find((b) => b.id === id) || null; },
  async createBus(data) {
    const db = jsonLoad();
    const bus = { id: uid('b'), name: data.name, plate: data.plate || '', routeId: data.routeId || null, driverName: data.driverName || '' };
    db.buses.push(bus); jsonSave(db); return bus;
  },
  async updateBus(id, data) {
    const db = jsonLoad();
    const b = db.buses.find((x) => x.id === id);
    if (!b) return null;
    if (data.name !== undefined) b.name = data.name;
    if (data.plate !== undefined) b.plate = data.plate;
    if (data.routeId !== undefined) b.routeId = data.routeId;
    if (data.driverName !== undefined) b.driverName = data.driverName;
    jsonSave(db); return b;
  },
  async deleteBus(id) {
    const db = jsonLoad();
    db.buses = db.buses.filter((x) => x.id !== id);
    jsonSave(db); return true;
  },
};

// ============================================================ PG backend =====
// Las rutas se guardan con stops/path como JSONB para mantener el mismo modelo.
const pgStore = {
  async _init() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS routes (
        id    TEXT PRIMARY KEY,
        name  TEXT NOT NULL,
        city  TEXT DEFAULT '',
        color TEXT DEFAULT '#2563eb',
        stops JSONB DEFAULT '[]',
        path  JSONB DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS buses (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        plate      TEXT DEFAULT '',
        route_id   TEXT,
        driver_name TEXT DEFAULT ''
      );
    `);
    // Semilla solo si está totalmente vacía (primer arranque)
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM routes');
    const busCount = await pool.query('SELECT COUNT(*)::int AS n FROM buses');
    if (rows[0].n === 0 && busCount.rows[0].n === 0) {
      const seed = jsonLoad();
      for (const r of seed.routes) {
        await pool.query(
          'INSERT INTO routes (id,name,city,color,stops,path) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING',
          [r.id, r.name, r.city || '', r.color || '#2563eb', JSON.stringify(r.stops || []), JSON.stringify(r.path || [])]
        );
      }
      for (const b of seed.buses) {
        await pool.query(
          'INSERT INTO buses (id,name,plate,route_id,driver_name) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING',
          [b.id, b.name, b.plate || '', b.routeId || null, b.driverName || '']
        );
      }
      if (seed.routes.length || seed.buses.length) console.log('🌱 Datos iniciales migrados desde db.json a PostgreSQL');
    }
  },
  _rowToRoute(r) { return { id: r.id, name: r.name, city: r.city, color: r.color, stops: r.stops || [], path: r.path || [] }; },
  _rowToBus(b) { return { id: b.id, name: b.name, plate: b.plate, routeId: b.route_id, driverName: b.driver_name }; },

  async getRoutes() { return (await pool.query('SELECT * FROM routes ORDER BY name')).rows.map(this._rowToRoute); },
  async getRoute(id) {
    const { rows } = await pool.query('SELECT * FROM routes WHERE id=$1', [id]);
    return rows[0] ? this._rowToRoute(rows[0]) : null;
  },
  async createRoute(data) {
    const route = {
      id: uid('r'), name: data.name, city: data.city || '', color: data.color || '#2563eb',
      stops: (data.stops || []).map((s, i) => ({ id: uid('s'), order: i + 1, name: s.name, lat: s.lat, lng: s.lng })),
      path: data.path || [],
    };
    await pool.query('INSERT INTO routes (id,name,city,color,stops,path) VALUES ($1,$2,$3,$4,$5,$6)',
      [route.id, route.name, route.city, route.color, JSON.stringify(route.stops), JSON.stringify(route.path)]);
    return route;
  },
  async updateRoute(id, data) {
    const cur = await this.getRoute(id);
    if (!cur) return null;
    const next = {
      name: data.name !== undefined ? data.name : cur.name,
      city: data.city !== undefined ? data.city : cur.city,
      color: data.color !== undefined ? data.color : cur.color,
      path: data.path !== undefined ? data.path : cur.path,
      stops: data.stops !== undefined
        ? data.stops.map((s, i) => ({ id: s.id || uid('s'), order: i + 1, name: s.name, lat: s.lat, lng: s.lng }))
        : cur.stops,
    };
    await pool.query('UPDATE routes SET name=$2,city=$3,color=$4,stops=$5,path=$6 WHERE id=$1',
      [id, next.name, next.city, next.color, JSON.stringify(next.stops), JSON.stringify(next.path)]);
    return { id, ...next };
  },
  async deleteRoute(id) {
    await pool.query('DELETE FROM routes WHERE id=$1', [id]);
    await pool.query('UPDATE buses SET route_id=NULL WHERE route_id=$1', [id]);
    return true;
  },
  async getBuses() { return (await pool.query('SELECT * FROM buses ORDER BY name')).rows.map(this._rowToBus); },
  async getBus(id) {
    const { rows } = await pool.query('SELECT * FROM buses WHERE id=$1', [id]);
    return rows[0] ? this._rowToBus(rows[0]) : null;
  },
  async createBus(data) {
    const bus = { id: uid('b'), name: data.name, plate: data.plate || '', routeId: data.routeId || null, driverName: data.driverName || '' };
    await pool.query('INSERT INTO buses (id,name,plate,route_id,driver_name) VALUES ($1,$2,$3,$4,$5)',
      [bus.id, bus.name, bus.plate, bus.routeId, bus.driverName]);
    return bus;
  },
  async updateBus(id, data) {
    const cur = await this.getBus(id);
    if (!cur) return null;
    const next = {
      name: data.name !== undefined ? data.name : cur.name,
      plate: data.plate !== undefined ? data.plate : cur.plate,
      routeId: data.routeId !== undefined ? data.routeId : cur.routeId,
      driverName: data.driverName !== undefined ? data.driverName : cur.driverName,
    };
    await pool.query('UPDATE buses SET name=$2,plate=$3,route_id=$4,driver_name=$5 WHERE id=$1',
      [id, next.name, next.plate, next.routeId, next.driverName]);
    return { id, ...next };
  },
  async deleteBus(id) { await pool.query('DELETE FROM buses WHERE id=$1', [id]); return true; },
};

// ============================================================ init ===========
async function init() {
  if (USE_PG) {
    try {
      const { Pool } = require('pg');
      pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }, // Supabase requiere SSL
      });
      await pgStore._init();
      console.log('💾 Base de datos: PostgreSQL (datos persistentes)');
      return pgStore;
    } catch (e) {
      console.error('⚠️  No se pudo conectar a PostgreSQL, usando archivo JSON. Detalle:', e.message);
      return jsonStore;
    }
  }
  console.log('💾 Base de datos: archivo JSON local (data/db.json)');
  return jsonStore;
}

module.exports = { init };
