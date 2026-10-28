/* Envío de correos (RF-08). Sin SMTP configurado, el enlace se muestra en la consola (modo desarrollo). */
const nodemailer = require('nodemailer');

const transporte = process.env.SMTP_HOST
  ? nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    requireTLS: true,
    tls: { minVersion: 'TLSv1.2' },
  })
  : null;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function enviarRecuperacion(destino, nombre, enlace) {
  if (!transporte) {
    console.log(`[correo · desarrollo] Enlace de recuperación para ${destino}: ${enlace}`);
    return;
  }
  await transporte.sendMail({
    from: process.env.SMTP_FROM || 'Dopta <no-responder@dopta.mx>',
    to: destino,
    subject: 'Restablece tu contraseña de Dopta',
    text: `Hola ${nombre}:\n\nUsa este enlace para restablecer tu contraseña. Funciona una sola vez y vence en 30 minutos.\n\n${enlace}\n\nSi no lo pediste, ignora este correo.`,
    html: `<p>Hola ${esc(nombre)}:</p><p>Usa este enlace para restablecer tu contraseña. Funciona una sola vez y vence en 30 minutos.</p><p><a href="${esc(enlace)}">Restablecer contraseña</a></p><p>Si no lo pediste, ignora este correo.</p>`,
  });
}

module.exports = { enviarRecuperacion };
