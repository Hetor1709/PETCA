/* Moderación, catálogos, reportes y estadísticas generales (RF-25 a RF-32, RF-34, RF-36, RF-37). */
const express = require('express');
const { q, uno, tx } = require('./db');
const {
  h, V, falla, limpiar, ahora, haceMin, periodo, notificar,
} = require('./util');
const { requiere } = require('./seguridad');
const { horario } = require('./animales');
const { retirarActividad } = require('./auth');
const { MOTIVOS } = require('./solicitudes');

const r = express.Router();
r.use('/admin', requiere('admin'));
const POR_PAGINA = 20;
const lim = (p) => `LIMIT ${POR_PAGINA} OFFSET ${(p - 1) * POR_PAGINA}`;

/* ---------- Resumen del panel ---------- */
r.get('/admin/resumen', h(async (req, res) => {
  const [pend, rep, err] = await Promise.all([
    uno("SELECT COUNT(*) AS n FROM usuarios WHERE tipo = 'refugio' AND estado = 'pendiente'"),
    uno("SELECT COUNT(*) AS n FROM reportes WHERE estado = 'abierto'"),
    q('SELECT id, texto, creado_en FROM errores_notificacion WHERE revisado = 0 ORDER BY id DESC LIMIT 20'),
  ]);
  res.json({ refugiosPendientes: Number(pend.n), reportesAbiertos: Number(rep.n), erroresNotificacion: err });
}));

r.post('/admin/errores-notificacion/revisados', h(async (req, res) => {
  await q('UPDATE errores_notificacion SET revisado = 1 WHERE revisado = 0');
  res.json({ ok: true });
}));

/* ---------- RF-25: verificar refugios ---------- */
r.get('/admin/refugios-pendientes', h(async (req, res) => {
  const lista = await q(
    `SELECT u.id, u.nombre, u.correo, u.creado, u.aviso_version, u.aviso_fecha, rf.institucion, rf.direccion, rf.telefono,
            al.nombre AS alcaldia, u.creado < ? AS plazo_vencido
       FROM usuarios u JOIN refugios rf ON rf.usuario_id = u.id LEFT JOIN catalogo_valores al ON al.id = rf.alcaldia_id
      WHERE u.tipo = 'refugio' AND u.estado = 'pendiente' ORDER BY u.creado`, [haceMin(3 * 24 * 60)]);
  for (const x of lista) {
    x.plazo_vencido = !!Number(x.plazo_vencido);
    x.horario = await horario(x.id);
  }
  res.json(lista);
}));

async function decidirRefugio(req, aceptar) {
  const id = V.id(req.params.id);
  await tx(async (c) => {
    const u = await uno("SELECT id, estado FROM usuarios WHERE id = ? AND tipo = 'refugio' FOR UPDATE", [id], c);
    if (!u) falla('La cuenta no existe.', 404);
    if (u.estado !== 'pendiente') falla('La cuenta ya no está pendiente de verificación.', 409);
    if (aceptar) {
      await q("UPDATE usuarios SET estado = 'activa', verificado_en = ? WHERE id = ?", [ahora(), id], c);
      await notificar(id, '¡Tu refugio fue verificado! Ya puedes publicar animales en adopción.', c);
    } else {
      await q("UPDATE usuarios SET estado = 'rechazada', rechazado_en = ? WHERE id = ?", [ahora(), id], c);
    }
  });
}
r.post('/admin/refugios/:id/aceptar', h(async (req, res) => { await decidirRefugio(req, true); res.json({ mensaje: 'Cuenta verificada.' }); }));
r.post('/admin/refugios/:id/rechazar', h(async (req, res) => { await decidirRefugio(req, false); res.json({ mensaje: 'Cuenta rechazada.' }); }));

