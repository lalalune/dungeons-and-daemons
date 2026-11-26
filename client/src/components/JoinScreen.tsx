import { useCallback, useEffect, useState } from "react";
import { AccountBox } from "./AccountBox";
import { Backdrop } from "./Backdrop";
import {
	type AdventureSummary,
	type CharacterOptions,
	inviteLink,
	type RoomView,
	roomCodeFromUrl,
	rememberedSeat,
	forgetSeat,
	SERVER_URL,
	useGameStore,
} from "../store/gameStore";

const CLASS_BLURB: Record<string, string> = {
	Fighter: "Front line. Hits hard, takes hits.",
	Wizard: "Fragile, with spells that end fights.",
	Cleric: "Keeps the party standing.",
	Rogue: "Sneaky, precise, good with locks.",
};

function Shell({
	children,
	wide,
	scene,
}: {
	children: React.ReactNode;
	wide?: boolean;
	/** Text that decides which painting sits behind the screen. */
	scene?: string | null;
}) {
	return (
		<div className="relative isolate min-h-screen flex items-center justify-center p-4">
			<Backdrop scene={scene} />
			<div className={`w-full ${wide ? "max-w-3xl" : "max-w-lg"}`}>
				<div className="text-center mb-8">
					<h1 className="font-fantasy text-4xl font-bold text-amber-400 mb-2">
						Dungeons &amp; Daemons
					</h1>
					<p className="text-slate-400">
						A tabletop adventure run by an AI Dungeon Master.
					</p>
				</div>
				<div className="bg-slate-900/75 backdrop-blur-md border border-slate-700/80 rounded-xl p-6 shadow-2xl">
					{children}
				</div>
				<SourceNote />
			</div>
		</div>
	);
}

/** Free software notice: this game is AGPL, so players are told where its source is. */
function SourceNote() {
	const [sourceUrl, setSourceUrl] = useState<string | null>(null);
	useEffect(() => {
		fetch(`${SERVER_URL}/api/about`, { credentials: "include" })
			.then((res) => (res.ok ? res.json() : null))
			.then((data: { sourceUrl: string | null } | null) => setSourceUrl(data?.sourceUrl ?? null))
			.catch(() => undefined);
	}, []);
	return (
		<p className="text-center text-[11px] text-slate-500 mt-4">
			Free software under the GNU AGPL v3.
			{sourceUrl && (
				<>
					{" "}
					<a href={sourceUrl} target="_blank" rel="noreferrer" className="underline hover:text-slate-300">
						Source code
					</a>
				</>
			)}
		</p>
	);
}

function ErrorNote({ message }: { message: string | null }) {
	if (!message) return null;
	return (
		<div
			role="alert"
			className="bg-red-900/30 border border-red-800 rounded-lg p-3 mb-4 text-red-300 text-sm"
		>
			{message}
		</div>
	);
}

function NameField() {
	const { playerName, setPlayerName } = useGameStore();
	return (
		<label className="block mb-5">
			<span className="block text-sm font-medium text-slate-300 mb-2">
				Your name
			</span>
			<input
				type="text"
				value={playerName}
				maxLength={24}
				onChange={(e) => setPlayerName(e.target.value)}
				placeholder="What should the table call you?"
				autoComplete="nickname"
				className="w-full rounded-lg bg-slate-900/60 border border-slate-600 px-3 py-2.5 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
			/>
		</label>
	);
}

