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

/* ---------- Nombres (personas, perros y refugios) ----------
   Reglas comunes: sin la misma letra 3 veces seguidas, con al menos una vocal, sin groserías
   y, para perros, sin nombres genéricos o de prueba. El navegador aplica las mismas reglas (app.js). */
const sinAcentos = (t) => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const GROSERIAS = new Set(['puta', 'puto', 'putas', 'putos', 'pendejo', 'pendeja', 'pendejos', 'pendejas', 'verga', 'vergas',
  'chinga', 'chingada', 'chingado', 'chingar', 'culero', 'culera', 'culo', 'mierda', 'cabron', 'cabrona', 'mamada', 'mamadas',
  'joto', 'zorra', 'estupido', 'estupida', 'idiota', 'imbecil', 'pinche', 'marica', 'maricon', 'ojete', 'nazi', 'hitler', 'naco', 'naca']);
const GENERICOS = new Set(['perro', 'perra', 'perrito', 'perrita', 'can', 'mascota', 'animal', 'sin nombre', 'ninguno', 'ninguna',
  'nombre', 'test', 'prueba', 'asdf', 'qwerty', 'xxx', 'na', 'no', 'si', 'desconocido', 'desconocida', 'callejero', 'callejera']);
function problemaNombre(n, tipo) {
  const plano = sinAcentos(n);
  if (/(.)\1\1/.test(plano.replace(/\s/g, ''))) return 'El nombre no puede repetir la misma letra 3 o más veces seguidas.';
  if (!/[aeiouy]/.test(plano)) return 'El nombre debe incluir al menos una vocal.';
  if (plano.split(/[^a-z]+/).some((p) => GROSERIAS.has(p))) return 'El nombre contiene palabras no permitidas.';
  if (tipo === 'perro') {
    if (GENERICOS.has(plano) || RAZAS_LISTA.some((x) => sinAcentos(x.nombre) === plano)) return 'Escriba el nombre del perro, no un término genérico o el nombre de su raza.';
    if (plano.split(' ').length > 3) return 'El nombre del perro puede tener máximo 3 palabras.';
  }
  if (tipo === 'persona' && plano.split(' ').length > 6) return 'El nombre puede tener máximo 6 palabras.';
  if (tipo === 'persona' && plano.split(' ').every((p) => p.length === 1)) return 'Escriba el nombre completo, no solo iniciales.';
  return null;
}

/* ---------- Dimensiones (peso y altura a la cruz) ----------
   Rango adulto típico por raza (razas.json) o, en mestizos, por tamaño. Valores aproximados de referencia. */
const DIMS_TAMANO = {
  pequeno: { peso: [1, 10], altura: [15, 40] },
  mediano: { peso: [8, 25], altura: [35, 60] },
  grande: { peso: [20, 90], altura: [50, 90] },
};
function mesesDeEdad(nombre) {
  const m = String(nombre || '').match(/(\d+)\s*(mes|año|ano)/i);
  if (!m) return null;
  return /^mes/i.test(m[2]) ? Number(m[1]) : Number(m[1]) * 12;
}
function rangoDimensiones(raza, tamanoNombre) {
  const r = RAZAS_LISTA.find((x) => x.id === raza);
  if (r && r.peso) return { peso: r.peso, altura: r.altura, base: `un ${r.nombre}` };
  const t = DIMS_TAMANO[sinAcentos(tamanoNombre || '')];
  return t ? { ...t, base: `un perro de tamaño ${String(tamanoNombre).toLowerCase()}` } : null;
}
/* Límites aceptados: adulto con margen (-25 % / +30 % de peso, ±15 % de altura); cachorro solo con tope máximo */
function limitesDimensiones(rango, meses) {
  const r1 = (n) => Math.round(n * 10) / 10;
  const adulto = meses == null || meses >= 12;
  return {
    adulto,
    peso: [adulto ? r1(rango.peso[0] * 0.75) : 0.3, r1(rango.peso[1] * (adulto ? 1.3 : 1.1))],
    altura: [adulto ? Math.floor(rango.altura[0] * 0.85) : 8, Math.ceil(rango.altura[1] * (adulto ? 1.15 : 1.1))],
  };
}

/* Tamaño por raza: una raza pura siempre tiene su tamaño típico (un chihuahua siempre es pequeño).
   Devuelve el id del catálogo de tamaños cuyo nombre coincide, o null (mestizo o catálogo renombrado). */
