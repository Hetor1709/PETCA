/* Utilidades compartidas: fechas en hora CDMX, validaciones, errores y notificaciones. */
const { q } = require('./db');
const RAZAS_LISTA = require('./razas.json');
const RAZAS = new Set(RAZAS_LISTA.map((r) => r.id));

/* ---------- Errores con mensaje para el usuario ---------- */
class ErrorApp extends Error {
  constructor(status, mensaje, extra) {
    super(mensaje);
    this.status = status;
    this.extra = extra;
  }
}
const falla = (mensaje, status = 400, extra) => { throw new ErrorApp(status, mensaje, extra); };

/* Envuelve rutas async para que los errores lleguen al manejador central */
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ---------- Fechas (zona America/Mexico_City) ---------- */
const ZONA = 'America/Mexico_City';
const partes = (d = new Date()) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return p;
};
const ahora = (d) => { const p = partes(d); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`; };
const hoy = (d) => ahora(d).slice(0, 10);
const haceMin = (min) => ahora(new Date(Date.now() - min * 60000));
const enMin = (min) => ahora(new Date(Date.now() + min * 60000));
const sumarDias = (fecha, n) => {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const diasEntre = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000);
const diaSemana = (fecha) => (new Date(`${fecha}T12:00:00Z`).getUTCDay() + 6) % 7; // 0 = lunes
const esFecha = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v;
const esHora = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/* ---------- Texto ---------- */
/* Quita caracteres de control y los símbolos < > que se usan para inyectar HTML */
const limpiar = (v) => (typeof v === 'string' ? v : '')
  .normalize('NFC')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮]/g, '')
  .replace(/[<>]/g, '')
  .trim();
const largo = (v) => [...v].length;
const entre = (v, min, max) => largo(v) >= min && largo(v) <= max;

/* ---------- Reglas de coherencia ---------- */
const FECHA_MIN = '2000-01-01';
const tieneLetras = (t, n = 2) => (String(t).match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) || []).length >= n;

/* Teléfono de México: 10 dígitos, no empieza con 0 ni 1 y no es una serie falsa (0000000000, 1234567890…) */
function telefonoReal(t) {
  if (!/^[2-9]\d{9}$/.test(t)) return false;
  if (/^(\d)\1{9}$/.test(t)) return false;
  return !'01234567890123456789'.includes(t) && !'98765432109876543210'.includes(t);
}

/* Nacimiento más antiguo posible según la edad del catálogo ("3 meses", "2 años"): ninguna fecha del animal puede ser anterior */
function nacimientoMinimo(edadNombre, base) {
  const m = String(edadNombre || '').match(/(\d+)\s*(mes|año|ano)/i);
  if (!m) return null;
  const n = Number(m[1]) + 1; // margen de una unidad
  const d = new Date(`${base}T12:00:00Z`);
  if (/^mes/i.test(m[2])) d.setUTCMonth(d.getUTCMonth() - n); else d.setUTCFullYear(d.getUTCFullYear() - n);
  return d.toISOString().slice(0, 10);
}

const RE_CORREO = /^[^\s@"'<>()\\,;:]+@[^\s@"'<>()\\,;:]+\.[A-Za-z]{2,}$/;
const RE_NOMBRE_PERSONA = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]+$/; // RF-01: solo letras y espacios

const V = {
  correo(v) {
    const c = limpiar(v).toLowerCase();
    if (!c || c.length > 254 || !RE_CORREO.test(c)) falla('Ingrese un correo electrónico válido.');
    return c;
  },
  contrasena(v) {
    if (typeof v !== 'string' || v.length < 8 || v.length > 64 || !/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(v) || !/\d/.test(v)) {
      falla('La contraseña debe tener de 8 a 64 caracteres, con al menos una letra y un número.');
    }
    return v;
  },
  nombrePersona(v) {
    const n = limpiar(v).replace(/\s+/g, ' ');
    if (!entre(n, 2, 100) || !RE_NOMBRE_PERSONA.test(n)) falla('El nombre debe tener entre 2 y 100 caracteres y solo letras y espacios.');
    return n;
  },
  nombreRefugio(v, msg = 'El nombre del refugio debe tener de 3 a 120 caracteres.') {
    const n = limpiar(v).replace(/\s+/g, ' ');
    if (!entre(n, 3, 120)) falla(msg);
    if (!tieneLetras(n)) falla('El nombre debe incluir letras, no solo números o símbolos.');
    return n;
  },
  direccion(v) {
    const d = limpiar(v).replace(/\s+/g, ' ');
    if (!entre(d, 10, 200)) falla('La dirección debe tener de 10 a 200 caracteres.');
    if (!/\d/.test(d) || !tieneLetras(d, 4)) falla('La dirección debe incluir calle y número (por ejemplo: Av. Universidad 1200, Col. Xoco).');
    return d;
  },
  telefono(v) {
    const t = typeof v === 'string' ? v.trim() : '';
    if (!/^\d{10}$/.test(t)) falla('El teléfono debe tener exactamente 10 dígitos numéricos.');
    if (!telefonoReal(t)) falla('Ingrese un teléfono real: no puede empezar con 0 o 1 ni ser una serie como 0000000000 o 1234567890.');
    return t;
  },
  horario(lista) {
    if (!Array.isArray(lista) || lista.length !== 7) falla('Indique el horario de los 7 días de la semana.');
    const aMin = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3));
    const res = lista.map((d, i) => {
      if (!d || d.cerrado) return { dia: i, cerrado: 1, abre: null, cierra: null };
      if (!esHora(d.abre) || !esHora(d.cierra) || d.abre >= d.cierra) {
        falla('El horario de apertura debe ser menor que el horario de cierre, en formato HH:MM de 24 horas.');
      }
      if (aMin(d.cierra) - aMin(d.abre) < 60) falla('Cada día abierto debe tener al menos 1 hora de atención.');
      return { dia: i, cerrado: 0, abre: d.abre, cierra: d.cierra };
    });
    if (res.every((d) => d.cerrado)) falla('Indique al menos un día abierto para poder agendar citas.');
    return res;
  },
  motivo(v, min = 10, max = 300, msg = `El motivo debe tener de ${min} a ${max} caracteres.`) {
    const m = limpiar(v);
    if (!entre(m, min, max)) falla(msg);
    return m;
  },
  id(v) {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0 || n > 4294967295) falla('Identificador inválido.', 404);
    return n;
  },
  raza(v) {
    const r = limpiar(v);
    if (r !== 'mestizo' && !RAZAS.has(r)) falla('Seleccione la raza del animal.');
    return r;
  },
  razaAprox(v) {
    const r = limpiar(v);
    if (!r) return null;
    if (!RAZAS.has(r)) falla('Seleccione una raza de la lista.');
    return r;
  },
  pagina(v) {
    const n = Number(v || 1);
    return Number.isInteger(n) && n > 0 && n < 100000 ? n : 1;
  },
};

/* ---------- Opciones cerradas de salud y temperamento del animal ----------
   Cada campo guarda la clave (izquierda) y la app muestra la etiqueta (derecha). */
const OPCIONES_ANIMAL = {
  salud_general: { titulo: 'Estado de salud general', opciones: { excelente: 'Excelente', bueno: 'Bueno', regular: 'Regular', recuperacion: 'En recuperación' } },
  tratamiento: { titulo: '¿Requiere medicamento o trato especial?', opciones: { no: 'No requiere', medicamento: 'Sí, medicamento', dieta: 'Sí, dieta especial', cuidados: 'Sí, cuidados especiales' } },
  temp_general: { titulo: 'Temperamento general', opciones: { tranquilo: 'Tranquilo', jugueton: 'Juguetón', activo: 'Muy activo', nervioso: 'Nervioso' } },
  temp_perros: { titulo: 'Con otros perros', opciones: { sociable: 'Sociable', selectivo: 'Selectivo', unico: 'Prefiere ser el único', no_evaluado: 'No evaluado' } },
  temp_desconocidos: { titulo: 'Con desconocidos', opciones: { amigable: 'Amigable', timido: 'Tímido al inicio', desconfiado: 'Desconfiado', no_evaluado: 'No evaluado' } },
  temp_comida: { titulo: 'Al comer', opciones: { tranquilo: 'Come tranquilo', rapido: 'Come rápido', protege: 'Protege su comida', no_evaluado: 'No evaluado' } },
};
const CAMPOS_ANIMAL = Object.keys(OPCIONES_ANIMAL);

/* ---------- Periodos de estadísticas (RF-35 / RF-36) ---------- */
function periodo(query) {
  const t = hoy();
  if (query.periodo === '7') return { inicio: sumarDias(t, -6), fin: t };
  if (query.periodo === '30') return { inicio: sumarDias(t, -29), fin: t };
  const { inicio, fin } = query;
  if (!esFecha(inicio) || !esFecha(fin)) falla('Ingrese la fecha de inicio y la fecha de fin en formato AAAA-MM-DD.');
  if (inicio < FECHA_MIN) falla('La fecha de inicio no puede ser anterior al año 2000.');
  if (inicio > fin) falla('La fecha de inicio debe ser anterior o igual a la fecha de fin.');
  if (fin > t) falla('La fecha de fin debe ser igual o anterior a hoy.');
  if (diasEntre(inicio, fin) + 1 > 365) falla('El periodo máximo es de 365 días.');
  return { inicio, fin };
}

/* ---------- Notificaciones (RF-24) ---------- */
async function notificar(usuarioId, texto, conn) {
  const t = [...String(texto)].slice(0, 200).join('');
  const sql = 'INSERT INTO notificaciones (usuario_id, texto, creada_en) VALUES (?, ?, ?)';
  try {
    await q(sql, [usuarioId, t, ahora()], conn);
  } catch (e1) {
    try {
      await q(sql, [usuarioId, t, ahora()], conn);
    } catch (e2) {
      // Se registra fuera de la transacción para que el Administrador vea el aviso
      await q('INSERT INTO errores_notificacion (usuario_id, texto, detalle, creado_en) VALUES (?, ?, ?, ?)',
        [usuarioId, t, String(e2.code || e2.message).slice(0, 300), ahora()]).catch(() => {});
    }
  }
}

module.exports = {
  ErrorApp, falla, h, V, limpiar, entre,
  ahora, hoy, haceMin, enMin, sumarDias, diasEntre, diaSemana, esFecha, esHora,
  periodo, notificar, RAZAS, RAZAS_LISTA, OPCIONES_ANIMAL, CAMPOS_ANIMAL, FECHA_MIN, tieneLetras, telefonoReal, nacimientoMinimo,
};
