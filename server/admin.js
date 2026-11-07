/* Administración (RF-25 a RF-32, RF-34, RF-36, RF-37).
   - Administrador (único): todo.
   - Funcionario (cuenta subida de nivel por el Administrador): reportes y estadísticas. */
const express = require('express');
const { q, uno, tx } = require('./db');
const {
  h, V, falla, limpiar, ahora, haceMin, periodo, notificar, diasEntre, sumarDias, sinAcentos,
} = require('./util');
const { requiere } = require('./seguridad');
const { horario } = require('./animales');
const { retirarActividad } = require('./auth');
const { MOTIVOS } = require('./solicitudes');
const { decidirCambio, ETIQUETAS } = require('./cambios');

const r = express.Router();
r.use('/admin', requiere('admin', 'funcionario'));
const soloAdmin = requiere('admin');
const POR_PAGINA = 20;
const lim = (p) => `LIMIT ${POR_PAGINA} OFFSET ${(p - 1) * POR_PAGINA}`;
const patron = (t) => `%${sinAcentos(t).replace(/[%_\\]/g, '\\$&')}%`;

/* Búsqueda en Google Maps con los datos que dio el refugio (para comprobar que existe antes de validarlo) */
function mapa(x) {
  const texto = [x.institucion || x.nombre, x.direccion, x.alcaldia, 'Ciudad de México'].filter(Boolean).join(', ');
  const base = 'https://www.google.com/maps/search/?api=1';
  const ver = `${base}&query=${encodeURIComponent(texto)}${x.place_id ? `&query_place_id=${encodeURIComponent(x.place_id)}` : ''}`;
  const llave = process.env.GOOGLE_MAPS_EMBED_KEY; // key pública restringida por dominio (Maps Embed API, sin costo)
  return {
    consulta: texto,
    url: ver,
    soloDireccion: `${base}&query=${encodeURIComponent([x.direccion, 'Ciudad de México'].filter(Boolean).join(', '))}`,
    embed: llave ? `https://www.google.com/maps/embed/v1/${x.place_id ? `place?q=place_id:${encodeURIComponent(x.place_id)}` : `search?q=${encodeURIComponent(texto)}`}&key=${encodeURIComponent(llave)}&language=es` : null,
  };
}

/* ---------- Resumen del panel ---------- */
r.get('/admin/resumen', h(async (req, res) => {
  const admin = req.usuario.tipo === 'admin';
  const [pend, rep, err, cam] = await Promise.all([
    admin ? uno("SELECT COUNT(*) AS n FROM usuarios WHERE tipo = 'refugio' AND estado = 'pendiente'") : { n: 0 },
    uno("SELECT COUNT(*) AS n FROM reportes WHERE estado = 'abierto'"),
    admin ? q('SELECT id, texto, creado_en FROM errores_notificacion WHERE revisado = 0 ORDER BY id DESC LIMIT 20') : [],
    admin ? uno("SELECT COUNT(*) AS n FROM refugio_cambios WHERE estado = 'pendiente'") : { n: 0 },
  ]);
  res.json({ rol: req.usuario.tipo, refugiosPendientes: Number(pend.n), reportesAbiertos: Number(rep.n), cambiosPendientes: Number(cam.n), erroresNotificacion: err });
}));

r.post('/admin/errores-notificacion/revisados', soloAdmin, h(async (req, res) => {
  await q('UPDATE errores_notificacion SET revisado = 1 WHERE revisado = 0');
  res.json({ ok: true });
}));

