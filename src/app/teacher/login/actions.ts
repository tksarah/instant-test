"use server";

import { redirect } from "next/navigation";

import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";

export type TeacherAuthFormState = {
  status: "idle" | "error" | "success";
  message: string;
};

function getFormValue(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function normalizeNextPath(value: string) {
  return value.startsWith("/teacher") ? value : "/teacher";
}

function formatAuthErrorMessage(message: string) {
  if (message.includes("Invalid login credentials")) {
    return "メールアドレスまたはパスワードが正しくありません。";
  }

  if (message.includes("Email not confirmed")) {
    return "メール確認が完了していません。メール設定を確認してください。";
  }

  if (message.includes("User already registered")) {
    return "このメールアドレスは既に登録されています。ログインしてください。";
  }

  return message || "認証に失敗しました。";
}

export async function signInTeacher(
  _previousState: TeacherAuthFormState,
  formData: FormData,
): Promise<TeacherAuthFormState> {
  if (!isSupabaseConfigured()) {
    return {
      status: "error",
      message: "Supabase 認証が未設定のため、ログインは不要です。",
    };
  }

  const email = getFormValue(formData, "email");
  const password = getFormValue(formData, "password");
  const nextPath = normalizeNextPath(getFormValue(formData, "next"));

  if (!email || !password) {
    return {
      status: "error",
      message: "メールアドレスとパスワードを入力してください。",
    };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return {
      status: "error",
      message: formatAuthErrorMessage(error.message),
    };
  }

  redirect(nextPath);
}

export async function signUpTeacher(
  _previousState: TeacherAuthFormState,
  formData: FormData,
): Promise<TeacherAuthFormState> {
  if (!isSupabaseConfigured()) {
    return {
      status: "error",
      message: "Supabase 認証が未設定のため、アカウント作成は無効です。",
    };
  }

  const displayName = getFormValue(formData, "displayName");
  const email = getFormValue(formData, "email");
  const password = getFormValue(formData, "password");
  const confirmPassword = getFormValue(formData, "confirmPassword");
  const nextPath = normalizeNextPath(getFormValue(formData, "next"));

  if (!displayName || !email || !password) {
    return {
      status: "error",
      message: "表示名、メールアドレス、パスワードを入力してください。",
    };
  }

  if (password.length < 6) {
    return {
      status: "error",
      message: "パスワードは 6 文字以上で入力してください。",
    };
  }

  if (password !== confirmPassword) {
    return {
      status: "error",
      message: "確認用パスワードが一致しません。",
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: displayName,
      },
    },
  });

  if (error) {
    return {
      status: "error",
      message: formatAuthErrorMessage(error.message),
    };
  }

  if (data.session) {
    redirect(nextPath);
  }

  return {
    status: "success",
    message:
      "先生アカウントを作成しました。メール確認が不要な環境では、そのままログインできます。",
  };
}

export async function signOutTeacher() {
  if (!isSupabaseConfigured()) {
    redirect("/teacher");
  }

  const supabase = await createSupabaseServerClient();

  await supabase.auth.signOut();

  redirect("/teacher/login");
}