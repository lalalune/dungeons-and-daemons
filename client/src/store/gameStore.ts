import { io, type Socket } from "socket.io-client";
import { create } from "zustand";

export type GamePhase =
	| "initializing"
	| "narration"
	| "exploration"
	| "social"
	| "combat"
	| "rest";

export interface Token {
	id: string;
	name: string;
	type: "pc" | "npc" | "monster";
	x: number;
	y: number;
	size: number;
	imageUrl?: string;
	hp?: { current: number; max: number };
	conditions?: string[];
}

/** Health of one party member, sent to everyone at the table. */
export interface PartyMember {
	characterId: string;
	hp: { current: number; max: number };
	ac: number;
	conditions: string[];
}

export interface CharacterChoices {
	name: string;
	race: string;
	class: string;
	backstory?: string;
}

export type RollMode = "normal" | "advantage" | "disadvantage";

export interface Account {
	id: string;
	email: string;
	displayName: string;
}

export interface SavedCharacter {
	id: string;
	name: string;
	race: string;
	class: string;
	level: number;
	lastAdventure: string | null;
	updatedAt: string;
}

export interface AdventureSummary {
	id: string;
	title: string;
	credit: string;
	levels: string;
	tone: string;
	length: string;
	tagline: string;
	summary: string;
}

export interface CharacterOptions {
	races: { name: string; speed: number; bonuses: string }[];
	classes: { name: string; blurb: string; hitDie: string; caster: boolean }[];
}

export interface Combatant {
	id: string;
	name: string;
	type: "pc" | "npc" | "monster";
	initiative: number;
	hp: { current: number; max: number; temp: number };
	ac: number;
	conditions: string[];
	isCurrentTurn: boolean;
}

export interface LogEntry {
	id: string;
	timestamp: Date;
	type: "narrative" | "action" | "roll" | "system" | "combat" | "error";
	speaker?: string;
	content: string;
	metadata?: Record<string, unknown>;
}

export type BodySlot =
	| "head"
	| "neck"
	| "shoulders"
	| "chest"
	| "hands"
	| "legs"
	| "greaves"
	| "feet"
	| "mainHand"
	| "offHand";

export interface InventoryItem {
	name: string;
	kind: string;
	quantity: number;
	detail: string;
	description?: string;
	rarity?: string;
	canEquip?: BodySlot;
	canRemove?: boolean;
}

export interface Inventory {
	equipped: Record<BodySlot, InventoryItem | null>;
	bag: InventoryItem[];
	coins: { pp: number; gp: number; ep: number; sp: number; cp: number };
}

export interface CharacterSheetView {
	background?: string;
	alignment?: string;
	experience: number;
	proficiencyBonus: number;
	initiative: number;
	passivePerception: number;
	hitDice: string;
	abilities: { key: string; name: string; score: number; modifier: number }[];
	savingThrows: { key: string; name: string; modifier: number; proficient: boolean }[];
	skills: { name: string; ability: string; modifier: number; proficient: boolean }[];
	proficiencies: { armor: string[]; weapons: string[]; tools: string[]; languages: string[] };
	features: string[];
	racialTraits: string[];
	spellcasting: { ability: string; saveDC: number; attackBonus: number } | null;
	spells: {
		name: string;
		level: number;
		school: string;
		range: string;
		detail: string;
		description?: string;
		castingTime?: string;
		duration?: string;
		components?: string;
	}[];
	backstory?: string;
}

export interface CharacterInfo {
	id: string;
	name: string;
	race: string;
	class: string;
	level: number;
	hp: { current: number; max: number; temp: number };
	ac: number;
	speed: number;
	conditions: string[];
	spellSlots?: Record<number, { current: number; max: number }>;
	inventory?: Inventory;
	sheet?: CharacterSheetView;
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
	phase: GamePhase;
	seats: SeatView[];
	watching: number;
}

interface GameState {
	// Connection
	connected: boolean;
	socket: Socket | null;

	// Table (room) state
	joined: boolean;
	roomCode: string | null;
	campaignName: string | null;
	seats: SeatView[];
	watching: number;
	party: PartyMember[];
	playerName: string;
	roomError: string | null;

	// Game state
	phase: GamePhase;
	inCombat: boolean;
	round: number;
	dmTyping: boolean;

	// Map
	tokens: Token[];
	selectedTokenId: string | null;
	mapWidth: number;
	mapHeight: number;
	gridSize: number;
	mapImageUrl: string | null;