/* ---------- RF-25: verificar refugios (con la búsqueda de Maps lista para revisar) ---------- */
r.get('/admin/refugios-pendientes', soloAdmin, h(async (req, res) => {
  const lista = await q(
    `SELECT u.id, u.nombre, u.correo, u.creado, u.aviso_version, u.aviso_fecha, rf.institucion, rf.direccion, rf.telefono,
            rf.calle, rf.num_ext, rf.num_int, rf.colonia, rf.cp, rf.lat, rf.lng, rf.place_id,
            al.nombre AS alcaldia, u.creado < ? AS plazo_vencido
       FROM usuarios u JOIN refugios rf ON rf.usuario_id = u.id LEFT JOIN catalogo_valores al ON al.id = rf.alcaldia_id
      WHERE u.tipo = 'refugio' AND u.estado = 'pendiente' ORDER BY u.creado`, [haceMin(3 * 24 * 60)]);
  for (const x of lista) {
    x.plazo_vencido = !!x.plazo_vencido;
    x.horario = await horario(x.id);
    x.mapa = mapa(x);
    // Otras cuentas con el mismo teléfono o dirección (posible duplicado)
    x.coincidencias = await q(
      `SELECT u.id, u.nombre, u.estado FROM usuarios u JOIN refugios rf ON rf.usuario_id = u.id
        WHERE u.id <> ? AND (rf.telefono = ? OR (rf.cp = ? AND sin_acentos(rf.calle) = sin_acentos(?) AND rf.num_ext = ?)) LIMIT 5`,
      [x.id, x.telefono, x.cp, x.calle, x.num_ext]);
  }
  res.json(lista);
}));

async function decidirRefugio(req, aceptar) {
  const id = V.id(req.params.id);
  const motivo = aceptar ? null : V.motivo(req.body && req.body.motivo, 10, 300, 'Indique el motivo del rechazo (10 a 300 caracteres).');
  await tx(async (c) => {
    const u = await uno("SELECT id, estado FROM usuarios WHERE id = ? AND tipo = 'refugio' FOR UPDATE", [id], c);
    if (!u) falla('La cuenta no existe.', 404);
    if (u.estado !== 'pendiente') falla('La cuenta ya no está pendiente de verificación.', 409);
    if (aceptar) {
      await q("UPDATE usuarios SET estado = 'activa', verificado_en = ? WHERE id = ?", [ahora(), id], c);
      await notificar(id, '¡Tu refugio fue verificado! Ya puedes publicar animales en adopción.', c, '#/refugio');
    } else {
      await q("UPDATE usuarios SET estado = 'rechazada', rechazado_en = ?, eliminado_motivo = ? WHERE id = ?", [ahora(), motivo, id], c);
    }
  });
}
r.post('/admin/refugios/:id/aceptar', soloAdmin, h(async (req, res) => { await decidirRefugio(req, true); res.json({ mensaje: 'Cuenta verificada.' }); }));
r.post('/admin/refugios/:id/rechazar', soloAdmin, h(async (req, res) => { await decidirRefugio(req, false); res.json({ mensaje: 'Cuenta rechazada.' }); }));

/* ---------- Refugios: tabla con sus datos e indicadores ---------- */
r.get('/admin/refugios', soloAdmin, h(async (req, res) => {
  const where = ["u.tipo = 'refugio'", 'u.purgado = 0'];
  const params = [];
  const texto = limpiar(req.query.q).slice(0, 60);
  if (texto) { where.push('(sin_acentos(u.nombre) LIKE ? OR sin_acentos(rf.institucion) LIKE ? OR sin_acentos(u.correo) LIKE ? OR rf.telefono LIKE ?)'); params.push(patron(texto), patron(texto), patron(texto), `%${texto.replace(/\D/g, '') || '¬'}%`); }
  if (['activa', 'pendiente', 'rechazada', 'baja', 'eliminada'].includes(req.query.estado)) { where.push('u.estado = ?'); params.push(req.query.estado); }
  if (req.query.alcaldia) { where.push('rf.alcaldia_id = ?'); params.push(V.id(req.query.alcaldia)); }
  const ORDEN = { nombre: 'u.nombre', recientes: 'u.creado DESC', adopciones: 'adoptados DESC, u.nombre', reportes: 'reportes DESC, u.nombre' };
  const lista = await q(
    `SELECT u.id, u.nombre, u.correo, u.estado, LEFT(u.creado, 10) AS creado, LEFT(u.verificado_en, 10) AS verificado, u.avatar_v,
            rf.institucion, rf.direccion, rf.telefono, rf.place_id, al.nombre AS alcaldia,
            (SELECT COUNT(*) FROM animales a WHERE a.refugio_id = u.id AND a.eliminado = 0 AND a.estado = 'disponible') AS disponibles,
            (SELECT COUNT(*) FROM animales a WHERE a.refugio_id = u.id AND a.estado = 'adoptado') AS adoptados,
            (SELECT COUNT(*) FROM solicitudes s JOIN animales a ON a.id = s.animal_id WHERE a.refugio_id = u.id AND s.estado IN ('pendiente','aprobada') AND s.concretada_en IS NULL) AS activas,
            (SELECT COUNT(*) FROM reportes rp WHERE rp.objetivo_tipo = 'refugio' AND rp.objetivo_id = u.id AND rp.estado = 'abierto') AS reportes,
            (SELECT COUNT(*) FROM refugio_cambios rc WHERE rc.refugio_id = u.id AND rc.estado = 'pendiente') AS cambios
       FROM usuarios u JOIN refugios rf ON rf.usuario_id = u.id LEFT JOIN catalogo_valores al ON al.id = rf.alcaldia_id
      WHERE ${where.join(' AND ')} ORDER BY ${ORDEN[req.query.orden] || ORDEN.nombre} LIMIT 200`, params);
  res.json(lista.map((x) => ({ ...x, mapa: mapa(x) })));
}));

