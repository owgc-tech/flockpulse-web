'use client';

import { usePathname } from 'next/navigation';
import { isAdminTier, type Role } from '@/src/lib/auth/middleware';

// DIP-FP-114-web: adminOnly items are hidden entirely for Leader-tier — Members/
// Groups/Formation/Restore stay fully excluded (not read-only), so a nav link
// that would just 403 isn't shown. Everything else Leader-tier can reach.
const NAV = [
  { href: '/admin/members', label: 'Members', adminOnly: true },
  { href: '/admin/groups', label: 'Groups', adminOnly: true },
  { href: '/admin/events', label: 'Events', adminOnly: false },
  { href: '/admin/formation', label: 'Formation', adminOnly: true },
  { href: '/admin/formation-progress', label: 'Formation Progress', adminOnly: false },
  { href: '/admin/reports', label: 'Reports', adminOnly: false },
  { href: '/admin/invitations', label: 'Invitations', adminOnly: false },
  { href: '/admin/community', label: 'Community', adminOnly: false },
  {
    href: '/admin/restore',
    label: 'Record Restorations',
    adminOnly: true,
    children: [
      { href: '/admin/restore/courses', label: 'Courses' },
      { href: '/admin/restore/modules', label: 'Modules' },
      { href: '/admin/restore/talks', label: 'Talks' },
    ],
  },
] as const;

export default function AdminSidebar({ role }: { role: Role }) {
  const pathname = usePathname();
  const nav = isAdminTier(role) ? NAV : NAV.filter(item => !item.adminOnly);

  function isActive(href: string) {
    if (href === '/admin/restore') return pathname.startsWith('/admin/restore');
    return pathname === href || pathname.startsWith(href + '/');
  }

  return (
    <aside className="flex w-56 flex-shrink-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <nav className="flex flex-col gap-0.5 p-3">
        {nav.map(item => (
          <div key={item.href}>
            <a
              href={item.href}
              className={`flex items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive(item.href) && !('children' in item)
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'children' in item && pathname.startsWith('/admin/restore')
                  ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                  : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
              }`}
            >
              {item.label}
            </a>
            {'children' in item && (
              <div className="ml-3 mt-0.5 flex flex-col gap-0.5">
                {item.children.map(child => (
                  <a
                    key={child.href}
                    href={child.href}
                    className={`flex items-center rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      pathname === child.href || pathname.startsWith(child.href + '/')
                        ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                        : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200'
                    }`}
                  >
                    {child.label}
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>
    </aside>
  );
}