	// Combat
	combatants: Combatant[];
	currentTurnIndex: number;

	// Log & character
	log: LogEntry[];
	logVersion: number; // Increments on every log change (used for auto-scroll)
	character: CharacterInfo | null;

	// Actions
	connect: () => void;
	setPlayerName: (name: string) => void;
	createRoom: (adventureId?: string) => Promise<string | null>;
	joinRoom: (code: string, characterId?: string) => void;
	createCharacter: (code: string, choices: CharacterChoices) => void;
	account: Account | null;
	savedCharacters: SavedCharacter[];
	loadAccount: () => Promise<void>;
	signIn: (email: string, password: string) => Promise<string | null>;
	signUp: (email: string, password: string, name: string) => Promise<string | null>;
	signOut: () => Promise<void>;
	loadSavedCharacters: () => Promise<void>;
	deleteSavedCharacter: (id: string) => Promise<void>;
	bringCharacter: (code: string, savedCharacterId: string) => void;
	rollCheck: (kind: "ability" | "save" | "skill", key: string, mode?: RollMode) => void;
	rollDice: (notation: string) => void;
	equipItem: (name: string) => void;
	unequipItem: (name: string) => void;
	conditionRules: Record<string, string>;
	/** Which map or picture the story is in right now. */
	scene: string;
	loadConditionRules: () => Promise<void>;
	leaveRoom: () => void;
	selectToken: (id: string | null) => void;
	moveToken: (id: string, x: number, y: number) => void;
	sendAction: (action: string, data?: Record<string, unknown>) => void;
	sendMessage: (message: string) => void;
	addLogEntry: (entry: Omit<LogEntry, "id" | "timestamp">) => void;
	setPhase: (phase: GamePhase) => void;
	setCombatants: (combatants: Combatant[]) => void;
	setTokens: (tokens: Token[]) => void;
	setCharacter: (character: CharacterInfo | null) => void;
}

const createLogEntry = (
	entry: Omit<LogEntry, "id" | "timestamp">,
): LogEntry => ({
	...entry,
	id: crypto.randomUUID(),
	timestamp: new Date(),
});

/** Empty means same origin (the Vite dev proxy, or the server that serves the built client). */
export const SERVER_URL: string = import.meta.env.VITE_API_URL || "";

const TOKEN_KEY = "dnd.playerToken";
const NAME_KEY = "dnd.playerName";

/**
 * A private, random identity for this browser. It is what lets a player
 * refresh the page or reconnect and get their seat back.
 */
function getPlayerToken(): string {
	let token = localStorage.getItem(TOKEN_KEY);
	if (!token || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) {
		const bytes = crypto.getRandomValues(new Uint8Array(24));
		token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
		localStorage.setItem(TOKEN_KEY, token);
	}
	return token;
}

const SEAT_KEY = "dnd.seat";

/** The seat this browser last held, so a page refresh can go straight back to it. */
export function rememberedSeat(code: string): string | null {
	try {
		const saved = JSON.parse(localStorage.getItem(SEAT_KEY) ?? "null");
		return saved && saved.code === code && typeof saved.characterId === "string"
			? saved.characterId
			: null;
	} catch {
		return null;
	}
}

export function forgetSeat() {
	localStorage.removeItem(SEAT_KEY);
}

function rememberSeat(code: string, characterId: string) {
	localStorage.setItem(SEAT_KEY, JSON.stringify({ code, characterId }));
}

export function roomCodeFromUrl(): string | null {
	const code = new URLSearchParams(window.location.search).get("room");
	return code ? code.trim().toUpperCase() : null;
}

function setUrlRoom(code: string | null) {
	const url = new URL(window.location.href);
	if (code) url.searchParams.set("room", code);
	else url.searchParams.delete("room");
	window.history.replaceState(null, "", url);
}

export function inviteLink(code: string): string {
	const url = new URL(window.location.href);
	url.search = "";
	url.hash = "";
	url.searchParams.set("room", code);
	return url.toString();
}

/** The server reads who you are when the socket connects, so sign-in changes need a fresh one. */
function reconnect(socket: Socket | null) {
	if (!socket) return;
	socket.disconnect();
	socket.connect();
}

