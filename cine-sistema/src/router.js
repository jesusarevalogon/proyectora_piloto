// src/router.js
export function initRouter(onRoute) {
  function handle() {
    const hash = window.location.hash || "";
    onRoute(hash);
  }
  window.addEventListener("hashchange", handle);
  handle();
}

export function navigate(route) {
  // route: "presupuesto" | "ruta" | "documentacion" | "entrega" | ""
  window.location.hash = route ? `#${route}` : "";
}
