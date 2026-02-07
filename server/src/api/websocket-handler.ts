import { Server as SocketIOServer, Socket } from 'socket.io';
import type { Server as HTTPServer } from 'http';
import type { GameState } from '../campaign';
import { processPlayerAction, getGameStatus } from '../campaign';
import { extractConditionNames, buildCharacterPayload } from '../combat/condition-utils';

interface ClientData {
  campaignId?: string;
  characterId?: string;
  characterName?: string;
}

const clients = new Map<string, ClientData>();
const receivedOpening = new Set<string>(); // tracks who got the opening narration (survives reconnects)

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

export function initializeWebSocket(httpServer: HTTPServer, gameState: GameState): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.CLIENT_ORIGIN || 'http://localhost:3345',
      methods: ['GET', 'POST'],
    },
    pingTimeout: 60000, // generous for LLM latency
    pingInterval: 25000,
  });

  io.on('connection', (socket: Socket) => {
    console.log(`Client connected: ${socket.id}`);
    clients.set(socket.id, {});
    socket.emit('game_status', getGameStatus(gameState));

    socket.on('join_campaign', ({ campaignId, characterId }: { campaignId: string; characterId?: string }) => {
      try {
        const client = clients.get(socket.id);
        if (!client) return;

        client.campaignId = campaignId;
        client.characterId = characterId;
        if (characterId) {
          client.characterName = gameState._characters?.find(c => c.id === characterId)?.name ?? 'Adventurer';
        }

        socket.join(`campaign:${campaignId}`);
        if (characterId) socket.join(`character:${characterId}`);

        socket.emit('phase_change', { phase: gameState.phase });
        if (characterId) {
          const charInfo = buildCharacterInfo(gameState, characterId);
          if (charInfo) socket.emit('character_update', charInfo);
        }
        const combat = buildCombatState(gameState);
        if (combat) socket.emit('combat_update', combat);

        socket.emit('join_confirmed', {
          campaignId, characterId,
          characterName: client.characterName,
          campaignName: gameState._campaign?.name ?? null,
          phase: gameState.phase,
        });

        const openingKey = `${campaignId}:${characterId ?? socket.id}`;
        if (gameState._openingNarration && !receivedOpening.has(openingKey)) {
          receivedOpening.add(openingKey);
          socket.emit('dm_narration', { content: gameState._openingNarration });
        }
      } catch (error) {
        console.error('Error in join_campaign:', error);
        socket.emit('error', { message: 'Failed to join campaign.' });
      }
    });

    socket.on('player_message', async ({ message }: { message: string; characterId?: string }) => {
      const client = clients.get(socket.id);
      const characterId = client?.characterId;
      if (!characterId || !gameState.sessionState) {
        return socket.emit('error', { message: 'Not in an active session. Join a campaign first.' });
      }

      try {
        if (client?.campaignId) {
          io.to(`campaign:${client.campaignId}`).emit('dm_typing', { typing: true });
        }

        const result = await processPlayerAction(gameState, characterId, { type: 'message', description: message });
        socket.emit('action_result', result);

        if (client?.campaignId) {
          socket.to(`campaign:${client.campaignId}`).emit('player_action', {
            characterName: client.characterName ?? 'Player',
            content: message,
          });
        }
      } catch (error) {
        console.error('Error processing player message:', error);
        socket.emit('error', { message: 'Failed to process message.' });
      } finally {
        if (client?.campaignId) {
          io.to(`campaign:${client.campaignId}`).emit('dm_typing', { typing: false });
        }
      }
    });

    socket.on('player_action', async (data: { action: string; target?: string; characterId?: string; [key: string]: unknown }) => {
      const client = clients.get(socket.id);
      const characterId = client?.characterId;
      if (!characterId || !gameState.sessionState) {
        return socket.emit('error', { message: 'Not in an active session. Join a campaign first.' });
      }

      try {
        if (client?.campaignId) {
          io.to(`campaign:${client.campaignId}`).emit('dm_typing', { typing: true });
        }

        const result = await processPlayerAction(gameState, characterId, {
          type: data.action, description: data.action,
          target: data.target, metadata: data,
        });
        socket.emit('action_result', result);

        if (client?.campaignId) {
          socket.to(`campaign:${client.campaignId}`).emit('player_action', {
            characterName: client.characterName ?? 'Player',
            content: result.response,
          });
        }
      } catch (error) {
        console.error('Error processing player action:', error);
        socket.emit('error', { message: 'Failed to process action.' });
      } finally {
        if (client?.campaignId) {
          io.to(`campaign:${client.campaignId}`).emit('dm_typing', { typing: false });
        }
      }
    });

    socket.on('move_token', ({ id, x, y }: { id: string; x: number; y: number }) => {
      const client = clients.get(socket.id);
      if (client?.campaignId) {
        socket.to(`campaign:${client.campaignId}`).emit('token_moved', { id, x, y });
      }
    });

    socket.on('request_state', () => {
      try {
        socket.emit('game_status', getGameStatus(gameState));
        const client = clients.get(socket.id);
        if (client?.characterId) {
          const charInfo = buildCharacterInfo(gameState, client.characterId);
          if (charInfo) socket.emit('character_update', charInfo);
        }
        const combat = buildCombatState(gameState);
        if (combat) socket.emit('combat_update', combat);
      } catch (error) {
        console.error('Error in request_state:', error);
      }
    });

    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);
      clients.delete(socket.id);
    });
  });

  return io;
}