r.get('/admin/refugios/:id', soloAdmin, h(async (req, res) => {
  const id = V.id(req.params.id);
  const x = await uno(
    `SELECT u.id, u.nombre, u.correo, u.estado, u.creado, u.verificado_en, u.eliminado_motivo, u.avatar_v,
            rf.institucion, rf.direccion, rf.calle, rf.num_ext, rf.num_int, rf.colonia, rf.cp, rf.telefono, rf.lat, rf.lng, rf.place_id, al.nombre AS alcaldia
       FROM usuarios u JOIN refugios rf ON rf.usuario_id = u.id LEFT JOIN catalogo_valores al ON al.id = rf.alcaldia_id WHERE u.id = ?`, [id]);
  if (!x) falla('El refugio no existe.', 404);
  x.horario = await horario(id);
  x.mapa = mapa(x);
  x.animales = await q(
    `SELECT a.id, a.nombre, a.estado, a.eliminado, LEFT(a.publicado_en, 10) AS publicado, a.adoptado_en,
            (SELECT COUNT(*) FROM solicitudes s WHERE s.animal_id = a.id) AS solicitudes
       FROM animales a WHERE a.refugio_id = ? ORDER BY a.publicado_en DESC LIMIT 100`, [id]);
  x.reportes = await q("SELECT id, motivo, descripcion, estado, LEFT(creado_en, 10) AS creado FROM reportes WHERE objetivo_tipo = 'refugio' AND objetivo_id = ? ORDER BY id DESC LIMIT 20", [id]);
  x.cambios = await q('SELECT id, datos, anteriores, estado, motivo, LEFT(creado_en, 16) AS creado FROM refugio_cambios WHERE refugio_id = ? ORDER BY id DESC LIMIT 10', [id]);
  const tiempos = await uno("SELECT AVG(adoptado_en - fecha_ingreso) AS dias FROM animales WHERE refugio_id = ? AND estado = 'adoptado'", [id]);
  x.dias_promedio_adopcion = tiempos.dias == null ? null : Math.round(Number(tiempos.dias));
  res.json(x);
}));

/* ---------- Cambios de datos de refugios esperando aprobación ---------- */
r.get('/admin/refugio-cambios', soloAdmin, h(async (req, res) => {
  const lista = await q(
    `SELECT rc.id, rc.refugio_id, rc.datos, rc.anteriores, LEFT(rc.creado_en, 16) AS creado, u.nombre, u.correo, rf.institucion, rf.direccion,
            rf.place_id, al.nombre AS alcaldia
       FROM refugio_cambios rc JOIN usuarios u ON u.id = rc.refugio_id JOIN refugios rf ON rf.usuario_id = u.id
       LEFT JOIN catalogo_valores al ON al.id = rf.alcaldia_id
      WHERE rc.estado = 'pendiente' ORDER BY rc.creado_en`);
  const alcaldias = Object.fromEntries((await q("SELECT id, nombre FROM catalogo_valores WHERE catalogo = 'alcaldia'")).map((a) => [a.id, a.nombre]));
  res.json(lista.map((x) => ({
    ...x,
    etiquetas: ETIQUETAS,
    mapa_actual: mapa(x),
    mapa_nuevo: mapa({ institucion: x.datos.institucion || x.institucion, direccion: x.datos.direccion || x.direccion, alcaldia: alcaldias[x.datos.alcaldia_id] || x.alcaldia, place_id: x.datos.place_id }),
  })));
}));
r.post('/admin/refugio-cambios/:id/aprobar', soloAdmin, h(async (req, res) => { await decidirCambio(req, true); res.json({ mensaje: 'Cambio aprobado y aplicado.' }); }));
r.post('/admin/refugio-cambios/:id/rechazar', soloAdmin, h(async (req, res) => {
  req.body = { ...(req.body || {}), motivo: V.motivo(req.body && req.body.motivo, 10, 300, 'Indique el motivo (10 a 300 caracteres).') };
  await decidirCambio(req, false);
  res.json({ mensaje: 'Cambio rechazado. Se avisó al refugio.' });
}));

