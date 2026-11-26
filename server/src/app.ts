import { createServer, type Server as HTTPServer } from 'http';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Server as SocketIOServer } from 'socket.io';

import { isDatabaseConnected } from './persistence';
import { initializeWebSocket } from './api';
import { RoomError, normalizeCode, type RoomManager } from './rooms/room-manager';
import { characterOptions } from './rooms/character-builder';
import { conditionRules } from './data/dungeoneer';
import { adventureList, getAdventure, DEFAULT_ADVENTURE_ID } from './content/adventures';
import { claudeCodeNarratorEnabled } from './llm/claude-code-narrator';
import { accessRequired, hasAccess, codeMatches, accessCookie } from './access';
import {
  AccountError, registerAccount, verifyLogin, startSession, endSession, accountFromCookie,
  listSavedCharacters, deleteSavedCharacter,
} from './accounts';

export interface AppContext {
  app: Express;
  httpServer: HTTPServer;
  io: SocketIOServer;
  rooms: RoomManager;
}

/** How many tables one address may open per window. */
const CREATE_LIMIT = Number(process.env.ROOM_CREATE_LIMIT) || 5;
const CREATE_WINDOW_MS = 10 * 60 * 1000;
/** Sign-in and sign-up attempts one address may make per window. */
const AUTH_LIMIT = Number(process.env.AUTH_LIMIT) || 20;

function resolveCorsOrigin(): string | string[] | boolean {
  const raw = process.env.CLIENT_ORIGIN;
  if (!raw) return process.env.NODE_ENV === 'production' ? false : true;
  const list = raw.split(',').map(s => s.trim()).filter(Boolean);
  return list.length === 1 ? list[0] : list;
}