/* ---------- RF-26 / RF-27: publicaciones ---------- */
r.get('/admin/publicaciones', h(async (req, res) => {
  const p = V.pagina(req.query.pagina);
  const total = await uno('SELECT COUNT(*) AS n FROM animales WHERE eliminado = 0');
  const lista = await q(
    `SELECT a.id, a.nombre, a.raza, a.raza_aprox, a.foto, a.estado, LEFT(a.publicado_en, 16) AS publicado, u.nombre AS refugio
       FROM animales a JOIN usuarios u ON u.id = a.refugio_id
      WHERE a.eliminado = 0 ORDER BY a.publicado_en DESC, a.id DESC ${lim(p)}`);
  res.json({ total: Number(total.n), pagina: p, porPagina: POR_PAGINA, publicaciones: lista });
}));

r.post('/admin/publicaciones/:id/eliminar', h(async (req, res) => {
  const id = V.id(req.params.id);
  const b = req.body || {};
  if (!MOTIVOS.includes(b.motivo)) falla('Seleccione un motivo.');
  const desc = b.motivo === 'Otro' ? V.motivo(b.descripcion, 10, 300, 'La descripción debe tener de 10 a 300 caracteres.') : null;
  await tx(async (c) => {
    const a = await uno('SELECT id, nombre, refugio_id, eliminado FROM animales WHERE id = ? FOR UPDATE', [id], c);
    if (!a || a.eliminado) falla('La publicación no existe.', 404);
    const t = ahora();
    await q("UPDATE animales SET eliminado = 1, eliminado_por = 'admin', eliminado_motivo = ?, eliminado_desc = ?, eliminado_en = ? WHERE id = ?",
      [b.motivo, desc, t, id], c);
    const activas = await q("SELECT id, adoptante_id FROM solicitudes WHERE animal_id = ? AND estado = 'pendiente'", [id], c);
    for (const s of activas) {
      await q("UPDATE solicitudes SET estado = 'rechazada', motivo_rechazo = 'La publicación fue retirada por moderación.', rechazada_en = ? WHERE id = ?", [t, s.id], c);
      await notificar(s.adoptante_id, `Tu solicitud para ${a.nombre} se cerró porque la publicación fue retirada por moderación.`, c);
    }
    await notificar(a.refugio_id, `Tu publicación de ${a.nombre} fue eliminada por moderación. Motivo: ${b.motivo}${desc ? ` (${desc})` : ''}.`, c);
  });
  res.json({ mensaje: 'Publicación eliminada.' });
}));

/* ---------- RF-28 / RF-32: cuentas ---------- */
r.get('/admin/cuentas', h(async (req, res) => {
  const p = V.pagina(req.query.pagina);
  const where = ['purgado = 0'];
  const params = [];
  const texto = limpiar(req.query.q).slice(0, 60);
  if (texto) { where.push('(nombre LIKE ? OR correo LIKE ?)'); const t = `%${texto.replace(/[%_\\]/g, '\\$&')}%`; params.push(t, t); }
  if (['adoptante', 'refugio', 'admin'].includes(req.query.tipo)) { where.push('tipo = ?'); params.push(req.query.tipo); }
  const total = await uno(`SELECT COUNT(*) AS n FROM usuarios WHERE ${where.join(' AND ')}`, params);
  const lista = await q(`SELECT id, tipo, nombre, correo, estado, LEFT(creado, 10) AS creado FROM usuarios WHERE ${where.join(' AND ')} ORDER BY id DESC ${lim(p)}`, params);
  res.json({ total: Number(total.n), pagina: p, porPagina: POR_PAGINA, cuentas: lista });
}));