async function authenticate(
	path: "login" | "register",
	body: Record<string, string>,
	set: (partial: Partial<GameState>) => void,
	get: () => GameState,
): Promise<string | null> {
	try {
		const res = await fetch(`${SERVER_URL}/api/auth/${path}`, {
			method: "POST",
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		const data = (await res.json()) as { account?: Account; error?: string };
		if (!res.ok || !data.account) return data.error ?? "Could not sign in.";
		set({ account: data.account });
		if (!get().playerName.trim()) get().setPlayerName(data.account.displayName);
		reconnect(get().socket);
		await get().loadSavedCharacters();
		return null;
	} catch {
		return "Could not reach the server.";
	}
}

export const useGameStore = create<GameState>((set, get) => ({
	connected: false,
	socket: null,
	joined: false,
	roomCode: null,
	campaignName: null,
	seats: [],
	watching: 0,
	party: [],
	account: null,
	savedCharacters: [],
	conditionRules: {},
	scene: "village",
	playerName: localStorage.getItem(NAME_KEY) ?? "",
	roomError: null,
	phase: "initializing",
	inCombat: false,
	round: 0,
	dmTyping: false,
	tokens: [],
	selectedTokenId: null,
	mapWidth: 30,
	mapHeight: 20,
	gridSize: 40,
	mapImageUrl: null,
	combatants: [],
	currentTurnIndex: 0,
	log: [],
	logVersion: 0,
	character: null,

	connect: () => {
		// Guard against double-connect (React StrictMode, re-renders)
		const existing = get().socket;
		if (existing) {
			if (existing.connected) return;
			existing.disconnect();
		}

		const socket = io(SERVER_URL || undefined, {
			transports: ["websocket", "polling"],
			reconnection: true,
			reconnectionAttempts: 10,
			reconnectionDelay: 1000,
		});

		// Set socket immediately so other methods can reference it
		set({ socket, connected: false });

		socket.on("connect", () => {
			set({ connected: true });
			get().addLogEntry({
				type: "system",
				content: "Connected to the game server.",
			});

			// Back at the table after a dropped connection: the server returns
			// us to the seat our token holds.
			const { joined, roomCode, playerName } = get();
			if (joined && roomCode) {
				socket.emit("join_room", {
					code: roomCode,
					playerToken: getPlayerToken(),
					playerName,
				});
			}
		});

		socket.on("disconnect", () => {
			set({ connected: false });
			get().addLogEntry({
				type: "system",
				content: "Disconnected from the game server.",
			});
		});

		socket.on(
			"game_status",
			({
				phase,
				inCombat,
				roundNumber,
			}: {
				phase: GamePhase;
				inCombat: boolean;
				currentTurn: string | null;
				roundNumber: number;
			}) => {
				set({ phase, inCombat, round: roundNumber });
			},
		);

		socket.on(
			"join_confirmed",
			({
				code,
				characterId,
				characterName,
				campaignName,
				phase,
			}: {
				code: string;
				characterId: string | null;
				characterName?: string;
				campaignName?: string;
				phase: GamePhase;
			}) => {
				const wasJoined = get().joined;
				const updates: Partial<GameState> = {
					joined: true,
					roomCode: code,
					roomError: null,
					campaignName: campaignName ?? null,
					phase,
					inCombat: phase === "combat",
				};
				if (characterId) rememberSeat(code, characterId);
				else {
					updates.character = null;
					forgetSeat();
				}
				set(updates);
				setUrlRoom(code);
				if (!wasJoined) {
					get().addLogEntry({
						type: "system",
						content: characterName
							? `You sit down at the table as ${characterName}.`
							: "You are watching this table.",
					});
				}
			},
		);

		socket.on("room_update", ({ seats, watching }: RoomView) => {
			set({ seats, watching });
		});

		socket.on("party_update", (party: PartyMember[]) => set({ party }));

		socket.on(
			"dice_roll",
			({
				characterName,
				label,
				detail,
				total,
				natural,
			}: {
				characterName: string;
				label: string;
				detail: string;
				total: number;
				natural?: 20 | 1;
			}) => {
				get().addLogEntry({
					type: "roll",
					speaker: characterName,
					content: `${label}: ${detail}${
						natural === 20 ? "  Natural 20!" : natural === 1 ? "  Natural 1." : ""
					}`,
					metadata: { roll: { total, type: label } },
				});
			},
		);

		socket.on("scene_update", ({ key }: { key: string }) => set({ scene: key }));

		socket.on("loot", ({ lines }: { lines: string[] }) => {
			get().addLogEntry({
				type: "system",
				speaker: "Treasure",
				content: `💰 ${lines.join(" ")}`,
			});
		});

		socket.on("notice", ({ message }: { message: string }) => {
			get().addLogEntry({ type: "system", content: message });
		});

		socket.on("move_rejected", ({ message }: { message: string }) => {
			get().addLogEntry({ type: "error", content: message });
		});

		socket.on("room_error", ({ message }: { code: string; message: string }) => {
			set({ roomError: message });
			if (get().joined) {
				get().addLogEntry({ type: "error", content: message });
			}
		});

		socket.on("phase_change", ({ phase }: { phase: GamePhase }) => {
			const updates: Partial<GameState> = {
				phase,
				inCombat: phase === "combat",
			};
			// Clean up stale combat state when transitioning out of combat
			if (phase !== "combat") {
				updates.combatants = [];
				updates.round = 0;
			}
			set(updates);
		});

		socket.on(
			"combat_update",
			({
				round,
				combatants,
				currentTurnIndex,
			}: {
				round: number;
				combatants: Combatant[];
				currentTurnIndex: number;
			}) => {
				set({ round, combatants, currentTurnIndex, inCombat: true });
			},
		);

		socket.on("combat_end", () => {
			set({ inCombat: false, combatants: [], round: 0 });
			get().addLogEntry({ type: "system", content: "Combat has ended." });
		});

		socket.on("tokens_update", (tokens: Token[]) => set({ tokens }));
		socket.on(
			"token_moved",
			({ id, x, y }: { id: string; x: number; y: number }) => {
				set((state) => ({
					tokens: state.tokens.map((t) => (t.id === id ? { ...t, x, y } : t)),
				}));
			},
		);
		socket.on("character_update", (character: CharacterInfo) =>
			set({ character }),
		);

		socket.on("dm_typing", ({ typing }: { typing: boolean }) => {
			set({ dmTyping: typing });
		});

		socket.on("dm_narration", ({ content }: { content: string }) => {
			set({ dmTyping: false });
			get().addLogEntry({
				type: "narrative",
				speaker: "Dungeon Master",
				content,
			});
		});

		socket.on(
			"player_action",
			({
				characterName,
				content,
				rollResult,
			}: {
				characterName: string;
				content: string;
				rollResult?: { total: number; type: string };
			}) => {
				get().addLogEntry({
					type: rollResult ? "roll" : "action",
					speaker: characterName,
					content,
					metadata: rollResult ? { roll: rollResult } : undefined,
				});
			},
		);

		socket.on(
			"combat_action",
			({
				actorName,
				description,
				damage,
				healing,
			}: {
				actorName: string;
				description: string;
				damage?: number;
				healing?: number;
			}) => {
				get().addLogEntry({
					type: "combat",
					speaker: actorName,
					content: description,
					metadata: { damage, healing },
				});
			},
		);

		socket.on(
			"action_result",
			({ success, response }: { success: boolean; response: string }) => {
				if (!success) {
					get().addLogEntry({ type: "error", content: response });
				}
			},
		);

		socket.on("error", ({ message }: { message: string }) => {
			get().addLogEntry({ type: "error", content: `Error: ${message}` });
		});
	},

	setPlayerName: (name) => {
		const playerName = name.slice(0, 24);
		localStorage.setItem(NAME_KEY, playerName);
		set({ playerName });
	},

	createRoom: async (adventureId) => {
		set({ roomError: null });
		try {
			const res = await fetch(`${SERVER_URL}/api/rooms`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(adventureId ? { adventureId } : {}),
			});
			const data = (await res.json()) as RoomView & { error?: string };
			if (!res.ok) {
				set({ roomError: data.error ?? "Could not open a table." });
				return null;
			}
			return data.code;
		} catch {
			set({ roomError: "Could not reach the server." });
			return null;
		}
	},

	joinRoom: (code, characterId) => {
		const { socket, playerName } = get();
		if (!socket) return;
		set({ roomError: null });
		socket.emit("join_room", {
			code,
			playerToken: getPlayerToken(),
			playerName: playerName.trim() || "Adventurer",
			characterId,
		});
	},

	createCharacter: (code, choices) => {
		const { socket, playerName } = get();
		if (!socket) return;
		set({ roomError: null });
		socket.emit("create_character", {
			code,
			playerToken: getPlayerToken(),
			playerName: playerName.trim() || "Adventurer",
			character: choices,
		});
	},

	loadAccount: async () => {
		try {
			const res = await fetch(`${SERVER_URL}/api/auth/me`, { credentials: "include" });
			const data = (await res.json()) as { account: Account | null };
			set({ account: data.account ?? null });
			if (data.account) {
				if (!get().playerName) get().setPlayerName(data.account.displayName);
				await get().loadSavedCharacters();
			}
		} catch {
			set({ account: null });
		}
	},

	signIn: (email, password) => authenticate("login", { email, password }, set, get),

	signUp: (email, password, name) =>
		authenticate("register", { email, password, name }, set, get),

	signOut: async () => {
		await fetch(`${SERVER_URL}/api/auth/logout`, {
			method: "POST",
			credentials: "include",
		}).catch(() => undefined);
		set({ account: null, savedCharacters: [] });
		reconnect(get().socket);
	},

	loadSavedCharacters: async () => {
		try {
			const res = await fetch(`${SERVER_URL}/api/characters`, { credentials: "include" });
			if (!res.ok) return set({ savedCharacters: [] });
			const data = (await res.json()) as { characters: SavedCharacter[] };
			set({ savedCharacters: data.characters });
		} catch {
			// Keep whatever list is already shown.
		}
	},

	deleteSavedCharacter: async (id) => {
		await fetch(`${SERVER_URL}/api/characters/${id}`, {
			method: "DELETE",
			credentials: "include",
		}).catch(() => undefined);
		await get().loadSavedCharacters();
	},

	bringCharacter: (code, savedCharacterId) => {
		const { socket, playerName } = get();
		if (!socket) return;
		set({ roomError: null });
		socket.emit("bring_character", {
			code,
			playerName: playerName.trim() || "Adventurer",
			savedCharacterId,
		});
	},

	rollCheck: (kind, key, mode = "normal") => {
		get().socket?.emit("roll", { kind, key, mode });
	},

	equipItem: (name) => {
		get().socket?.emit("equip_item", { name });
	},

	unequipItem: (name) => {
		get().socket?.emit("unequip_item", { name });
	},

	loadConditionRules: async () => {
		if (Object.keys(get().conditionRules).length > 0) return;
		try {
			const res = await fetch(`${SERVER_URL}/api/conditions`, { credentials: "include" });
			if (!res.ok) return;
			const data = (await res.json()) as {
				conditions: { name: string; description: string }[];
			};
			set({
				conditionRules: Object.fromEntries(
					data.conditions.map((c) => [c.name.toLowerCase(), c.description]),
				),
			});
		} catch {
			// Tooltips are a nicety; play goes on without them.
		}
	},

	rollDice: (notation) => {
		get().socket?.emit("roll", { kind: "dice", notation });
	},

	leaveRoom: () => {
		get().socket?.emit("leave_room");
		forgetSeat();
		setUrlRoom(null);
		set({
			joined: false,
			roomCode: null,
			campaignName: null,
			seats: [],
			watching: 0,
			party: [],
			roomError: null,
			phase: "initializing",
			inCombat: false,
			round: 0,
			combatants: [],
			character: null,
			tokens: [],
			log: [],
			logVersion: 0,
			dmTyping: false,
		});
	},

	selectToken: (id) => set({ selectedTokenId: id }),

	moveToken: (id, x, y) => {
		const { socket, tokens } = get();
		set({ tokens: tokens.map((t) => (t.id === id ? { ...t, x, y } : t)) });
		socket?.emit("move_token", { id, x, y });
	},

	sendAction: (action, data) => {
		get().socket?.emit("player_action", { action, ...data });
	},

	sendMessage: (message) => {
		const { socket, character } = get();
		socket?.emit("player_message", { message, characterId: character?.id });
		if (character) {
			get().addLogEntry({
				type: "action",
				speaker: character.name,
				content: message,
			});
		}
	},

	addLogEntry: (entry) => {
		set((state) => ({
			log: [...state.log.slice(-499), createLogEntry(entry)],
			logVersion: state.logVersion + 1,
		}));
	},

	setPhase: (phase) => set({ phase, inCombat: phase === "combat" }),
	setCombatants: (combatants) => set({ combatants }),
	setTokens: (tokens) => set({ tokens }),
	setCharacter: (character) => set({ character }),
}));
