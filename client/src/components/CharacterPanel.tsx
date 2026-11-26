import clsx from "clsx";
import { useEffect, useState } from "react";
import { CharacterScreen, type CharacterTab } from "./CharacterScreen";
import { useGameStore } from "../store/gameStore";

export function CharacterPanel() {
	const { character, conditionRules, loadConditionRules } = useGameStore();
	useEffect(() => {
		loadConditionRules();
	}, [loadConditionRules]);
	const [openTab, setOpenTab] = useState<CharacterTab | null>(null);

	if (!character) {
		return (
			<div className="bg-slate-900/70 backdrop-blur-sm rounded-lg border border-slate-700 p-4">
				<div className="text-center text-slate-500">
					You are watching. Leave and rejoin to take an open seat.
				</div>
			</div>
		);
	}

	const hpPercent = (character.hp.current / character.hp.max) * 100;

	return (
		<div className="bg-slate-900/70 backdrop-blur-sm rounded-lg border border-slate-700 overflow-hidden">
			{/* Header */}
			<div className="bg-gradient-to-r from-slate-700 to-slate-800 px-4 py-3 border-b border-slate-600">
				<h2 className="fantasy-heading text-xl text-gold-400">
					{character.name}
				</h2>
				<p className="text-sm text-slate-400">
					{character.race} {character.class} {character.level}
				</p>
			</div>

			<div className="p-4 space-y-4">
				{/* HP Bar */}
				<div>
					<div className="flex justify-between text-sm mb-1">
						<span className="text-slate-400">Hit Points</span>
						<span
							className={clsx(
								"font-bold",
								hpPercent <= 25
									? "text-red-400"
									: hpPercent <= 50
										? "text-yellow-400"
										: "text-green-400",
							)}
						>
							{character.hp.current}/{character.hp.max}
							{character.hp.temp > 0 && (
								<span className="text-blue-400"> (+{character.hp.temp})</span>
							)}
						</span>
					</div>
					<div className="h-3 bg-slate-700 rounded-full overflow-hidden">
						<div
							className={clsx(
								"h-full transition-all duration-300",
								hpPercent <= 25
									? "bg-red-500"
									: hpPercent <= 50
										? "bg-yellow-500"
										: "bg-green-500",
							)}
							style={{ width: `${Math.max(0, hpPercent)}%` }}
						/>
					</div>
				</div>

				{/* Stats Grid */}
				<div className="grid grid-cols-3 gap-2">
					<StatBox label="AC" value={character.ac} />
					<StatBox label="Speed" value={`${character.speed}ft`} />
					<StatBox label="Level" value={character.level} />
				</div>

				<div className="grid grid-cols-2 gap-2">
					<button
						type="button"
						onClick={() => setOpenTab("sheet")}
						className="py-2 rounded-lg text-sm font-medium border border-amber-700/70 text-amber-200 bg-amber-900/20 hover:border-amber-500 transition-all"
					>
						📜 Sheet
					</button>
					<button
						type="button"
						onClick={() => setOpenTab("inventory")}
						className="py-2 rounded-lg text-sm font-medium border border-amber-700/70 text-amber-200 bg-amber-900/20 hover:border-amber-500 transition-all"
					>
						🎒 Inventory
					</button>
				</div>
				{openTab && (
					<CharacterScreen initialTab={openTab} onClose={() => setOpenTab(null)} />
				)}

				{/* Spell Slots */}
				{character.spellSlots &&
					Object.keys(character.spellSlots).length > 0 && (
						<div>
							<h4 className="text-sm text-slate-400 mb-2">Spell Slots</h4>
							<div className="flex flex-wrap gap-2">
								{Object.entries(character.spellSlots)
									.filter(([_, slot]) => slot.max > 0)
									.map(([level, slot]) => (
										<div
											key={level}
											className="bg-slate-700 rounded px-2 py-1 text-sm"
										>
											<span className="text-slate-400">L{level}:</span>
											<span
												className={clsx(
													"ml-1 font-bold",
													slot.current === 0
														? "text-red-400"
														: slot.current < slot.max
															? "text-yellow-400"
															: "text-blue-400",
												)}
											>
												{slot.current}/{slot.max}
											</span>
										</div>
									))}
							</div>
						</div>
					)}

				{/* Conditions */}
				{character.conditions.length > 0 && (
					<div>
						<h4 className="text-sm text-slate-400 mb-2">Conditions</h4>
						<div className="flex flex-wrap gap-1">
							{character.conditions.map((condition) => (
								<span
									key={condition}
									title={conditionRules[condition.toLowerCase()] ?? condition}
									className="cursor-help bg-yellow-900/50 text-yellow-300 text-xs px-2 py-1 rounded border border-yellow-700"
								>
									{condition}
								</span>
							))}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

function StatBox({ label, value }: { label: string; value: string | number }) {
	return (
		<div className="bg-slate-700/50 rounded p-2 text-center">
			<div className="text-xs text-slate-400">{label}</div>
			<div className="text-lg font-bold text-slate-200">{value}</div>
		</div>
	);
}
