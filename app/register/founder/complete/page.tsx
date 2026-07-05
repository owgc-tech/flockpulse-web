import FounderCompleteForm from './FounderCompleteForm';

export default function FounderCompletePage() {
  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-12 dark:bg-black">
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-8 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Set up your community
        </h1>
        <FounderCompleteForm />
      </div>
    </main>
  );
}
