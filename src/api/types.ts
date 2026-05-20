// API-Response-Typen — bewusst defensiv (viele optional), weil der Backend-
// Vertrag aus CLAUDE.md additiv erweitert wird. Pflicht-Felder hier
// entspricht "App-stabile Endpoints"-Vertrag (siehe CLAUDE.md Section 6).

export type UserRole =
  | "admin"
  | "editor"
  | "viewer"
  | "learner"
  | "teacher"
  | "school_admin";

export interface AuthMeResponse {
  id: number;
  email: string;
  username: string;
  role: UserRole;
  display_name?: string | null;
  is_active: boolean;
  xp_total?: number;
  student_class_id?: number | null;
  student_login_name?: string | null;
  oauth_provider?: string | null;
  mfa_enabled?: boolean;
  lab_agb_accepted_version?: string | null;
  suspended_at?: string | null;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type?: string;
  user?: AuthMeResponse;
}

export interface MfaChallengeResponse {
  mfa_required: true;
  mfa_token: string;
}

// Backend liefert title/description als {de, en}-Object direkt im Field
// (anders als Blog/Legal die _de/_en-Suffix nutzen).
export type I18nText = string | { de?: string; en?: string };

export interface LabModule {
  id: number;
  slug: string;
  title: I18nText;
  description?: I18nText;
  difficulty?: string;
  estimated_duration_minutes?: number;
  duration_minutes?: number;
  display_order?: number;
  published?: boolean;
  progress?: {
    total_tasks?: number;
    passed?: number;
    status?: string;
    last_active_at?: string | null;
    first_lesson_slug?: string;
  };
  lesson_count?: number;
  task_count?: number;
  category?: string;
  is_locked?: boolean;
}

export interface LabModulesResponse {
  modules: LabModule[];
}

export interface LabLessonSummary {
  id: number;
  slug: string;
  title: I18nText;
  module_slug?: string;
  module_title?: I18nText;
  intro_preview?: I18nText;
  display_order?: number;
  order_index?: number;
  estimated_minutes?: number;
  task_count?: number;
}

export interface LabLessonDetail extends LabLessonSummary {
  intro_md?: I18nText;
  content_markdown?: I18nText;
  content?: I18nText;
  blocks?: Array<{ type: string; content?: string | I18nText; data?: unknown }>;
  tasks?: Array<{ id: number; slug: string; title: I18nText; description?: I18nText }>;
}

export function resolveI18n(value: I18nText | undefined, locale: "de" | "en" = "de"): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  // Object-Form: {de, en}. Primary locale zuerst, dann andere, dann leer.
  const primary = value[locale];
  if (typeof primary === "string" && primary.length > 0) return primary;
  const fallback = value[locale === "de" ? "en" : "de"];
  if (typeof fallback === "string") return fallback;
  return "";
}

// Backend liefert session_id (UUID) statt id, vm_ipv4 statt vm_ip,
// lesson_slug statt module_slug, ends_at statt expires_at (beides
// optional vorhanden bei verschiedenen Endpoints).
export interface LabSession {
  session_id?: string;
  id?: number | string;
  status: string;
  module_slug?: string;
  lesson_slug?: string;
  lesson_title?: I18nText;
  vm_ipv4?: string;
  vm_ipv6?: string;
  vm_ip?: string;
  vm_user?: string;
  ends_at?: string;
  expires_at?: string;
  started_at?: string;
  created_at?: string;
  cost_per_hour_eur?: number;
  reconnect_token?: string;
  terminal_url?: string;
}

export function sessionId(s: LabSession): string | undefined {
  return s.session_id ?? (s.id != null ? String(s.id) : undefined);
}

export function sessionIp(s: LabSession): string | undefined {
  return s.vm_ipv4 ?? s.vm_ip ?? s.vm_ipv6;
}

export function sessionExpiry(s: LabSession): string | undefined {
  return s.ends_at ?? s.expires_at;
}

export interface CostEstimate {
  today_eur?: number;
  threshold_eur?: number;
  threshold_exceeded?: boolean;
  active_sessions?: number;
  currency?: string;
  // Legacy/zukunfts-feld - tolerieren falls Backend Schema-aendert
  monthly_used_cents?: number;
  monthly_budget_cents?: number;
  sessions_this_month?: number;
  next_reset?: string;
}

// Backend liefert Blog/Legal-Texte i18n-getrennt: title_de/title_en,
// content_de/content_en. Wir tolerieren zusaetzlich ein single "title"
// und "content_html/content_markdown" fuer Forward-Compat falls das
// Schema sich vereinheitlicht.
export interface BlogPost {
  id?: number;
  slug?: string;
  title?: string;
  title_de?: string;
  title_en?: string;
  excerpt?: string;
  excerpt_de?: string;
  excerpt_en?: string;
  published_at?: string;
  author?: string;
  content_html?: string;
  content_markdown?: string;
  content_de?: string;
  content_en?: string;
}

export interface LegalDocument {
  slug?: string;
  type?: string;
  title?: string;
  title_de?: string;
  title_en?: string;
  content_html?: string;
  content_markdown?: string;
  content_de?: string;
  content_en?: string;
  version?: string;
  updated_at?: string;
}

// Helper-Typ-Guard fuer i18n-Felder
export function pickLocaleText(
  obj: Record<string, unknown>,
  field: string,
  locale: "de" | "en" = "de",
): string | undefined {
  const localized = obj[`${field}_${locale}`];
  if (typeof localized === "string" && localized.length > 0) return localized;
  const fallback = obj[`${field}_${locale === "de" ? "en" : "de"}`];
  if (typeof fallback === "string" && fallback.length > 0) return fallback;
  const plain = obj[field];
  if (typeof plain === "string") return plain;
  return undefined;
}

export interface SchoolClass {
  id: number;
  name: string;
  class_code?: string;
  student_count?: number;
  created_at?: string;
}

export interface TeacherOut {
  id: number;
  email: string;
  display_name?: string | null;
  is_active: boolean;
  created_at?: string;
}
