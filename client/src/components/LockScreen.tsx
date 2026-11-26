import { useState } from "react";
import { SERVER_URL } from "../store/gameStore";
import { Backdrop } from "./Backdrop";

/** Shown on private servers until the visitor enters the access code. */
export function LockScreen({ onUnlocked }: { onUnlocked: () => void }) {
	const [code, setCode] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		setBusy(true);
		setError(null);
		try {
			const res = await fetch(`${SERVER_URL}/api/unlock`, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ code }),
			});
			if (res.ok) return onUnlocked();
			const data = (await res.json().catch(() => ({}))) as { error?: string };
			setError(data.error ?? "Could not unlock.");
		} catch {
			setError("Could not reach the server.");
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="relative isolate min-h-screen flex items-center justify-center p-4">
			<Backdrop />
			<form
				onSubmit={submit}
				className="w-full max-w-sm bg-slate-900/75 backdrop-blur-md border border-slate-700/80 rounded-xl p-6 shadow-2xl"
			>
				<h1 className="font-fantasy text-2xl font-bold text-amber-400 mb-1 text-center">
					Dungeons &amp; Daemons
				</h1>
				<p className="text-sm text-slate-400 text-center mb-5">
					This is a private table. Enter the access code.
				</p>
				{error && (
					<div
						role="alert"
						className="bg-red-900/30 border border-red-800 rounded-lg p-3 mb-4 text-red-300 text-sm"
					>
						{error}
					</div>
				)}
				<input
					type="password"
					value={code}
					onChange={(e) => setCode(e.target.value)}
					placeholder="Access code"
					aria-label="Access code"
					autoComplete="current-password"
					className="w-full rounded-lg bg-slate-900/60 border border-slate-600 px-3 py-2.5 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-500 mb-4"
				/>
				<button
					type="submit"
					disabled={busy || !code.trim()}
					className="w-full py-3 rounded-lg font-medium transition-all disabled:opacity-40 bg-amber-600 hover:bg-amber-500 text-white"
				>
					{busy ? "Checking..." : "Enter"}
				</button>
			</form>
		</div>
	);
}
