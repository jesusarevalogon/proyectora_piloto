// src/main.js
import { initRouter, navigate } from "./router.js";
import { renderNavbar } from "./components/navbar.js";
import { login, logout, onSessionChanged } from "./services/authService.js";
import { getUserProfile, getProject } from "./services/projectService.js";

import { renderPresupuestoView, bindPresupuestoEvents } from "./modules/presupuesto.js";
import { renderRutaCriticaView, bindRutaCriticaEvents } from "./modules/rutaCritica.js";
import { renderDocumentacionView, bindDocumentacionEvents } from "./modules/documentacion.js";

// ✅ AJUSTE QUIRÚRGICO: NO importamos entrega.js aquí para que no truene la app por "pdf-lib"
let entregaModule = null;
let entregaLoadingPromise = null;

const app = document.getElementById("app");

// Estado global simple
window.appState = {
  user: null,
  profile: null,
  project: null,
  role: null,
};

// Hacemos navigate accesible al navbar
window.navigateTo = (route) => navigate(route);

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[m]));
}

function mapAuthError(err) {
  const code = err?.code || "";
  if (code.includes("auth/invalid-credential") || code.includes("local/invalid-credential")) return "Credenciales inválidas.";
  if (code.includes("auth/user-not-found")) return "Usuario no encontrado.";
  if (code.includes("auth/wrong-password")) return "Password incorrecto.";
  if (code.includes("auth/too-many-requests")) return "Demasiados intentos. Intenta más tarde.";
  return "No se pudo iniciar sesión. Revisa email/password.";
}

// UI: Login
function renderLogin(errorMsg = "") {
  app.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <h2>Iniciar sesión</h2>
        <div class="small">Sistema Carpeta Cine (V1)</div>

        <label>Email</label>
        <input id="email" type="email" placeholder="correo@ejemplo.com" />

        <label>Password</label>
        <input id="password" type="password" placeholder="********" />

        <button class="btn btn-primary" id="btnLogin">Entrar</button>

        ${errorMsg ? `<div class="error">${escapeHtml(errorMsg)}</div>` : ""}

        <div class="small" style="margin-top:10px;">
          Si estás en modo local (sin Firebase), usa:<br/>
          <b>admin@demo.com</b> / <b>123456</b> o <b>user@demo.com</b> / <b>123456</b>
        </div>
      </div>
    </div>
  `;

  document.getElementById("btnLogin").addEventListener("click", async () => {
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    try {
      await login(email, password);
    } catch (err) {
      renderLogin(mapAuthError(err));
    }
  });
}

// ✅ Loader mínimo (quirúrgico) para cuando estás cargando Entrega
function renderEntregaLoading(route) {
  const projectName = window.appState.project?.name ?? "(sin proyecto)";
  const responsable = window.appState.project?.responsable ?? "-";

  app.innerHTML = `
    ${renderNavbar()}
    <div class="container">
      <div class="card topbar-card">
        <div>
          <b>Proyecto:</b> ${escapeHtml(projectName)}
          <span class="muted"> | </span>
          <b>Responsable:</b> ${escapeHtml(responsable)}
        </div>
        <button class="btn btn-ghost" id="btnLogout">Cerrar sesión</button>
      </div>

      <div class="card" style="margin-top:12px;">
        <h2>Cargando Entrega…</h2>
        <p class="muted">Preparando el módulo, no cierres esta ventana.</p>
      </div>
    </div>
  `;

  const btnLogout = document.getElementById("btnLogout");
  if (btnLogout) btnLogout.addEventListener("click", async () => logout());

  // Cuando termine de cargar, re-render normal en esa ruta
  ensureEntregaModule()
    .then(() => renderDashboard(route))
    .catch((e) => {
      alert(e?.message || String(e));
      navigate(""); // vuelve a home si truena
    });
}

function ensureEntregaModule() {
  if (entregaModule) return Promise.resolve(entregaModule);
  if (entregaLoadingPromise) return entregaLoadingPromise;

  entregaLoadingPromise = import("./modules/entrega.js")
    .then((m) => {
      entregaModule = m;
      return m;
    })
    .finally(() => {
      entregaLoadingPromise = null;
    });

  return entregaLoadingPromise;
}

// UI: Dashboard base
function renderDashboard(route) {
  const currentRoute = (route || "").replace("#", "");

  const projectName = window.appState.project?.name ?? "(sin proyecto)";
  const responsable = window.appState.project?.responsable ?? "-";

  let content = "";

  switch (currentRoute) {
    case "presupuesto":
      content = renderPresupuestoView();
      break;

    case "ruta":
      content = renderRutaCriticaView();
      break;

    case "documentacion":
      content = renderDocumentacionView();
      break;

    case "entrega":
      // ✅ AJUSTE QUIRÚRGICO: cargar entrega.js bajo demanda
      if (!entregaModule) {
        renderEntregaLoading(route);
        return;
      }
      content = entregaModule.renderEntregaView();
      break;

    default:
      content = `
        <div class="container">
          <div class="card">
            <h2>Bienvenida</h2>
            <p><b>Proyecto:</b> ${escapeHtml(projectName)}</p>
            <p><b>Responsable:</b> ${escapeHtml(responsable)}</p>
            <button class="btn btn-primary" id="btnGoBudget">Ir a Presupuesto</button>
          </div>
        </div>
      `;
  }

  app.innerHTML = `
    ${renderNavbar()}
    <div class="container">
      <div class="card topbar-card">
        <div>
          <b>Proyecto:</b> ${escapeHtml(projectName)}
          <span class="muted"> | </span>
          <b>Responsable:</b> ${escapeHtml(responsable)}
        </div>
        <button class="btn btn-ghost" id="btnLogout">Cerrar sesión</button>
      </div>
    </div>
    ${content}
  `;

  // Logout
  const btnLogout = document.getElementById("btnLogout");
  if (btnLogout) btnLogout.addEventListener("click", async () => logout());

  // Home -> presupuesto
  const btnGoBudget = document.getElementById("btnGoBudget");
  if (btnGoBudget) btnGoBudget.addEventListener("click", () => navigate("presupuesto"));

  // Bind módulos
  if (currentRoute === "presupuesto") bindPresupuestoEvents();
  if (currentRoute === "ruta") bindRutaCriticaEvents();
  if (currentRoute === "documentacion") bindDocumentacionEvents();
  if (currentRoute === "entrega" && entregaModule) entregaModule.bindEntregaEvents();
}

// Router init (solo cuando estás logueado)
function startAppRouter() {
  initRouter((hash) => renderDashboard(hash));
}

// Sesión
onSessionChanged(async (user) => {
  if (!user) {
    window.appState = { user: null, profile: null, project: null, role: null };
    renderLogin();
    return;
  }

  try {
    const profile = await getUserProfile(user.uid);

    let project = null;
    if (profile.role !== "admin") {
      if (!profile.projectId) throw new Error("Este usuario no tiene projectId asignado.");
      project = await getProject(profile.projectId);
    }

    window.appState.user = user;
    window.appState.profile = profile;
    window.appState.role = profile.role;
    window.appState.project = project;

    startAppRouter();
    if (!window.location.hash) navigate(""); // home
  } catch (err) {
    await logout();
    renderLogin(`Error de configuración: ${err.message}`);
  }
});
