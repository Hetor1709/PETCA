/* Registro, sesión, recuperación de contraseña, cuenta y notificaciones (RF-01 a RF-10, RF-24). */
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { q, uno, tx } = require('./db');
const {
  h, V, falla, limpiar, ahora, hoy, haceMin, enMin, sumarDias, notificar,
} = require('./util');
const {
  limitador, requiere, crearSesion, cerrarSesion, borrarCookie, sha256,
} = require('./seguridad');
const correo = require('./correo');
const { enCDMX, RE_PLACE } = require('./lugares');

const r = express.Router();
const AVISO_VERSION = 'v1.0';
const COSTO = 12;
const HASH_FALSO = bcrypt.hashSync('contrasena-falsa-0', COSTO); // iguala tiempos si el correo no existe

const PANEL = { adoptante: '#/', refugio: '#/refugio', admin: '#/admin' };

const limiteLogin = limitador({ ventanaMin: 15, max: 10, clave: (req) => `${req.ip}|${String(req.body?.correo || '').toLowerCase()}`, mensaje: 'Demasiados intentos de inicio de sesión. Espere 15 minutos.' });
const limiteRegistro = limitador({ ventanaMin: 60, max: 10, mensaje: 'Demasiados registros desde esta conexión. Intente más tarde.' });

const vacio = (...v) => v.some((x) => typeof x !== 'string' || !x.trim());

/* Datos institucionales del Refugio (RF-04) */
async function validarRefugio(b) {
  const datos = {
    institucion: V.nombreRefugio(b.institucion, 'El nombre de la institución debe tener de 3 a 120 caracteres.'),
    direccion: V.direccion(b.direccion),
    telefono: V.telefono(b.telefono),
    horario: V.horario(b.horario),
    alcaldia_id: null,
    // Coordenadas de Google Places (opcionales): solo se aceptan dentro de la CDMX
    lat: null,
    lng: null,
    place_id: null,
  };
  const lat = Number(b.lat);
  const lng = Number(b.lng);
  if (b.lat != null && b.lng != null && enCDMX(lat, lng)) {
    datos.lat = Math.round(lat * 1e6) / 1e6;
    datos.lng = Math.round(lng * 1e6) / 1e6;
    datos.place_id = RE_PLACE.test(String(b.place_id || '')) ? b.place_id : null;
  }
  if (b.alcaldia_id) {
    const a = await uno("SELECT id FROM catalogo_valores WHERE id = ? AND catalogo = 'alcaldia' AND activo = 1", [V.id(b.alcaldia_id)]);
    if (!a) falla('Seleccione una alcaldía de la lista.');
    datos.alcaldia_id = a.id;
  }
  return datos;
}