export function createApp(): AppContext {
  const corsOrigin = resolveCorsOrigin();
  const app = express();
  if (process.env.TRUST_PROXY) app.set('trust proxy', 1);
  app.use(cors({ origin: corsOrigin }));
  app.use(express.json({ limit: '16kb' }));

  const httpServer = createServer(app);
  const { io, rooms } = initializeWebSocket(httpServer, corsOrigin);

  const createLog = new Map<string, number[]>();
  function underCreateLimit(ip: string): boolean {
    const now = Date.now();
    const recent = (createLog.get(ip) ?? []).filter(t => now - t < CREATE_WINDOW_MS);
    if (recent.length >= CREATE_LIMIT) {
      createLog.set(ip, recent);
      return false;
    }
    recent.push(now);
    createLog.set(ip, recent);
    if (createLog.size > 5000) createLog.clear();
    return true;
  }

  // --- Private deployments: everything below the lock needs the access code.
  const unlockLog = new Map<string, number[]>();
  function underUnlockLimit(ip: string): boolean {
    const now = Date.now();
    const recent = (unlockLog.get(ip) ?? []).filter(t => now - t < CREATE_WINDOW_MS);
    recent.push(now);
    unlockLog.set(ip, recent);
    if (unlockLog.size > 5000) unlockLog.clear();
    return recent.length <= 10;
  }

  app.get('/api/access', (req, res) => {
    res.json({ required: accessRequired(), unlocked: hasAccess(req.headers.cookie) });
  });

  app.post('/api/unlock', (req, res) => {
    if (!accessRequired()) return res.json({ unlocked: true });
    if (!underUnlockLimit(req.ip ?? 'unknown')) {
      return res.status(429).json({ error: 'Too many tries. Wait a few minutes.' });
    }
    if (!codeMatches(req.body?.code)) {
      return res.status(401).json({ error: 'That code is not right.' });
    }
    const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.setHeader('Set-Cookie', accessCookie(secure));
    res.json({ unlocked: true });
  });

  app.use('/api', (req, res, next) => {
    if (req.path === '/health' || hasAccess(req.headers.cookie)) return next();
    res.status(401).json({ error: 'locked' });
  });

  // --- Accounts: email and password, with characters kept between tables.
  const authLog = new Map<string, number[]>();
  function underAuthLimit(ip: string): boolean {
    const now = Date.now();
    const recent = (authLog.get(ip) ?? []).filter(t => now - t < CREATE_WINDOW_MS);
    recent.push(now);
    authLog.set(ip, recent);
    if (authLog.size > 5000) authLog.clear();
    return recent.length <= AUTH_LIMIT;
  }
  const isSecure = (req: Request) => req.secure || req.headers['x-forwarded-proto'] === 'https';

  const signIn = (create: boolean) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!isDatabaseConnected()) return res.status(503).json({ error: 'The server is still starting.' });
      if (!underAuthLimit(req.ip ?? 'unknown')) {
        return res.status(429).json({ error: 'Too many tries. Wait a few minutes.' });
      }
      const { email, password, name } = req.body ?? {};
      const account = create ? await registerAccount(email, password, name) : await verifyLogin(email, password);
      res.setHeader('Set-Cookie', await startSession(account.id, isSecure(req)));
      res.status(create ? 201 : 200).json({ account });
    } catch (err) {
      if (err instanceof AccountError) {
        const status = err.code === 'email_taken' ? 409 : err.code === 'bad_login' ? 401 : 400;
        return res.status(status).json({ error: err.message, code: err.code });
      }
      next(err);
    }
  };
  app.post('/api/auth/register', signIn(true));
  app.post('/api/auth/login', signIn(false));

  app.post('/api/auth/logout', async (req, res, next) => {
    try {
      res.setHeader('Set-Cookie', await endSession(req.headers.cookie));
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  app.get('/api/auth/me', async (req, res, next) => {
    try {
      res.json({ account: await accountFromCookie(req.headers.cookie) });
    } catch (err) { next(err); }
  });

  /** The signed-in player's saved characters. */
  app.get('/api/characters', async (req, res, next) => {
    try {
      const account = await accountFromCookie(req.headers.cookie);
      if (!account) return res.status(401).json({ error: 'Sign in first.' });
      res.json({ characters: await listSavedCharacters(account.id) });
    } catch (err) { next(err); }
  });

  app.delete('/api/characters/:id', async (req, res, next) => {
    try {
      const account = await accountFromCookie(req.headers.cookie);
      if (!account) return res.status(401).json({ error: 'Sign in first.' });
      const removed = await deleteSavedCharacter(account.id, req.params.id);
      res.status(removed ? 200 : 404).json({ removed });
    } catch (err) { next(err); }
  });

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', version: '0.2.0', database: isDatabaseConnected(), rooms: rooms.size });
  });

  /** Open a new table. Returns the invite code. */
  app.post('/api/rooms', async (req, res, next) => {
    try {
      if (!isDatabaseConnected()) {
        return res.status(503).json({ error: 'The server is still starting. Try again in a moment.' });
      }
      if (!underCreateLimit(req.ip ?? 'unknown')) {
        return res.status(429).json({ error: 'You have opened a lot of tables. Try again in a few minutes.' });
      }
      const wanted = req.body?.adventureId ?? DEFAULT_ADVENTURE_ID;
      if (!getAdventure(wanted)) {
        return res.status(400).json({ error: 'That adventure is not available.' });
      }
      const room = await rooms.create(wanted);
      res.status(201).json(rooms.view(room));
    } catch (err) {
      if (err instanceof RoomError) {
        return res.status(err.code === 'server_full' ? 503 : 500).json({ error: err.message });
      }
      next(err);
    }
  });

  /** Adventures a new table can play. The game master's notes stay on the server. */
  app.get('/api/adventures', (_req, res) => {
    const aiNarration = claudeCodeNarratorEnabled()
      || Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY);
    res.json({ aiNarration, defaultId: DEFAULT_ADVENTURE_ID, adventures: adventureList() });
  });

  /** What each condition does, for tooltips. */
  app.get('/api/conditions', (_req, res) => {
    res.json({ conditions: conditionRules() });
  });

  /** Where to get this server's source code (AGPL-3.0, section 13). */
  app.get('/api/about', (_req, res) => {
    res.json({ license: 'AGPL-3.0-or-later', sourceUrl: process.env.SOURCE_URL || null });
  });

  /** Races and classes a player can choose from when making a character. */
  app.get('/api/character-options', (_req, res) => {
    res.json(characterOptions());
  });

  /** Public view of a table: who is sitting where. */
  app.get('/api/rooms/:code', (req, res) => {
    const room = rooms.get(normalizeCode(req.params.code));
    if (!room) return res.status(404).json({ error: 'That table does not exist (it may have closed).' });
    res.json(rooms.view(room));
  });

  if (process.env.NODE_ENV === 'production') {
    const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
    app.use(express.static(dist));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('API error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  });

  return { app, httpServer, io, rooms };
}
