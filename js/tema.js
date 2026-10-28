/* Cambio entre modo claro y oscuro.
   Se aplica antes de pintar la página para evitar un parpadeo y recuerda la elección en el navegador. */
(() => {
  const CLAVE = 'dopta-tema';
  const OSCURO = 'oscuro';
  const raiz = document.documentElement;

  const leerTema = () => {
    try {
      return window.localStorage.getItem(CLAVE);
    } catch (error) {
      return null; // Sin acceso a localStorage (modo privado o bloqueado) se usa el modo claro
    }
  };

  const guardarTema = (tema) => {
    try {
      window.localStorage.setItem(CLAVE, tema);
    } catch (error) {
      // Si no se puede guardar, el cambio dura solo mientras la página esté abierta
    }
  };

  const aplicarTema = (tema) => {
    if (tema === OSCURO) {
      raiz.setAttribute('data-theme', OSCURO);
    } else {
      raiz.removeAttribute('data-theme');
    }
  };

  aplicarTema(leerTema());

  document.addEventListener('DOMContentLoaded', () => {
    const boton = document.querySelector('[data-tema-boton]');
    if (!boton) return;

    const actualizarBoton = () => {
      const esOscuro = raiz.getAttribute('data-theme') === OSCURO;
      const texto = esOscuro ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
      boton.setAttribute('aria-label', texto);
      boton.setAttribute('title', texto);
      boton.setAttribute('aria-pressed', String(esOscuro));
    };

    boton.addEventListener('click', () => {
      const siguiente = raiz.getAttribute('data-theme') === OSCURO ? 'claro' : OSCURO;
      aplicarTema(siguiente);
      guardarTema(siguiente);
      actualizarBoton();
    });

    actualizarBoton();
  });
})();
