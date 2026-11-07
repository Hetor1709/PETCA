/* Dopta · servidor web y API REST. Inicia con:  npm start */
const arranque = require('./arranque');

arranque.prepararEnv(); // crea .env si falta y carga la configuración antes de conectar a la base
const path = require('path');
const express = require('express');
const { q } = require('./db');
const { ErrorApp, ahora, haceMin, hoy, notificar } = require('./util');
const seg = require('./seguridad');

const app = express();
const PUBLICO = path.join(__dirname, '..', 'public');

app.disable('x-powered-by');
// En Render (y detrás de cualquier proxy HTTPS) la IP y el protocolo reales vienen en cabeceras X-Forwarded-*
app.set('trust proxy', arranque.EN_NUBE || process.env.TRUST_PROXY === '1' ? 1 : false);
app.use(seg.forzarHttps);
app.use(seg.cabeceras);
app.use(seg.bloquearSondeos);

/* ---------- Redirección de las URLs antiguas (páginas sueltas) a las rutas de la app ---------- */
const ANTIGUAS = {
  '/index.html': '/', '/login.html': '/#/login', '/registro.html': '/#/registro', '/cuestionario.html': '/#/cuestionario',
  '/sobre-nosotros.html': '/#/nosotros', '/usuario.html': '/', '/animal.html': '/', '/ficha.html': '/',
  '/refugio.html': '/#/refugio', '/refugio-mascota.html': '/#/refugio/animal/nuevo', '/perfil.html': '/#/cuenta',
  '/ajustes.html': '/#/cuenta', '/404.html': '/#/404', '/500.html': '/#/500',
};
app.get(Object.keys(ANTIGUAS), (req, res) => {
  let destino = ANTIGUAS[req.path];
  const id = Number(req.query.id);
  if (['/animal.html', '/ficha.html'].includes(req.path) && Number.isInteger(id) && id > 0) destino = `/#/animal/${id}`;
  res.redirect(301, destino);
});

/* ---------- Archivos estáticos ---------- */
app.use(express.static(PUBLICO, {
  index: 'index.html',
  dotfiles: 'deny',
  maxAge: seg.PROD ? '7d' : 0,
  setHeaders: (res, ruta) => { if (ruta.endsWith('index.html')) res.set('Cache-Control', 'no-cache'); },
}));

/* ---------- Estado de la base de datos ----------
   Mientras PostgreSQL no esté disponible la API responde 503 con la causa exacta (nunca un 500 genérico). */
const estadoBD = { lista: false, mensaje: 'El servidor se está iniciando. Intente de nuevo en unos segundos.' };
// Códigos de Node y de PostgreSQL que indican que la base no está disponible o su estructura no coincide
const ERRORES_CONEXION = ['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENOTFOUND', 'ECONNRESET', 'EAI_AGAIN',
  'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR', '42P01', '42703', '57P01', '57P03', '53300', '08006', '08001', '08003'];
let reconectando = false;
async function conectarBD() {
  if (reconectando) return;
  reconectando = true;
  let avisado = '';
  // Reintenta cada 5 s hasta que la base esté lista (por ejemplo, si el proyecto de Supabase estaba pausado)
  for (;;) {
    const problema = await arranque.prepararBD();
    if (!problema) break;
    estadoBD.lista = false;
    estadoBD.mensaje = problema;
    if (problema !== avisado) { console.log(arranque.rojo(`[X] ${problema}`)); console.log('    Reintentando cada 5 segundos...'); avisado = problema; }
    await new Promise((r) => setTimeout(r, 5000));
  }
  estadoBD.lista = true;
  reconectando = false;
  console.log(arranque.verde('[✓] Base de datos conectada.'));
}

/* ---------- API ---------- */
const api = express.Router();
api.use((req, res, next) => { res.set('X-Dopta-Version', arranque.VERSION); next(); });
api.get('/version', (req, res) => res.json({ version: arranque.VERSION, bd: estadoBD.lista }));
api.use((req, res, next) => (estadoBD.lista ? next() : res.status(503).json({ error: estadoBD.mensaje, codigo: 'BD' })));
// La foto de perfil llega como imagen (máx. 300 KB ya recortada y comprimida en el navegador); lo demás, JSON
api.put('/cuenta/avatar', express.raw({ type: ['image/webp', 'image/jpeg', 'image/png'], limit: '300kb' }));
api.use(express.json({ limit: '100kb', strict: true }));
api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
api.use(seg.limitador({ ventanaMin: 15, max: 600 }));
api.use(seg.antiCsrf);
api.use(seg.cargarSesion);
/* Para un cron externo (p. ej. cron-job.org) si el servicio gratuito de Render estuvo dormido. Requiere CRON_SECRET. */
api.get('/cron/mantenimiento', async (req, res) => {
  const clave = process.env.CRON_SECRET;
  if (!clave || req.headers.authorization !== `Bearer ${clave}`) return res.status(401).json({ error: 'No autorizado.' });
  await mantenimiento();
  res.json({ ok: true, fecha: ahora() });
});
api.use(require('./lugares').router);
api.use(require('./auth').router);
api.use(require('./animales').router);
api.use(require('./solicitudes').router);
api.use(require('./admin').router);
api.use((req, res) => res.status(404).json({ error: 'Recurso no encontrado.' }));
app.use('/api', api);

/* Cualquier otra ruta desconocida se redirige a la página 404 de la app */
app.use((req, res) => {
  if (req.method === 'GET' && req.accepts('html')) return res.redirect(302, '/#/404');
  res.status(404).type('text').send('No encontrado');
});

