import { useGameStore } from "../store/gameStore";

/** Who is sitting at the table, and whether they are here right now. */
export function PartyPanel() {
	const { seats, watching, character, party, conditionRules } = useGameStore();
	if (seats.length === 0) return null;

	return (
		<div className="bg-slate-900/70 backdrop-blur-sm rounded-lg border border-slate-700 overflow-hidden">
			<div className="px-4 py-2 border-b border-slate-700 flex items-center justify-between">
				<h2 className="fantasy-heading text-sm text-gold-400">The Party</h2>
				{watching > 0 && (
					<span className="text-xs text-slate-500">{watching} watching</span>
				)}
			</div>
			<ul className="divide-y divide-slate-700/60">
				{seats.map((seat) => {
					const mine = seat.characterId === character?.id;
					const vitals = party.find((m) => m.characterId === seat.characterId);
					const hpPct = vitals
						? Math.max(0, Math.min(100, (vitals.hp.current / vitals.hp.max) * 100))
						: 0;
					return (
						<li
							key={seat.characterId}
							className="px-4 py-2 flex items-center gap-3"
						>
							<span
								aria-hidden="true"
								className={`w-2 h-2 rounded-full shrink-0 ${
									!seat.taken
										? "bg-slate-600"
										: seat.connected
											? "bg-green-500"
											: "bg-amber-500"
								}`}
							/>
							<div className="min-w-0 flex-1">
								<div className="text-sm text-slate-200 truncate">
									{seat.name}
									{mine && <span className="text-slate-500"> (you)</span>}
								</div>
								<div className="text-xs text-slate-500 truncate">
									{seat.class} ·{" "}
									{!seat.taken
										? "open seat"
										: seat.connected
											? seat.playerName
											: `${seat.playerName} (away)`}
								</div>
								{vitals && (
									<div className="mt-1 flex items-center gap-2">
										<div
											className="h-1.5 flex-1 rounded-full bg-slate-700 overflow-hidden"
											role="progressbar"
											aria-label={`${seat.name} hit points`}
											aria-valuemin={0}
											aria-valuemax={vitals.hp.max}
											aria-valuenow={vitals.hp.current}
										>
											<div
												className={`h-full ${
													hpPct > 50
														? "bg-green-500"
														: hpPct > 25
															? "bg-amber-500"
															: "bg-red-500"
												}`}
												style={{ width: `${hpPct}%` }}
											/>
										</div>
										<span className="text-[11px] tabular-nums text-slate-400 shrink-0">
											{vitals.hp.current}/{vitals.hp.max}
										</span>
									</div>
								)}
								{vitals && vitals.conditions.length > 0 && (
									<div className="text-[11px] text-amber-400 truncate">
										{vitals.conditions.map((c, i) => (
											<span
												key={c}
												title={conditionRules[c.toLowerCase()] ?? c}
												className="cursor-help"
											>
												{i > 0 && ", "}
												{c}
											</span>
										))}
									</div>
								)}
							</div>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
