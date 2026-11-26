/**
 * Room Manager
 *
 * A room is one table: its own campaign, its own game state, and a set of
 * seats (one per party character) that players claim with a private token.
 */

import type { Server as SocketIOServer } from 'socket.io';
import { createGameOrchestrator, bootstrapGame, addCharacterToGame, type GameState } from '../campaign';
import { characterRepository } from '../persistence';
import type { CharacterSheet } from '../types';
import { buildCharacter, type CharacterChoices } from './character-builder';
import { updateSavedCharacter } from '../accounts';
import { createBoard, syncBoard, boardTokens, partyVitals, type Board } from './board';
import { createStarterCampaign } from './starter-campaign';
import { DEFAULT_ADVENTURE_ID, getAdventure } from '../content/adventures';
import { DEFAULT_SCENE, sceneFromText } from './scenes';

/** Unambiguous alphabet: no 0/O, 1/I/L. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;

export const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 50;
/** A disconnected player's seat stays reserved for them this long. */
export const SEAT_HOLD_MS = Number(process.env.SEAT_HOLD_MS) || 5 * 60 * 1000;
/** Rooms with nobody connected are dropped after this long. */
/** Premade characters plus the ones players make themselves. */
export const MAX_SEATS = Number(process.env.MAX_SEATS) || 6;
export const ROOM_IDLE_MS = Number(process.env.ROOM_IDLE_MS) || 2 * 60 * 60 * 1000;

export interface Seat {
  characterId: string;
  name: string;
  race: string;
  class: string;
  level: number;
  /** Private token of the player holding the seat, or null when open. */
  playerToken: string | null;
  playerName: string | null;
  /** Socket currently driving the seat; null while the player is away. */
  socketId: string | null;
  disconnectedAt: number | null;
  /** Row in the owner's saved roster that this character is written back to. */
  savedCharacterId?: string;
  /** Last sheet written to the roster, to skip saves when nothing changed. */
  savedSnapshot?: string;
}

export interface Room {
  code: string;
  campaignId: string;
  campaignName: string;
  adventureId: string;
  state: GameState;
  seats: Map<string, Seat>;
  board: Board;
  /** player token -> the character that player created at this table */
  createdBy: Map<string, string>;
  /** Scene last sent to the table, to announce only changes. */
  shownScene?: string;
  /** socket ids of everyone in the room, seated or watching */
  sockets: Set<string>;
  /** player tokens that have already been sent the opening narration */
  sawOpening: Set<string>;
  createdAt: number;
  lastActivity: number;
  /** Serializes actions so two players never mutate game state at once. */
  queue: Promise<unknown>;
}

export interface SeatView {
  characterId: string;
  name: string;
  race: string;
  class: string;
  level: number;
  taken: boolean;
  playerName: string | null;
  connected: boolean;
}

export interface RoomView {
  code: string;
  campaignName: string;
  phase: string;
  seats: SeatView[];
  watching: number;
}

export type ClaimResult =
  | { ok: true; seat: Seat }
  | { ok: false; reason: 'no_such_seat' | 'seat_taken' };

export class RoomError extends Error {
  constructor(public code: 'server_full' | 'not_ready' | 'unknown_adventure' | 'table_full' | 'name_taken' | 'already_created' | 'already_here', message: string) {
    super(message);
  }
}

