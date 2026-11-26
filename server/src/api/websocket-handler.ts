import { Server as SocketIOServer, Socket } from 'socket.io';
import type { Server as HTTPServer } from 'http';
import type { GameState } from '../campaign';
import { processPlayerAction, getGameStatus } from '../campaign';
import { extractConditionNames, buildCharacterPayload } from '../combat/condition-utils';
import { RoomManager, RoomError, normalizeCode, type Room } from '../rooms/room-manager';
import { requestMove, boardTokens, partyVitals } from '../rooms/board';
import { hasAccess } from '../access';
import { resolveRoll, type RollRequest } from '../rooms/rolls';
import { awardLoot, equipItem, unequipItem } from '../rooms/loot';
import { characterRepository } from '../persistence';
import {
  accountFromCookie, createSavedCharacter, loadSavedCharacter, AccountError, type Account,
} from '../accounts';
import { buildCharacter } from '../rooms/character-builder';
import type { CharacterSheet } from '../types';
import { cleanCharacterName, cleanBackstory, isRace, isCharacterClass } from '../rooms/character-builder';

interface ClientData {
  roomCode?: string;
  playerToken?: string;
  playerName?: string;
  characterId?: string;
}

const MAX_MESSAGE_LENGTH = 600;
const MAX_NAME_LENGTH = 24;
/** Minimum gap between actions from one socket (each action is an LLM call). */
const ACTION_COOLDOWN_MS = Number(process.env.ACTION_COOLDOWN_MS ?? 1500);

function buildCombatState(state: GameState) {
  const combat = state.combatEncounter;
  if (!combat) return null;
  return {
    round: combat.round,
    currentTurnIndex: combat.currentTurnIndex,
    combatants: combat.initiativeOrder.map((c, i) => ({
      id: c.id, name: c.name, type: c.type, initiative: c.initiative,
      hp: c.hp, ac: c.ac,
      conditions: extractConditionNames(c.conditions),
      isCurrentTurn: i === combat.currentTurnIndex,
    })),
  };
}

function buildCharacterInfo(state: GameState, characterId: string) {
  const character = state._characters?.find(c => c.id === characterId);
  return character ? buildCharacterPayload(character) : null;
}

/** What the rest of the table sees when someone presses an action button outside combat. */
const ACTION_LABELS: Record<string, string> = {
  explore: 'looks around.',
  investigate: 'searches the area.',
  rest: 'settles down to rest.',
  short_rest: 'takes a short rest.',
  long_rest: 'makes camp for a long rest.',
};

function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') return 'Adventurer';
  // Strip control characters and collapse whitespace
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
  return name || 'Adventurer';
}

function validToken(raw: unknown): raw is string {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(raw);
}

