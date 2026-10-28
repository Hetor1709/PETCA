/* Capa de seguridad: cabeceras, límites de peticiones, protección CSRF, sesiones y roles. */
const crypto = require('crypto');
const helmet = require('helmet');
const { q, uno } = require('./db');
const { ahora, haceMin, falla } = require('./util');

const PROD = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
const COOKIE = PROD ? '__Host-dopta_sid' : 'dopta_sid';
const INACTIVIDAD_MIN = 30;

/* ---------- Cabeceras HTTP seguras ---------- */
const cabeceras = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],                                   // sin scripts en línea ni de terceros
      styleSrc: ["'self'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],                              // evita clickjacking
      ...(PROD ? { upgradeInsecureRequests: [] } : {}),
    },
  },
  hsts: PROD ? { maxAge: 31536000, includeSubDomains: true } : false,
  referrerPolicy: { policy: 'same-origin' },
  crossOriginEmbedderPolicy: false,
});

/* Redirige a HTTPS en producción (RNF-03, TLS 1.2+ lo pone el hosting o el proxy) */
const forzarHttps = (req, res, next) => {
  if (PROD && req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'] !== 'https') {
    return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  }
  next();
};

/* ---------- Límite de peticiones en memoria ---------- */
function limitador({ ventanaMin, max, clave = (req) => req.ip, mensaje = 'Demasiadas solicitudes. Intente más tarde.' }) {
  const mapa = new Map();
  setInterval(() => {
    const t = Date.now();
    for (const [k, v] of mapa) if (v.reinicia < t) mapa.delete(k);
  }, 60000).unref();
  return (req, res, next) => {
    const k = clave(req);
    const t = Date.now();
    let e = mapa.get(k);
    if (!e || e.reinicia < t) { e = { n: 0, reinicia: t + ventanaMin * 60000 }; mapa.set(k, e); }
    e.n += 1;
    if (e.n > max) {
      res.set('Retry-After', String(Math.ceil((e.reinicia - t) / 1000)));
      return res.status(429).json({ error: mensaje });
    }
    next();
  };
}

/* ---------- CSRF ----------
   Toda petición que cambia datos debe traer la cabecera X-Dopta (un sitio ajeno no puede
   enviarla sin permiso CORS, que nunca se concede) y, si trae Origin, debe ser este mismo sitio. */
const antiCsrf = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origen = req.headers.origin;
  const propio = `${req.protocol}://${req.headers.host}`;
  const permitido = process.env.BASE_URL ? process.env.BASE_URL.replace(/\/$/, '') : propio;
  if (req.headers['x-dopta'] !== '1' || (origen && origen !== permitido && origen !== propio)) {
    return res.status(403).json({ error: 'Solicitud no permitida.' });
  }
  next();
};

/* ---------- Sesiones ---------- */
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

const leerCookie = (req) => {
  const raw = req.headers.cookie || '';
  for (const parte of raw.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
};

const opcionesCookie = () => [
  'Path=/', 'HttpOnly', 'SameSite=Strict', ...(PROD ? ['Secure'] : []),
];

async function crearSesion(res, usuarioId, ip) {
  const token = crypto.randomBytes(32).toString('base64url');
  const t = ahora();
  await q('INSERT INTO sesiones (token_hash, usuario_id, creada_en, ultima_actividad, ip) VALUES (?, ?, ?, ?, ?)',
    [sha256(token), usuarioId, t, t, String(ip || '').slice(0, 45)]);
  res.append('Set-Cookie', [`${COOKIE}=${token}`, ...opcionesCookie()].join('; '));
}

const borrarCookie = (res) => res.append('Set-Cookie', [`${COOKIE}=`, 'Max-Age=0', ...opcionesCookie()].join('; '));

async function cerrarSesion(req, res) {
  const token = leerCookie(req);
  if (token) await q('DELETE FROM sesiones WHERE token_hash = ?', [sha256(token)]);
  borrarCookie(res);
}

/* Carga el usuario de la cookie. Cierra la sesión tras 30 minutos sin actividad (RF-06). */
async function cargarSesion(req, res, next) {
  try {
    req.usuario = null;
    const token = leerCookie(req);
    if (!token || token.length > 100) return next();
    const th = sha256(token);
    const s = await uno(
      `SELECT s.ultima_actividad, u.id, u.tipo, u.nombre, u.correo, u.estado
         FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token_hash = ?`, [th]);
    if (!s) { borrarCookie(res); return next(); }
    if (s.estado !== 'activa') {
      await q('DELETE FROM sesiones WHERE usuario_id = ?', [s.id]);
      borrarCookie(res);
      return next();
    }
    if (s.ultima_actividad < haceMin(INACTIVIDAD_MIN)) {
      await q('DELETE FROM sesiones WHERE token_hash = ?', [th]);
      borrarCookie(res);
      req.sesionExpirada = true;
      return next();
    }
    // Las consultas automáticas (notificaciones) no cuentan como actividad del usuario
    if (req.headers['x-dopta-auto'] !== '1' && s.ultima_actividad < haceMin(0.5)) {
      await q('UPDATE sesiones SET ultima_actividad = ? WHERE token_hash = ?', [ahora(), th]);
    }
    req.usuario = { id: s.id, tipo: s.tipo, nombre: s.nombre, correo: s.correo };
    req.tokenHash = th;
    next();
  } catch (e) { next(e); }
}

/* Exige sesión y, opcionalmente, uno de los roles indicados */
const requiere = (...tipos) => (req, res, next) => {
  if (!req.usuario) {
    return res.status(401).json({
      error: req.sesionExpirada ? 'Su sesión terminó por inactividad. Inicie sesión de nuevo.' : 'Inicie sesión para continuar.',
      codigo: 'SESION',
    });
  }
  if (tipos.length && !tipos.includes(req.usuario.tipo)) {
    return res.status(403).json({ error: 'No tiene permiso para realizar esta acción.' });
  }
  next();
};

/* Rutas típicas de escaneos automáticos: se responden con 404 sin dar información */
const RE_SONDEO = /(\.\.|\/\.|\.(php|asp|aspx|jsp|cgi|env|git|sql|bak|ini|log)(\/|$)|wp-|phpmyadmin|\/server\/|\/database\/|node_modules)/i;
const bloquearSondeos = (req, res, next) => {
  let ruta;
  try { ruta = decodeURIComponent(req.path); } catch { return res.status(400).end(); }
  if (RE_SONDEO.test(ruta)) return res.status(404).type('text').send('No encontrado');
  next();
};

module.exports = {
  PROD, cabeceras, forzarHttps, limitador, antiCsrf, cargarSesion, requiere,
  crearSesion, cerrarSesion, borrarCookie, sha256, bloquearSondeos, falla,
};