r.post('/admin/cuentas/:id/eliminar', h(async (req, res) => {
  const id = V.id(req.params.id);
  const motivo = V.motivo(req.body && req.body.motivo);
  await tx(async (c) => {
    const u = await uno('SELECT id, tipo, estado FROM usuarios WHERE id = ? FOR UPDATE', [id], c);
    if (!u) falla('La cuenta no existe.', 404);
    if (u.tipo === 'admin') falla('No es posible eliminar una cuenta de Administrador.', 403);
    if (u.estado === 'eliminada') falla('La cuenta ya está eliminada.', 409);
    await q("UPDATE usuarios SET estado = 'eliminada', eliminado_motivo = ?, eliminado_en = ? WHERE id = ?", [motivo, ahora(), id], c);
    await retirarActividad(c, u, 'La cuenta del adoptante fue eliminada.', 'La cuenta del refugio fue eliminada.');
    await q('DELETE FROM sesiones WHERE usuario_id = ?', [id], c);
  });
  res.json({ mensaje: 'Cuenta eliminada.' });
}));

r.post('/admin/cuentas/:id/admin', h(async (req, res) => {
  const id = V.id(req.params.id);
  const u = await uno('SELECT id, tipo, estado FROM usuarios WHERE id = ?', [id]);
  if (!u) falla('La cuenta no existe.', 404);
  if (u.tipo === 'admin') falla('La cuenta ya tiene el rol de Administrador.', 409);
  if (u.tipo !== 'adoptante' || u.estado !== 'activa') falla('El rol solo se asigna a una cuenta de tipo Adoptante.', 409);
  await q("UPDATE usuarios SET tipo = 'admin' WHERE id = ?", [id]);
  await q('DELETE FROM sesiones WHERE usuario_id = ?', [id]); // el nuevo panel se abre en su siguiente inicio de sesión
  res.json({ mensaje: 'Rol de Administrador asignado.' });
}));

/* ---------- RF-29 a RF-31: catálogos ---------- */
const EDITABLES = ['tamano', 'edad', 'tipo_requisito', 'vacuna'];
const nombreValor = (v) => {
  const n = limpiar(v).replace(/\s+/g, ' ');
  if (!n || [...n].length > 50) falla('El nombre del valor debe tener de 1 a 50 caracteres.');
  return n;
};
const duplicado = (e) => { if (e.code === 'ER_DUP_ENTRY') falla('Ya existe un valor con el mismo nombre en el catálogo.', 409); throw e; };

