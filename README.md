# Dungeons & Daemons- AI-Powered Virtual Tabletop

An AI-powered D&D 5e Virtual Tabletop powered by ElizaOS agents. Features an AI Dungeon Master that runs dynamic, narrative-driven adventures with AI party members that can act autonomously or be guided by players.

## Features

- **AI Dungeon Master**: Fully autonomous DM that manages narrative, combat, and NPCs
- **AI Party Members**: Optional AI-controlled party members with distinct personalities
- **Real-time Gameplay**: WebSocket-based communication for instant updates
- **Combat System**: Complete D&D 5e combat with initiative, actions, reactions
- **Persistent Campaigns**: Multi-session campaigns with memory and history
- **Battle Maps**: Grid-based tactical combat display
- **Character Sheets**: Full D&D 5e character support

## Architecture

```
dnd-vtt/
├── server/           # Backend game server
│   ├── src/
│   │   ├── agents/       # ElizaOS agent plugins
│   │   │   ├── dm-agent/     # Dungeon Master AI
│   │   │   └── player-agent/ # AI party member
│   │   ├── api/          # WebSocket handlers
│   │   ├── campaign/     # Game orchestration & memory
│   │   ├── combat/       # Combat system
│   │   ├── content/      # Starter adventure content
│   │   ├── data/         # SRD data (races, classes, monsters)
│   │   ├── dice/         # Dice rolling utilities
│   │   ├── persistence/  # Database & repositories
│   │   ├── rules/        # D&D 5e rules engine
│   │   ├── services/     # External services (image gen)
│   │   └── types/        # TypeScript type definitions
│   └── package.json
│
└── client/           # React frontend
    ├── src/
    │   ├── components/   # UI components
    │   └── store/        # Zustand state management
    └── package.json
```

## Prerequisites

