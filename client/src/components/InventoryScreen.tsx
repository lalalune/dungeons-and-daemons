import { useState } from "react";
import {
	type BodySlot,
	type InventoryItem,
	useGameStore,
} from "../store/gameStore";

/** Where each slot sits on the 3-column body grid. */
const SLOTS: { slot: BodySlot; label: string; col: number; row: number }[] = [
	{ slot: "shoulders", label: "Pauldrons", col: 1, row: 1 },
	{ slot: "head", label: "Head", col: 2, row: 1 },
	{ slot: "neck", label: "Necklace", col: 3, row: 1 },
	{ slot: "mainHand", label: "Sword hand", col: 1, row: 2 },
	{ slot: "chest", label: "Chest", col: 2, row: 2 },
	{ slot: "offHand", label: "Other hand", col: 3, row: 2 },
	{ slot: "hands", label: "Gloves", col: 1, row: 3 },
	{ slot: "legs", label: "Legs", col: 2, row: 3 },
	{ slot: "greaves", label: "Greaves", col: 2, row: 4 },
	{ slot: "feet", label: "Boots", col: 2, row: 5 },
];

const KIND_MARK: Record<string, string> = {
	weapon: "⚔",
	armor: "🛡",
	potion: "⚗",
	scroll: "📜",
	gear: "🎒",
	tool: "🔧",
	treasure: "💎",
	consumable: "🍖",
	ring: "💍",
	wand: "✦",
	wondrous: "✦",
};

/** A plain standing figure behind the slots, so the layout reads as a body. */
function Figure() {
	return (
		<svg
			viewBox="0 0 200 420"
			aria-hidden="true"
			className="absolute inset-0 m-auto h-full w-auto opacity-[0.13] pointer-events-none"
			fill="currentColor"
		>
			<circle cx="100" cy="42" r="30" />
			<rect x="88" y="68" width="24" height="18" rx="6" />
			<path d="M52 88 Q100 74 148 88 L156 206 Q100 220 44 206 Z" />
			<path d="M50 92 Q28 100 24 132 L14 218 Q22 228 34 222 L50 140 Z" />
			<path d="M150 92 Q172 100 176 132 L186 218 Q178 228 166 222 L150 140 Z" />
			<path d="M50 208 L96 214 L92 396 Q76 406 60 396 Z" />
			<path d="M150 208 L104 214 L108 396 Q124 406 140 396 Z" />
		</svg>
	);
}

function SlotBox({
	label,
	item,
	active,
	onSelect,
	style,
}: {
	label: string;
	item: InventoryItem | null;
	active: boolean;
	onSelect: () => void;
	style: React.CSSProperties;
}) {
	return (
		<button
			type="button"
			onClick={onSelect}
			disabled={!item}
			aria-pressed={active}
			aria-label={item ? `${label}: ${item.name}` : `${label}: empty`}
			style={style}
			className={`relative z-10 h-[4.6rem] rounded-lg border px-2 py-1.5 text-left transition-all ${
				item
					? active
						? "border-amber-400 bg-amber-900/30"
						: "border-amber-700/70 bg-slate-800/90 hover:border-amber-500"
					: "border-dashed border-slate-600 bg-slate-900/50 cursor-default"
			}`}
		>
			<div className="text-[10px] uppercase tracking-wide text-slate-500">
				{label}
			</div>
			{item ? (
				<>
					<div className="text-sm text-amber-100 leading-tight truncate">
						{item.name}
					</div>
					<div className="text-[11px] text-slate-400 truncate">{item.detail}</div>
				</>
			) : (
				<div className="text-xs text-slate-600 mt-1">Empty</div>
			)}
		</button>
	);
}

