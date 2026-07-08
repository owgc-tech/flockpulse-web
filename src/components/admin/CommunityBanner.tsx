interface Props {
  name: string | null;
  logoUrl: string | null;
  tagline: string | null;
}

export default function CommunityBanner({ name, logoUrl, tagline }: Props) {
  const displayName = name ?? 'Community';

  return (
    <div className="sticky top-0 z-20 flex h-24 items-center gap-3 border-b border-zinc-200 bg-white px-6 dark:border-zinc-800 dark:bg-zinc-950">
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={`${displayName} logo`}
          className="h-20 w-20 flex-shrink-0 rounded-md object-cover"
        />
      ) : (
        <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-md bg-zinc-100 dark:bg-zinc-800">
          <span className="text-3xl font-semibold text-zinc-400 dark:text-zinc-500">
            {displayName.charAt(0).toUpperCase()}
          </span>
        </div>
      )}
      <div className="min-w-0">
        <p className="truncate text-[21px] font-semibold text-zinc-900 dark:text-zinc-50">{displayName}</p>
        {tagline && (
          <p className="truncate text-lg text-zinc-500 dark:text-zinc-400">{tagline}</p>
        )}
      </div>
    </div>
  );
}