/** Choose what the new table will play. */
function AdventurePicker({
	onEnter,
	onCancel,
}: {
	onEnter: (code: string) => void;
	onCancel: () => void;
}) {
	const { createRoom, roomError } = useGameStore();
	const [adventures, setAdventures] = useState<AdventureSummary[] | null>(null);
	const [aiNarration, setAiNarration] = useState(true);
	const [failed, setFailed] = useState(false);
	const [selected, setSelected] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);

	useEffect(() => {
		let alive = true;
		fetch(`${SERVER_URL}/api/adventures`)
			.then((res) => (res.ok ? res.json() : Promise.reject()))
			.then(
				(data: {
					aiNarration: boolean;
					defaultId: string;
					adventures: AdventureSummary[];
				}) => {
					if (!alive) return;
					setAdventures(data.adventures);
					setAiNarration(data.aiNarration);
					setSelected(data.defaultId);
				},
			)
			.catch(() => alive && setFailed(true));
		return () => {
			alive = false;
		};
	}, []);

	const chosen = adventures?.find((a) => a.id === selected);

	async function start() {
		if (!selected) return;
		setCreating(true);
		const created = await createRoom(selected);
		setCreating(false);
		if (created) onEnter(created);
	}

	return (
		<Shell
			wide
			scene={chosen ? `${chosen.title} ${chosen.tone} ${chosen.tagline}` : null}
		>
			<h2 className="font-fantasy text-xl text-amber-300 mb-1">
				Choose an adventure
			</h2>
			<p className="text-sm text-slate-400 mb-4">
				Everyone at the table plays the one you pick.
			</p>
			<ErrorNote message={roomError} />
			{failed && <ErrorNote message="Could not load the adventures." />}
			{!aiNarration && (
				<p className="text-xs text-amber-300/90 bg-amber-900/20 border border-amber-800/60 rounded-lg p-3 mb-4">
					This server has no AI Dungeon Master switched on, so only the first
					adventure will play properly. The others need one to tell their story.
				</p>
			)}
			{!adventures && !failed && (
				<div className="text-center py-10 text-slate-400">Loading...</div>
			)}

			{adventures && (
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[46vh] overflow-y-auto pr-1 mb-4">
					{adventures.map((a) => {
						const active = a.id === selected;
						return (
							<button
								type="button"
								key={a.id}
								aria-pressed={active}
								onClick={() => setSelected(a.id)}
								className={`text-left p-3 rounded-lg border transition-all ${
									active
										? "border-amber-500 bg-amber-900/20"
										: "border-slate-600 bg-slate-700/30 hover:border-slate-500"
								}`}
							>
								<div
									className={`font-medium text-sm ${active ? "text-amber-200" : "text-slate-200"}`}
								>
									{a.title}
								</div>
								<div className="text-xs text-slate-400 mt-0.5">{a.tagline}</div>
								<div className="text-[11px] text-slate-500 mt-1.5">
									Levels {a.levels} · {a.tone} · {a.length}
								</div>
							</button>
						);
					})}
				</div>
			)}

			{chosen && (
				<div className="rounded-lg bg-slate-900/50 border border-slate-700 p-4 mb-4">
					<div className="font-fantasy text-amber-300">{chosen.title}</div>
					<p className="text-sm text-slate-300 mt-1">{chosen.summary}</p>
					<p className="text-[11px] text-slate-500 mt-2">{chosen.credit}</p>
				</div>
			)}

			<button
				type="button"
				onClick={start}
				disabled={!selected || creating}
				className="w-full py-3 rounded-lg font-medium transition-all disabled:opacity-50 bg-amber-600 hover:bg-amber-500 text-white"
			>
				{creating ? "Setting the table..." : "Start this adventure"}
			</button>
			<button
				type="button"
				onClick={onCancel}
				className="block mx-auto mt-4 text-xs text-slate-500 hover:text-slate-300"
			>
				Back
			</button>
		</Shell>
	);
}

/** No table yet: open one, or type a friend's code. */
function Landing({ onEnter }: { onEnter: (code: string) => void }) {
	const { roomError } = useGameStore();
	const [code, setCode] = useState("");
	const [choosing, setChoosing] = useState(false);

	if (choosing) {
		return (
			<AdventurePicker
				onEnter={onEnter}
				onCancel={() => {
					useGameStore.setState({ roomError: null });
					setChoosing(false);
				}}
			/>
		);
	}

	function handleJoin(e: React.FormEvent) {
		e.preventDefault();
		const cleaned = code.trim().toUpperCase();
		if (cleaned) onEnter(cleaned);
	}

	return (
		<Shell>
			<ErrorNote message={roomError} />
			<AccountBox />
			<NameField />

			<button
				type="button"
				onClick={() => setChoosing(true)}
				className="w-full py-3 rounded-lg font-medium transition-all bg-amber-600 hover:bg-amber-500 text-white"
			>
				Start a new table
			</button>
			<p className="text-xs text-slate-500 mt-2 text-center">
				Pick an adventure, then get a link to send to your friends.
			</p>

			<div className="flex items-center gap-3 my-6 text-xs text-slate-500">
				<div className="h-px flex-1 bg-slate-700" />
				or join a friend
				<div className="h-px flex-1 bg-slate-700" />
			</div>

			<form onSubmit={handleJoin} className="flex gap-2">
				<input
					type="text"
					value={code}
					onChange={(e) => setCode(e.target.value.toUpperCase())}
					maxLength={8}
					placeholder="Table code"
					aria-label="Table code"
					autoCapitalize="characters"
					className="flex-1 min-w-0 rounded-lg bg-slate-900/60 border border-slate-600 px-3 py-2.5 text-slate-100 tracking-widest uppercase placeholder:tracking-normal placeholder:normal-case placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
				/>
				<button
					type="submit"
					disabled={!code.trim()}
					className="px-5 rounded-lg font-medium border border-slate-600 text-slate-200 hover:border-slate-400 disabled:opacity-40 disabled:cursor-not-allowed"
				>
					Join
				</button>
			</form>
		</Shell>
	);
}

