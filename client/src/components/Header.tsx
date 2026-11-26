import { useState } from "react";
import { inviteLink, useGameStore } from "../store/gameStore";

export function Header() {
	const {
		connected,
		phase,
		round,
		inCombat,
		character,
		campaignName,
		roomCode,
		leaveRoom,
	} = useGameStore();
	const [copied, setCopied] = useState(false);

	async function copyInvite() {
		if (!roomCode) return;
		try {
			await navigator.clipboard.writeText(inviteLink(roomCode));
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// Clipboard can be blocked; the code is shown in the header to read out.
		}
	}

	const phaseLabels: Record<string, string> = {
		initializing: "Starting...",
		narration: "Story",
		exploration: "Exploration",
		social: "Conversation",
		combat: "Combat",
		rest: "Resting",
		transition: "Transition",
		ending: "Ending",
	};

	return (
		<header className="bg-slate-950/70 backdrop-blur-sm border-b border-slate-700 px-4 py-3">
			<div className="container mx-auto flex items-center justify-between">
				<div className="flex items-center gap-4">
					<h1 className="font-fantasy text-2xl text-gold-400">
						Dungeons &amp; Daemons
					</h1>

					{campaignName && (
						<span className="text-sm text-slate-400 hidden sm:inline">
							— {campaignName}
						</span>
					)}

					<div className="flex items-center gap-2 text-sm">
						<span
							className={`w-2 h-2 rounded-full ${
								connected ? "bg-green-500" : "bg-red-500"
							}`}
						/>
						<span className="text-slate-400">
							{connected ? "Connected" : "Disconnected"}
						</span>
					</div>
				</div>

				<div className="flex items-center gap-4">
					{roomCode && (
						<button
							type="button"
							onClick={copyInvite}
							title="Copy a link your friends can use to join this table"
							className="flex items-center gap-2 px-2 py-1 rounded border border-slate-600 text-sm text-slate-200 hover:border-amber-500"
						>
							<span className="font-mono tracking-widest text-amber-300">
								{roomCode}
							</span>
							<span className="text-slate-400">
								{copied ? "Copied" : "Invite"}
							</span>
						</button>
					)}

					{/* Game Phase */}
					<div className="flex items-center gap-2">
						<span
							className={`px-2 py-1 rounded text-sm font-medium ${
								inCombat
									? "bg-red-900/50 text-red-300 border border-red-700"
									: "bg-slate-700 text-slate-300"
							}`}
						>
							{phaseLabels[phase] ?? phase}
							{inCombat && round > 0 && ` • Round ${round}`}
						</span>
					</div>

					{/* Character Info (compact) */}
					{character && (
						<div className="flex items-center gap-3 pl-4 border-l border-slate-700">
							<div className="text-right">
								<div className="text-sm font-medium text-slate-200">
									{character.name}
								</div>
								<div className="text-xs text-slate-400">
									Lv. {character.level} {character.race} {character.class}
								</div>
							</div>

							<div className="flex flex-col items-center">
								<div className="text-xs text-slate-500">HP</div>
								<div
									className={`text-sm font-bold ${
										character.hp.current <= character.hp.max * 0.25
											? "text-red-400"
											: character.hp.current <= character.hp.max * 0.5
												? "text-yellow-400"
												: "text-green-400"
									}`}
								>
									{character.hp.current}/{character.hp.max}
								</div>
							</div>

							<div className="flex flex-col items-center">
								<div className="text-xs text-slate-500">AC</div>
								<div className="text-sm font-bold text-slate-200">
									{character.ac}
								</div>
							</div>
						</div>
					)}

					{/* Leave button */}
					<button
						type="button"
						onClick={leaveRoom}
						className="text-xs text-slate-500 hover:text-slate-300 transition-colors px-2 py-1 rounded hover:bg-slate-800"
						title="Leave this table and give up your seat"
					>
						Leave
					</button>
				</div>
			</div>
		</header>
	);
}