/** The body with its slots, and the bag beside it. */
export function InventoryBody() {
	const { character, equipItem, unequipItem } = useGameStore();
	const [selected, setSelected] = useState<InventoryItem | null>(null);

	const inventory = character?.inventory;
	if (!character || !inventory) return null;

	const coins = (
		[
			["pp", "Platinum", "text-slate-200"],
			["gp", "Gold", "text-amber-300"],
			["ep", "Electrum", "text-teal-200"],
			["sp", "Silver", "text-slate-300"],
			["cp", "Copper", "text-orange-300"],
		] as const
	).filter(([key]) => inventory.coins[key] > 0);

	return (
				<div className="grid grid-cols-1 md:grid-cols-2 gap-5 p-5">
					{/* The body */}
					<section aria-label="Worn and wielded">
						<h3 className="text-sm font-medium text-slate-300 mb-3">
							Worn and wielded
						</h3>
						<div className="relative grid grid-cols-3 gap-2 text-slate-300">
							<Figure />
							{SLOTS.map(({ slot, label, col, row }) => {
								const item = inventory.equipped[slot];
								return (
									<SlotBox
										key={slot}
										label={label}
										item={item}
										active={item !== null && item === selected}
										onSelect={() => setSelected(item)}
										style={{ gridColumn: col, gridRow: row }}
									/>
								);
							})}
						</div>
					</section>

					{/* The bag */}
					<section aria-label="Bag" className="flex flex-col">
						<div className="flex items-baseline justify-between mb-3">
							<h3 className="text-sm font-medium text-slate-300">Bag</h3>
							<div className="flex gap-3 text-xs">
								{coins.length === 0 && (
									<span className="text-slate-500">No coins</span>
								)}
								{coins.map(([key, name, color]) => (
									<span key={key} className={color} title={name}>
										{inventory.coins[key]} {key}
									</span>
								))}
							</div>
						</div>

						{inventory.bag.length === 0 ? (
							<p className="text-sm text-slate-500 py-6 text-center border border-dashed border-slate-700 rounded-lg">
								Your bag is empty.
							</p>
						) : (
							<ul className="grid grid-cols-2 gap-2">
								{inventory.bag.map((item, i) => {
									const active = item === selected;
									return (
										<li key={`${item.name}-${i}`}>
											<button
												type="button"
												onClick={() => setSelected(item)}
												aria-pressed={active}
												className={`w-full h-[4.6rem] rounded-lg border px-2 py-1.5 text-left transition-all ${
													active
														? "border-amber-400 bg-amber-900/30"
														: "border-slate-600 bg-slate-800/80 hover:border-slate-400"
												}`}
											>
												<div className="flex items-start justify-between gap-2">
													<span
														className={`text-sm leading-tight line-clamp-2 ${
															item.rarity ? "text-violet-200" : "text-slate-100"
														}`}
													>
														<span aria-hidden="true" className="mr-1 opacity-70">
															{KIND_MARK[item.kind] ?? "•"}
														</span>
														{item.name}
													</span>
													{item.quantity > 1 && (
														<span className="text-xs tabular-nums text-amber-300 shrink-0">
															×{item.quantity}
														</span>
													)}
												</div>
												<div className="text-[11px] text-slate-400 truncate mt-0.5">
													{item.detail || item.kind}
												</div>
											</button>
										</li>
									);
								})}
							</ul>
						)}

						<div className="mt-4 min-h-[5.5rem] rounded-lg border border-slate-700 bg-slate-950/50 p-3">
							{selected ? (
								<>
									<div className="text-amber-200 font-medium">
										{selected.name}
										{selected.quantity > 1 && (
											<span className="text-slate-400 font-normal">
												{" "}
												×{selected.quantity}
											</span>
										)}
									</div>
									<div className="text-xs text-slate-400 capitalize">
										{selected.rarity && (
											<span className="text-violet-300">{selected.rarity} </span>
										)}
										{selected.kind}
										{selected.detail && ` · ${selected.detail}`}
									</div>
									{(selected.canEquip || selected.canRemove) && (
										<button
											type="button"
											onClick={() => {
												if (selected.canRemove) unequipItem(selected.name);
												else equipItem(selected.name);
												setSelected(null);
											}}
											className="mt-2 text-sm px-3 py-1.5 rounded-lg font-medium bg-amber-600 hover:bg-amber-500 text-white"
										>
											{selected.canRemove ? "Take off" : "Put on"}
										</button>
									)}
									{selected.description && (
										<p className="text-sm text-slate-300 mt-1">
											{selected.description}
										</p>
									)}
								</>
							) : (
								<p className="text-sm text-slate-500">
									Select an item to see what it does.
								</p>
							)}
						</div>
					</section>
				</div>
	);
}