/* ---------- RF-26 / RF-27: publicaciones ---------- */
r.get('/admin/publicaciones', soloAdmin, h(async (req, res) => {
  const p = V.pagina(req.query.pagina);
  const total = await uno('SELECT COUNT(*) AS n FROM animales WHERE eliminado = 0');
  const lista = await q(
    `SELECT a.id, a.nombre, a.raza, a.raza_aprox, a.estado, LEFT(a.publicado_en, 16) AS publicado, u.nombre AS refugio
       FROM animales a JOIN usuarios u ON u.id = a.refugio_id
      WHERE a.eliminado = 0 ORDER BY a.publicado_en DESC, a.id DESC ${lim(p)}`);
  res.json({ total: Number(total.n), pagina: p, porPagina: POR_PAGINA, publicaciones: lista });
}));

r.post('/admin/publicaciones/:id/eliminar', soloAdmin, h(async (req, res) => {
  const id = V.id(req.params.id);
  const b = req.body || {};
  if (!MOTIVOS.animal.includes(b.motivo)) falla('Seleccione un motivo.');
  const desc = b.motivo === 'Otro' ? V.motivo(b.descripcion, 10, 300, 'La descripción debe tener de 10 a 300 caracteres.') : null;
  await tx(async (c) => {
    const a = await uno('SELECT id, nombre, refugio_id, eliminado FROM animales WHERE id = ? FOR UPDATE', [id], c);
    if (!a || a.eliminado) falla('La publicación no existe.', 404);
    const t = ahora();
    await q("UPDATE animales SET eliminado = 1, eliminado_por = 'admin', eliminado_motivo = ?, eliminado_desc = ?, eliminado_en = ? WHERE id = ?",
      [b.motivo, desc, t, id], c);
    const activas = await q("SELECT id, adoptante_id FROM solicitudes WHERE animal_id = ? AND estado IN ('pendiente','aprobada') AND concretada_en IS NULL", [id], c);
    for (const s of activas) {
      await q("UPDATE solicitudes SET estado = 'cancelada', motivo_rechazo = 'La publicación fue retirada por moderación.', rechazada_en = ? WHERE id = ?", [t, s.id], c);
      await notificar(s.adoptante_id, `Tu solicitud para ${a.nombre} se cerró porque la publicación fue retirada por moderación.`, c, `#/solicitudes?id=${s.id}`);
    }
    await notificar(a.refugio_id, `Tu publicación de ${a.nombre} fue eliminada por moderación. Motivo: ${b.motivo}${desc ? ` (${desc})` : ''}.`, c, '#/refugio');
  });
  res.json({ mensaje: 'Publicación eliminada.' });
}));

/* ---------- RF-28 / RF-32: cuentas ---------- */
r.get('/admin/cuentas', soloAdmin, h(async (req, res) => {
  const p = V.pagina(req.query.pagina);
  const where = ['purgado = 0'];
  const params = [];
  const texto = limpiar(req.query.q).slice(0, 60);
  if (texto) { where.push('(sin_acentos(nombre) LIKE ? OR sin_acentos(correo) LIKE ?)'); params.push(patron(texto), patron(texto)); }
  if (['adoptante', 'refugio', 'admin', 'funcionario'].includes(req.query.tipo)) { where.push('tipo = ?'); params.push(req.query.tipo); }
  const total = await uno(`SELECT COUNT(*) AS n FROM usuarios WHERE ${where.join(' AND ')}`, params);
  const lista = await q(`SELECT id, tipo, nombre, correo, telefono, estado, LEFT(creado, 10) AS creado, avatar_v FROM usuarios WHERE ${where.join(' AND ')} ORDER BY id DESC ${lim(p)}`, params);
  res.json({ total: Number(total.n), pagina: p, porPagina: POR_PAGINA, cuentas: lista });
}));