/* ---------- Manejo central de errores (sin filtrar detalles internos) ---------- */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof ErrorApp) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  if (err.status === 404 || err.statusCode === 404) return res.status(404).type('text').send('No encontrado');
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'El archivo es demasiado grande.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Solicitud inválida.' });
  if (ERRORES_CONEXION.includes(err.code)) {
    // Se perdió la base o la estructura no coincide: se explica la causa y se intenta reparar en segundo plano
    estadoBD.lista = false;
    estadoBD.mensaje = arranque.explicarErrorBD(err);
    console.log(arranque.rojo(`[X] ${estadoBD.mensaje}`));
    conectarBD();
    return res.status(503).json({ error: estadoBD.mensaje, codigo: 'BD' });
  }
  console.error(`[${ahora()}]`, req.method, req.originalUrl, err);
  res.status(500).json({ error: 'Ocurrió un error inesperado. Intente de nuevo.' });
});

/* ---------- Tareas periódicas ---------- */
async function mantenimiento() {
  try {
    await q('DELETE FROM sesiones WHERE ultima_actividad < ?', [haceMin(30)]);
    await q('DELETE FROM notificaciones WHERE leida = 1 AND leida_en < ?', [haceMin(30 * 24 * 60)]);   // RF-24 CA3
    await q('DELETE FROM recuperacion_intentos WHERE creado_en < ?', [haceMin(24 * 60)]);
    await q('DELETE FROM recuperaciones WHERE expira_en < ?', [haceMin(24 * 60)]);
    // RF-10: elimina los datos personales 30 días después de la baja
    const bajas = await q("SELECT id, tipo FROM usuarios WHERE estado = 'baja' AND purgado = 0 AND purgar_en <= ?", [ahora()]);
    for (const u of bajas) {
      await q("UPDATE usuarios SET nombre = 'Cuenta dada de baja', correo = ?, hash = '!', telefono = NULL, avatar_v = 0, purgado = 1 WHERE id = ?", [`baja-${u.id}@dopta.invalid`, u.id]);
      if (u.tipo === 'refugio') await q("UPDATE refugios SET institucion = 'Datos eliminados', direccion = 'Datos eliminados', calle = NULL, num_ext = NULL, num_int = NULL, colonia = NULL, cp = NULL, telefono = '0000000000', lat = NULL, lng = NULL, place_id = NULL WHERE usuario_id = ?", [u.id]);
      // Mensajes, cuestionarios y foto son datos personales
      await q("UPDATE mensajes SET texto = '[mensaje eliminado]' WHERE autor_id = ?", [u.id]);
      await q('UPDATE solicitudes SET cuestionario = NULL WHERE adoptante_id = ?', [u.id]);
      await q('DELETE FROM avatares WHERE usuario_id = ?', [u.id]);
      await q('DELETE FROM notificaciones WHERE usuario_id = ?', [u.id]);
    }
    // Seguimiento post-adopción: avisa al refugio cuando toca contactar a la familia
    const toca = await q(
      `SELECT sg.id, sg.etapa, a.refugio_id, a.nombre AS animal, s.id AS solicitud_id
         FROM seguimientos sg JOIN solicitudes s ON s.id = sg.solicitud_id JOIN animales a ON a.id = s.animal_id
        WHERE sg.avisado = 0 AND sg.realizado_en IS NULL AND sg.programado <= ?`, [hoy()]);
    for (const x of toca) {
      const etapa = { '1_semana': '1 semana', '1_mes': '1 mes', '3_meses': '3 meses' }[x.etapa];
      await notificar(x.refugio_id, `Toca el seguimiento de ${etapa} de ${x.animal}: contacta a la familia y registra cómo está.`, undefined, `#/refugio/solicitudes?id=${x.solicitud_id}`);
      await q('UPDATE seguimientos SET avisado = 1 WHERE id = ?', [x.id]);
    }
  } catch (e) {
    console.error('Mantenimiento:', e.message);
  }
}

/* ---------- Inicio ---------- */
function iniciar() {
  const PUERTO = Number(process.env.PORT || 3000);
  console.log(`\nDopta ${arranque.VERSION}`);

  // Archivos del proyecto: avisa si alguno es de otra versión o falta
  const rev = arranque.revisarArchivos();
  if (rev.faltan.length) console.log(arranque.rojo(`[X] Faltan archivos: ${rev.faltan.join(', ')}. Vuelve a copiar el proyecto completo.`));
  if (rev.distintos.length) {
    console.log(arranque.amarillo(`[!] Estos archivos no coinciden con la versión ${rev.version}: ${rev.distintos.join(', ')}`));
    console.log(arranque.amarillo('    Si no los editaste tú, vuelve a copiarlos (o descomprime de nuevo el proyecto).'));
  }

  const servidor = app.listen(PUERTO, () => {
    const dir = arranque.direcciones(PUERTO);
    console.log(arranque.verde(`[✓] Dopta en ${dir.local}`));
    if (dir.red.length) console.log(`    Desde otro dispositivo en la misma red: ${dir.red.join('  ·  ')}`);
    if (process.env.ABRIR_NAVEGADOR === '1') abrirNavegador(dir.local);
  });
  servidor.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.log(arranque.rojo(`[X] El puerto ${PUERTO} ya está en uso: probablemente Dopta ya está abierto en otra ventana.`));
      console.log('    Cierra esa ventana (Ctrl + C) o cambia PORT en el archivo .env.');
      process.exit(1);
    }
    throw e;
  });

  conectarBD().then(() => {
    mantenimiento();
    setInterval(() => estadoBD.lista && mantenimiento(), 15 * 60 * 1000).unref();
  });
}

function abrirNavegador(url) {
  const { spawn } = require('child_process');
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref(); } catch { /* sin navegador: se abre a mano */ }
}

if (require.main === module) iniciar();

module.exports = { app, iniciar };
