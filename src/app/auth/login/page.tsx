"use client";

import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { getPostLoginRedirectPath } from "@/lib/auth/redirect-path";
import { BRAND } from "@/lib/brand";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { LoginCredentials } from "@/types/erp.types";

const isLiveAuth = isSupabaseConfigured();

export default function LoginPage() {
  const router = useRouter();
  const { login, isLoading, isAuthenticated, user } = useAuth();
  const [formData, setFormData] = useState<LoginCredentials>({
    email: "",
    password: "",
    rememberMe: false,
  });
  const [error, setError] = useState("");
  const [isHydrated, setIsHydrated] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isLoading && isAuthenticated && user) {
      router.replace(
        getPostLoginRedirectPath(user.role, user.storeKey, user.permissions),
      );
    }
  }, [isAuthenticated, isLoading, router, user]);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const submitLogin = async () => {
    setError("");

    if (!isLiveAuth) {
      setError("Configure Supabase Auth before signing in.");
      return;
    }

    setIsSubmitting(true);

    try {
      const session = await login(formData);
      router.push(
        getPostLoginRedirectPath(
          session.user.role,
          session.user.storeKey,
          session.user.permissions,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void submitLogin();
  };

  return (
    <div className="w-full">
      <div className="mb-6 text-center sm:mb-8">
        <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-[20px] bg-slate-950 shadow-[0_22px_48px_rgba(15,23,42,0.2)] sm:h-16 sm:w-16 sm:rounded-[22px]">
          <span className="font-satoshi text-xl font-black tracking-[0.12em] text-white sm:text-2xl">
            {BRAND.mark}
          </span>
        </div>
        <h1 className="font-satoshi mb-2 text-3xl font-bold text-slate-950 sm:text-4xl">
          {BRAND.name}
        </h1>
        <p className="font-satoshi text-sm text-slate-600">
          {BRAND.authSubtitle}
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 shadow-sm">
          <p className="font-satoshi text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="rounded-[24px] border border-slate-200/80 bg-white/92 p-5 shadow-[0_30px_80px_rgba(15,23,42,0.14)] backdrop-blur-xl sm:rounded-[28px] sm:p-8">
        <div className="mb-6 rounded-2xl border border-teal-100 bg-teal-50 p-4">
          <p className="font-satoshi text-sm font-medium text-slate-700">
            {isLiveAuth
              ? `Secure ${BRAND.name} login is active. Use an email and password created in Supabase Auth.`
              : "Supabase Auth is not configured. Add the required environment variables before signing in."}
          </p>
        </div>

        <form
          action="/auth/login"
          method="post"
          onSubmit={handleSubmit}
          className="space-y-5"
        >
          <div>
            <label
              htmlFor="email"
              className="font-satoshi mb-2 block text-sm font-medium text-slate-700"
            >
              Email Address
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-3 h-5 w-5 text-slate-400" />
              <input
                id="email"
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="you@company.com"
                required
                className="font-satoshi w-full rounded-xl border border-stroke bg-white py-3 pl-10 pr-4 text-dark placeholder-slate-400 transition focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/15"
                disabled={!isHydrated || isSubmitting || !isLiveAuth}
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="password"
              className="font-satoshi mb-2 block text-sm font-medium text-slate-700"
            >
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-3 h-5 w-5 text-slate-400" />
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                name="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="••••••••"
                required
                className="font-satoshi w-full rounded-xl border border-stroke bg-white py-3 pl-10 pr-12 text-dark placeholder-slate-400 transition focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/15"
                disabled={!isHydrated || isSubmitting || !isLiveAuth}
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-3 top-3 text-slate-400 transition hover:text-slate-600"
              >
                {showPassword ? (
                  <EyeOff className="h-5 w-5" />
                ) : (
                  <Eye className="h-5 w-5" />
                )}
              </button>
            </div>
          </div>

          <label className="flex cursor-pointer items-center space-x-3">
            <input
              type="checkbox"
              name="rememberMe"
              checked={formData.rememberMe}
              onChange={handleChange}
              className="h-4 w-4 cursor-pointer rounded border-stroke bg-white text-primary focus:ring-primary/20"
              disabled={!isHydrated || !isLiveAuth}
            />
            <span className="font-satoshi text-sm text-slate-600">
              Keep me signed in
            </span>
          </label>

          <button
            type="button"
            onClick={() => {
              void submitLogin();
            }}
            disabled={!isHydrated || isSubmitting || !isLiveAuth}
            className="font-satoshi mt-7 w-full rounded-xl bg-slate-950 px-4 py-3 font-semibold text-white shadow-[0_16px_30px_rgba(15,23,42,0.18)] transition duration-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center space-x-2">
                <svg
                  className="h-5 w-5 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                <span>Signing in...</span>
              </span>
            ) : isLiveAuth ? (
              "Sign In"
            ) : (
              "Supabase Required"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
