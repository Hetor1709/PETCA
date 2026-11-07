/* Reglas de dimensiones del perro, compartidas por el navegador (window.Reglas) y el servidor.
   Peso y altura a la cruz según la raza (o el tamaño en mestizos) y la edad en meses.

   Crecimiento (aproximación de referencia, no veterinaria): la fracción del peso adulto a los m meses es
       f(m) = m^1.6 / (m^1.6 + h^1.6)
   donde h es la edad (meses) a la que se alcanza la mitad del peso adulto: 3 en razas pequeñas, 4 en medianas,
   5 en grandes y 6 en gigantes. La altura crece como la raíz cúbica del peso (el volumen escala con la longitud³).
   Ejemplo: un gran danés de 1 mes pesa como máximo ≈ 6.7 kg; un chihuahua de 1 mes, ≈ 0.6 kg. */
(function (raiz, crear) {
  if (typeof module === 'object' && module.exports) module.exports = crear();
  else raiz.Reglas = crear();
}(typeof self !== 'undefined' ? self : this, () => {
  const DIMS_TAMANO = {
    pequeno: { peso: [1, 10], altura: [15, 40] },
    mediano: { peso: [8, 25], altura: [35, 60] },
    grande: { peso: [20, 90], altura: [50, 90] },
  };
  const sinAcentos = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const r1 = (n) => Math.round(n * 10) / 10;

  function mesesDeEdad(nombre) {
    const m = String(nombre || '').match(/(\d+)\s*(mes|año|ano)/i);
    if (!m) return null;
    return /^mes/i.test(m[2]) ? Number(m[1]) : Number(m[1]) * 12;
  }

  /* Categoría de crecimiento por el peso adulto máximo */
  function categoria(pesoMax) {
    if (pesoMax <= 10) return { mitad: 3, madurez: 10 };
    if (pesoMax <= 25) return { mitad: 4, madurez: 12 };
    if (pesoMax <= 45) return { mitad: 5, madurez: 15 };
    return { mitad: 6, madurez: 20 };
  }
  const fraccion = (m, mitad) => (m ** 1.6) / (m ** 1.6 + mitad ** 1.6);

  /* Rango adulto: de la raza (razas = { id: { nombre, peso, altura } }) o del tamaño en mestizos */
  function rango(raza, tamanoNombre, razas, nombreRaza) {
    const r = raza && raza !== 'mestizo' && razas[raza];
    if (r && r.peso) return { peso: r.peso, altura: r.altura, base: `un ${nombreRaza || r.nombre || raza}` };
    const t = DIMS_TAMANO[sinAcentos(tamanoNombre)];
    return t ? { ...t, base: `un perro de tamaño ${String(tamanoNombre).toLowerCase()}` } : null;
  }

  /* Límites aceptados para la edad dada (meses; null = adulto) */
  function limites(rg, meses) {
    const cat = categoria(rg.peso[1]);
    const adulto = meses == null || meses >= cat.madurez;
    if (adulto) {
      return { adulto, peso: [r1(rg.peso[0] * 0.75), r1(rg.peso[1] * 1.3)], altura: [Math.floor(rg.altura[0] * 0.85), Math.ceil(rg.altura[1] * 1.15)] };
    }
    const f = fraccion(meses, cat.mitad);
    const fa = Math.cbrt(f);
    return {
      adulto,
      peso: [Math.max(0.2, r1(rg.peso[0] * f * 0.6)), Math.max(0.5, r1(rg.peso[1] * f * 1.35))],
      altura: [Math.max(6, Math.floor(rg.altura[0] * fa * 0.8)), Math.max(10, Math.ceil(rg.altura[1] * fa * 1.15))],
    };
  }

  /* Valor sugerido: punto medio del rango esperado para la edad (o del de la raza parecida en mestizos) */
  function sugerido(rg, meses, parecido) {
    const base = parecido || rg;
    const cat = categoria(base.peso[1]);
    const f = meses == null || meses >= cat.madurez ? 1 : fraccion(meses, cat.mitad);
    const l = limites(rg, meses);
    const entre = (v, [a, b]) => Math.min(b, Math.max(a, v));
    return {
      peso: entre(r1(((base.peso[0] + base.peso[1]) / 2) * f), l.peso),
      altura: entre(Math.round(((base.altura[0] + base.altura[1]) / 2) * Math.cbrt(f)), l.altura),
    };
  }

  /* Revisión completa: devuelve null o el mensaje de error */
  function problema(peso, altura, rg, meses) {
    if (!Number.isFinite(peso) || peso < 0.2 || peso > 100) return 'Indique el peso en kilos (entre 0.2 y 100 kg).';
    if (!Number.isFinite(altura) || altura < 6 || altura > 110) return 'Indique la altura a la cruz en centímetros (entre 6 y 110 cm).';
    if (!rg) return null;
    const l = limites(rg, meses);
    const quien = l.adulto ? `${rg.base} adulto` : `${rg.base} de ${meses} ${meses === 1 ? 'mes' : 'meses'}`;
    if (peso < l.peso[0] || peso > l.peso[1]) return `El peso no es coherente: para ${quien} se acepta de ${l.peso[0]} a ${l.peso[1]} kg. Revise el peso, la raza o la edad.`;
    if (altura < l.altura[0] || altura > l.altura[1]) return `La altura no es coherente: para ${quien} se acepta de ${l.altura[0]} a ${l.altura[1]} cm. Revise la altura, la raza o la edad.`;
    return null;
  }

  return { DIMS_TAMANO, mesesDeEdad, rango, limites, sugerido, problema };
}));