export function normalizeCode(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toUpperCase().slice(0, 12) : '';
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private sweeper: ReturnType<typeof setInterval> | null = null;

  constructor(private io: SocketIOServer) {}

  get size(): number {
    return this.rooms.size;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(normalizeCode(code));
  }

  private newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) {
        code += CODE_ALPHABET[crypto.getRandomValues(new Uint32Array(1))[0] % CODE_ALPHABET.length];
      }
      if (!this.rooms.has(code)) return code;
    }
  }

  async create(adventureId: string = DEFAULT_ADVENTURE_ID): Promise<Room> {
    this.sweep();
    if (this.rooms.size >= MAX_ROOMS) {
      throw new RoomError('server_full', 'All tables are in use right now. Try again in a little while.');
    }

    const adventure = getAdventure(adventureId);
    if (!adventure) throw new RoomError('unknown_adventure', 'That adventure is not available.');

    const campaignId = await createStarterCampaign(adventure);
    const state = createGameOrchestrator();
    await bootstrapGame(state, this.io, campaignId);
    state._adventure = { title: adventure.title, levels: adventure.levels, dmBrief: adventure.dmBrief };
    state._openingNarration = adventure.opening;
    state._scene = sceneFromText(`${adventure.startLocation.name}. ${adventure.startLocation.description}`)
      ?? sceneFromText(`${adventure.title}. ${adventure.tagline}`)
      ?? DEFAULT_SCENE;
    if (!state.sessionState || !state._characters?.length) {
      throw new RoomError('not_ready', 'Could not set up the adventure.');
    }

    const seats = new Map<string, Seat>();
    for (const c of state._characters) {
      if (c.id) seats.set(c.id, this.openSeat(c));
    }
    const board = createBoard();
    syncBoard(board, state);

    const now = Date.now();
    const room: Room = {
      code: this.newCode(),
      campaignId,
      campaignName: adventure.title,
      adventureId: adventure.id,
      state,
      seats,
      board,
      createdBy: new Map(),
      sockets: new Set(),
      sawOpening: new Set(),
      createdAt: now,
      lastActivity: now,
      queue: Promise.resolve(),
    };
    this.rooms.set(room.code, room);
    return room;
  }

  private openSeat(c: CharacterSheet): Seat {
    return {
      characterId: c.id as string,
      name: c.name,
      race: c.race,
      class: c.class,
      level: c.level,
      playerToken: null,
      playerName: null,
      socketId: null,
      disconnectedAt: null,
    };
  }

  /**
   * A player makes their own character. It joins the party as a new seat;
   * the caller then claims that seat for them. Call this inside enqueue().
   */
  addCharacter(room: Room, playerToken: string, choices: CharacterChoices): Promise<Seat> {
    return this.addSheet(room, playerToken, buildCharacter(choices));
  }

  /**
   * Seat a ready-built character: a new one, or one brought from a player's
   * saved roster (savedCharacterId links it back for saving progress).
   */
  async addSheet(
    room: Room,
    playerToken: string,
    built: Omit<CharacterSheet, 'id' | 'campaignId'>,
    savedCharacterId?: string,
  ): Promise<Seat> {
    if (savedCharacterId) {
      for (const seat of room.seats.values()) {
        if (seat.savedCharacterId === savedCharacterId) {
          throw new RoomError('already_here', 'That character is already at this table.');
        }
      }
    }
    if (room.createdBy.has(playerToken)) {
      throw new RoomError('already_created', 'You have already made a character at this table.');
    }
    if (room.seats.size >= MAX_SEATS) {
      throw new RoomError('table_full', 'This table has no room for another character.');
    }
    const wanted = built.name.toLowerCase();
    for (const seat of room.seats.values()) {
      if (seat.name.toLowerCase() === wanted) {
        throw new RoomError('name_taken', 'Someone at this table already has that name.');
      }
    }

    const sheet = await characterRepository.create({
      campaignId: room.campaignId,
      sheet: built as CharacterSheet,
    });
    addCharacterToGame(room.state, sheet);
    const seat = this.openSeat(sheet);
    seat.savedCharacterId = savedCharacterId;
    room.seats.set(seat.characterId, seat);
    room.createdBy.set(playerToken, seat.characterId);
    syncBoard(room.board, room.state);
    return seat;
  }

  /** Re-read the game and tell the whole table where everyone stands. */
  syncTable(room: Room): void {
    syncBoard(room.board, room.state);
    const channel = `campaign:${room.campaignId}`;
    this.io.to(channel).emit('tokens_update', boardTokens(room.board));
    this.io.to(channel).emit('party_update', partyVitals(room.state));
    if (room.state._scene && room.state._scene !== room.shownScene) {
      room.shownScene = room.state._scene;
      this.io.to(channel).emit('scene_update', { key: room.shownScene });
    }
    this.saveProgress(room);
  }

  /** Write characters that belong to an account back to their owner's roster. */
  saveProgress(room: Room): void {
    for (const seat of room.seats.values()) {
      if (!seat.savedCharacterId) continue;
      const sheet = room.state._characters?.find(c => c.id === seat.characterId);
      if (!sheet) continue;
      const snapshot = JSON.stringify(sheet);
      if (snapshot === seat.savedSnapshot) continue;
      seat.savedSnapshot = snapshot;
      updateSavedCharacter(seat.savedCharacterId, sheet, room.campaignName)
        .catch(err => console.error('Could not save character progress:', (err as Error).message));
    }
  }

  /** Seat currently held by this player token, if any. */
  seatOf(room: Room, playerToken: string): Seat | undefined {
    for (const seat of room.seats.values()) {
      if (seat.playerToken === playerToken) return seat;
    }
    return undefined;
  }

  /**
   * Claim a seat. A seat held by someone else can only be taken once its
   * holder has been disconnected for longer than SEAT_HOLD_MS.
   */
  claim(room: Room, characterId: string, playerToken: string, playerName: string, socketId: string): ClaimResult {
    const seat = room.seats.get(characterId);
    if (!seat) return { ok: false, reason: 'no_such_seat' };

    if (seat.playerToken && seat.playerToken !== playerToken) {
      const abandoned =
        seat.socketId === null &&
        seat.disconnectedAt !== null &&
        Date.now() - seat.disconnectedAt > SEAT_HOLD_MS;
      if (!abandoned) return { ok: false, reason: 'seat_taken' };
    }

    // One seat per player: give up any other seat they hold.
    const previous = this.seatOf(room, playerToken);
    if (previous && previous !== seat) this.release(previous);

    seat.playerToken = playerToken;
    seat.playerName = playerName;
    seat.socketId = socketId;
    seat.disconnectedAt = null;
    room.lastActivity = Date.now();
    return { ok: true, seat };
  }

  release(seat: Seat): void {
    seat.playerToken = null;
    seat.playerName = null;
    seat.socketId = null;
    seat.disconnectedAt = null;
  }

  /** The socket went away; keep the seat reserved for its player. */
  markDisconnected(room: Room, socketId: string): void {
    room.sockets.delete(socketId);
    for (const seat of room.seats.values()) {
      if (seat.socketId === socketId) {
        seat.socketId = null;
        seat.disconnectedAt = Date.now();
      }
    }
    room.lastActivity = Date.now();
  }

  /** Run a task after every earlier task for this room has finished. */
  enqueue<T>(room: Room, task: () => Promise<T>): Promise<T> {
    const run = room.queue.then(task, task);
    room.queue = run.catch(() => undefined);
    room.lastActivity = Date.now();
    return run;
  }

  view(room: Room): RoomView {
    const seated = new Set<string>();
    const seats: SeatView[] = [];
    for (const seat of room.seats.values()) {
      if (seat.socketId) seated.add(seat.socketId);
      seats.push({
        characterId: seat.characterId,
        name: seat.name,
        race: seat.race,
        class: seat.class,
        level: seat.level,
        taken: seat.playerToken !== null,
        playerName: seat.playerName,
        connected: seat.socketId !== null,
      });
    }
    let watching = 0;
    for (const id of room.sockets) if (!seated.has(id)) watching++;
    return {
      code: room.code,
      campaignName: room.campaignName,
      phase: room.state.phase,
      seats,
      watching,
    };
  }

  broadcast(room: Room): void {
    this.io.to(`campaign:${room.campaignId}`).emit('room_update', this.view(room));
  }

  /** Drop rooms that have had nobody connected for ROOM_IDLE_MS. */
  sweep(now = Date.now()): number {
    let removed = 0;
    for (const [code, room] of this.rooms) {
      if (room.sockets.size === 0 && now - room.lastActivity > ROOM_IDLE_MS) {
        this.rooms.delete(code);
        removed++;
      }
    }
    return removed;
  }

  startSweeper(intervalMs = 10 * 60 * 1000): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => this.sweep(), intervalMs);
    (this.sweeper as { unref?: () => void }).unref?.();
  }

  stopSweeper(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
  }
}
