'use client';

import { usePathname } from 'next/navigation';
import { isAdminTier, type Role } from '@/src/lib/auth/middleware';

interface NavLeaf {
  href: string;
  label: string;
  adminOnly: boolean;
}

// Record Restorations: parent href redirects to the first child, and the
// whole group is gated wholesale via the parent's single adminOnly — children
// carry no independent adminOnly. Unchanged from the pre-FP-137 shape.
interface NavRestoreGroup {
  href: string;
  label: string;
  adminOnly: boolean;
  children: { href: string; label: string }[];
}

// Formation/Reports: a plain-text, non-navigational heading (no href, no
// redirect route — DIP-FP-135-FP-137-web's explicit deviation from Restore's
// clickable-parent pattern) whose children are gated INDEPENDENTLY, since
// unlike Restore, these groups mix adminOnly: true and adminOnly: false
// children under one heading.
interface NavLabelGroup {
  label: string;
  children: NavLeaf[];
}

type NavItem = NavLeaf | NavRestoreGroup | NavLabelGroup;

function isRestoreGroup(item: NavItem): item is NavRestoreGroup {
  return 'children' in item && 'href' in item;
}

function isLabelGroup(item: NavItem): item is NavLabelGroup {
  return 'children' in item && !('href' in item);
}

// DIP-FP-114-web: adminOnly items are hidden entirely for Leader-tier — Members/
// Groups/Formation/Restore stay fully excluded (not read-only), so a nav link
// that would just 403 isn't shown. Everything else Leader-tier can reach.
const NAV: NavItem[] = [
  { href: '/admin/community', label: 'Community', adminOnly: false },
  { href: '/admin/members', label: 'Members', adminOnly: true },
  { href: '/admin/groups', label: 'Groups', adminOnly: true },
  { href: '/admin/events', label: 'Events', adminOnly: false },
  { href: '/admin/invitations', label: 'Invitations', adminOnly: false },
  {
    label: 'Formation',
    children: [
      { href: '/admin/formation-progress', label: 'Member Progress', adminOnly: false },
      { href: '/admin/formation', label: 'Courses', adminOnly: true },
    ],
  },
  {
    label: 'Reports',
    children: [
      { href: '/admin/reports/rsvp', label: 'RSVP Report', adminOnly: false },
      { href: '/admin/reports/attendance', label: 'Attendance Report', adminOnly: false },
      { href: '/admin/audit-logs', label: 'Audit Logs', adminOnly: true },
    ],
  },
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
];

export default function AdminSidebar({ role }: { role: Role }) {
  const pathname = usePathname();
  const admin = isAdminTier(role);

  // Each item type is filtered by its own gating rule: leaves and Restore's
  // group are gated wholesale by their own adminOnly; label groups filter
  // their children independently and disappear entirely if that leaves none.
  const nav = NAV.flatMap((item): NavItem[] => {
    if (isLabelGroup(item)) {
      const children = item.children.filter(child => admin || !child.adminOnly);
      return children.length > 0 ? [{ ...item, children }] : [];
    }
    if (admin || !item.adminOnly) return [item];
    return [];
  });

  function isActive(href: string) {
    if (href === '/admin/restore') return pathname.startsWith('/admin/restore');
    return pathname === href || pathname.startsWith(href + '/');
  }

  function renderChild(child: { href: string; label: string }) {
    return (
      <a
        key={child.href}
        href={child.href}
        className={`flex items-center rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
          isActive(child.href)
            ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
            : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200'
        }`}
      >
        {child.label}
      </a>
    );
  }

  return (
    <aside className="flex w-56 flex-shrink-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <nav className="flex flex-col gap-0.5 p-3">
        {nav.map(item => {
          if (isLabelGroup(item)) {
            return (
              <div key={item.label}>
                <p className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-600">
                  {item.label}
                </p>
                <div className="ml-3 mt-0.5 flex flex-col gap-0.5">
                  {item.children.map(renderChild)}
                </div>
              </div>
            );
          }

          if (isRestoreGroup(item)) {
            return (
              <div key={item.href}>
                <a
                  href={item.href}
                  className={`flex items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    pathname.startsWith('/admin/restore')
                      ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                      : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
                  }`}
                >
                  {item.label}
                </a>
                <div className="ml-3 mt-0.5 flex flex-col gap-0.5">
                  {item.children.map(renderChild)}
                </div>
              </div>
            );
          }

          return (
            <a
              key={item.href}
              href={item.href}
              className={`flex items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive(item.href)
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
              }`}
            >
              {item.label}
            </a>
          );
        })}
      </nav>
    </aside>
  );
}
