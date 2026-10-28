/* Pantalla de carga entre páginas: aparece al cambiar de página y se oculta al terminar de cargar.
   Respeta la preferencia de reducir movimiento: en ese caso no muestra la animación. */
(() => {
  const TIEMPO_MINIMO = 900; // ms que se muestra como mínimo, para que no parpadee
  const TIEMPO_SALIDA = 350; // ms antes de cambiar de página, para que se vea la pantalla
  const reducirMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const inicio = performance.now();
  let pantalla;

  const crearPantalla = () => {
    pantalla = document.createElement('div');
    pantalla.className = 'cargando';
    pantalla.setAttribute('role', 'status');
    pantalla.innerHTML = '<img src="img/cargando.svg" alt="Cargando la página"><p>CARGANDO...</p>';
    document.body.appendChild(pantalla);
  };

  const ocultar = () => {
    if (!pantalla) return;
    pantalla.classList.add('cargando--oculto');
  };

  const mostrar = () => {
    if (!pantalla) return;
    pantalla.classList.remove('cargando--oculto');
  };

  document.addEventListener('DOMContentLoaded', () => {
    if (reducirMovimiento) return;
    crearPantalla();
  });

  window.addEventListener('load', () => {
    if (!pantalla) return;
    const espera = Math.max(0, TIEMPO_MINIMO - (performance.now() - inicio));
    setTimeout(ocultar, espera);
  });

  // Al volver con el botón atrás la página puede quedar con la pantalla visible
  window.addEventListener('pageshow', (evento) => {
    if (evento.persisted) ocultar();
  });

  // Al ir a otra página de Dopta se muestra la pantalla antes de navegar
  document.addEventListener('click', (evento) => {
    if (reducirMovimiento || !pantalla) return;
    if (evento.defaultPrevented || evento.button !== 0 || evento.metaKey || evento.ctrlKey || evento.shiftKey) return;

    const enlace = evento.target.closest('a[href]');
    if (!enlace || enlace.target === '_blank' || enlace.hasAttribute('download')) return;

    const destino = new URL(enlace.href, window.location.href);
    const esMismaPagina = destino.pathname === window.location.pathname;
    const esDeEsteSitio = destino.origin === window.location.origin;
    if (!esDeEsteSitio || esMismaPagina || destino.hash) return;

    evento.preventDefault();
    mostrar();
    setTimeout(() => {
      window.location.href = destino.href;
    }, TIEMPO_SALIDA);
  });
})();
