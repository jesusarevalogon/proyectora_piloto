// src/components/navbar.js
export function renderNavbar() {
  const current = (window.location.hash || "").replace("#", "");

  const is = (r) => (current === r ? "tab active" : "tab");

  return `
    <header class="tabs">
      <a class="${is("presupuesto")}" href="#presupuesto" onclick="window.navigateTo('presupuesto')">Presupuesto</a>
      <a class="tab" href="#ruta" data-tab="ruta">Ruta Crítica</a>
      <a class="${is("documentacion")}" href="#documentacion" onclick="window.navigateTo('documentacion')">Documentación</a>
      <a class="${is("entrega")}" href="#entrega" onclick="window.navigateTo('entrega')">Entrega</a>
    </header>
  `;
}