export function initializeWebSocket(
  httpServer: HTTPServer,
  corsOrigin: string | string[] | boolean,
): { io: SocketIOServer; rooms: RoomManager } {
  const io = new SocketIOServer(httpServer, {
    cors: { origin: corsOrigin, methods: ['GET', 'POST'] },
    pingTimeout: 60000, // generous for LLM latency
    pingInterval: 25000,
  });
  // Private deployments: no socket without the access cookie.
  io.use((socket, next) => {
    if (!hasAccess(socket.request.headers.cookie)) return next(new Error('locked'));
    // A signed-in player is recognised on every device, not just this browser.
    accountFromCookie(socket.request.headers.cookie)
      .then(account => { socket.data.account = account; next(); })
      .catch(() => next());
  });

  /** Signed-in players own seats by account; guests by the token in their browser. */
  function identity(socket: Socket, rawToken: unknown): string | null {
    const account = socket.data.account as Account | null | undefined;
    if (account) return `account-${account.id}`;
    return validToken(rawToken) ? rawToken : null;
  }

  const rooms = new RoomManager(io);
  const clients = new Map<string, ClientData>();
  const lastAction = new Map<string, number>();

  /** A fight just ended with the party on its feet: hand out the spoils. */
  async function shareLoot(room: Room): Promise<void> {
    if (room.state.phase === 'combat') return;
    const loot = awardLoot(room.state._characters ?? []);
    if (loot.lines.length === 0) return;
    for (const sheet of loot.changed) {
      if (!sheet.id) continue;
      await characterRepository.updateSheet(sheet.id, sheet).catch(() => undefined);
      io.to(`character:${sheet.id}`).emit('character_update', buildCharacterPayload(sheet));
    }
    io.to(`campaign:${room.campaignId}`).emit('loot', { lines: loot.lines });
  }

  /** Detach a socket from whatever room it is in. */
  function leaveRoom(socket: Socket, opts: { giveUpSeat: boolean }) {
    const client = clients.get(socket.id);
    if (!client?.roomCode) return;
    const room = rooms.get(client.roomCode);
    if (room) {
      if (opts.giveUpSeat && client.playerToken) {
        const seat = rooms.seatOf(room, client.playerToken);
        if (seat) rooms.release(seat);
      }
      rooms.markDisconnected(room, socket.id);
      socket.leave(`campaign:${room.campaignId}`);
      if (client.characterId) socket.leave(`character:${client.characterId}`);
      rooms.broadcast(room);
    }
    client.roomCode = undefined;
    client.characterId = undefined;
  }

  /** Resolve the room + seat a socket is allowed to act for. */
  function actingSeat(socket: Socket): { room: Room; characterId: string } | null {
    const client = clients.get(socket.id);
    if (!client?.roomCode || !client.characterId) return null;
    const room = rooms.get(client.roomCode);
    const seat = room?.seats.get(client.characterId);
    // The seat must still belong to this socket (it may have been reclaimed elsewhere).
    if (!room || !seat || seat.socketId !== socket.id) return null;
    return { room, characterId: client.characterId };
  }

  function tooSoon(socket: Socket): boolean {
    const now = Date.now();
    if (now - (lastAction.get(socket.id) ?? 0) < ACTION_COOLDOWN_MS) return true;
    lastAction.set(socket.id, now);
    return false;
  }

  io.on('connection', (socket: Socket) => {
    clients.set(socket.id, {});

    /** Put a socket at a table, in a seat if one is given, and send it the current state. */
    function enter(room: Room, playerToken: string, playerName: string, characterId: string | undefined): boolean {
      const client = clients.get(socket.id);
      if (!client) return false;

      // Switching tables: leave the old one first.
      if (client.roomCode && client.roomCode !== room.code) {
        leaveRoom(socket, { giveUpSeat: true });
      }

      if (characterId) {
        const result = rooms.claim(room, characterId, playerToken, playerName, socket.id);
        if (!result.ok) {
          socket.emit('room_error', {
            code: result.reason,
            message: result.reason === 'seat_taken'
              ? 'Someone else is playing that character. Pick another.'
              : 'That character is not at this table.',
          });
          return false;
        }
      }

      if (client.characterId && client.characterId !== characterId) {
        socket.leave(`character:${client.characterId}`);
      }
      client.roomCode = room.code;
      client.playerToken = playerToken;
      client.playerName = playerName;
      client.characterId = characterId;

      room.sockets.add(socket.id);
      socket.join(`campaign:${room.campaignId}`);
      if (characterId) socket.join(`character:${characterId}`);

      const state = room.state;
      socket.emit('game_status', getGameStatus(state));
      socket.emit('phase_change', { phase: state.phase });
      if (characterId) {
        const charInfo = buildCharacterInfo(state, characterId);
        if (charInfo) socket.emit('character_update', charInfo);
      }
      const combat = buildCombatState(state);
      if (combat) socket.emit('combat_update', combat);
      socket.emit('tokens_update', boardTokens(room.board));
      socket.emit('party_update', partyVitals(state));
      socket.emit('scene_update', { key: state._scene ?? 'village' });

      socket.emit('join_confirmed', {
        code: room.code,
        campaignId: room.campaignId,
        characterId: characterId ?? null,
        characterName: characterId ? room.seats.get(characterId)?.name : undefined,
        campaignName: room.campaignName,
        phase: state.phase,
      });

      if (state._openingNarration && !room.sawOpening.has(playerToken)) {
        room.sawOpening.add(playerToken);
        socket.emit('dm_narration', { content: state._openingNarration });
      }

      rooms.broadcast(room);
      return true;
    }

    socket.on('join_room', (payload: { code?: string; playerToken?: string; playerName?: string; characterId?: string }) => {
      try {
        const room = rooms.get(normalizeCode(payload?.code));
        if (!room) {
          return socket.emit('room_error', { code: 'not_found', message: 'That table does not exist (it may have closed).' });
        }
        const playerToken = identity(socket, payload.playerToken);
        if (!playerToken) {
          return socket.emit('room_error', { code: 'bad_request', message: 'Missing player identity. Reload the page.' });
        }
        const wanted = typeof payload.characterId === 'string' ? payload.characterId : undefined;
        // Rejoining without naming a seat returns the player to the seat they hold.
        const held = rooms.seatOf(room, playerToken);
        enter(room, playerToken, cleanName(payload.playerName), wanted ?? held?.characterId);
      } catch (error) {
        console.error('Error in join_room:', error);
        socket.emit('room_error', { code: 'server', message: 'Failed to join the table.' });
      }
    });

    /** Make a new character and sit down as them. */
    socket.on('create_character', async (payload: {
      code?: string; playerToken?: string; playerName?: string;
      character?: { name?: string; race?: string; class?: string; backstory?: string };
    }) => {
      try {
        const room = rooms.get(normalizeCode(payload?.code));
        if (!room) {
          return socket.emit('room_error', { code: 'not_found', message: 'That table does not exist (it may have closed).' });
        }
        const playerToken = identity(socket, payload.playerToken);
        if (!playerToken) {
          return socket.emit('room_error', { code: 'bad_request', message: 'Missing player identity. Reload the page.' });
        }
        const account = socket.data.account as Account | null | undefined;
        const name = cleanCharacterName(payload.character?.name);
        const race = payload.character?.race;
        const klass = payload.character?.class;
        if (!name) {
          return socket.emit('room_error', { code: 'bad_request', message: 'Give your character a name of at least two letters.' });
        }
        if (!isRace(race) || !isCharacterClass(klass)) {
          return socket.emit('room_error', { code: 'bad_request', message: 'Pick a race and a class.' });
        }
        if (tooSoon(socket)) {
          return socket.emit('room_error', { code: 'bad_request', message: 'One moment, then try again.' });
        }

        const built = buildCharacter({
          name, race, class: klass, backstory: cleanBackstory(payload.character?.backstory),
        });
        const seat = await rooms.enqueue(room, async () => {
          const added = await rooms.addSheet(room, playerToken, built);
          // Signed-in players keep the character; guests play it for this table only.
          if (account) {
            try {
              added.savedCharacterId = await createSavedCharacter(account.id, built, room.campaignName);
            } catch (error) {
              if (!(error instanceof AccountError)) throw error;
              socket.emit('notice', { message: `${error.message} This character will not be saved.` });
            }
          }
          return added;
        });
        if (enter(room, playerToken, cleanName(payload.playerName), seat.characterId)) {
          rooms.syncTable(room);
        }
      } catch (error) {
        if (error instanceof RoomError) {
          return socket.emit('room_error', { code: error.code, message: error.message });
        }
        console.error('Error in create_character:', error);
        socket.emit('room_error', { code: 'server', message: 'Could not create that character.' });
      }
    });

    /** Bring a character from the player's saved roster to this table. */
    socket.on('bring_character', async (payload: { code?: string; playerName?: string; savedCharacterId?: string }) => {
      try {
        const room = rooms.get(normalizeCode(payload?.code));
        if (!room) {
          return socket.emit('room_error', { code: 'not_found', message: 'That table does not exist (it may have closed).' });
        }
        const account = socket.data.account as Account | null | undefined;
        if (!account) {
          return socket.emit('room_error', { code: 'bad_request', message: 'Sign in to use a saved character.' });
        }
        const savedId = typeof payload.savedCharacterId === 'string' ? payload.savedCharacterId : '';
        const saved = await loadSavedCharacter(account.id, savedId);
        if (!saved) {
          return socket.emit('room_error', { code: 'bad_request', message: 'That saved character could not be found.' });
        }
        if (tooSoon(socket)) {
          return socket.emit('room_error', { code: 'bad_request', message: 'One moment, then try again.' });
        }

        // A new adventure starts rested: full hit points, spell slots and hit dice, no conditions.
        const hp = saved.hp ?? saved.hitPoints;
        const rested = {
          ...saved,
          ...(hp ? { hp: { ...hp, current: hp.max, temp: 0 } } : {}),
          ...(saved.spellSlots
            ? { spellSlots: Object.fromEntries(Object.entries(saved.spellSlots).map(([l, s]) => [l, { ...s, current: s.max }])) }
            : {}),
          ...(saved.hitDice ? { hitDice: { ...saved.hitDice, current: saved.hitDice.max } } : {}),
          conditions: [],
          deathSaves: undefined,
        } as Omit<CharacterSheet, 'id' | 'campaignId'>;

        const playerToken = `account-${account.id}`;
        const seat = await rooms.enqueue(room, () => rooms.addSheet(room, playerToken, rested, savedId));
        if (enter(room, playerToken, cleanName(payload.playerName), seat.characterId)) {
          rooms.syncTable(room);
        }
      } catch (error) {
        if (error instanceof RoomError) {
          return socket.emit('room_error', { code: error.code, message: error.message });
        }
        console.error('Error in bring_character:', error);
        socket.emit('room_error', { code: 'server', message: 'Could not bring that character.' });
      }
    });

    socket.on('leave_room', () => {
      leaveRoom(socket, { giveUpSeat: true });
    });

    socket.on('player_message', async ({ message }: { message: string }) => {
      const acting = actingSeat(socket);
      if (!acting) {
        return socket.emit('error', { message: 'Take a seat at the table to act.' });
      }
      if (typeof message !== 'string' || !message.trim()) return;
      if (tooSoon(socket)) {
        return socket.emit('error', { message: 'Slow down a moment, the DM is still listening.' });
      }
      const text = message.trim().slice(0, MAX_MESSAGE_LENGTH);
      const { room, characterId } = acting;
      const channel = `campaign:${room.campaignId}`;
      const characterName = room.seats.get(characterId)?.name ?? 'Player';

      // Everyone else sees what was said straight away, before the DM answers.
      socket.to(channel).emit('player_action', { characterName, content: text });

      try {
        io.to(channel).emit('dm_typing', { typing: true });
        const wasFighting = room.state.phase === 'combat';
        const result = await rooms.enqueue(room, () =>
          processPlayerAction(room.state, characterId, { type: 'message', description: text }),
        );
        socket.emit('action_result', result);
        if (wasFighting) await shareLoot(room);
        rooms.syncTable(room);
      } catch (error) {
        console.error('Error processing player message:', error);
        socket.emit('error', { message: 'Failed to process message.' });
      } finally {
        io.to(channel).emit('dm_typing', { typing: false });
      }
    });

    socket.on('player_action', async (data: { action: string; target?: string; [key: string]: unknown }) => {
      const acting = actingSeat(socket);
      if (!acting) {
        return socket.emit('error', { message: 'Take a seat at the table to act.' });
      }
      if (typeof data?.action !== 'string' || !data.action) return;
      if (tooSoon(socket)) {
        return socket.emit('error', { message: 'Slow down a moment, the DM is still listening.' });
      }
      const { room, characterId } = acting;
      const channel = `campaign:${room.campaignId}`;
      const characterName = room.seats.get(characterId)?.name ?? 'Player';
      const actionType = data.action.slice(0, 64);

      // Outside a fight, tell the table what was attempted. In a fight the
      // combat log already describes every action to everyone.
      const label = ACTION_LABELS[actionType];
      if (label && room.state.phase !== 'combat') {
        socket.to(channel).emit('player_action', { characterName, content: label });
      }

      try {
        io.to(channel).emit('dm_typing', { typing: true });
        const wasFighting = room.state.phase === 'combat';
        const result = await rooms.enqueue(room, () =>
          processPlayerAction(room.state, characterId, {
            type: actionType,
            description: actionType,
            target: typeof data.target === 'string' ? data.target : undefined,
            // The seat decides who is acting, never the payload.
            metadata: { ...data, characterId },
          }),
        );
        socket.emit('action_result', result);
        if (wasFighting) await shareLoot(room);
        rooms.syncTable(room);
      } catch (error) {
        console.error('Error processing player action:', error);
        socket.emit('error', { message: 'Failed to process action.' });
      } finally {
        io.to(channel).emit('dm_typing', { typing: false });
      }
    });

    /** Put on or take off something from the bag. */
    const changeGear = (wear: boolean) => async ({ name }: { name?: string } = {}) => {
      const acting = actingSeat(socket);
      if (!acting) return;
      const { room, characterId } = acting;
      const sheet = room.state._characters?.find(c => c.id === characterId);
      if (!sheet) return;
      const result = wear ? equipItem(sheet, name) : unequipItem(sheet, name);
      if (!result.ok) return socket.emit('error', { message: result.message });
      await characterRepository.updateSheet(characterId, sheet).catch(() => undefined);
      io.to(`character:${characterId}`).emit('character_update', buildCharacterPayload(sheet));
      io.to(`campaign:${room.campaignId}`).emit('player_action', { characterName: sheet.name, content: result.message });
      rooms.syncTable(room);
    };
    socket.on('equip_item', changeGear(true));
    socket.on('unequip_item', changeGear(false));

    /** Roll a check from the character sheet, or loose dice. Everyone sees the result. */
    socket.on('roll', async (request: RollRequest) => {
      const acting = actingSeat(socket);
      if (!acting) {
        return socket.emit('error', { message: 'Take a seat at the table to roll.' });
      }
      const { room, characterId } = acting;
      const sheet = room.state._characters?.find(c => c.id === characterId);
      const outcome = sheet ? resolveRoll(sheet, request ?? {}) : null;
      if (!outcome) {
        return socket.emit('error', { message: 'That roll did not make sense. Try something like 2d6+3.' });
      }
      const channel = `campaign:${room.campaignId}`;
      const characterName = room.seats.get(characterId)?.name ?? 'Player';
      io.to(channel).emit('dice_roll', {
        characterName, label: outcome.label, detail: outcome.detail, total: outcome.total, natural: outcome.natural,
      });

      // A check made outside a fight goes to the Dungeon Master to say what happens.
      if (!outcome.isCheck || room.state.phase === 'combat' || tooSoon(socket)) return;
      const note = outcome.natural === 20 ? ' (a natural 20)' : outcome.natural === 1 ? ' (a natural 1)' : '';
      try {
        io.to(channel).emit('dm_typing', { typing: true });
        await rooms.enqueue(room, () =>
          processPlayerAction(room.state, characterId, {
            type: 'roll',
            description: `I rolled a ${outcome.label}: ${outcome.total}${note}. Decide whether that is enough for what I was attempting and tell me what happens.`,
          }),
        );
        rooms.syncTable(room);
      } catch (error) {
        console.error('Error resolving roll:', error);
      } finally {
        io.to(channel).emit('dm_typing', { typing: false });
      }
    });

    socket.on('move_token', (payload: { id?: string; x?: number; y?: number }) => {
      const acting = actingSeat(socket);
      if (!acting) return;
      const { room, characterId } = acting;
      // Players may only move their own token, and only where the rules allow.
      const result = payload?.id === characterId
        ? requestMove(room.board, room.state, characterId, payload.x, payload.y)
        : { ok: false as const, reason: 'You can only move your own character.' };
      if (!result.ok) {
        // Put the sender's map back the way it really is.
        socket.emit('tokens_update', boardTokens(room.board));
        socket.emit('move_rejected', { message: result.reason });
        return;
      }
      const token = room.board.tokens.get(characterId);
      if (token) {
        socket.to(`campaign:${room.campaignId}`).emit('token_moved', { id: token.id, x: token.x, y: token.y });
      }
    });

    socket.on('request_state', () => {
      try {
        const client = clients.get(socket.id);
        const room = client?.roomCode ? rooms.get(client.roomCode) : undefined;
        if (!room) return;
        socket.emit('game_status', getGameStatus(room.state));
        if (client?.characterId) {
          const charInfo = buildCharacterInfo(room.state, client.characterId);
          if (charInfo) socket.emit('character_update', charInfo);
        }
        const combat = buildCombatState(room.state);
        if (combat) socket.emit('combat_update', combat);
        socket.emit('tokens_update', boardTokens(room.board));
        socket.emit('party_update', partyVitals(room.state));
        socket.emit('room_update', rooms.view(room));
      } catch (error) {
        console.error('Error in request_state:', error);
      }
    });

    socket.on('disconnect', () => {
      // Seat stays reserved so a refresh or dropped connection can reclaim it.
      leaveRoom(socket, { giveUpSeat: false });
      clients.delete(socket.id);
      lastAction.delete(socket.id);
    });
  });

  return { io, rooms };
}
