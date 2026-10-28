/* Almacén de fotos de los perros.
   - En tu computadora se guardan en la carpeta uploads/ (como antes).
   - En Vercel el disco no es permanente, así que se guardan en la base de datos (tabla fotos).
   Para forzar uno u otro: ALMACEN_FOTOS=disco | bd en el .env. */
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { q, uno, EN_VERCEL } = require('./db');

const DIR = path.join(__dirname, '..', 'uploads');
const RE_NOMBRE = /^[a-f0-9]{32}\.(jpg|png|webp)$/;
const TIPOS = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const enBD = () => (process.env.ALMACEN_FOTOS ? process.env.ALMACEN_FOTOS === 'bd' : EN_VERCEL);

/* Límite por foto: Vercel acepta peticiones de hasta 4.5 MB; el navegador ya comprime antes de subir */
const LIMITE = EN_VERCEL ? 4 * 1024 * 1024 : 5 * 1024 * 1024;

async function guardar(buffer, ext) {
  const nombre = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  if (enBD()) {
    await q('INSERT INTO fotos (nombre, tipo, datos, creada_en) VALUES (?, ?, ?, NOW())', [nombre, TIPOS[ext], buffer]);
  } else {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(path.join(DIR, nombre), buffer, { flag: 'wx' });
  }
  return nombre;
}

async function borrar(nombre) {
  if (!nombre || !RE_NOMBRE.test(nombre)) return;
  await q('DELETE FROM fotos WHERE nombre = ?', [nombre]).catch(() => {});
  await fs.unlink(path.join(DIR, nombre)).catch(() => {});
}

/* Devuelve { tipo, datos } o null. Busca primero en disco (fotos antiguas) y luego en la base. */
async function leer(nombre) {
  if (!RE_NOMBRE.test(nombre)) return null;
  try {
    const datos = await fs.readFile(path.join(DIR, nombre));
    return { tipo: TIPOS[nombre.split('.').pop()], datos };
  } catch { /* no está en disco */ }
  const f = await uno('SELECT tipo, datos FROM fotos WHERE nombre = ?', [nombre]);
  return f ? { tipo: f.tipo, datos: f.datos } : null;
}

module.exports = { guardar, borrar, leer, LIMITE, RE_NOMBRE };
