/* Autocompletado de direcciones con Google Places API (New).
   La API key vive solo en el servidor (.env → GOOGLE_MAPS_API_KEY); el navegador nunca la ve.
   Sin key configurada, la dirección se escribe a mano como antes. */
const express = require('express');
const { q } = require('./db');
const { h, falla, limpiar } = require('./util');
const { limitador } = require('./seguridad');

const r = express.Router();
const BASE = process.env.GOOGLE_PLACES_URL || 'https://places.googleapis.com/v1';
const clave = () => process.env.GOOGLE_MAPS_API_KEY || '';

/* Rectángulo que cubre la Ciudad de México: las sugerencias se limitan a esta zona */
const CDMX = { low: { latitude: 19.04, longitude: -99.37 }, high: { latitude: 19.6, longitude: -98.94 } };
const enCDMX = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng)
  && lat >= CDMX.low.latitude && lat <= CDMX.high.latitude && lng >= CDMX.low.longitude && lng <= CDMX.high.longitude;

const RE_TOKEN = /^[A-Za-z0-9-]{10,40}$/;
const RE_PLACE = /^[A-Za-z0-9_-]{10,300}$/;
const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Protege la cuota de Google: 60 consultas por minuto por conexión
const limite = limitador({ ventanaMin: 1, max: 60, mensaje: 'Demasiadas búsquedas de dirección. Espere un momento.' });

async function google(ruta, opciones) {
  const ctrl = new AbortController();
  const reloj = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(`${BASE}${ruta}`, { ...opciones, signal: ctrl.signal });
    if (!res.ok) {
      console.error('Google Places', res.status, (await res.text()).slice(0, 300));
      falla('No se pudo consultar la dirección. Escríbala manualmente.', 502);
    }
    return res.json();
  } catch (e) {
    if (e.status) throw e;
    falla('No se pudo consultar la dirección. Escríbala manualmente.', 502);
  } finally {
    clearTimeout(reloj);
  }
}

r.get('/lugares/estado', (req, res) => res.json({ activo: !!clave() }));

/* Sugerencias mientras se escribe */
r.post('/lugares/sugerencias', limite, h(async (req, res) => {
  if (!clave()) return res.json({ sugerencias: [], activo: false });
  const b = req.body || {};
  const texto = limpiar(b.texto).slice(0, 120);
  if ([...texto].length < 3) return res.json({ sugerencias: [] });
  if (!RE_TOKEN.test(String(b.sesion || ''))) falla('Solicitud inválida.');
  const j = await google('/places:autocomplete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': clave() },
    body: JSON.stringify({
      input: texto,
      languageCode: 'es',
      regionCode: 'mx',
      includedRegionCodes: ['mx'],
      locationRestriction: { rectangle: CDMX },
      sessionToken: b.sesion,
    }),
  });
  const sugerencias = (j.suggestions || [])
    .map((s) => s.placePrediction)
    .filter(Boolean)
    .slice(0, 5)
    .map((p) => ({
      id: p.placeId,
      principal: (p.structuredFormat && p.structuredFormat.mainText && p.structuredFormat.mainText.text) || (p.text && p.text.text) || '',
      secundario: (p.structuredFormat && p.structuredFormat.secondaryText && p.structuredFormat.secondaryText.text) || '',
    }));
  res.json({ sugerencias });
}));

/* Detalle del lugar elegido: dirección limpia, alcaldía del catálogo y coordenadas */
r.post('/lugares/detalle', limite, h(async (req, res) => {
  if (!clave()) falla('El autocompletado de direcciones no está disponible.', 503);
  const b = req.body || {};
  if (!RE_PLACE.test(String(b.id || '')) || !RE_TOKEN.test(String(b.sesion || ''))) falla('Solicitud inválida.');
  const j = await google(`/places/${encodeURIComponent(b.id)}?languageCode=es&regionCode=mx&sessionToken=${encodeURIComponent(b.sesion)}`, {
    headers: { 'X-Goog-Api-Key': clave(), 'X-Goog-FieldMask': 'id,formattedAddress,addressComponents,location' },
  });
  const lat = j.location && Number(j.location.latitude);
  const lng = j.location && Number(j.location.longitude);
  if (!enCDMX(lat, lng)) falla('La dirección debe estar dentro de la Ciudad de México.');

  // Dirección sin el país, recortada a 200 caracteres (RF-04)
  const direccion = limpiar(String(j.formattedAddress || '').replace(/,\s*(México|Mexico|Méx\.?)\s*$/i, '')).slice(0, 200);

  // Busca la alcaldía comparando los componentes de Google con las 16 del catálogo
  const alcaldias = await q("SELECT id, nombre FROM catalogo_valores WHERE catalogo = 'alcaldia' AND activo = 1");
  // Solo componentes administrativos: así una calle o colonia llamada "Miguel Hidalgo" no se confunde con la alcaldía
  const ADMIN = ['sublocality', 'sublocality_level_1', 'locality', 'administrative_area_level_2', 'administrative_area_level_3'];
  const nombres = (j.addressComponents || [])
    .filter((c) => (c.types || []).some((t) => ADMIN.includes(t)))
    .flatMap((c) => [c.longText, c.shortText]).map(norm);
  const clave16 = (n) => norm(n).replace(/^la\s+/, '').replace(/\s+de\s+morelos$/, '');
  const alc = alcaldias.find((a) => nombres.some((n) => n === norm(a.nombre) || n.includes(clave16(a.nombre))));

  res.json({ direccion, alcaldia_id: alc ? alc.id : null, lat, lng, place_id: j.id || b.id });
}));

module.exports = { router: r, enCDMX, RE_PLACE };
