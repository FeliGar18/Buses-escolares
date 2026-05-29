# 🚌 Buses Escolares — Seguimiento en tiempo real

Plataforma web para que **apoderados y funcionarios** vean en vivo, desde cualquier lugar,
dónde va el bus que recoge a los estudiantes. El **chofer** comparte su ubicación desde el
celular y todos la ven moverse en un mapa.

## Vistas

| Vista | URL | Para quién |
|-------|-----|-----------|
| Inicio | `/` | Apoderados: lista de buses |
| Seguimiento | `/track.html?bus=<id>` | Apoderados/funcionarios: ven el bus en vivo |
| Chofer | `/driver.html` | Conductor: comparte su GPS |
| Admin | `/admin.html` | Colegio: crea rutas, paradas y buses |

## Tecnología
- **Backend:** Node.js + Express + Socket.IO (tiempo real)
- **Frontend:** HTML/CSS/JS + Leaflet (OpenStreetMap)
- **Datos:** archivo JSON (`data/db.json`)

---

## ▶️ Correr en local

```bash
npm install
npm start
# Abrir http://localhost:3000
```

> El GPS del chofer requiere **HTTPS** o `localhost`. Por eso, para probar entre
> celulares reales hay que desplegarlo (Render ya da HTTPS). Ver abajo.

---

## ☁️ Desplegar en Render (gratis, con HTTPS)

### Paso 1 — Subir el código a GitHub
```bash
cd bus-tracker
git init
git add .
git commit -m "Plataforma de buses escolares"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/buses-escolares.git
git push -u origin main
```

### Paso 2 — Crear el servicio en Render
1. Entra a https://render.com y crea una cuenta (puedes usar tu GitHub).
2. Clic en **New +** → **Web Service**.
3. Conecta tu repositorio `buses-escolares`.
4. Render detecta Node automáticamente. Confirma:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free
5. Clic en **Create Web Service**.

> Alternativa de un clic: **New + → Blueprint** y apunta al repo (usa `render.yaml`).

### Paso 3 — ¡Listo!
En ~2-3 minutos tendrás una URL pública con HTTPS, por ejemplo:
```
https://buses-escolares.onrender.com
```

Comparte así:
- **Chofer:** `https://buses-escolares.onrender.com/driver.html`
- **Apoderados:** `https://buses-escolares.onrender.com/` (eligen su bus)

---

## ⚠️ Notas del plan gratis de Render
- El servicio **se duerme** tras 15 min sin visitas; la primera carga luego tarda ~30-50 s.
- El sistema de archivos es **efímero**: las rutas/buses creados en `/admin.html` se
  reinician al reiniciar el servicio. Para que persistan, migrar `data/db.json` a una base
  de datos (Render ofrece **PostgreSQL gratis**). Las posiciones en vivo siempre son en tiempo real.

## 📱 Uso real (chofer)
- Abrir `/driver.html`, elegir el bus y pulsar **Iniciar recorrido**.
- Aceptar el permiso de ubicación.
- La pantalla se mantiene encendida sola (Wake Lock) mientras dura el recorrido.
