import {
  createAttemptLocal,
  createClassLocal,
  getClassByCodePublicLocal,
  getClassByCodeLocal,
  getClassByIdLocal,
  getPublicTestStatsLocal,
  getPublishedTestByIdLocal,
  getTestByIdLocal,
  listAttemptsForTestLocal,
  listAttemptsLocal,
  listPublishedClassesLocal,
  listPublishedTestsLocal,
  listClassesLocal,
  listTestsLocal,
  saveTestLocal,
} from "@/lib/persistence-local";
import {
  createPublicAttemptSupabase,
  createClassSupabase,
  getClassByCodePublicSupabase,
  getClassByCodeSupabase,
  getClassByIdSupabase,
  getPublicTestStatsSupabase,
  getPublishedTestByIdPublicSupabase,
  getTestByIdSupabase,
  listAttemptsForTestSupabase,
  listAttemptsSupabase,
  listPublishedClassesPublicSupabase,
  listPublishedTestsPublicSupabase,
  listClassesSupabase,
  listTestsSupabase,
  saveTestSupabase,
} from "@/lib/persistence-supabase";
import type {
  CreateAttemptInput,
  CreateClassInput,
  SaveTestInput,
} from "@/lib/persistence-types";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export function getPersistenceBackend() {
  return isSupabaseConfigured() ? "supabase" : "local-json";
}

export async function listClasses() {
  return getPersistenceBackend() === "supabase"
    ? listClassesSupabase()
    : listClassesLocal();
}

export async function getClassById(classId: string) {
  return getPersistenceBackend() === "supabase"
    ? getClassByIdSupabase(classId)
    : getClassByIdLocal(classId);
}

export async function getClassByCode(classCode: string) {
  return getPersistenceBackend() === "supabase"
    ? getClassByCodeSupabase(classCode)
    : getClassByCodeLocal(classCode);
}

export async function getClassByCodePublic(classCode: string) {
  return getPersistenceBackend() === "supabase"
    ? getClassByCodePublicSupabase(classCode)
    : getClassByCodePublicLocal(classCode);
}

export async function createClass(input: CreateClassInput) {
  return getPersistenceBackend() === "supabase"
    ? createClassSupabase(input)
    : createClassLocal(input);
}

export async function listTests() {
  return getPersistenceBackend() === "supabase"
    ? listTestsSupabase()
    : listTestsLocal();
}

export async function getTestById(testId: string) {
  return getPersistenceBackend() === "supabase"
    ? getTestByIdSupabase(testId)
    : getTestByIdLocal(testId);
}

export async function listPublishedClassesPublic() {
  return getPersistenceBackend() === "supabase"
    ? listPublishedClassesPublicSupabase()
    : listPublishedClassesLocal();
}

export async function listPublishedTestsPublic() {
  return getPersistenceBackend() === "supabase"
    ? listPublishedTestsPublicSupabase()
    : listPublishedTestsLocal();
}

export async function getPublishedTestByIdPublic(testId: string) {
  return getPersistenceBackend() === "supabase"
    ? getPublishedTestByIdPublicSupabase(testId)
    : getPublishedTestByIdLocal(testId);
}

export async function saveTest(input: SaveTestInput) {
  return getPersistenceBackend() === "supabase"
    ? saveTestSupabase(input)
    : saveTestLocal(input);
}

export async function listAttempts() {
  return getPersistenceBackend() === "supabase"
    ? listAttemptsSupabase()
    : listAttemptsLocal();
}

export async function listAttemptsForTest(testId: string) {
  return getPersistenceBackend() === "supabase"
    ? listAttemptsForTestSupabase(testId)
    : listAttemptsForTestLocal(testId);
}

export async function getPublicTestStats(testId: string) {
  return getPersistenceBackend() === "supabase"
    ? getPublicTestStatsSupabase(testId)
    : getPublicTestStatsLocal(testId);
}

export async function createAttempt(input: CreateAttemptInput) {
  return getPersistenceBackend() === "supabase"
    ? createPublicAttemptSupabase(input)
    : createAttemptLocal(input);
}