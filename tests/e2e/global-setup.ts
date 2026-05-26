import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { loadE2EEnv } from "./load-env";

const FULL_ACCESS_PERMISSIONS = ["*"];

type ProfileStoreRow = {
  store_key: string | null;
};

type StoreRow = {
  store_key: string;
};

async function findUserByEmail(supabase: SupabaseClient, email: string) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000,
    });

    if (error) {
      throw error;
    }

    const user = data.users.find(
      (candidate) => candidate.email?.toLowerCase() === email.toLowerCase(),
    );

    if (user) {
      return user;
    }

    if (!data.nextPage) {
      return null;
    }
  }

  return null;
}

async function upsertE2EAdminUser(
  supabase: SupabaseClient,
  email: string,
  password: string,
) {
  const existingUser = await findUserByEmail(supabase, email);
  let user: User | null = null;

  if (existingUser) {
    const { data, error } = await supabase.auth.admin.updateUserById(
      existingUser.id,
      {
        app_metadata: { role: "admin" },
        email_confirm: true,
        password,
        user_metadata: {
          full_name: "E2E Admin",
          role: "admin",
          status: "active",
        },
      },
    );

    if (error) {
      throw error;
    }

    user = data.user;
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      app_metadata: { role: "admin" },
      email,
      email_confirm: true,
      password,
      user_metadata: {
        full_name: "E2E Admin",
        role: "admin",
        status: "active",
      },
    });

    if (error) {
      throw error;
    }

    user = data.user;
  }

  if (!user) {
    throw new Error("Failed to prepare E2E admin auth user.");
  }

  const { data: existingProfile, error: profileReadError } = await supabase
    .from("profiles")
    .select("store_key")
    .eq("id", user.id)
    .maybeSingle<ProfileStoreRow>();

  if (profileReadError) {
    throw profileReadError;
  }

  let storeKey = existingProfile?.store_key ?? null;

  if (!storeKey) {
    const { data: firstStore, error: storeError } = await supabase
      .from("stores")
      .select("store_key")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle<StoreRow>();

    if (storeError) {
      throw storeError;
    }

    storeKey = firstStore?.store_key ?? null;
  }

  if (!storeKey) {
    throw new Error("E2E admin setup requires at least one existing store.");
  }

  const { error: profileWriteError } = await supabase.from("profiles").upsert({
    email,
    full_name: "E2E Admin",
    id: user.id,
    permissions: FULL_ACCESS_PERMISSIONS,
    role: "admin",
    status: "active",
    store_key: storeKey,
  });

  if (profileWriteError) {
    throw profileWriteError;
  }
}

export default async function globalSetup() {
  loadE2EEnv();

  const email = process.env.E2E_ADMIN_EMAIL?.trim();
  const password = process.env.E2E_ADMIN_PASSWORD;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const shouldSyncAdminUser = process.env.E2E_SYNC_ADMIN_USER === "1";

  if (
    !shouldSyncAdminUser ||
    !email ||
    !password ||
    !supabaseUrl ||
    !serviceRoleKey
  ) {
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  await upsertE2EAdminUser(supabase, email, password);
}
