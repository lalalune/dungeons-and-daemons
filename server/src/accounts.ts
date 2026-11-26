/**
 * Player accounts: sign in with email and password, and keep characters
 * between tables.
 *
 * Passwords are stored as salted scrypt hashes. A signed-in browser holds a
 * random session token in an HttpOnly cookie; the database stores only its
 * SHA-256, so a leaked table cannot be replayed as a login.
 */

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { sql } from 'drizzle-orm';
import { getDatabase } from './persistence';
import type { CharacterSheet } from './types';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

const SESSION_COOKIE = 'dnd_session';
const SESSION_DAYS = 30;
export const MAX_SAVED_CHARACTERS = 20;

export interface Account {
  id: string;
  email: string;
  displayName: string;
}

export interface SavedCharacterSummary {
  id: string;
  name: string;
  race: string;
  class: string;
  level: number;
  lastAdventure: string | null;
  updatedAt: string;
}

export class AccountError extends Error {
  constructor(public code: 'bad_email' | 'weak_password' | 'email_taken' | 'bad_login' | 'too_many', message: string) {
    super(message);
  }
}

type Row = Record<string, unknown>;
async function query(q: ReturnType<typeof sql>): Promise<Row[]> {
  const result = await getDatabase().execute(q) as unknown as { rows?: Row[] } | Row[];
  return Array.isArray(result) ? result : result.rows ?? [];
}

// ---------------------------------------------------------------- passwords

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : null;
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function cleanDisplayName(raw: unknown, email: string): string {
  const name = typeof raw === 'string'
    ? raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24)
    : '';
  return name || email.split('@')[0].slice(0, 24);
}

const toAccount = (row: Row): Account => ({
  id: String(row.id), email: String(row.email), displayName: String(row.display_name),
});

// ----------------------------------------------------------------- accounts

export async function registerAccount(rawEmail: unknown, password: unknown, displayName: unknown): Promise<Account> {
  const email = normalizeEmail(rawEmail);
  if (!email) throw new AccountError('bad_email', 'Enter a valid email address.');
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
    throw new AccountError('weak_password', 'Use a password of at least 8 characters.');
  }
  const existing = await query(sql`SELECT 1 FROM accounts WHERE email = ${email}`);
  if (existing.length > 0) throw new AccountError('email_taken', 'That email already has an account. Sign in instead.');

  const hash = await hashPassword(password);
  const rows = await query(sql`
    INSERT INTO accounts (email, password_hash, display_name)
    VALUES (${email}, ${hash}, ${cleanDisplayName(displayName, email)})
    RETURNING id, email, display_name`);
  return toAccount(rows[0]);
}

export async function verifyLogin(rawEmail: unknown, password: unknown): Promise<Account> {
  const email = normalizeEmail(rawEmail);
  const bad = new AccountError('bad_login', 'Email or password is not right.');
  if (!email || typeof password !== 'string' || password.length > 200) throw bad;
  const rows = await query(sql`SELECT id, email, display_name, password_hash FROM accounts WHERE email = ${email}`);
  if (rows.length === 0) {
    // Spend the same time as a real check so the reply does not reveal which emails exist.
    await hashPassword(password);
    throw bad;
  }
  if (!(await passwordMatches(password, String(rows[0].password_hash)))) throw bad;
  await query(sql`UPDATE accounts SET last_login_at = now() WHERE id = ${String(rows[0].id)}`);
  return toAccount(rows[0]);
}

// ----------------------------------------------------------------- sessions

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

function sessionToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    const value = rest.join('=');
    if (name === SESSION_COOKIE && /^[a-f0-9]{64}$/.test(value)) return value;
  }
  return null;
}