- [Bun](https://bun.sh) runtime (runs the server and the tests)
- Node.js with npm (or Bun) to install packages

No database and no API key are needed to start. Without `DATABASE_URL` the
server runs an embedded Postgres in memory and creates its tables on boot.
Without a language model the Dungeon Master answers from templates.

## Quick Start

```bash
npm install --legacy-peer-deps   # or: bun install
npm run dev
```

Open http://localhost:3345, press **Start a new table**, and send the invite
link to your friends. Each table has its own copy of the adventure. Players
take a ready-made character or make their own (name, race, class).

To try two players on one machine, open the link once on `localhost` and once
on `127.0.0.1`: the browser treats them as different people.

### Adventures

Starting a table opens an adventure picker. "The Goblin Den" is built in. The
others are briefs in `server/src/content/adventures/library.ts`: a short pitch
for players, an opening scene, and private notes the AI Dungeon Master
improvises from (so they need AI narration switched on).

To add one, drop a JSON brief in `tools/adventure-briefs/` and run:

```bash
python tools/build_adventure_library.py tools/adventure-briefs server/src/content/adventures/library.ts
```

Briefs for adventures you own but may not redistribute go in
`tools/adventure-briefs-private/` and are built into `library.local.ts`. Both
are ignored by git, and the server loads the local file when it exists:

```bash
python tools/build_adventure_library.py tools/adventure-briefs-private server/src/content/adventures/library.local.ts
```

### Optional settings (`server/.env`)

```env
# Use a real Postgres instead of the embedded one (tables are created on boot)
DATABASE_URL=postgresql://localhost:5432/dnd_vtt
# Open tables live in server memory either way: a restart closes them.

# Real narration through your Claude subscription (development and private play)
DM_PROVIDER=claude-code            # uses the Claude Code login on this machine
# CLAUDE_CODE_OAUTH_TOKEN=...      # or a token from `claude setup-token`
# DM_MODEL=claude-opus-5-5

# Real narration through an API key (ElizaOS plugins)
# OPENAI_API_KEY=...

PORT=3344
CLIENT_ORIGIN=http://localhost:3345
```

### Production build

```bash
cd client && npx vite build
cd ../server && NODE_ENV=production bun run src/index.ts
```

The server then serves the built client itself on `PORT`.

### Tests

```bash
cd server && bun test src/__tests__/integration/rooms.test.ts
```

## The Starter Adventure

"The Goblin Den" is a classic introductory adventure:

- **Location**: The village of Millbrook, under threat from goblin raids
- **Quest**: Find and clear the goblin lair
- **NPCs**: Mayor Aldric, Mira the Innkeeper, Old Tomas (retired hunter)
- **Villain**: Grishnak, the Goblin Boss
- **Party**: Pre-generated AI party of 4 (Fighter, Wizard, Cleric, Rogue)

## Game Controls

### As a Player

- **Send Message**: Type in the action bar to speak or describe actions
- **Quick Actions**: Use preset actions for common tasks
- **Combat**: Click tokens and select targets during combat
- **Character Panel**: View your character stats and abilities

### Phases

- **Narration**: The DM describes the scene
- **Exploration**: Move around, investigate, interact
- **Social**: Talk with NPCs
- **Combat**: Turn-based tactical battles
- **Rest**: Short or long rests for recovery

## AI Agent System

### DM Agent

The Dungeon Master AI uses these actions:
- `NARRATE_SCENE` - Describe locations and events
- `DESCRIBE_LOCATION` - Detail specific areas
- `CONTROL_NPC` - Voice NPCs in conversation
- `CALL_FOR_ROLL` - Request ability/skill checks
- `START_COMBAT` - Initialize combat encounters
- `RESOLVE_COMBAT_TURN` - Process monster turns
- `ADJUDICATE_ACTION` - Rule on player actions
- `ADVANCE_TIME` - Move game time forward

### Player Agent

AI party members can:
- `DECLARE_ACTION` - Take narrative actions
- `CAST_SPELL` - Use spells in and out of combat
- `PERFORM_SKILL_CHECK` - Attempt skill-based tasks
- `USE_ITEM` - Consume items from inventory
- `INTERACT_WITH_NPC` - Talk to NPCs
- `RESPOND_TO_PARTY` - React to other players
- `EXPLORE` - Investigate surroundings
- `SHORT_REST` - Recover during rests

## D&D 5e Rules

The system implements core 5e mechanics:

- **Ability Checks**: d20 + modifier vs DC
- **Attack Rolls**: d20 + attack bonus vs AC
- **Saving Throws**: d20 + save modifier vs DC
- **Advantage/Disadvantage**: Roll 2d20, take higher/lower
- **Critical Hits**: Natural 20 = double damage dice
- **Conditions**: All SRD conditions with proper effects
- **Damage Types**: Physical, magical, and elemental
- **Rest**: Short rest (hit dice), Long rest (full recovery)

## Development

### Type Checking

```bash
cd server
bun run tsc --noEmit
```

### Database Reset

To reset and re-migrate the database:

```bash
cd server
bun run migrate  # This drops and recreates all tables
bun run seed     # Re-seed with starter content
```

### Adding Content

1. **New Monsters**: Add to `server/src/data/srd-monsters.ts`
2. **New Locations**: Add to `server/src/content/starter-adventure.ts`
3. **New NPCs**: Add to the NPCs array in starter-adventure
4. **New Quests**: Add to the quests array in starter-adventure

## Contributing

This is part of the ElizaOS examples. Contributions welcome!

## License

GNU Affero General Public License v3.0 or later. See `LICENSE`.

In short: you may use, change and share this, but if you run a changed version
as a service that other people use over a network, you must offer those people
its source code. Set `SOURCE_URL` in `server/.env` to the public repository of
the code you are running; the lobby then shows a "Source code" link.

### Third-party material

- **Dungeoneer** by Durtur (AGPL-3.0): the magic item, spell, condition and
  name data in `server/src/data/dungeoneer/`, and the idea of rolling checks
  from the tracker. https://github.com/Durtur/Dungeoneer
- **Original project**: lalalune/dungeons-and-daemons (stated as MIT in its README).
- **Backgrounds**: public-domain paintings from Wikimedia Commons, listed in
  `client/public/backgrounds/credits.json`.
- **Rules content**: D&D 5e System Reference Document 5.1 (CC BY 4.0, Wizards of the Coast).
- **Adventure briefs**: the repository ships only original ones. Private briefs
  you add locally are yours to keep private.
