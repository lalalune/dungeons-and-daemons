import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
	type CharacterSheetView,
	type RollMode,
	useGameStore,
} from "../store/gameStore";
import { InventoryBody } from "./InventoryScreen";

const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<section className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
			<h3 className="text-xs uppercase tracking-wide text-amber-400/90 mb-2">
				{title}
			</h3>
			{children}
		</section>
	);
}

/** A filled dot marks proficiency, as on a paper sheet. */
function Dot({ on }: { on: boolean }) {
	return (
		<span
			aria-hidden="true"
			className={`inline-block w-2 h-2 rounded-full border ${
				on ? "bg-amber-400 border-amber-400" : "border-slate-500"
			}`}
		/>
	);
}

function Tags({ items, empty }: { items: string[]; empty: string }) {
	if (items.length === 0) return <span className="text-slate-500">{empty}</span>;
	return <span className="text-slate-200">{items.join(", ")}</span>;
}

type Roller = (kind: "ability" | "save" | "skill", key: string) => void;

const rollable =
	"w-full rounded px-1 -mx-1 text-left hover:bg-amber-900/30 focus:outline-none focus:bg-amber-900/30 transition-colors cursor-pointer";

function SheetBody({ sheet, onRolled }: { sheet: CharacterSheetView; onRolled: () => void }) {
	const { character, rollCheck } = useGameStore();
	const [mode, setMode] = useState<RollMode>("normal");
	if (!character) return null;
	const roll: Roller = (kind, key) => {
		rollCheck(kind, key, mode);
		onRolled();
	};
	const spellLevels = [...new Set(sheet.spells.map((s) => s.level))];

	return (
		<div className="p-5 space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2">
				<span className="text-sm text-slate-300">
					🎲 Click any ability, saving throw or skill to roll it for the table.
				</span>
				<div className="flex gap-1" role="radiogroup" aria-label="Roll with">
					{(["normal", "advantage", "disadvantage"] as const).map((m) => (
						<button
							type="button"
							key={m}
							role="radio"
							aria-checked={mode === m}
							onClick={() => setMode(m)}
							className={`px-2.5 py-1 rounded text-xs capitalize border transition-colors ${
								mode === m
									? "border-amber-500 bg-amber-900/40 text-amber-100"
									: "border-slate-600 text-slate-400 hover:border-slate-400"
							}`}
						>
							{m}
						</button>
					))}
				</div>
			</div>

			{/* Headline numbers */}
			<div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
				{(
					[
						["Armor Class", character.ac],
						["Hit Points", `${character.hp.current}/${character.hp.max}`],
						["Speed", `${character.speed} ft`],
						["Initiative", signed(sheet.initiative)],
						["Proficiency", signed(sheet.proficiencyBonus)],
						["Hit Dice", sheet.hitDice],
					] as const
				).map(([label, value]) => (
					<div
						key={label}
						className="rounded-lg border border-slate-700 bg-slate-800/60 p-2 text-center"
					>
						<div className="text-[10px] uppercase tracking-wide text-slate-400">
							{label}
						</div>
						<div className="text-lg font-bold text-slate-100">{value}</div>
					</div>
				))}
			</div>

			{/* Ability scores */}
			<div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
				{sheet.abilities.map((a) => (
					<button
						type="button"
						key={a.key}
						onClick={() => roll("ability", a.key)}
						title={`Roll a ${a.name} check`}
						className="rounded-lg border border-amber-800/60 bg-slate-800/60 p-2 text-center hover:border-amber-400 hover:bg-amber-900/20 transition-colors"
					>
						<div className="text-[10px] uppercase tracking-wide text-amber-300/90">
							{a.name}
						</div>
						<div className="text-2xl font-bold text-slate-100 leading-tight">
							{signed(a.modifier)}
						</div>
						<div className="text-xs text-slate-400">{a.score}</div>
					</button>
				))}
			</div>

			<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
				<div className="space-y-4">
					<Section title="Saving throws">
						<ul className="space-y-1 text-sm">
							{sheet.savingThrows.map((s) => (
								<li key={s.key}>
									<button
										type="button"
										onClick={() => roll("save", s.key)}
										title={`Roll a ${s.name} saving throw`}
										className={`${rollable} flex items-center gap-2`}
									>
										<Dot on={s.proficient} />
										<span className="flex-1 text-slate-200">{s.name}</span>
										<span className="tabular-nums text-slate-100">
											{signed(s.modifier)}
										</span>
									</button>
								</li>
							))}
						</ul>
					</Section>
					<Section title="Senses">
						<div className="text-sm text-slate-200 flex justify-between">
							<span>Passive Perception</span>
							<span className="tabular-nums">{sheet.passivePerception}</span>
						</div>
					</Section>
					<Section title="Background">
						<dl className="text-sm space-y-1">
							<div className="flex justify-between gap-2">
								<dt className="text-slate-400">Background</dt>
								<dd className="text-slate-200">{sheet.background ?? "None"}</dd>
							</div>
							<div className="flex justify-between gap-2">
								<dt className="text-slate-400">Alignment</dt>
								<dd className="text-slate-200 capitalize">
									{sheet.alignment ?? "Unaligned"}
								</dd>
							</div>
							<div className="flex justify-between gap-2">
								<dt className="text-slate-400">Experience</dt>
								<dd className="text-slate-200 tabular-nums">
									{sheet.experience} XP
								</dd>
							</div>
						</dl>
					</Section>
				</div>

				<Section title="Skills">
					<ul className="space-y-1 text-sm">
						{sheet.skills.map((s) => (
							<li key={s.name}>
								<button
									type="button"
									onClick={() => roll("skill", s.name)}
									title={`Roll a ${s.name} check`}
									className={`${rollable} flex items-center gap-2`}
								>
									<Dot on={s.proficient} />
									<span className="flex-1 text-slate-200">
										{s.name}{" "}
										<span className="text-[10px] uppercase text-slate-500">
											{s.ability}
										</span>
									</span>
									<span className="tabular-nums text-slate-100">
										{signed(s.modifier)}
									</span>
								</button>
							</li>
						))}
					</ul>
				</Section>

				<div className="space-y-4">
					<Section title="Features, traits and feats">
						{sheet.features.length + sheet.racialTraits.length === 0 ? (
							<p className="text-sm text-slate-500">None yet.</p>
						) : (
							<ul className="text-sm text-slate-200 space-y-1.5 list-disc pl-4">
								{sheet.features.map((f) => (
									<li key={`f-${f}`}>{f}</li>
								))}
								{sheet.racialTraits.map((t) => (
									<li key={`t-${t}`} className="text-slate-300">
										{t}
									</li>
								))}
							</ul>
						)}
					</Section>
					<Section title="Proficiencies and languages">
						<dl className="text-sm space-y-1.5">
							<div>
								<dt className="text-slate-400 inline">Armor: </dt>
								<dd className="inline">
									<Tags items={sheet.proficiencies.armor} empty="none" />
								</dd>
							</div>
							<div>
								<dt className="text-slate-400 inline">Weapons: </dt>
								<dd className="inline">
									<Tags items={sheet.proficiencies.weapons} empty="none" />
								</dd>
							</div>
							<div>
								<dt className="text-slate-400 inline">Tools: </dt>
								<dd className="inline">
									<Tags items={sheet.proficiencies.tools} empty="none" />
								</dd>
							</div>
							<div>
								<dt className="text-slate-400 inline">Languages: </dt>
								<dd className="inline">
									<Tags items={sheet.proficiencies.languages} empty="none" />
								</dd>
							</div>
						</dl>
					</Section>
				</div>
			</div>

			{sheet.spellcasting && (
				<Section title="Spellcasting">
					<div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-200 mb-3">
						<span>
							<span className="text-slate-400">Ability </span>
							{sheet.spellcasting.ability}
						</span>
						<span>
							<span className="text-slate-400">Save DC </span>
							{sheet.spellcasting.saveDC}
						</span>
						<span>
							<span className="text-slate-400">Spell attack </span>
							{signed(sheet.spellcasting.attackBonus)}
						</span>
						{Object.entries(character.spellSlots ?? {}).map(([level, slot]) => (
							<span key={level}>
								<span className="text-slate-400">Level {level} slots </span>
								{slot.current}/{slot.max}
							</span>
						))}
					</div>
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
						{spellLevels.map((level) => (
							<div key={level}>
								<div className="text-xs text-slate-400 mb-1">
									{level === 0 ? "Cantrips" : `Level ${level}`}
								</div>
								<ul className="text-sm space-y-1">
									{sheet.spells
										.filter((s) => s.level === level)
										.map((s) => (
											<li key={s.name}>
												{s.description ? (
													<details>
														<summary className="cursor-pointer list-none hover:text-amber-200">
															<span className="text-slate-100">{s.name}</span>
															<span className="text-xs text-slate-400">
																{" "}
																{[s.school, s.range, s.detail]
																	.filter(Boolean)
																	.join(" · ")}{" "}
																▾
															</span>
														</summary>
														<div className="mt-1 mb-2 rounded border border-slate-700 bg-slate-900/60 p-2 text-xs text-slate-300 whitespace-pre-line">
															<div className="text-slate-400 mb-1">
																{[s.castingTime, s.duration, s.components]
																	.filter(Boolean)
																	.join(" · ")}
															</div>
															{s.description}
														</div>
													</details>
												) : (
													<>
														<span className="text-slate-100">{s.name}</span>
														<span className="text-xs text-slate-400">
															{" "}
															{[s.school, s.range, s.detail].filter(Boolean).join(" · ")}
														</span>
													</>
												)}
											</li>
										))}
								</ul>
							</div>
						))}
					</div>
				</Section>
			)}

			{sheet.backstory && (
				<Section title="Backstory">
					<p className="text-sm text-slate-300">{sheet.backstory}</p>
				</Section>
			)}
		</div>
	);
}