const MAX_SEATS = 6;

/** Name, race, class: everything else about the character is worked out for the player. */
function CharacterCreator({ code, onCancel }: { code: string; onCancel: () => void }) {
	const { connected, createCharacter, account } = useGameStore();
	const [options, setOptions] = useState<CharacterOptions | null>(null);
	const [failed, setFailed] = useState(false);
	const [name, setName] = useState("");
	const [race, setRace] = useState<string | null>(null);
	const [klass, setKlass] = useState<string | null>(null);

	useEffect(() => {
		let alive = true;
		fetch(`${SERVER_URL}/api/character-options`)
			.then((res) => (res.ok ? res.json() : Promise.reject()))
			.then((data: CharacterOptions) => alive && setOptions(data))
			.catch(() => alive && setFailed(true));
		return () => {
			alive = false;
		};
	}, []);

	const chosenClass = options?.classes.find((c) => c.name === klass);
	const chosenRace = options?.races.find((r) => r.name === race);
	const ready = connected && name.trim().length >= 2 && race && klass;
	const pill = (active: boolean) =>
		`px-2 py-2 rounded-lg border text-sm transition-all ${
			active
				? "border-amber-500 bg-amber-900/20 text-amber-200"
				: "border-slate-600 bg-slate-700/30 text-slate-300 hover:border-slate-500"
		}`;

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				if (ready) createCharacter(code, { name: name.trim(), race, class: klass });
			}}
		>
			<label className="block mb-5">
				<span className="block text-sm font-medium text-slate-300 mb-2">
					Character name
				</span>
				<input
					type="text"
					value={name}
					maxLength={24}
					onChange={(e) => setName(e.target.value)}
					placeholder="Kira Stormborn"
					className="w-full rounded-lg bg-slate-900/60 border border-slate-600 px-3 py-2.5 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
				/>
			</label>

			{failed && <ErrorNote message="Could not load the character options." />}
			{!options && !failed && (
				<div className="text-center py-8 text-slate-400">Loading...</div>
			)}

			{options && (
				<>
					<fieldset className="mb-5">
						<legend className="block text-sm font-medium text-slate-300 mb-2">
							Race
						</legend>
						<div className="grid grid-cols-3 gap-2">
							{options.races.map((r) => (
								<button
									type="button"
									key={r.name}
									aria-pressed={race === r.name}
									onClick={() => setRace(r.name)}
									className={pill(race === r.name)}
								>
									{r.name}
								</button>
							))}
						</div>
						<p className="text-xs text-slate-400 mt-2 min-h-4">
							{chosenRace &&
								`${chosenRace.bonuses || "Flexible bonuses"} · moves ${chosenRace.speed} ft`}
						</p>
					</fieldset>

					<fieldset className="mb-6">
						<legend className="block text-sm font-medium text-slate-300 mb-2">
							Class
						</legend>
						<div className="grid grid-cols-3 gap-2">
							{options.classes.map((c) => (
								<button
									type="button"
									key={c.name}
									aria-pressed={klass === c.name}
									onClick={() => setKlass(c.name)}
									className={pill(klass === c.name)}
								>
									{c.name}
								</button>
							))}
						</div>
						<p className="text-xs text-slate-400 mt-2 min-h-4">
							{chosenClass &&
								`${chosenClass.blurb} ${chosenClass.caster ? "Casts spells." : "No spells."}`}
						</p>
					</fieldset>
				</>
			)}

			<button
				type="submit"
				disabled={!ready}
				className="w-full py-3 rounded-lg font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-amber-600 hover:bg-amber-500 text-white"
			>
				Create and sit down
			</button>
			<p className="text-xs text-slate-500 mt-2 text-center">
				{account
					? "This character is saved to your account."
					: "Sign in above first if you want to keep this character."}
			</p>
			<button
				type="button"
				onClick={onCancel}
				className="block mx-auto mt-4 text-xs text-slate-500 hover:text-slate-300"
			>
				Back to the ready-made characters
			</button>
		</form>
	);
}