r.post('/admin/catalogos', h(async (req, res) => {
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

r.put('/admin/catalogos/:id', h(async (req, res) => {
  const v = await valor(req.params.id);
  const n = nombreValor(req.body && req.body.nombre);
  await q('UPDATE catalogo_valores SET nombre = ? WHERE id = ?', [n, v.id]).catch(duplicado);
  res.json({ mensaje: 'Valor renombrado.' });
}));

r.post('/admin/catalogos/:id/desactivar', h(async (req, res) => {
  const v = await valor(req.params.id);
  if (!v.activo) falla('El valor ya está desactivado.', 409);
  await q('UPDATE catalogo_valores SET activo = 0 WHERE id = ?', [v.id]);
  res.json({ mensaje: 'Valor desactivado.' });
}));

r.post('/admin/catalogos/:id/activar', h(async (req, res) => {
  const v = await valor(req.params.id);
  if (v.activo) falla('El valor ya está activo.', 409);
  await q('UPDATE catalogo_valores SET activo = 1 WHERE id = ?', [v.id]);
  res.json({ mensaje: 'Valor activado.' });
}));

/* ---------- RF-34: reportes ---------- */
r.get('/admin/reportes', h(async (req, res) => {
  const p = V.pagina(req.query.pagina);
  const estado = ['abierto', 'resuelto', 'descartado'].includes(req.query.estado) ? req.query.estado : 'abierto';
  const total = await uno('SELECT COUNT(*) AS n FROM reportes WHERE estado = ?', [estado]);
  const lista = await q(
    `SELECT r.id, r.objetivo_tipo, r.objetivo_id, r.motivo, r.descripcion, r.estado, r.nota, LEFT(r.creado_en, 16) AS creado,
            u.nombre AS adoptante, u.correo AS adoptante_correo,
            CASE WHEN r.objetivo_tipo = 'animal' THEN (SELECT CONCAT(a.nombre, ' · ', ru.nombre) FROM animales a JOIN usuarios ru ON ru.id = a.refugio_id WHERE a.id = r.objetivo_id)
                 ELSE (SELECT nombre FROM usuarios WHERE id = r.objetivo_id) END AS objetivo
       FROM reportes r JOIN usuarios u ON u.id = r.adoptante_id
      WHERE r.estado = ? ORDER BY r.creado_en DESC ${lim(p)}`, [estado]);
  res.json({ total: Number(total.n), pagina: p, porPagina: POR_PAGINA, reportes: lista });
}));

async function cerrarReporte(req, estado) {
  const nota = V.motivo(req.body && req.body.nota, 10, 300, 'La nota debe tener de 10 a 300 caracteres.');
  await tx(async (c) => {
    const rep = await uno('SELECT id, adoptante_id, estado FROM reportes WHERE id = ? FOR UPDATE', [V.id(req.params.id)], c);
    if (!rep) falla('El reporte no existe.', 404);
    if (rep.estado !== 'abierto') falla('El reporte ya está resuelto o descartado.', 409);
    await q('UPDATE reportes SET estado = ?, nota = ?, admin_id = ?, cerrado_en = ? WHERE id = ?', [estado, nota, req.usuario.id, ahora(), rep.id], c);
    await notificar(rep.adoptante_id, `Tu reporte fue ${estado}. Nota: ${nota}`, c);
  });
}
r.post('/admin/reportes/:id/resolver', h(async (req, res) => { await cerrarReporte(req, 'resuelto'); res.json({ mensaje: 'Reporte resuelto.' }); }));
r.post('/admin/reportes/:id/descartar', h(async (req, res) => { await cerrarReporte(req, 'descartado'); res.json({ mensaje: 'Reporte descartado.' }); }));

/* ---------- RF-36 / RF-37: estadísticas generales ----------
   animales_publicados usa la fecha de ingreso, igual que RF-35, para que las cifras coincidan (CA1). */
async function generales(query) {
  const p = periodo(query);
  const [pub, ado, ref] = await Promise.all([
    uno('SELECT COUNT(*) AS n FROM animales WHERE fecha_ingreso BETWEEN ? AND ?', [p.inicio, p.fin]),
    uno("SELECT COUNT(*) AS n FROM animales WHERE estado = 'adoptado' AND adoptado_en BETWEEN ? AND ?", [p.inicio, p.fin]),
    // Refugios que estuvieron activos en algún momento del periodo: verificados antes del fin
    // y que no se dieron de baja ni fueron eliminados antes del inicio
    uno(`SELECT COUNT(*) AS n FROM usuarios
          WHERE tipo = 'refugio' AND verificado_en IS NOT NULL AND LEFT(verificado_en, 10) <= ?
            AND (estado = 'activa'
              OR (estado = 'baja' AND LEFT(baja_en, 10) >= ?)
              OR (estado = 'eliminada' AND LEFT(eliminado_en, 10) >= ?))`, [p.fin, p.inicio, p.inicio]),
  ]);
  return {
    ...p, animales_publicados: Number(pub.n), adopciones_concretadas: Number(ado.n), refugios_activos: Number(ref.n),
  };
}

r.get('/admin/estadisticas', h(async (req, res) => res.json(await generales(req.query))));

r.get('/admin/estadisticas.csv', h(async (req, res) => {
  const e = await generales(req.query);
  const csv = '﻿periodo,animales_publicados,adopciones_concretadas,refugios_activos\r\n'
    + `${e.inicio} a ${e.fin},${e.animales_publicados},${e.adopciones_concretadas},${e.refugios_activos}\r\n`;
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="estadisticas_dopta_${ahora().slice(0, 10)}.csv"`);
  res.send(csv);
}));

module.exports = { router: r };