r.post('/admin/cuentas/:id/eliminar', soloAdmin, h(async (req, res) => {
  const id = V.id(req.params.id);
  const motivo = V.motivo(req.body && req.body.motivo);
  await tx(async (c) => {
    const u = await uno('SELECT id, tipo, estado FROM usuarios WHERE id = ? FOR UPDATE', [id], c);
    if (!u) falla('La cuenta no existe.', 404);
    if (u.tipo === 'admin') falla('No es posible eliminar la cuenta del Administrador.', 403);
    if (u.estado === 'eliminada') falla('La cuenta ya está eliminada.', 409);
    await q("UPDATE usuarios SET estado = 'eliminada', eliminado_motivo = ?, eliminado_en = ? WHERE id = ?", [motivo, ahora(), id], c);
    await retirarActividad(c, u, 'La cuenta del adoptante fue eliminada.', 'La cuenta del refugio fue eliminada.');
    await q('DELETE FROM sesiones WHERE usuario_id = ?', [id], c);
  });
  res.json({ mensaje: 'Cuenta eliminada.' });
}));

/* Solo existe UN Administrador (índice único en la base). Las cuentas de adoptante se pueden subir a Funcionario. */
r.post('/admin/cuentas/:id/admin', soloAdmin, (req, res) => res.status(403).json({ error: 'Solo puede haber un Administrador. Puedes subir la cuenta a Funcionario.' }));

r.post('/admin/cuentas/:id/funcionario', soloAdmin, h(async (req, res) => {
  const id = V.id(req.params.id);
  const u = await uno('SELECT id, tipo, estado, nombre FROM usuarios WHERE id = ?', [id]);
  if (!u) falla('La cuenta no existe.', 404);
  if (u.tipo === 'funcionario') falla('La cuenta ya es de Funcionario.', 409);
  if (u.tipo !== 'adoptante' || u.estado !== 'activa') falla('Solo una cuenta de Adoptante activa puede subir a Funcionario.', 409);
  const activas = await uno("SELECT COUNT(*) AS n FROM solicitudes WHERE adoptante_id = ? AND estado IN ('pendiente','aprobada') AND concretada_en IS NULL", [id]);
  if (Number(activas.n)) falla('La cuenta tiene solicitudes de adopción activas. Deben cerrarse antes de subirla a Funcionario.', 409);
  await q("UPDATE usuarios SET tipo = 'funcionario' WHERE id = ?", [id]);
  await q('DELETE FROM sesiones WHERE usuario_id = ?', [id]); // el nuevo panel se abre en su siguiente inicio de sesión
  await notificar(id, 'Tu cuenta ahora es de Funcionario: puedes atender reportes y ver estadísticas.', undefined, '#/admin');
  res.json({ mensaje: `${u.nombre} ahora es Funcionario.` });
}));

r.post('/admin/cuentas/:id/quitar-funcionario', soloAdmin, h(async (req, res) => {
  const id = V.id(req.params.id);
  const u = await uno('SELECT id, tipo FROM usuarios WHERE id = ?', [id]);
  if (!u || u.tipo !== 'funcionario') falla('La cuenta no es de Funcionario.', 409);
  await q("UPDATE usuarios SET tipo = 'adoptante' WHERE id = ?", [id]);
  await q('DELETE FROM sesiones WHERE usuario_id = ?', [id]);
  res.json({ mensaje: 'La cuenta volvió a ser de Adoptante.' });
}));

/* ---------- RF-29 a RF-31: catálogos ---------- */
const EDITABLES = ['tamano', 'edad', 'tipo_requisito', 'vacuna', 'documento'];
const nombreValor = (v) => {
  const n = limpiar(v).replace(/\s+/g, ' ');
  if (!n || [...n].length > 50) falla('El nombre del valor debe tener de 1 a 50 caracteres.');
  return n;
};
const duplicado = (e) => { if (e.code === 'ER_DUP_ENTRY') falla('Ya existe un valor con el mismo nombre en el catálogo.', 409); throw e; };

