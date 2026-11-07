export function SetupRequired() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-navy px-6 text-white">
      <div className="max-w-lg rounded-[20px] border border-white/10 bg-navy-800 p-8">
        <h1 className="text-2xl font-bold">Setup required</h1>
        <p className="mt-3 text-slate-300">
          This app isn&apos;t connected to its database yet. Set <code className="font-mono text-plate">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code className="font-mono text-plate">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in the environment (see the README), then redeploy or
          restart the server.
        </p>
      </div>
    </main>
  );
}
