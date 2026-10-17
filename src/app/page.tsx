export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-4 px-4 py-16">
      <h1 className="text-3xl font-semibold">Triple Firma</h1>
      <p className="text-lg">
        El LLM <strong>lee</strong>, el código <strong>decide</strong>, la persona{" "}
        <strong>autoriza</strong>.
      </p>
      <p className="text-sm opacity-70">Esqueleto del proyecto. Las vistas se construyen aquí.</p>
    </main>
  );
}
