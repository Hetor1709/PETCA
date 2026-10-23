/* Buscador del catálogo: filtra las tarjetas por raza o nombre mientras escribes.
   No distingue mayúsculas ni acentos y no recarga la página. */
(() => {
  const campo = document.getElementById('buscar');
  const vacio = document.getElementById('sin-resultados');
  const formulario = campo ? campo.closest('form') : null;
  const tarjetas = [...document.querySelectorAll('.catalogo li')];
  if (!campo || !vacio || !formulario || tarjetas.length === 0) return;

  const normalizar = (texto) =>
    texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  const filtrar = () => {
    const termino = normalizar(campo.value);
    let coincidencias = 0;

    tarjetas.forEach((elemento) => {
      const coincide = normalizar(elemento.textContent).includes(termino);
      elemento.hidden = !coincide;
      if (coincide) coincidencias += 1;
    });

    vacio.hidden = coincidencias > 0;
  };

  campo.addEventListener('input', filtrar);

  // Enter no recarga la página: aplica el mismo filtro
  formulario.addEventListener('submit', (evento) => {
    evento.preventDefault();
    filtrar();
  });
})();
