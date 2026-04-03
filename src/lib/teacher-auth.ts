import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";
import type { User } from "@supabase/supabase-js";

import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";

export type TeacherProfile = {
  id: string;
  email: string;
  displayName: string;
};

export type TeacherAuthState = {
  authRequired: boolean;
  user: User | null;
  profile: TeacherProfile | null;
};

function getFallbackDisplayName(user: User) {
  const metadataDisplayName =
    typeof user.user_metadata?.display_name === "string"
      ? user.user_metadata.display_name.trim()
      : "";

  return metadataDisplayName || user.email?.split("@")[0] || "Teacher";
}

const readTeacherAuthState = cache(async (): Promise<TeacherAuthState> => {
  if (!isSupabaseConfigured()) {
    return {
      authRequired: false,
      user: null,
      profile: null,
    };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      authRequired: true,
      user: null,
      profile: null,
    };
  }

  let { data: profile } = await supabase
    .from("teacher_profiles")
    .select("id, email, display_name")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    const fallbackProfile = {
      id: user.id,
      email: user.email ?? "",
      display_name: getFallbackDisplayName(user),
    };
    const { data: insertedProfile, error: insertError } = await supabase
      .from("teacher_profiles")
      .upsert(fallbackProfile)
      .select("id, email, display_name")
      .single();

    if (!insertError) {
      profile = insertedProfile;
    }
  }

  return {
    authRequired: true,
    user,
    profile: profile
      ? {
          id: profile.id,
          email: profile.email,
          displayName: profile.display_name,
        }
      : null,
  };
});

export async function getTeacherAuthState() {
  return readTeacherAuthState();
}

export async function requireTeacherSession() {
  const authState = await readTeacherAuthState();

  if (authState.authRequired && (!authState.user || !authState.profile)) {
    redirect("/teacher/login");
  }

  return authState;
}

export async function ensureTeacherApiSession() {
  const authState = await readTeacherAuthState();

  if (!authState.authRequired) {
    return authState;
  }

  return authState.user && authState.profile ? authState : null;
}