import { cache } from "react";
import { redirect } from "next/navigation";
import { getUserSafely } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { mapSupabaseUserToAuthUser, PROFILE_SELECT, type ProfileRecord } from "./shared";

export const getCurrentUser = cache(async () => {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await getUserSafely(supabase);

  if (!user) {
    return null;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select(PROFILE_SELECT)
    .eq("id", user.id)
    .maybeSingle<ProfileRecord>();

  return {
    user,
    profile: profile ?? null,
    appUser: mapSupabaseUserToAuthUser(user, profile ?? null),
  };
});

export async function requireCurrentUser() {
  const auth = await getCurrentUser();

  if (!auth?.user) {
    redirect("/auth/login");
  }

  return auth;
}
