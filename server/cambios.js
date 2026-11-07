/* Cambios de datos del refugio que el Administrador aprueba antes de aplicarse
   (nombre, institución, dirección, teléfono y horario). Evita que un refugio se registre con datos reales,
   sea validado y después los cambie por otros que nunca se revisaron. */
const { q, uno, tx } = require('./db');
const { falla, ahora, notificar } = require('./util');

const CAMPOS_REFUGIO = ['institucion', 'direccion', 'calle', 'num_ext', 'num_int', 'colonia', 'cp', 'telefono', 'alcaldia_id', 'lat', 'lng', 'place_id'];
const ETIQUETAS = { nombre: 'Nombre', institucion: 'Institución', direccion: 'Dirección', telefono: 'Teléfono', horario: 'Horario' };

/* Valores vigentes del refugio en el mismo formato que los nuevos */
async function actuales(id, conn) {
  const r = await uno(
    `SELECT u.nombre, rf.institucion, rf.direccion, rf.calle, rf.num_ext, rf.num_int, rf.colonia, rf.cp, rf.telefono,
            rf.alcaldia_id, rf.lat, rf.lng, rf.place_id
       FROM usuarios u JOIN refugios rf ON rf.usuario_id = u.id WHERE u.id = ?`, [id], conn);
  r.lat = r.lat == null ? null : Number(r.lat);
  r.lng = r.lng == null ? null : Number(r.lng);
  r.horario = (await q('SELECT dia, cerrado, abre, cierra FROM refugio_horarios WHERE refugio_id = ? ORDER BY dia', [id], conn))
    .map((h) => ({ dia: h.dia, cerrado: Number(h.cerrado), abre: h.abre, cierra: h.cierra }));
  return r;
}

const igual = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/* Guarda (o actualiza) la solicitud de cambio pendiente con solo los campos que cambian */
async function solicitarCambioRefugio(usuario, nuevos) {
  return tx(async (c) => {
    const ant = await actuales(usuario.id, c);
    const pendiente = await uno("SELECT id, datos FROM refugio_cambios WHERE refugio_id = ? AND estado = 'pendiente' FOR UPDATE", [usuario.id], c);
    const datos = { ...(pendiente ? pendiente.datos : {}) };
    for (const [k, v] of Object.entries(nuevos)) {
      if (igual(v, ant[k])) delete datos[k]; else datos[k] = v;
    }
    // La dirección viaja completa: si cambia cualquier parte, se guardan todas
    if (['direccion', 'calle', 'num_ext', 'num_int', 'colonia', 'cp', 'alcaldia_id'].some((k) => k in datos)) {
      for (const k of ['direccion', 'calle', 'num_ext', 'num_int', 'colonia', 'cp', 'alcaldia_id', 'lat', 'lng', 'place_id']) if (k in nuevos) datos[k] = nuevos[k];
    }
    if (!Object.keys(datos).length) {
      if (pendiente) await q("UPDATE refugio_cambios SET estado = 'cancelado', revisado_en = ? WHERE id = ?", [ahora(), pendiente.id], c);
      return { mensaje: pendiente ? 'Se canceló el cambio pendiente: tus datos quedan como estaban.' : 'No hay cambios que guardar.', pendiente: false };
    }
    const anteriores = Object.fromEntries(Object.keys(datos).map((k) => [k, ant[k] ?? null]));
    if (pendiente) {
      await q('UPDATE refugio_cambios SET datos = ?, anteriores = ?, creado_en = ? WHERE id = ?', [JSON.stringify(datos), JSON.stringify(anteriores), ahora(), pendiente.id], c);
    } else {
      await q('INSERT INTO refugio_cambios (refugio_id, datos, anteriores, creado_en) VALUES (?, ?, ?, ?)', [usuario.id, JSON.stringify(datos), JSON.stringify(anteriores), ahora()], c);
    }
    const admin = await uno("SELECT id FROM usuarios WHERE tipo = 'admin' AND estado = 'activa'", [], c);
    if (admin && !pendiente) await notificar(admin.id, `${usuario.nombre} pidió cambiar sus datos de refugio. Revísalo antes de aplicarlo.`, c, '#/admin/refugios?vista=cambios');
    const campos = [...new Set(Object.keys(datos).map((k) => ETIQUETAS[k] || 'Dirección'))].join(', ');
    return { mensaje: `Cambio enviado (${campos}). Se aplicará cuando el Administrador lo apruebe; mientras, se muestran tus datos actuales.`, pendiente: true };
  });
}

/* Aplica un cambio aprobado */
async function aplicarCambio(c, cambio) {
  const d = cambio.datos;
  if ('nombre' in d) await q('UPDATE usuarios SET nombre = ? WHERE id = ?', [d.nombre, cambio.refugio_id], c);
  const sets = CAMPOS_REFUGIO.filter((k) => k in d);
  if (sets.length) {
    await q(`UPDATE refugios SET ${sets.map((k) => `${k} = ?`).join(', ')} WHERE usuario_id = ?`, [...sets.map((k) => d[k]), cambio.refugio_id], c);
  }
  if (Array.isArray(d.horario)) {
    for (const x of d.horario) {
      await q(`INSERT INTO refugio_horarios (refugio_id, dia, cerrado, abre, cierra) VALUES (?, ?, ?, ?, ?)
               ON CONFLICT (refugio_id, dia) DO UPDATE SET cerrado = EXCLUDED.cerrado, abre = EXCLUDED.abre, cierra = EXCLUDED.cierra`,
      [cambio.refugio_id, x.dia, x.cerrado, x.abre, x.cierra], c);
    }
  }
}

async function decidirCambio(req, aprobar) {
  const id = Number(req.params.id);
  const motivo = req.body && req.body.motivo;
  await tx(async (c) => {
    const cambio = await uno("SELECT id, refugio_id, datos FROM refugio_cambios WHERE id = ? AND estado = 'pendiente' FOR UPDATE", [id], c);
    if (!cambio) falla('El cambio ya fue revisado o no existe.', 404);
    if (aprobar) await aplicarCambio(c, cambio);
    await q('UPDATE refugio_cambios SET estado = ?, motivo = ?, revisor_id = ?, revisado_en = ? WHERE id = ?',
      [aprobar ? 'aprobado' : 'rechazado', aprobar ? null : motivo, req.usuario.id, ahora(), id], c);
    await notificar(cambio.refugio_id, aprobar
      ? 'El Administrador aprobó el cambio de tus datos de refugio: ya se muestran los nuevos.'
      : `El Administrador no aprobó el cambio de tus datos de refugio: ${motivo}`, c, '#/refugio/perfil');
  });
}

module.exports = { solicitarCambioRefugio, decidirCambio, actuales, ETIQUETAS };