r.post('/admin/catalogos', soloAdmin, h(async (req, res) => {
  const b = req.body || {};
  if (!EDITABLES.includes(b.catalogo)) falla('Seleccione un catálogo.');
  const n = nombreValor(b.nombre);
  const orden = await uno('SELECT COALESCE(MAX(orden), 0) + 1 AS o FROM catalogo_valores WHERE catalogo = ?', [b.catalogo]);
  await q('INSERT INTO catalogo_valores (catalogo, nombre, orden) VALUES (?, ?, ?)', [b.catalogo, n, orden.o]).catch(duplicado);
  res.status(201).json({ mensaje: 'Valor agregado.' });
}));

async function valor(id) {
  const v = await uno('SELECT id, catalogo, activo FROM catalogo_valores WHERE id = ?', [V.id(id)]);
  if (!v || !EDITABLES.includes(v.catalogo)) falla('El valor no existe.', 404);
  return v;
}

r.put('/admin/catalogos/:id', soloAdmin, h(async (req, res) => {
  const v = await valor(req.params.id);
  const n = nombreValor(req.body && req.body.nombre);
  await q('UPDATE catalogo_valores SET nombre = ? WHERE id = ?', [n, v.id]).catch(duplicado);
  res.json({ mensaje: 'Valor renombrado.' });
}));

r.post('/admin/catalogos/:id/desactivar', soloAdmin, h(async (req, res) => {
  const v = await valor(req.params.id);
  if (!v.activo) falla('El valor ya está desactivado.', 409);
  await q('UPDATE catalogo_valores SET activo = 0 WHERE id = ?', [v.id]);
  res.json({ mensaje: 'Valor desactivado.' });
}));

r.post('/admin/catalogos/:id/activar', soloAdmin, h(async (req, res) => {
  const v = await valor(req.params.id);
  if (v.activo) falla('El valor ya está activo.', 409);
  await q('UPDATE catalogo_valores SET activo = 1 WHERE id = ?', [v.id]);
  res.json({ mensaje: 'Valor activado.' });
}));

/* ---------- RF-34: reportes (Administrador y Funcionarios) ---------- */
r.get('/admin/reportes', h(async (req, res) => {
  const p = V.pagina(req.query.pagina);
  const estado = ['abierto', 'resuelto', 'descartado'].includes(req.query.estado) ? req.query.estado : 'abierto';
  const total = await uno('SELECT COUNT(*) AS n FROM reportes WHERE estado = ?', [estado]);
  const lista = await q(
    `SELECT r.id, r.objetivo_tipo, r.objetivo_id, r.motivo, r.descripcion, r.estado, r.nota, LEFT(r.creado_en, 16) AS creado, LEFT(r.cerrado_en, 16) AS cerrado,
            u.nombre AS autor, u.correo AS autor_correo, u.tipo AS autor_tipo, ad.nombre AS atendio,
            CASE WHEN r.objetivo_tipo = 'animal' THEN (SELECT CONCAT(a.nombre, ' · ', ru.nombre) FROM animales a JOIN usuarios ru ON ru.id = a.refugio_id WHERE a.id = r.objetivo_id)
                 ELSE (SELECT nombre FROM usuarios WHERE id = r.objetivo_id) END AS objetivo,
            (SELECT COUNT(*) FROM reportes r2 WHERE r2.objetivo_tipo = r.objetivo_tipo AND r2.objetivo_id = r.objetivo_id) AS veces_reportado
       FROM reportes r JOIN usuarios u ON u.id = r.autor_id LEFT JOIN usuarios ad ON ad.id = r.admin_id
      WHERE r.estado = ? ORDER BY r.creado_en DESC ${lim(p)}`, [estado]);
  const cuentas = await q('SELECT estado, COUNT(*) AS n FROM reportes GROUP BY estado');
  res.json({ total: Number(total.n), pagina: p, porPagina: POR_PAGINA, reportes: lista, cuentas: Object.fromEntries(cuentas.map((x) => [x.estado, Number(x.n)])) });
}));