async function guardarRefugio(conn, id, d, nuevo) {
  if (nuevo) {
    await q('INSERT INTO refugios (usuario_id, institucion, direccion, telefono, alcaldia_id, lat, lng, place_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, d.institucion, d.direccion, d.telefono, d.alcaldia_id, d.lat, d.lng, d.place_id], conn);
  } else {
    await q('UPDATE refugios SET institucion = ?, direccion = ?, telefono = ?, alcaldia_id = ?, lat = ?, lng = ?, place_id = ? WHERE usuario_id = ?',
      [d.institucion, d.direccion, d.telefono, d.alcaldia_id, d.lat, d.lng, d.place_id, id], conn);
  }
  for (const x of d.horario) {
    await q(`INSERT INTO refugio_horarios (refugio_id, dia, cerrado, abre, cierra) VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE cerrado = VALUES(cerrado), abre = VALUES(abre), cierra = VALUES(cierra)`,
    [id, x.dia, x.cerrado, x.abre, x.cierra], conn);
  }
}

/* ---------- RF-01, RF-02, RF-03, RF-04: registro ---------- */
r.post('/auth/registro', limiteRegistro, h(async (req, res) => {
  const b = req.body || {};
  const tipo = b.tipo === 'refugio' ? 'refugio' : b.tipo === 'adoptante' ? 'adoptante' : null;
  if (!tipo || vacio(b.nombre, b.correo, b.contrasena)) falla('Complete todos los campos obligatorios.');
  if (b.aviso !== true) falla('Debe aceptar el aviso de privacidad para crear una cuenta.');

  const nombre = tipo === 'adoptante' ? V.nombrePersona(b.nombre) : V.nombreRefugio(b.nombre);
  const mail = V.correo(b.correo);
  const pass = V.contrasena(b.contrasena);
  if (typeof b.confirmar === 'string' && b.confirmar !== pass) falla('Las contraseñas no coinciden.');
  const inst = tipo === 'refugio' ? await validarRefugio(b) : null;

  if (await uno('SELECT id FROM usuarios WHERE correo = ?', [mail])) falla('El correo electrónico ya está registrado.', 409);

  const hash = await bcrypt.hash(pass, COSTO);
  const t = ahora();
  await tx(async (c) => {
    const ins = await q(
      `INSERT INTO usuarios (tipo, nombre, correo, hash, estado, aviso_version, aviso_fecha, creado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [tipo, nombre, mail, hash, tipo === 'refugio' ? 'pendiente' : 'activa', AVISO_VERSION, t.slice(0, 16) + ':00', t], c);
    if (inst) await guardarRefugio(c, ins.insertId, inst, true);
  }).catch((e) => {
    if (e.code === 'ER_DUP_ENTRY') falla('El correo electrónico ya está registrado.', 409);
    throw e;
  });

  res.status(201).json({
    mensaje: tipo === 'refugio' ? 'Registro recibido. La cuenta se verificará antes de publicar animales.' : 'Cuenta creada',
  });
}));

/* ---------- RF-25 E1 / CA3: el Refugio rechazado vuelve a enviar todos sus datos ---------- */
r.post('/auth/revalidar', limiteLogin, h(async (req, res) => {
  const b = req.body || {};
  if (vacio(b.correo, b.contrasena, b.nombre)) falla('Complete todos los campos obligatorios.');
  const mail = V.correo(b.correo);
  const u = await uno("SELECT id, hash, estado, tipo FROM usuarios WHERE correo = ?", [mail]);
  const ok = await bcrypt.compare(String(b.contrasena), u ? u.hash : HASH_FALSO);
  if (!u || !ok || u.tipo !== 'refugio' || u.estado !== 'rechazada') falla('Correo o contraseña incorrectos.', 401);
  const nombre = V.nombreRefugio(b.nombre);
  const inst = await validarRefugio(b);
  await tx(async (c) => {
    await q("UPDATE usuarios SET nombre = ?, estado = 'pendiente', creado = ?, rechazado_en = NULL WHERE id = ?", [nombre, ahora(), u.id], c);
    await guardarRefugio(c, u.id, inst, false);
  });
  res.json({ mensaje: 'Registro recibido. La cuenta se verificará antes de publicar animales.' });
}));

/* ---------- RF-05: iniciar sesión ---------- */
r.post('/auth/login', limiteLogin, h(async (req, res) => {
  const b = req.body || {};
  const mail = limpiar(b.correo).toLowerCase();
  const pass = typeof b.contrasena === 'string' ? b.contrasena : '';
  if (!mail || mail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail) || pass.length < 8 || pass.length > 64) {
    falla('Complete los campos con un formato válido.');
  }
  const u = await uno('SELECT id, tipo, nombre, correo, hash, estado FROM usuarios WHERE correo = ?', [mail]);
  const ok = await bcrypt.compare(pass, u ? u.hash : HASH_FALSO);
  if (!u || !ok || u.estado === 'baja' || u.estado === 'eliminada') falla('Correo o contraseña incorrectos.', 401);
  if (u.estado === 'pendiente') falla('Su cuenta está pendiente de verificación.', 403);
  if (u.estado === 'rechazada') falla('Su cuenta no fue verificada. Vuelva a enviar su solicitud de validación.', 403, { codigo: 'RECHAZADA' });

  await cerrarSesion(req, res); // evita fijación de sesión
  res.removeHeader('Set-Cookie');
  await crearSesion(res, u.id, req.ip);
  res.json({ usuario: { id: u.id, tipo: u.tipo, nombre: u.nombre, correo: u.correo }, panel: PANEL[u.tipo] });
}));

/* ---------- RF-06: cerrar sesión ---------- */
r.post('/auth/logout', h(async (req, res) => {
  await cerrarSesion(req, res);
  res.json({ mensaje: 'Sesión cerrada.' });
}));

r.get('/auth/yo', h(async (req, res) => {
  if (!req.usuario) return res.json({ usuario: null, expirada: !!req.sesionExpirada });
  const n = await uno('SELECT COUNT(*) AS n FROM notificaciones WHERE usuario_id = ? AND leida = 0', [req.usuario.id]);
  res.json({ usuario: req.usuario, panel: PANEL[req.usuario.tipo], noLeidas: Number(n.n) });
}));

/* ---------- RF-08: recuperar contraseña ---------- */
r.post('/auth/recuperar', limitador({ ventanaMin: 60, max: 20 }), h(async (req, res) => {
  const mail = V.correo((req.body || {}).correo);
  const n = await uno('SELECT COUNT(*) AS n FROM recuperacion_intentos WHERE correo = ? AND creado_en >= ?', [mail, haceMin(60)]);
  if (Number(n.n) >= 3) falla('Ha alcanzado el límite de 3 solicitudes por hora. Intente más tarde.', 429);
  await q('INSERT INTO recuperacion_intentos (correo, creado_en) VALUES (?, ?)', [mail, ahora()]);

  const u = await uno("SELECT id, nombre FROM usuarios WHERE correo = ? AND estado = 'activa'", [mail]);
  if (u) {
    const token = crypto.randomBytes(32).toString('base64url');
    await q('INSERT INTO recuperaciones (token_hash, usuario_id, expira_en) VALUES (?, ?, ?)', [sha256(token), u.id, enMin(30)]);
    const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '';
    const base = (process.env.BASE_URL || vercel || `${req.protocol}://${req.headers.host}`).replace(/\/$/, '');
    correo.enviarRecuperacion(mail, u.nombre, `${base}/#/restablecer?token=${token}`).catch((e) => console.error('Correo:', e.message));
  }
  // Misma respuesta exista o no la cuenta (CA3)
  res.json({ mensaje: 'Si el correo existe, recibirá un enlace en unos minutos.' });
}));

async function tokenValido(token, conn) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) falla('El enlace no es válido. Solicite uno nuevo.');
  const t = await uno('SELECT token_hash, usuario_id, expira_en, usado_en FROM recuperaciones WHERE token_hash = ?' + (conn ? ' FOR UPDATE' : ''), [sha256(token)], conn);
  if (!t) falla('El enlace no es válido. Solicite uno nuevo.');
  if (t.usado_en) falla('El enlace ya fue utilizado. Solicite uno nuevo.', 410);
  if (t.expira_en < ahora()) falla('El enlace expiró. Solicite uno nuevo.', 410);
  return t;
}

r.post('/auth/recuperar/verificar', h(async (req, res) => {
  await tokenValido((req.body || {}).token);
  res.json({ valido: true });
}));

r.post('/auth/restablecer', limitador({ ventanaMin: 15, max: 20 }), h(async (req, res) => {
  const b = req.body || {};
  const pass = V.contrasena(b.contrasena);
  const hash = await bcrypt.hash(pass, COSTO);
  await tx(async (c) => {
    const t = await tokenValido(b.token, c);
    await q('UPDATE usuarios SET hash = ? WHERE id = ?', [hash, t.usuario_id], c);
    await q('UPDATE recuperaciones SET usado_en = ? WHERE token_hash = ?', [ahora(), t.token_hash], c);
    await q('DELETE FROM sesiones WHERE usuario_id = ?', [t.usuario_id], c);
  });
  res.json({ mensaje: 'Contraseña actualizada. Inicie sesión con su nueva contraseña.' });
}));

/* ---------- Cuenta (RF-07, RF-09, RF-10) ---------- */
r.get('/cuenta', requiere(), h(async (req, res) => {
  const u = await uno('SELECT id, tipo, nombre, correo, creado, aviso_version FROM usuarios WHERE id = ?', [req.usuario.id]);
  if (u.tipo === 'refugio') {
    u.refugio = await uno('SELECT institucion FROM refugios WHERE usuario_id = ?', [u.id]);
  }
  res.json(u);
}));

r.put('/cuenta/nombre', requiere('adoptante', 'refugio'), h(async (req, res) => {
  const b = req.body || {};
  const msg = 'El nombre debe tener de 2 a 100 caracteres, o de 3 a 120 caracteres para una institución.';
  if (req.usuario.tipo === 'adoptante') {
    let n;
    try { n = V.nombrePersona(b.nombre); } catch { falla(msg); }
    await q('UPDATE usuarios SET nombre = ? WHERE id = ?', [n, req.usuario.id]);
  } else {
    const n = V.nombreRefugio(b.nombre, msg);
    const i = V.nombreRefugio(b.institucion, msg);
    await q('UPDATE usuarios SET nombre = ? WHERE id = ?', [n, req.usuario.id]);
    await q('UPDATE refugios SET institucion = ? WHERE usuario_id = ?', [i, req.usuario.id]);
  }
  res.json({ mensaje: 'Datos actualizados.' });
}));

r.put('/cuenta/contrasena', requiere(), limitador({ ventanaMin: 15, max: 10 }), h(async (req, res) => {
  const b = req.body || {};
  const u = await uno('SELECT hash FROM usuarios WHERE id = ?', [req.usuario.id]);
  if (typeof b.actual !== 'string' || !(await bcrypt.compare(b.actual, u.hash))) falla('La contraseña actual es incorrecta.');
  const nueva = V.contrasena(b.nueva);
  await q('UPDATE usuarios SET hash = ? WHERE id = ?', [await bcrypt.hash(nueva, COSTO), req.usuario.id]);
  // Cierra las demás sesiones abiertas con la contraseña anterior
  await q('DELETE FROM sesiones WHERE usuario_id = ? AND token_hash <> ?', [req.usuario.id, req.tokenHash]);
  res.json({ mensaje: 'Contraseña actualizada.' });
}));

r.post('/cuenta/baja', requiere('adoptante', 'refugio'), limitador({ ventanaMin: 15, max: 5 }), h(async (req, res) => {
  const b = req.body || {};
  const u = await uno('SELECT hash FROM usuarios WHERE id = ?', [req.usuario.id]);
  if (typeof b.contrasena !== 'string' || !(await bcrypt.compare(b.contrasena, u.hash))) falla('La contraseña es incorrecta. La cuenta no se da de baja.');
  const t = ahora();
  await tx(async (c) => {
    await q("UPDATE usuarios SET estado = 'baja', baja_en = ?, purgar_en = ? WHERE id = ?",
      [t, `${sumarDias(hoy(), 30)} ${t.slice(11)}`, req.usuario.id], c);
    await retirarActividad(c, req.usuario, 'El adoptante dio de baja su cuenta.', 'El refugio dio de baja su cuenta.');
    await q('DELETE FROM sesiones WHERE usuario_id = ?', [req.usuario.id], c);
  });
  borrarCookie(res);
  res.json({ mensaje: 'Su cuenta fue dada de baja. Sus datos personales se eliminarán en 30 días.' });
}));

/* Al dar de baja o eliminar una cuenta se cierran sus solicitudes pendientes o sus publicaciones */
async function retirarActividad(c, usuario, motivoAdoptante, motivoRefugio) {
  const t = ahora();
  if (usuario.tipo === 'adoptante') {
    await q("UPDATE solicitudes SET estado = 'rechazada', motivo_rechazo = ?, rechazada_en = ? WHERE adoptante_id = ? AND estado = 'pendiente'",
      [motivoAdoptante, t, usuario.id], c);
  } else if (usuario.tipo === 'refugio') {
    const pend = await q(
      `SELECT s.id, s.adoptante_id, a.nombre FROM solicitudes s JOIN animales a ON a.id = s.animal_id
        WHERE a.refugio_id = ? AND s.estado IN ('pendiente','aprobada') AND a.estado = 'disponible'`, [usuario.id], c);
    for (const s of pend) {
      await q("UPDATE solicitudes SET estado = 'rechazada', motivo_rechazo = ?, rechazada_en = ? WHERE id = ?", [motivoRefugio, t, s.id], c);
      await notificar(s.adoptante_id, `Su solicitud para ${s.nombre} fue rechazada: ${motivoRefugio}`, c);
    }
    await q("UPDATE animales SET eliminado = 1, eliminado_por = 'refugio', eliminado_en = ? WHERE refugio_id = ? AND eliminado = 0 AND estado = 'disponible'",
      [t, usuario.id], c);
  }
}

/* ---------- RF-24: notificaciones ---------- */
r.get('/notificaciones', requiere(), h(async (req, res) => {
  const lista = await q(
    'SELECT id, texto, leida, creada_en FROM notificaciones WHERE usuario_id = ? ORDER BY id DESC LIMIT 100', [req.usuario.id]);
  res.json(lista);
}));

r.post('/notificaciones/:id/leida', requiere(), h(async (req, res) => {
  await q('UPDATE notificaciones SET leida = 1, leida_en = ? WHERE id = ? AND usuario_id = ? AND leida = 0',
    [ahora(), V.id(req.params.id), req.usuario.id]);
  res.json({ ok: true });
}));

r.post('/notificaciones/leidas', requiere(), h(async (req, res) => {
  await q('UPDATE notificaciones SET leida = 1, leida_en = ? WHERE usuario_id = ? AND leida = 0', [ahora(), req.usuario.id]);
  res.json({ ok: true });
}));

module.exports = { router: r, validarRefugio, guardarRefugio, retirarActividad, AVISO_VERSION };
