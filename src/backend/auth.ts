import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { getDb } from "./db";

const scrypt = promisify(scryptCallback);
const COOKIE_NAME = "edusearch_session";
const SESSION_DAYS = 30;

export type SessionUser = { id: string; name: string; email: string; role: "user" | "admin" };

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [algorithm, salt, hex] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !hex) return false;
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hex, "hex");
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

export function sessionFromRequest(request: Request): SessionUser | null {
  const cookies = parseCookies(request.headers.get("cookie") ?? "");
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  const tokenHash = sha256(token);
  const row = getDb()
    .prepare(
      `
    SELECT u.id,u.name,u.email,u.role
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>?
  `,
    )
    .get(tokenHash, new Date().toISOString()) as SessionUser | undefined;
  return row ?? null;
}

export function requireUser(request: Request) {
  const user = sessionFromRequest(request);
  if (!user) throw new HttpError(401, "Please log in to continue.");
  return user;
}

export function requireAdmin(request: Request) {
  const user = requireUser(request);
  if (user.role !== "admin") throw new HttpError(403, "Administrator access is required.");
  return user;
}

export function createSession(userId: string, request: Request) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  getDb()
    .prepare("INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES(?,?,?,?)")
    .run(randomUUID(), userId, sha256(token), expires.toISOString());
  return {
    token,
    cookie: `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${
      shouldUseSecureCookie(request) ? "; Secure" : ""
    }`,
  };
}

export function destroySession(request: Request) {
  const cookies = parseCookies(request.headers.get("cookie") ?? "");
  if (cookies[COOKIE_NAME])
    getDb().prepare("DELETE FROM sessions WHERE token_hash=?").run(sha256(cookies[COOKIE_NAME]));
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${shouldUseSecureCookie(request) ? "; Secure" : ""}`;
}

export function assertSameOrigin(request: Request) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  if (!origin) return;
  const expected = new URL(request.url).origin;
  if (origin !== expected) throw new HttpError(403, "Cross-origin request rejected.");
}

function shouldUseSecureCookie(request: Request) {
  if (process.env.COOKIE_SECURE === "true") return true;
  if (process.env.COOKIE_SECURE === "false") return false;
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return forwarded === "https" || new URL(request.url).protocol === "https:";
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function parseCookies(header: string) {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index === -1
          ? [part, ""]
          : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}