function tamanoDeRaza(raza, catTamano) {
  const r = RAZAS_LISTA.find((x) => x.id === raza);
  if (!r || !r.tamano) return null;
  const t = catTamano.find((x) => x.activo && sinAcentos(x.nombre) === sinAcentos(r.tamano));
  return t ? t.id : null;
}

const RE_CORREO = /^[^\s@"'<>()\\,;:]+@[^\s@"'<>()\\,;:]+\.[A-Za-z]{2,}$/;
const RE_NOMBRE_PERSONA = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]+$/; // RF-01: solo letras y espacios
const RE_CALLE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 .,#°\-]+$/;
const RE_NUM_EXT = /^(S\/N|\d{1,5}[A-Z]?(-[A-Z0-9]{1,3})?)$/;
const RE_NUM_INT = /^[A-Z0-9][A-Z0-9 .\-]{0,9}$/;
/* Los dos primeros dígitos del C.P. de la CDMX indican la alcaldía (Correos de México) */
const CP_ALCALDIA = {
  '01': 'Álvaro Obregón', '02': 'Azcapotzalco', '03': 'Benito Juárez', '04': 'Coyoacán', '05': 'Cuajimalpa de Morelos',
  '06': 'Cuauhtémoc', '07': 'Gustavo A. Madero', '08': 'Iztacalco', '09': 'Iztapalapa', '10': 'La Magdalena Contreras',
  '11': 'Miguel Hidalgo', '12': 'Milpa Alta', '13': 'Tláhuac', '14': 'Tlalpan', '15': 'Venustiano Carranza', '16': 'Xochimilco',
};
const RE_NOMBRE_REFUGIO = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 .,&()\-]+$/;

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
    const p = problemaNombre(n, 'persona');
    if (p) falla(p);
    return n;
  },
  nombreRefugio(v, msg = 'El nombre del refugio debe tener de 3 a 120 caracteres.') {
    const n = limpiar(v).replace(/\s+/g, ' ');
    if (!entre(n, 3, 120)) falla(msg);
    if (!tieneLetras(n)) falla('El nombre debe incluir letras, no solo números o símbolos.');
    if (!RE_NOMBRE_REFUGIO.test(n)) falla('El nombre solo puede tener letras, números, espacios y . , & ( ) -');
    const p = problemaNombre(n, 'refugio');
    if (p) falla(p);
    return n;
  },
  /* Ubicación atomizada (RF-04): calle, número exterior e interior, colonia, C.P. y alcaldía coherente con el C.P. */
  ubicacion(b, alcaldias) {
    const t = (v) => limpiar(typeof v === 'string' ? v : '').replace(/\s+/g, ' ');
    const calle = t(b.calle);
    const numExt = t(b.num_ext).toUpperCase().replace(/^S\/?N$/, 'S/N');
    const numInt = t(b.num_int).toUpperCase();
    const colonia = t(b.colonia).replace(/^col(onia)?\.?\s+/i, '');
    const cp = typeof b.cp === 'string' ? b.cp.trim() : '';
    if (!entre(calle, 3, 100) || !RE_CALLE.test(calle) || !tieneLetras(calle, 3)) falla('La calle debe tener de 3 a 100 caracteres, con letras (puede incluir números y . , - #).');
    if (!RE_NUM_EXT.test(numExt) || /^0+\D*$/.test(numExt)) falla('El número exterior debe ser un número (ej. 1200, 15-B o 12A) o S/N si no tiene.');
    if (numInt && !RE_NUM_INT.test(numInt)) falla('El número interior puede tener hasta 10 letras o números (ej. 3, B, Depto 4).');
    if (!entre(colonia, 3, 80) || !RE_CALLE.test(colonia) || !tieneLetras(colonia, 3)) falla('La colonia debe tener de 3 a 80 caracteres, con letras.');
    if (!/^\d{5}$/.test(cp)) falla('El código postal debe tener exactamente 5 dígitos.');
    const nombreAlc = CP_ALCALDIA[cp.slice(0, 2)];
    if (!nombreAlc) falla('El código postal no pertenece a la Ciudad de México (debe estar entre 01000 y 16999).');
    const alc = alcaldias.find((a) => Number(a.id) === Number(b.alcaldia_id));
    if (!alc) falla('Seleccione una alcaldía de la lista.');
    const esperada = alcaldias.find((a) => sinAcentos(a.nombre) === sinAcentos(nombreAlc)); // si el admin renombró el catálogo, no se bloquea
    if (esperada && Number(esperada.id) !== Number(alc.id)) falla(`El código postal ${cp} corresponde a ${nombreAlc}, no a ${alc.nombre}. Revise el C.P. o la alcaldía.`);
    const direccion = `${calle} ${numExt}${numInt ? ` Int. ${numInt}` : ''}, Col. ${colonia}, C.P. ${cp}`.slice(0, 200);
    return { calle, num_ext: numExt, num_int: numInt || null, colonia, cp, alcaldia_id: alc.id, direccion };
  },
  /* Peso (kg, 1 decimal) y altura a la cruz (cm), coherentes con la raza (o el tamaño en mestizos) y la edad */
  dimensiones(d, raza, tamanoNombre, edadNombre) {
    const peso = Math.round(Number(d.peso_kg) * 10) / 10;
    const altura = Math.round(Number(d.altura_cm));
    if (!Number.isFinite(peso) || peso < 0.3 || peso > 100) falla('Indique el peso en kilos (entre 0.3 y 100 kg).');
    if (!Number.isFinite(altura) || altura < 8 || altura > 110) falla('Indique la altura a la cruz en centímetros (entre 8 y 110 cm).');
    const rango = rangoDimensiones(raza, tamanoNombre);
    if (rango) {
      const l = limitesDimensiones(rango, mesesDeEdad(edadNombre));
      const quien = l.adulto ? `${rango.base} adulto` : `${rango.base} cachorro`;
      if (peso < l.peso[0] || peso > l.peso[1]) {
        falla(`El peso no es coherente: para ${quien} se acepta de ${l.peso[0]} a ${l.peso[1]} kg (típico adulto: ${rango.peso[0]}–${rango.peso[1]} kg). Revise el peso, la raza o la edad.`);
      }
      if (altura < l.altura[0] || altura > l.altura[1]) {
        falla(`La altura no es coherente: para ${quien} se acepta de ${l.altura[0]} a ${l.altura[1]} cm (típico adulto: ${rango.altura[0]}–${rango.altura[1]} cm). Revise la altura, la raza o la edad.`);
      }
    }
    return { peso, altura };
  },
  /* Aviso corto del refugio al adoptante en una solicitud (vacío = quitar la nota) */
  notaRefugio(v) {
    const m = limpiar(typeof v === 'string' ? v : '').replace(/\s+/g, ' ');
    if (!m) return null;
    if ([...m].length < 5 || [...m].length > 200) falla('La nota debe tener de 5 a 200 caracteres.');
    if (!tieneLetras(m, 3)) falla('La nota debe incluir texto, no solo números o símbolos.');
    if (/(https?:\/\/|www\.)/i.test(m)) falla('La nota no puede incluir enlaces.');
    if (sinAcentos(m).split(/[^a-z]+/).some((p) => GROSERIAS.has(p))) falla('La nota contiene palabras no permitidas.');
    return m;
  },
  /* Mensaje opcional del adoptante al refugio: texto real, sin enlaces ni groserías */
  mensajeSolicitud(v) {
    const m = limpiar(typeof v === 'string' ? v : '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (!m) return null;
    if ([...m].length < 10 || [...m].length > 500) falla('El mensaje debe tener de 10 a 500 caracteres (o déjelo vacío).');
    if (!tieneLetras(m, 5)) falla('El mensaje debe incluir texto, no solo números o símbolos.');
    if (/(https?:\/\/|www\.|\.(com|mx|net|org|io|ly)\b)/i.test(m)) falla('El mensaje no puede incluir enlaces.');
    if (/(.)\1{5,}/.test(m)) falla('El mensaje no puede repetir el mismo carácter tantas veces seguidas.');
    if (sinAcentos(m).split(/[^a-z]+/).some((p) => GROSERIAS.has(p))) falla('El mensaje contiene palabras no permitidas.');
    return m;
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
  nombrePerro(v) {
    const n = limpiar(v).replace(/\s+/g, ' ');
    if (!entre(n, 2, 30) || !RE_NOMBRE_PERSONA.test(n)) falla('El nombre del perro debe tener de 2 a 30 caracteres, solo letras y espacios.');
    const p = problemaNombre(n, 'perro');
    if (p) falla(p);
    return n;
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
  periodo, notificar, RAZAS, RAZAS_LISTA, tamanoDeRaza, DIMS_TAMANO, GROSERIAS, mesesDeEdad, rangoDimensiones, limitesDimensiones, CP_ALCALDIA, sinAcentos, problemaNombre, OPCIONES_ANIMAL, CAMPOS_ANIMAL, FECHA_MIN, tieneLetras, telefonoReal, nacimientoMinimo,
};