async function cerrarReporte(req, estado) {
  const nota = V.motivo(req.body && req.body.nota, 10, 300, 'La nota debe tener de 10 a 300 caracteres.');
  await tx(async (c) => {
    const rep = await uno('SELECT id, autor_id, estado FROM reportes WHERE id = ? FOR UPDATE', [V.id(req.params.id)], c);
    if (!rep) falla('El reporte no existe.', 404);
    if (rep.estado !== 'abierto') falla('El reporte ya está resuelto o descartado.', 409);
    await q('UPDATE reportes SET estado = ?, nota = ?, admin_id = ?, cerrado_en = ? WHERE id = ?', [estado, nota, req.usuario.id, ahora(), rep.id], c);
    await notificar(rep.autor_id, `Tu reporte fue ${estado}. Nota: ${nota}`, c);
  });
}
r.post('/admin/reportes/:id/resolver', h(async (req, res) => { await cerrarReporte(req, 'resuelto'); res.json({ mensaje: 'Reporte resuelto.' }); }));
r.post('/admin/reportes/:id/descartar', h(async (req, res) => { await cerrarReporte(req, 'descartado'); res.json({ mensaje: 'Reporte descartado.' }); }));

/* ---------- RF-36 / RF-37: estadísticas generales (Administrador y Funcionarios) ----------
   animales_publicados usa la fecha de ingreso, igual que RF-35, para que las cifras coincidan (CA1). */
