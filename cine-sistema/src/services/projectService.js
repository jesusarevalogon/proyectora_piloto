// src/services/projectService.js
import { supabase } from "./supabase.js";

// ======= Fallback local =======
function getLocalProfile(uid) {
  if (uid === "LOCAL_ADMIN") return { role: "admin", projectId: null, name: "Admin" };
  return { role: "user", projectId: "p1", name: "Local User" };
}

function getLocalProject(projectId) {
  return { id: projectId, name: "Proyecto Local", responsable: "Responsable Local" };
}

// ======= API =======
export async function getUserProfile(uid) {
  if (!supabase) return getLocalProfile(uid);

  const { data, error } = await supabase
    .from("profiles")
    .select("role,name,project_id")
    .eq("id", uid)
    .single();

  if (error) throw error;

  return {
    role: data.role,
    name: data.name,
    projectId: data.project_id,
  };
}

export async function getProject(projectId) {
  if (!supabase) return getLocalProject(projectId);

  const { data, error } = await supabase
    .from("projects")
    .select("id,name,responsable")
    .eq("id", projectId)
    .single();

  if (error) throw error;
  return data;
}
