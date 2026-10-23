/* Rebote tipo croqueta: cuando bajas el scroll dentro de la parte inferior de la página
   (barra de scroll, rueda del mouse o scroll suave), las tarjetas se aplastan y rebotan,
   y los huesos salen del centro inferior de la pantalla con fuerza y destino distintos. */
(() => {
  if (!document.querySelector('.catalogo') || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // Cada tarjeta guarda su posición para escalonar el rebote
  document.querySelectorAll('.tarjeta').forEach((tarjeta, indice) => {
    tarjeta.style.setProperty('--i', indice);
  });

  const huesos = [...document.querySelectorAll('.croqueta-pieza')];

  const ZONA_FONDO = 100; // px antes del límite inferior donde sí se dispara al bajar
  const RUEDA_MINIMA = 100; // deltaY acumulado de la rueda dentro de la zona para contar como fuerte
  const VENTANA_RUEDA = 250; // ms sin rueda para reiniciar el acumulado
  const DURACION_IMPACTO = 1800; // ms que dura la clase impacto en el body

  let ruedaAcumulada = 0;
  let temporizadorRueda;
  let temporizador;

  const aleatorio = (minimo, maximo) => minimo + Math.random() * (maximo - minimo);

  // Cada hueso sale con fuerza (altura), dirección (lado) y giro distintos
  const sortearSalto = () => {
    huesos.forEach((hueso) => {
      const lado = Math.random() < 0.5 ? -1 : 1;
      hueso.style.setProperty('--x', `${lado * aleatorio(40, 240).toFixed(0)}px`);
      hueso.style.setProperty('--y', `${-aleatorio(90, 320).toFixed(0)}px`);
      hueso.style.setProperty('--r', `${aleatorio(-200, 200).toFixed(0)}deg`);
      hueso.style.setProperty('--d', `${aleatorio(0.9, 1.5).toFixed(2)}s`);
      hueso.style.setProperty('--retraso', `${aleatorio(0, 180).toFixed(0)}ms`);
    });
  };

  const estaEnZonaFondo = () =>
    window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - ZONA_FONDO;

  const golpear = () => {
    if (document.body.classList.contains('impacto')) return;

    ruedaAcumulada = 0;
    sortearSalto();
    document.body.classList.add('impacto');

    clearTimeout(temporizador);
    temporizador = setTimeout(() => document.body.classList.remove('impacto'), DURACION_IMPACTO);
  };

  // Barra de scroll, arrastre o scroll suave: solo cuenta si bajas dentro de la zona inferior
  let ultimaY = window.scrollY;
  window.addEventListener('scroll', () => {
    const desplazamiento = window.scrollY - ultimaY;
    ultimaY = window.scrollY;

    if (desplazamiento > 0 && estaEnZonaFondo()) {
      golpear();
    }
  }, { passive: true });

  // Rueda del mouse: al estar en el fondo la página ya no se mueve, así que se suman las muescas
  window.addEventListener('wheel', (evento) => {
    if (evento.deltaY <= 0 || !estaEnZonaFondo()) return;

    ruedaAcumulada += evento.deltaY;
    clearTimeout(temporizadorRueda);
    temporizadorRueda = setTimeout(() => { ruedaAcumulada = 0; }, VENTANA_RUEDA);

    if (ruedaAcumulada >= RUEDA_MINIMA) {
      golpear();
    }
  }, { passive: true });
})();
