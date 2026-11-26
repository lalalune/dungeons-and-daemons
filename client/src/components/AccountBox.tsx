import { useState } from "react";
import { useGameStore } from "../store/gameStore";

const field =
	"w-full rounded-lg bg-slate-900/60 border border-slate-600 px-3 py-2.5 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-500";

/** Sign in or create an account, so characters are kept between tables. */
export function AccountBox() {
	const { account, signIn, signUp, signOut, playerName } = useGameStore();
	const [open, setOpen] = useState(false);
	const [creating, setCreating] = useState(false);
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	if (account) {
		return (
			<div className="flex items-center justify-between gap-3 mb-5 rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm">
				<span className="text-slate-300 truncate">
					Signed in as <span className="text-amber-200">{account.email}</span>
				</span>
				<button
					type="button"
					onClick={() => signOut()}
					className="shrink-0 text-xs text-slate-400 hover:text-slate-200 underline"
				>
					Sign out
				</button>
			</div>
		);
	}

	if (!open) {
		return (
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="w-full mb-5 rounded-lg border border-dashed border-slate-600 px-3 py-2 text-sm text-slate-300 hover:border-amber-500 hover:text-amber-200 transition-all"
			>
				Sign in to save your characters
			</button>
		);
	}

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		setBusy(true);
		setError(null);
		const problem = creating
			? await signUp(email, password, playerName)
			: await signIn(email, password);
		setBusy(false);
		if (problem) setError(problem);
		else setPassword("");
	}

	return (
		<form
			onSubmit={submit}
			className="mb-5 rounded-lg border border-slate-700 bg-slate-950/40 p-3 space-y-2"
		>
			<div className="flex items-center justify-between">
				<span className="text-sm font-medium text-slate-200">
					{creating ? "Create an account" : "Sign in"}
				</span>
				<button
					type="button"
					onClick={() => setOpen(false)}
					className="text-xs text-slate-500 hover:text-slate-300"
				>
					Not now
				</button>
			</div>
			{error && (
				<div role="alert" className="text-sm text-red-300">
					{error}
				</div>
			)}
			<input
				type="email"
				value={email}
				onChange={(e) => setEmail(e.target.value)}
				placeholder="Email"
				aria-label="Email"
				autoComplete="email"
				required
				className={field}
			/>
			<input
				type="password"
				value={password}
				onChange={(e) => setPassword(e.target.value)}
				placeholder={creating ? "Password (8 characters or more)" : "Password"}
				aria-label="Password"
				autoComplete={creating ? "new-password" : "current-password"}
				minLength={creating ? 8 : undefined}
				required
				className={field}
			/>
			<button
				type="submit"
				disabled={busy}
				className="w-full py-2.5 rounded-lg font-medium transition-all disabled:opacity-50 bg-slate-700 hover:bg-slate-600 text-white"
			>
				{busy ? "One moment..." : creating ? "Create account" : "Sign in"}
			</button>
			<button
				type="button"
				onClick={() => {
					setCreating(!creating);
					setError(null);
				}}
				className="block mx-auto text-xs text-slate-400 hover:text-slate-200 underline"
			>
				{creating ? "I already have an account" : "New here? Create an account"}
			</button>
		</form>
	);
}
