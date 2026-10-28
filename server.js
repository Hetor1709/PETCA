/* Punto de entrada para Vercel (detecta Express automáticamente en server.js de la raíz).
   En tu computadora sigue usándose:  npm start  (server/inicio.js). */
require('express');
module.exports = require('./server/index').app;