export type CharacterTab = "sheet" | "inventory";

/** Full-page window with the character sheet and the inventory. */
export function CharacterScreen({
	initialTab,
	onClose,
}: {
	initialTab: CharacterTab;
	onClose: () => void;
}) {
	const { character } = useGameStore();
	const [tab, setTab] = useState<CharacterTab>(initialTab);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	if (!character) return null;

	const tabClass = (active: boolean) =>
		`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
			active
				? "bg-amber-600 text-white"
				: "text-slate-300 border border-slate-600 hover:border-slate-400"
		}`;

	// Rendered on <body> so no panel's styling can clip it.
	return createPortal(
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
			onClick={onClose}
			onKeyDown={() => {}}
			role="presentation"
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={`${character.name}: character`}
				onClick={(e) => e.stopPropagation()}
				onKeyDown={() => {}}
				className="w-full max-w-5xl max-h-[92vh] overflow-y-auto rounded-xl border border-slate-700 bg-slate-900/95 backdrop-blur-md shadow-2xl"
			>
				<div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-slate-700 bg-slate-900">
					<div>
						<h2 className="fantasy-heading text-xl text-gold-400">
							{character.name}
						</h2>
						<p className="text-xs text-slate-400">
							Level {character.level} {character.race} {character.class}
						</p>
					</div>
					<div className="flex items-center gap-2" role="tablist">
						<button
							type="button"
							role="tab"
							aria-selected={tab === "sheet"}
							onClick={() => setTab("sheet")}
							className={tabClass(tab === "sheet")}
						>
							Character sheet
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={tab === "inventory"}
							onClick={() => setTab("inventory")}
							className={tabClass(tab === "inventory")}
						>
							Inventory
						</button>
						<button
							type="button"
							onClick={onClose}
							className="ml-2 text-sm px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 hover:border-slate-400"
						>
							Close
						</button>
					</div>
				</div>

				{tab === "sheet" && character.sheet && (
					<SheetBody sheet={character.sheet} onRolled={onClose} />
				)}
				{tab === "inventory" && <InventoryBody />}
			</div>
		</div>,
		document.body,
	);
}
