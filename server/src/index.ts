import { createServer } from 'http';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import path from 'path';

import { initializeDatabase, closeDatabase, isDatabaseConnected, campaignRepository, characterRepository } from './persistence';
import { initializeWebSocket } from './api';
import { createGameOrchestrator, bootstrapGame, type GameState } from './campaign';

const PORT = process.env.PORT || 3344;

let gameState: GameState;

async function main() {
  console.log('🎲 Starting D&D VTT Server...\n');

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
  });

  console.log('📦 Initializing database...');
  try {
    await initializeDatabase();
    console.log('✅ Database connected\n');
  } catch (error) {
    console.error('❌ Failed to connect to database:', error);
    console.log('⚠️  Continuing without database\n');
  }

  const app = express();
  app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:3345' }));
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok', version: '0.1.0',
      phase: gameState?.phase || 'initializing',
      inCombat: Boolean(gameState?.combatEncounter),
    });
  });

  app.get('/api/campaigns', async (_req, res, next) => {
    try {
      if (!isDatabaseConnected()) return res.json([]);
      const campaigns = await campaignRepository.list();
      res.json(campaigns.map(c => ({ id: c.id, name: c.name, status: c.status, description: c.description })));
    } catch (err) { next(err); }
  });

  app.get('/api/campaigns/:campaignId/characters', async (req, res, next) => {
    try {
      if (!isDatabaseConnected()) return res.json([]);
      const characters = await characterRepository.getByCampaign(req.params.campaignId);
      res.json(characters.map(c => ({
        id: c.id, name: c.name, race: c.race, class: c.class, level: c.level,
        isAI: c.isAI ?? false, hp: c.hp ?? c.hitPoints, ac: c.ac ?? c.armorClass ?? 10,
      })));
    } catch (err) { next(err); }
  });

  app.get('/api/game-state', (_req, res) => {
    if (!gameState) return res.status(503).json({ error: 'Game not initialized' });
    const campaign = gameState._campaign;
    const characters = gameState._characters ?? [];
    res.json({
      phase: gameState.phase,
      inCombat: gameState.phase === 'combat' && gameState.combatEncounter !== null,
      campaignId: campaign?.id ?? null,
      campaignName: campaign?.name ?? null,
      characters: characters.map(c => ({
        id: c.id, name: c.name, race: c.race, class: c.class, level: c.level, isAI: c.isAI ?? false,
      })),
    });
  });

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, '../../client/dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
    });
  }

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('API error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  });

  const httpServer = createServer(app);

  console.log('🎮 Initializing game...');
  gameState = createGameOrchestrator();

  const io = initializeWebSocket(httpServer, gameState);

  if (isDatabaseConnected()) {
    try {
      await bootstrapGame(gameState, io, process.env.CAMPAIGN_ID);
    } catch (error) {
      console.error('⚠️  Game bootstrap failed:', error);
      console.log('⚠️  Run `bun run seed` to set up data.\n');
    }
  }

  httpServer.listen(PORT, () => {
    console.log(`\n🏰 D&D VTT Server running on http://localhost:${PORT}\n`);
  });

  const shutdown = async () => {
    console.log('\n🛑 Shutting down...');
    await closeDatabase().catch(e => console.error('DB close error:', e));
    httpServer.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