/** Starts a session and returns the Set-Cookie header value for it. */
export async function startSession(accountId: string, secure: boolean): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await query(sql`
    INSERT INTO account_sessions (token_hash, account_id, expires_at)
    VALUES (${tokenHash(token)}, ${accountId}, now() + make_interval(days => ${SESSION_DAYS}))`);
  // Old sessions are cleared as a side job; nothing depends on it.
  query(sql`DELETE FROM account_sessions WHERE expires_at < now()`).catch(() => undefined);
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export async function endSession(cookieHeader: string | undefined): Promise<string> {
  const token = sessionToken(cookieHeader);
  if (token) await query(sql`DELETE FROM account_sessions WHERE token_hash = ${tokenHash(token)}`);
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

export async function accountFromCookie(cookieHeader: string | undefined): Promise<Account | null> {
  const token = sessionToken(cookieHeader);
  if (!token) return null;
  const rows = await query(sql`
    SELECT a.id, a.email, a.display_name
    FROM account_sessions s JOIN accounts a ON a.id = s.account_id
    WHERE s.token_hash = ${tokenHash(token)} AND s.expires_at > now()`);
  return rows.length > 0 ? toAccount(rows[0]) : null;
}

// --------------------------------------------------------- saved characters

type Sheet = Omit<CharacterSheet, 'id' | 'campaignId'>;

function storable(sheet: CharacterSheet | Sheet): Sheet {
  const { id: _id, campaignId: _campaignId, ...rest } = sheet as CharacterSheet;
  return rest;
}

const toSummary = (row: Row): SavedCharacterSummary => ({
  id: String(row.id),
  name: String(row.name),
  race: String(row.race),
  class: String(row.class_name),
  level: Number(row.level),
  lastAdventure: row.last_adventure ? String(row.last_adventure) : null,
  updatedAt: new Date(row.updated_at as string).toISOString(),
});

export async function listSavedCharacters(accountId: string): Promise<SavedCharacterSummary[]> {
  const rows = await query(sql`
    SELECT id, name, race, class_name, level, last_adventure, updated_at
    FROM saved_characters WHERE account_id = ${accountId} ORDER BY updated_at DESC`);
  return rows.map(toSummary);
}

export async function createSavedCharacter(accountId: string, sheet: CharacterSheet | Sheet, adventure: string): Promise<string> {
  const count = await query(sql`SELECT count(*)::int AS n FROM saved_characters WHERE account_id = ${accountId}`);
  if (Number(count[0]?.n ?? 0) >= MAX_SAVED_CHARACTERS) {
    throw new AccountError('too_many', `You can keep up to ${MAX_SAVED_CHARACTERS} characters. Delete one first.`);
  }
  const rows = await query(sql`
    INSERT INTO saved_characters (account_id, name, race, class_name, level, sheet, last_adventure)
    VALUES (${accountId}, ${sheet.name}, ${String(sheet.race)}, ${String(sheet.class)}, ${sheet.level},
            ${JSON.stringify(storable(sheet))}::jsonb, ${adventure})
    RETURNING id`);
  return String(rows[0].id);
}

export async function loadSavedCharacter(accountId: string, id: string): Promise<Sheet | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await query(sql`SELECT sheet FROM saved_characters WHERE id = ${id} AND account_id = ${accountId}`);
  if (rows.length === 0) return null;
  const sheet = rows[0].sheet;
  return (typeof sheet === 'string' ? JSON.parse(sheet) : sheet) as Sheet;
}

/** Writes a character's current state back to its owner's roster. */
export async function updateSavedCharacter(id: string, sheet: CharacterSheet | Sheet, adventure: string): Promise<void> {
  await query(sql`
    UPDATE saved_characters
    SET sheet = ${JSON.stringify(storable(sheet))}::jsonb, name = ${sheet.name}, level = ${sheet.level},
        last_adventure = ${adventure}, updated_at = now()
    WHERE id = ${id}`);
}

export async function deleteSavedCharacter(accountId: string, id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const rows = await query(sql`DELETE FROM saved_characters WHERE id = ${id} AND account_id = ${accountId} RETURNING id`);
  return rows.length > 0;
}
