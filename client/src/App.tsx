import { useEffect, useState } from "react";
import { ActionBar } from "./components/ActionBar";
import { AdventureLog } from "./components/AdventureLog";
import { Backdrop } from "./components/Backdrop";
import { BattleMap } from "./components/BattleMap";
import { CharacterPanel } from "./components/CharacterPanel";
import { Header } from "./components/Header";
import { InitiativeTracker } from "./components/InitiativeTracker";
import { JoinScreen } from "./components/JoinScreen";
import { LockScreen } from "./components/LockScreen";
import { PartyPanel } from "./components/PartyPanel";
import { SERVER_URL, useGameStore } from "./store/gameStore";

function App() {
	const { connect, joined, inCombat, campaignName, loadAccount } = useGameStore();

	// Private servers ask for an access code before anything else loads.
	const [access, setAccess] = useState<"checking" | "locked" | "open">("checking");

	useEffect(() => {
		fetch(`${SERVER_URL}/api/access`, { credentials: "include" })
			.then((res) => res.json())
			.then((data: { required: boolean; unlocked: boolean }) =>
				setAccess(data.required && !data.unlocked ? "locked" : "open"),
			)
			.catch(() => setAccess("open"));
	}, []);

	useEffect(() => {
		if (access !== "open") return;
		// Find out who is signed in first, then open the game connection.
		loadAccount().finally(connect);
	}, [access, connect, loadAccount]);

	if (access === "checking") return <Backdrop />;
	if (access === "locked") return <LockScreen onUnlocked={() => setAccess("open")} />;
	if (!joined) return <JoinScreen />;

	return (
		<div className="relative isolate min-h-screen">
			<Backdrop scene={campaignName} dim="table" />
			<Header />
			<div className="container mx-auto p-4">
				<div className="grid grid-cols-12 gap-4 h-[calc(100vh-8rem)]">
					<div className="col-span-3 flex flex-col gap-4">
						<CharacterPanel />
						{inCombat && <PartyPanel />}
						{inCombat && <InitiativeTracker />}
					</div>
					{inCombat ? (
						<>
							<div className="col-span-6 flex flex-col gap-4">
								<div className="flex-1 rounded-lg overflow-hidden border border-slate-700 bg-slate-800/50">
									<BattleMap />
								</div>
								<ActionBar />
							</div>
							<div className="col-span-3">
								<AdventureLog />
							</div>
						</>
					) : (
						<>
							<div className="col-span-5 flex flex-col gap-4 min-h-0">
								<div className="flex-1 min-h-0">
									<AdventureLog />
								</div>
								<ActionBar />
							</div>
							<div className="col-span-4 min-h-0 flex flex-col gap-4 overflow-y-auto">
								<div className="aspect-[3/2] shrink-0 rounded-lg overflow-hidden border border-slate-700 bg-slate-950/60">
									<BattleMap />
								</div>
								<PartyPanel />
							</div>
						</>
					)}
				</div>
			</div>
		</div>
	);
}

export default App;