/** A table exists: show who is sitting where and let the visitor pick a seat. */
function SeatPicker({ code, onBack }: { code: string; onBack: () => void }) {
	const {
		connected,
		joinRoom,
		roomError,
		account,
		savedCharacters,
		bringCharacter,
		deleteSavedCharacter,
		loadSavedCharacters,
	} = useGameStore();

	// The roster changes while playing (new characters, levels), so read it fresh here.
	useEffect(() => {
		if (account) loadSavedCharacters();
	}, [account, loadSavedCharacters]);
	const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
	const [room, setRoom] = useState<RoomView | null>(null);
	const [missing, setMissing] = useState<string | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [making, setMaking] = useState(false);

	const refresh = useCallback(async () => {
		try {
			const res = await fetch(`${SERVER_URL}/api/rooms/${code}`);
			if (res.status === 404) {
				setMissing("That table does not exist. It may have closed.");
				return;
			}
			if (!res.ok) return;
			setRoom((await res.json()) as RoomView);
			setMissing(null);
		} catch {
			setMissing("Could not reach the server.");
		}
	}, [code]);

	// Seats fill up while the visitor is deciding, so keep the list fresh.
	useEffect(() => {
		refresh();
		const timer = setInterval(refresh, 3000);
		return () => clearInterval(timer);
	}, [refresh]);

	// Back after a refresh: return straight to the seat this browser was holding.
	const [resuming, setResuming] = useState(() => rememberedSeat(code) !== null);
	useEffect(() => {
		if (!resuming || !connected) return;
		const seat = rememberedSeat(code);
		if (seat) joinRoom(code, seat);
		else setResuming(false);
	}, [resuming, connected, code, joinRoom]);
	useEffect(() => {
		// The seat is gone (someone took it over, or the table closed): pick again.
		if (resuming && (roomError || missing)) {
			forgetSeat();
			setResuming(false);
			if (roomError) useGameStore.setState({ roomError: null });
		}
	}, [resuming, roomError, missing]);

	// If the chosen seat was taken meanwhile, drop the selection.
	useEffect(() => {
		if (selected && room?.seats.find((s) => s.characterId === selected)?.taken) {
			setSelected(null);
		}
	}, [room, selected]);

	async function copyInvite() {
		try {
			await navigator.clipboard.writeText(inviteLink(code));
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// Clipboard can be blocked; the code itself is on screen to read out.
		}
	}

	if (resuming && !missing) {
		return (
			<Shell>
				<p className="text-center text-slate-400">Returning to your seat…</p>
			</Shell>
		);
	}

	if (missing) {
		return (
			<Shell>
				<ErrorNote message={missing} />
				<button
					type="button"
					onClick={onBack}
					className="w-full py-3 rounded-lg font-medium bg-amber-600 hover:bg-amber-500 text-white"
				>
					Start a new table instead
				</button>
			</Shell>
		);
	}

	const openSeats = room?.seats.filter((s) => !s.taken).length ?? 0;

	return (
		<Shell scene={room?.campaignName}>
			<div className="flex items-start justify-between gap-3 mb-5">
				<div>
					<div className="text-xs uppercase tracking-wide text-slate-500">
						Table
					</div>
					<div className="font-mono text-2xl tracking-[0.3em] text-amber-300">
						{code}
					</div>
					{room && (
						<div className="text-sm text-slate-400 mt-1">
							{room.campaignName}
						</div>
					)}
				</div>
				<button
					type="button"
					onClick={copyInvite}
					className="shrink-0 text-sm px-3 py-2 rounded-lg border border-slate-600 text-slate-200 hover:border-amber-500"
				>
					{copied ? "Copied" : "Copy invite link"}
				</button>
			</div>

			<ErrorNote message={roomError} />
			<AccountBox />
			<NameField />

			{making ? (
				<CharacterCreator code={code} onCancel={() => setMaking(false)} />
			) : (
				<>
			{account && savedCharacters.length > 0 && room && (
				<div className="mb-5">
					<span className="block text-sm font-medium text-slate-300 mb-2">
						Your saved characters
					</span>
					<ul className="space-y-2">
						{savedCharacters.map((c) => (
							<li
								key={c.id}
								className="flex items-center gap-3 rounded-lg border border-amber-800/60 bg-amber-900/10 px-3 py-2"
							>
								<div className="min-w-0 flex-1">
									<div className="text-sm font-medium text-amber-100 truncate">
										{c.name}
									</div>
									<div className="text-xs text-slate-400 truncate">
										Level {c.level} {c.race} {c.class}
										{c.lastAdventure && ` · last seen in ${c.lastAdventure}`}
									</div>
								</div>
								{confirmDelete === c.id ? (
									<>
										<button
											type="button"
											onClick={() => {
												deleteSavedCharacter(c.id);
												setConfirmDelete(null);
											}}
											className="text-xs px-2 py-1.5 rounded border border-red-700 text-red-300 hover:bg-red-900/30"
										>
											Delete for good
										</button>
										<button
											type="button"
											onClick={() => setConfirmDelete(null)}
											className="text-xs text-slate-400 hover:text-slate-200"
										>
											Keep
										</button>
									</>
								) : (
									<>
										<button
											type="button"
											disabled={!connected || room.seats.length >= MAX_SEATS}
											onClick={() => bringCharacter(code, c.id)}
											className="text-sm px-3 py-1.5 rounded-lg font-medium bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
										>
											Play
										</button>
										<button
											type="button"
											onClick={() => setConfirmDelete(c.id)}
											aria-label={`Delete ${c.name}`}
											className="text-xs text-slate-500 hover:text-red-300"
										>
											Delete
										</button>
									</>
								)}
							</li>
						))}
					</ul>
				</div>
			)}

			<span className="block text-sm font-medium text-slate-300 mb-2">
				Choose your character
			</span>
			{!room && (
				<div className="text-center py-8 text-slate-400">Loading table...</div>
			)}
			{room && (
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-6">
					{room.seats.map((seat) => {
						const active = selected === seat.characterId;
						return (
							<button
								type="button"
								key={seat.characterId}
								disabled={seat.taken}
								aria-pressed={active}
								onClick={() => setSelected(seat.characterId)}
								className={`text-left p-3 rounded-lg border transition-all ${
									seat.taken
										? "border-slate-700 bg-slate-900/40 text-slate-500 cursor-not-allowed"
										: active
											? "border-amber-500 bg-amber-900/20 text-amber-200"
											: "border-slate-600 bg-slate-700/30 text-slate-300 hover:border-slate-500"
								}`}
							>
								<div className="font-medium text-sm">{seat.name}</div>
								<div className="text-xs text-slate-400">
									Level {seat.level} {seat.race} {seat.class}
								</div>
								<div className="text-xs mt-1">
									{seat.taken ? (
										<span className="text-slate-400">
											Played by {seat.playerName ?? "someone"}
											{!seat.connected && " (away)"}
										</span>
									) : (
										<span className="text-slate-500">
											{CLASS_BLURB[seat.class] ?? "Open seat"}
										</span>
									)}
								</div>
							</button>
						);
					})}
					{room.seats.length < MAX_SEATS && (
						<button
							type="button"
							onClick={() => setMaking(true)}
							className="text-left p-3 rounded-lg border border-dashed border-slate-500 text-slate-300 hover:border-amber-500 hover:text-amber-200 transition-all"
						>
							<div className="font-medium text-sm">Make your own</div>
							<div className="text-xs text-slate-400 mt-1">
								Pick a name, race and class. We handle the rest.
							</div>
						</button>
					)}
				</div>
			)}

			{room && openSeats === 0 && (
				<p className="text-sm text-slate-400 mb-4">
					Every ready-made character is taken. Make your own, or watch the game.
				</p>
			)}

			<div className="flex gap-3">
				<button
					type="button"
					onClick={() => selected && joinRoom(code, selected)}
					disabled={!connected || !selected}
					className="flex-1 py-3 rounded-lg font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-amber-600 hover:bg-amber-500 text-white"
				>
					{connected ? "Sit down" : "Connecting..."}
				</button>
				<button
					type="button"
					onClick={() => joinRoom(code)}
					disabled={!connected || !room}
					className="py-3 px-4 rounded-lg font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed border border-slate-600 text-slate-300 hover:border-slate-500 hover:text-white"
				>
					Watch
				</button>
			</div>
				</>
			)}

			<button
				type="button"
				onClick={onBack}
				className="block mx-auto mt-5 text-xs text-slate-500 hover:text-slate-300"
			>
				Leave this table
			</button>
		</Shell>
	);
}

export function JoinScreen() {
	const [code, setCode] = useState<string | null>(() => roomCodeFromUrl());

	function enter(next: string) {
		const url = new URL(window.location.href);
		url.searchParams.set("room", next);
		window.history.replaceState(null, "", url);
		setCode(next);
	}

	function back() {
		const url = new URL(window.location.href);
		url.searchParams.delete("room");
		window.history.replaceState(null, "", url);
		useGameStore.setState({ roomError: null });
		setCode(null);
	}

	return code ? (
		<SeatPicker code={code} onBack={back} />
	) : (
		<Landing onEnter={enter} />
	);
}
