import 'dotenv/config';
import { initializeDatabase, closeDatabase } from './persistence';
import { getSharedDMAgent } from './campaign';
import { createApp } from './app';
import { claudeCodeNarratorEnabled, claudeCodeModel } from './llm/claude-code-narrator';

const PORT = process.env.PORT || 3344;

async function main() {
  console.log('🎲 Starting Dungeons & Daemons server...\n');

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
  });

  console.log('📦 Initializing database...');
  await initializeDatabase();
  console.log('✅ Database ready\n');

  // Warm the Dungeon Master so the first table does not pay the startup cost.
  await getSharedDMAgent();
  if (claudeCodeNarratorEnabled()) {
    console.log(`✅ DM narration: Claude Code CLI (${claudeCodeModel()})`);
  }

  const { httpServer, rooms } = createApp();
  rooms.startSweeper();

  httpServer.listen(PORT, () => {
    console.log(`\n🏰 Server running on http://localhost:${PORT}\n`);
  });

  const shutdown = async () => {
    console.log('\n🛑 Shutting down...');
    rooms.stopSweeper();
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
