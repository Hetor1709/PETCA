/* Conexión a PostgreSQL (Supabase u otro) con consultas parametrizadas: nunca se concatenan valores del usuario en SQL.
   Las consultas del proyecto usan "?" como marcador; aquí se traducen a $1, $2… de PostgreSQL. */
const { Pool, types } = require('pg');

const EN_RENDER = !!process.env.RENDER;

/* Fechas y horas como texto, igual que antes ('AAAA-MM-DD' y 'AAAA-MM-DD HH:MM:SS', hora de la CDMX que calcula el servidor) */
types.setTypeParser(1082, (v) => v); // date
types.setTypeParser(1114, (v) => v.slice(0, 19)); // timestamp sin zona
types.setTypeParser(20, (v) => Number(v)); // bigint (COUNT, SUM) como número

/* Configuración: DATABASE_URL (postgresql://usuario:clave@host:puerto/base) o las variables DB_* */
function config() {
  const url = process.env.DATABASE_URL;
  const c = url
    ? { connectionString: url }
    : {
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 5432),
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'postgres',
    };
  const host = url ? (() => { try { return new URL(url).hostname; } catch { return ''; } })() : c.host;
  // En la nube la conexión va cifrada (TLS). Supabase usa certificados propios: se cifra sin validar la cadena salvo que se indique DB_SSL_CA.
  const ssl = process.env.DB_SSL ? process.env.DB_SSL === 'true' : /supabase\.(co|com)$|pooler\.supabase|render\.com$|neon\.tech$/.test(host);
  if (ssl) c.ssl = process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA.replace(/\\n/g, '\n'), rejectUnauthorized: true } : { rejectUnauthorized: false };
  return { ...c, host_mostrar: host };
}

const { host_mostrar: HOST, ...cfg } = config();
const pool = new Pool({
  ...cfg,
  max: EN_RENDER ? 5 : 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  application_name: 'dopta',
});
pool.on('error', (e) => console.error('[BD] conexión inactiva cerrada:', e.message));

/* "?" → $n (ignora los signos dentro de cadenas entre comillas simples) */
const cache = new Map();
function traducir(sql) {
  let t = cache.get(sql);
  if (t) return t;
  let n = 0;
  let enCadena = false;
  t = '';
  for (const ch of sql) {
    if (ch === "'") enCadena = !enCadena;
    t += !enCadena && ch === '?' ? `$${++n}` : ch;
  }
  cache.set(sql, t);
  return t;
}

/* Códigos de error con los nombres que ya usaba el proyecto */
const CODIGOS = { 23505: 'ER_DUP_ENTRY', 23503: 'ER_NO_REFERENCED_ROW', '3D000': 'ER_BAD_DB_ERROR', '28P01': 'ER_ACCESS_DENIED_ERROR', 28000: 'ER_ACCESS_DENIED_ERROR' };

/* Ejecuta y devuelve las filas. filas.insertId = id de la fila insertada (con RETURNING id); filas.affectedRows = filas afectadas */
async function q(sql, params = [], conn = pool) {
  try {
    const r = await conn.query(traducir(sql), params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v)));
    const filas = r.rows;
    filas.affectedRows = r.rowCount;
    if (r.command === 'INSERT' && filas[0] && 'id' in filas[0]) filas.insertId = filas[0].id;
    return filas;
  } catch (e) {
    if (CODIGOS[e.code]) { e.codigoPg = e.code; e.code = CODIGOS[e.code]; }
    throw e;
  }
}
const uno = async (sql, params = [], conn = pool) => (await q(sql, params, conn))[0] || null;

/* Ejecuta fn dentro de una transacción; hace rollback si algo falla */
async function tx(fn) {
  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    const r = await fn(conn);
    await conn.query('COMMIT');
    return r;
  } catch (e) {
    await conn.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

const descripcion = () => `${HOST || 'local'}${cfg.ssl ? ' (TLS)' : ''}`;

module.exports = { pool, q, uno, tx, config, descripcion, EN_RENDER };
