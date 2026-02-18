// src/services/projectService.js
import { db } from "./firebase.js";

// Firebase Firestore (si existe)
import {
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Seed V1 local
function getLocalProfile(uid) {
  if (uid === "LOCAL_ADMIN") {
    return { role: "admin", projectId: null, name: "Admin" };
  }
  return { role: "user", projectId: "p1", name: "Paloma" };
}

function getLocalProject(projectId) {
  if (projectId === "p1") {
    return { id: "p1", name: "Proyecto Demo", responsable: "Paloma" };
  }
  return { id: projectId, name: "(sin proyecto)", responsable: "-" };
}

export async function getUserProfile(uid) {
  if (!db) return getLocalProfile(uid);

  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("No existe perfil en users/" + uid);
  return snap.data();
}

export async function getProject(projectId) {
  if (!db) return getLocalProject(projectId);

  const ref = doc(db, "projects", projectId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("No existe project en projects/" + projectId);
  return { id: projectId, ...snap.data() };
}
