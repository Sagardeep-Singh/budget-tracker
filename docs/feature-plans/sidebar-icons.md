# Sidebar item icons

## Goal

Every primary nav item in `components/nav/sidebar.tsx` gets a leading icon, matching the active/inactive treatment already used for labels and badges.

## Acceptance criteria

- [ ] Each of the 7 nav items (Overview, Transactions, Categorize, Budgets, Accounts, Rules, Settings) renders a small leading icon next to its label.
- [ ] Icon inherits the active/inactive color state: `text-paper-raised` when the row is active (`bg-iris`), `text-ink-muted` (or matching current inactive label tone) when not.
- [ ] Icon size and gap are visually balanced with the existing 14px label text and pill padding (`px-3 py-2.5`) — icons should not increase row height.
- [ ] No layout shift: badge (right-aligned) position is unaffected by adding an icon on the left.
- [ ] `SidebarNavItem` type gains an `icon` field without breaking the `alert` styling already on Categorize.

## Icon-per-item mapping

| Label | Icon (lucide-react name) | Notes |
|---|---|---|
| Overview | `LayoutDashboard` | matches "dashboard" route name |
| Transactions | `Receipt` | consistent with money/ledger entries |
| Categorize | `Tag` | categorization action |
| Budgets | `PiggyBank` | budget/savings connotation |
| Accounts | `Wallet` | bank/account balance |
| Rules | `ListFilter` | matching rule/filter logic |
| Settings | `Settings` | standard gear icon |

(Exact icon names to be confirmed against whichever icon set is actually installed — see dependency note below.)

## Shared-dependency assumption

**This plan does not install an icon library.** No icon package (`lucide-react`, `@heroicons/react`, `react-icons`) is currently a dependency (checked `package.json` — none present). The parallel "button icons + loading states" workstream is expected to make the actual library choice and add the dependency, since it touches more surface area (every button). This plan assumes that choice lands as `lucide-react` (best fit: tree-shakeable, no extra runtime, matches the app's plain/minimal icon style) and uses lucide icon names above.

**Reconcile at merge time:** whichever branch (this one or the button-icons one) merges first should add the dependency; the second branch rebases and drops the duplicate `npm install`. If a different library is chosen, swap the icon names in the table above 1:1 — the component wiring below doesn't change.

## Component changes

### `components/nav/sidebar-nav.tsx`

- Extend `SidebarNavItem`:
  ```ts
  export type SidebarNavItem = {
    href: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
    alert?: boolean;
  };
  ```
- In the row render, add the icon before the label:
  ```tsx
  <span className="flex items-center gap-2">
    <item.icon className="size-4 shrink-0" />
    <span>{item.label}</span>
  </span>
  ```
  (wrap label+icon in one flex span so the existing `justify-between` with the badge still pushes the badge to the far right)
- Icon color follows the existing conditional already applied to the row's text color — no separate icon color class needed if `currentColor`-based icons (lucide default) are used; verify no icon has a hardcoded fill/stroke color prop.

### `components/nav/sidebar.tsx`

- Import the 7 icons and attach one per `navItems` entry, per the mapping table above.

## Out of scope

- No changes to icon usage anywhere outside the sidebar (buttons, headers, etc. — that's the separate "button icons + loading states" plan).
- No changes to nav item set, routes, or badge/count logic.

## Checklist

- [ ] Confirm final icon library choice (coordinate with button-icons-loading-states branch; add dependency here only if this branch merges first)
- [ ] Extend `SidebarNavItem` type with required `icon` field in `components/nav/sidebar-nav.tsx`
- [ ] Update row markup to render icon + label as a grouped flex span, preserving badge alignment
- [ ] Wire the 7 icons into `navItems` in `components/nav/sidebar.tsx` per the mapping table
- [ ] Visually verify active/inactive icon color matches label color in both states
- [ ] Visually verify no row height / alignment regression at 60px sidebar width
- [ ] `npm run format:fix && npm run lint` and `npm run test`