async function generales(query) {
  const p = periodo(query);
  const dias = diasEntre(p.inicio, p.fin) + 1;
  // Agrupa por día si el periodo es corto y por mes si es largo
  const porMes = dias > 62;
  const grupo = (col) => (porMes ? `to_char(${col}, 'YYYY-MM')` : `to_char(${col}, 'YYYY-MM-DD')`);
  const [pub, ado, ref, serieIng, serieAdo, serieSol, sol, tiempo, topRef, porTam, porAlc, rep] = await Promise.all([
    uno('SELECT COUNT(*) AS n FROM animales WHERE fecha_ingreso BETWEEN ? AND ?', [p.inicio, p.fin]),
    uno("SELECT COUNT(*) AS n FROM animales WHERE estado = 'adoptado' AND adoptado_en BETWEEN ? AND ?", [p.inicio, p.fin]),
    // Refugios que estuvieron activos en algún momento del periodo: verificados antes del fin
    // y que no se dieron de baja ni fueron eliminados antes del inicio
    uno(`SELECT COUNT(*) AS n FROM usuarios
          WHERE tipo = 'refugio' AND verificado_en IS NOT NULL AND LEFT(verificado_en, 10) <= ?
            AND (estado = 'activa'
              OR (estado = 'baja' AND LEFT(baja_en, 10) >= ?)
              OR (estado = 'eliminada' AND LEFT(eliminado_en, 10) >= ?))`, [p.fin, p.inicio, p.inicio]),
    q(`SELECT ${grupo('fecha_ingreso')} AS k, COUNT(*) AS n FROM animales WHERE fecha_ingreso BETWEEN ? AND ? GROUP BY 1`, [p.inicio, p.fin]),
    q(`SELECT ${grupo('adoptado_en')} AS k, COUNT(*) AS n FROM animales WHERE estado = 'adoptado' AND adoptado_en BETWEEN ? AND ? GROUP BY 1`, [p.inicio, p.fin]),
    q(`SELECT ${grupo('enviada_en')} AS k, COUNT(*) AS n FROM solicitudes WHERE enviada_en::date BETWEEN ? AND ? GROUP BY 1`, [p.inicio, p.fin]),
    q(`SELECT CASE WHEN concretada_en IS NOT NULL THEN 'concretada' ELSE estado END AS e, COUNT(*) AS n
         FROM solicitudes WHERE enviada_en::date BETWEEN ? AND ? GROUP BY 1`, [p.inicio, p.fin]),
    uno("SELECT AVG(adoptado_en - fecha_ingreso) AS dias FROM animales WHERE estado = 'adoptado' AND adoptado_en BETWEEN ? AND ?", [p.inicio, p.fin]),
    q(`SELECT u.nombre, COUNT(*) AS n FROM animales a JOIN usuarios u ON u.id = a.refugio_id
        WHERE a.estado = 'adoptado' AND a.adoptado_en BETWEEN ? AND ? GROUP BY u.nombre ORDER BY n DESC LIMIT 5`, [p.inicio, p.fin]),
    q(`SELECT t.nombre, COUNT(*) FILTER (WHERE a.estado = 'adoptado' AND a.adoptado_en BETWEEN ? AND ?) AS adoptados,
              COUNT(*) FILTER (WHERE a.estado = 'disponible' AND a.eliminado = 0) AS disponibles
         FROM animales a JOIN catalogo_valores t ON t.id = a.tamano_id GROUP BY t.nombre, t.orden ORDER BY t.orden`, [p.inicio, p.fin]),
    q(`SELECT al.nombre, COUNT(*) AS n FROM usuarios u JOIN refugios rf ON rf.usuario_id = u.id JOIN catalogo_valores al ON al.id = rf.alcaldia_id
        WHERE u.tipo = 'refugio' AND u.estado = 'activa' GROUP BY al.nombre ORDER BY n DESC`),
    uno('SELECT COUNT(*) AS n FROM reportes WHERE creado_en::date BETWEEN ? AND ?', [p.inicio, p.fin]),
  ]);
  // Serie completa (sin huecos) para las gráficas
  const claves = [];
  for (let d = p.inicio; d <= p.fin; d = sumarDias(d, 1)) {
    const k = porMes ? d.slice(0, 7) : d;
    if (claves[claves.length - 1] !== k) claves.push(k);
  }
  const serie = (filas) => { const m = Object.fromEntries(filas.map((x) => [x.k, Number(x.n)])); return claves.map((k) => m[k] || 0); };
  const estados = Object.fromEntries(sol.map((x) => [x.e, Number(x.n)]));
  const totalSol = Object.values(estados).reduce((a, b) => a + b, 0);
  const decididas = (estados.aprobada || 0) + (estados.concretada || 0) + (estados.rechazada || 0);
  return {
    ...p,
    animales_publicados: Number(pub.n),
    adopciones_concretadas: Number(ado.n),
    refugios_activos: Number(ref.n),
    solicitudes: totalSol,
    reportes: Number(rep.n),
    dias_promedio_adopcion: tiempo.dias == null ? null : Math.round(Number(tiempo.dias)),
    tasa_aprobacion: decididas ? Math.round((((estados.aprobada || 0) + (estados.concretada || 0)) / decididas) * 100) : null,
    agrupado: porMes ? 'mes' : 'dia',
    serie: { claves, ingresos: serie(serieIng), adopciones: serie(serieAdo), solicitudes: serie(serieSol) },
    solicitudes_por_estado: estados,
    top_refugios: topRef.map((x) => ({ nombre: x.nombre, n: Number(x.n) })),
    por_tamano: porTam.map((x) => ({ nombre: x.nombre, adoptados: Number(x.adoptados), disponibles: Number(x.disponibles) })),
    refugios_por_alcaldia: porAlc.map((x) => ({ nombre: x.nombre, n: Number(x.n) })),
  };
}

r.get('/admin/estadisticas', h(async (req, res) => res.json(await generales(req.query))));

r.get('/admin/estadisticas.csv', h(async (req, res) => {
  const e = await generales(req.query);
  const filas = [
    ['periodo', `${e.inicio} a ${e.fin}`],
    ['animales_publicados', e.animales_publicados],
    ['adopciones_concretadas', e.adopciones_concretadas],
    ['refugios_activos', e.refugios_activos],
    ['solicitudes', e.solicitudes],
    ['tasa_aprobacion_%', e.tasa_aprobacion ?? ''],
    ['dias_promedio_adopcion', e.dias_promedio_adopcion ?? ''],
    ['reportes', e.reportes],
    [],
    [e.agrupado, 'ingresos', 'adopciones', 'solicitudes'],
    ...e.serie.claves.map((k, i) => [k, e.serie.ingresos[i], e.serie.adopciones[i], e.serie.solicitudes[i]]),
  ];
  const csv = `﻿${filas.map((f) => f.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n')}\r\n`;
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="estadisticas_dopta_${ahora().slice(0, 10)}.csv"`);
  res.send(csv);
}));

module.exports = { router: r };
