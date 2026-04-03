import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/lib/supabase/database.types";
import {
  getSupabaseAnonKey,
  getSupabaseUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/env";

function buildTeacherLoginUrl(request: NextRequest) {
  const loginUrl = request.nextUrl.clone();
  const nextPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;

  loginUrl.pathname = "/teacher/login";

  if (nextPath.startsWith("/teacher")) {
    loginUrl.searchParams.set("next", nextPath);
  } else {
    loginUrl.searchParams.delete("next");
  }

  return loginUrl;
}

function resolveTeacherNextPath(value: string | null) {
  if (!value || !value.startsWith("/teacher")) {
    return "/teacher";
  }

  return value;
}

function copyResponseCookies(source: NextResponse, target: NextResponse) {
  for (const cookie of source.cookies.getAll()) {
    target.cookies.set(cookie);
  }

  return target;
}

export async function updateSession(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.next({
      request: {
        headers: request.headers,
      },
    });
  }

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient<Database>(
    getSupabaseUrl(),
    getSupabaseAnonKey(),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookieValues) {
          for (const { name, value, options } of cookieValues) {
            request.cookies.set({
              name,
              value,
              ...options,
            });
          }

          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });

          for (const { name, value, options } of cookieValues) {
            response.cookies.set({
              name,
              value,
              ...options,
            });
          }
        },
      },
    },
  );

  let claims: Record<string, unknown> | null = null;

  try {
    const { data } = await supabase.auth.getClaims();
    claims = data?.claims ?? null;
  } catch {
    claims = null;
  }

  const pathname = request.nextUrl.pathname;
  const isTeacherLogin = pathname === "/teacher/login";
  const isProtectedTeacherRoute =
    pathname === "/teacher" || pathname.startsWith("/teacher/");

  if (isProtectedTeacherRoute && !isTeacherLogin && !claims) {
    return copyResponseCookies(
      response,
      NextResponse.redirect(buildTeacherLoginUrl(request)),
    );
  }

  if (isTeacherLogin && claims) {
    const targetUrl = request.nextUrl.clone();

    targetUrl.pathname = resolveTeacherNextPath(
      request.nextUrl.searchParams.get("next"),
    );
    targetUrl.search = "";

    return copyResponseCookies(response, NextResponse.redirect(targetUrl));
  }

  return response;
}