interface Props {
  name: string | null;
  logoUrl: string | null;
  tagline: string | null;
}

export default function CommunityBanner({ name, logoUrl, tagline }: Props) {
  const displayName = name ?? 'Community';

  return (
    <div className="flex items-center gap-3 border-b border-zinc-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-zinc-950">
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={`${displayName} logo`}
          className="h-9 w-9 flex-shrink-0 rounded-md object-cover"
        />
      ) : (
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-zinc-100 dark:bg-zinc-800">
          <span className="text-sm font-semibold text-zinc-400 dark:text-zinc-500">
            {displayName.charAt(0).toUpperCase()}
          </span>
        </div>
      )}
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">{displayName}</p>
        {tagline && (
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{tagline}</p>
        )}
      </div>
    </div>
  );
}
