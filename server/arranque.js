/* Arranque con autodiagnóstico.
   Carga el .env, comprueba PostgreSQL, crea o actualiza las tablas (database/schema.sql es idempotente)
   y revisa que los archivos del proyecto sean los de esta versión. Si algo falla, explica cómo resolverlo. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const RAIZ = path.join(__dirname, '..');
const ENV = path.join(RAIZ, '.env');
const MANIFIESTO = path.join(__dirname, 'manifiesto.json');
const VERSION = require('../package.json').version;
const EN_NUBE = !!(process.env.RENDER || process.env.VERCEL);

const verde = (t) => `\x1b[32m${t}\x1b[0m`;
const amarillo = (t) => `\x1b[33m${t}\x1b[0m`;
const rojo = (t) => `\x1b[31m${t}\x1b[0m`;

/* 1. Archivo .env: si no existe se crea a partir de .env.example */
function prepararEnv() {
  // En Render la configuración llega por variables de entorno del servicio (no hay .env)
  if (EN_NUBE) return;
  if (!fs.existsSync(ENV)) {
    const ejemplo = path.join(RAIZ, '.env.example');
    fs.writeFileSync(ENV, fs.existsSync(ejemplo) ? fs.readFileSync(ejemplo, 'utf8') : '');
    console.log(amarillo('[!] No había archivo .env: se creó uno a partir de .env.example.'));
    console.log(amarillo('    Pon tu cadena de conexión de Supabase en DATABASE_URL (o los datos DB_*) y vuelve a ejecutar npm start.'));
  }
  require('dotenv').config({ path: ENV });
}

/* Mensaje claro para cada error típico de PostgreSQL */
function explicarErrorBD(e) {
  const { descripcion } = require('./db');
  const donde = descripcion();
  const variables = EN_NUBE ? 'las variables de entorno del servicio en Render' : 'el archivo .env';
  switch (e.code) {
    case 'ECONNREFUSED': case 'ETIMEDOUT': case 'EHOSTUNREACH': case 'ENOTFOUND': case 'ECONNRESET': case 'EAI_AGAIN':
      return `La base de datos (${donde}) no responde. Revisa DATABASE_URL en ${variables} y que el proyecto de Supabase esté activo (los proyectos gratuitos se pausan tras una semana sin uso).`;
    case 'ER_ACCESS_DENIED_ERROR':
      return `La base de datos rechazó el usuario o la contraseña. Copia de nuevo la cadena de conexión de Supabase (Project Settings → Database) en DATABASE_URL de ${variables}.`;
    case 'ER_BAD_DB_ERROR':
      return `La base de datos indicada no existe. En Supabase usa la base "postgres" (viene en la cadena de conexión).`;
    case 'SELF_SIGNED_CERT_IN_CHAIN': case 'DEPTH_ZERO_SELF_SIGNED_CERT': case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      return `No se pudo validar el certificado TLS de ${donde}. Quita DB_SSL_CA o pon el certificado correcto de tu proveedor.`;
    case '42501':
      return `El usuario de la base no tiene permisos para crear tablas. Usa el usuario "postgres" de Supabase.`;
    default:
      return `Error de PostgreSQL (${e.code || ''} ${e.message}).`;
  }
}

/* Crea o actualiza las tablas. Es seguro repetirlo: todo usa IF NOT EXISTS / ON CONFLICT. */
async function crearEsquema() {
  const { pool } = require('./db');
  // Ruta escrita completa para que los empaquetadores incluyan schema.sql
  const sql = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');
  const c = await pool.connect();
  try {
    await c.query('SELECT pg_advisory_lock(424242)'); // si arrancan dos instancias, una espera a la otra
    await c.query(sql);
  } finally {
    await c.query('SELECT pg_advisory_unlock(424242)').catch(() => {});
    c.release();
  }
}

/* 2. Base de datos: conecta y crea/actualiza las tablas. Devuelve null si todo está bien o el mensaje del problema. */
async function prepararBD() {
  const { q } = require('./db');
  try {
    await q('SELECT 1');
    await crearEsquema();
    const admins = await q("SELECT COUNT(*) AS n FROM usuarios WHERE tipo = 'admin' AND estado = 'activa'");
    if (!Number(admins[0].n)) {
      console.log(amarillo('[!] Aún no hay administrador. Créalo con:  npm run admin -- correo@ejemplo.com "Tu Nombre" Clave123'));
    }
    return null;
  } catch (e) {
    return explicarErrorBD(e);
  }
}

/* 3. Archivos: compara cada archivo con la huella guardada al empaquetar (detecta copias viejas o a medias).
   Se ignoran los saltos de línea (Windows/Git los cambian a CRLF) para no dar falsas alarmas. */
const ARCHIVOS = () => {
  const lista = [];
  const recorrer = (dir) => {
    for (const f of fs.readdirSync(path.join(RAIZ, dir))) {
      const rel = `${dir}/${f}`;
      const abs = path.join(RAIZ, rel);
      if (fs.statSync(abs).isDirectory()) recorrer(rel);
      else if (/\.(js|css|html|json|sql|svg)$/.test(f) && f !== 'manifiesto.json') lista.push(rel);
    }
  };
  ['public', 'server', 'database'].forEach((d) => fs.existsSync(path.join(RAIZ, d)) && recorrer(d));
  return lista.sort();
};
const huella = (rel) => crypto.createHash('sha256')
  .update(fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);

function generarManifiesto() {
  const archivos = Object.fromEntries(ARCHIVOS().map((f) => [f, huella(f)]));
  fs.writeFileSync(MANIFIESTO, `${JSON.stringify({ version: VERSION, archivos }, null, 1)}\n`);
  return Object.keys(archivos).length;
}

function revisarArchivos() {
  if (EN_NUBE || !fs.existsSync(MANIFIESTO)) return { faltan: [], distintos: [], sinManifiesto: true };
  const m = JSON.parse(fs.readFileSync(MANIFIESTO, 'utf8'));
  const faltan = [];
  const distintos = [];
  for (const [f, h] of Object.entries(m.archivos)) {
    if (!fs.existsSync(path.join(RAIZ, f))) faltan.push(f);
    else if (huella(f) !== h) distintos.push(f);
  }
  // app.js declara su versión: si no coincide con package.json, el navegador recibiría una app de otra versión
  try {
    const app = fs.readFileSync(path.join(RAIZ, 'public', 'app.js'), 'utf8');
    if (!app.includes(`VERSION_APP = '${VERSION}'`) && !distintos.includes('public/app.js')) distintos.push('public/app.js');
  } catch { /* ya se reporta como faltante */ }
  return { faltan, distintos, version: m.version };
}

/* Direcciones para abrir Dopta desde esta computadora y desde otros dispositivos de la misma red */
function direcciones(puerto) {
  const red = Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i.address}:${puerto}`);
  return { local: `http://localhost:${puerto}`, red };
}

module.exports = {
  VERSION, EN_NUBE, prepararEnv, prepararBD, crearEsquema, explicarErrorBD,
  generarManifiesto, revisarArchivos, direcciones, verde, amarillo, rojo,
};
