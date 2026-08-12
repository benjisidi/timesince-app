import { NavLink, useLocation } from "react-router";

function NavigationLinks() {
  return (
    <>
      <NavLink to="/" end>
        Ready
      </NavLink>
      <NavLink to="/categories" end>
        Browse
      </NavLink>
    </>
  );
}

export function AppNavigation({
  onSearch,
}: {
  onSearch: (trigger: HTMLButtonElement) => void;
}) {
  const location = useLocation();
  const browseRoute = location.pathname === "/categories";
  const manageCategories = location.pathname === "/categories/manage";
  const archivedTasks = location.pathname === "/categories/archived";
  const viewLabel = archivedTasks
    ? "Archived tasks"
    : manageCategories
      ? "Manage categories"
      : browseRoute
        ? "Browse"
        : "Ready";
  const shortcutLabel = /Mac|iPhone|iPad/.test(navigator.platform)
    ? "⌘K"
    : "Ctrl K";

  return (
    <header className="app-header">
      <div>
        <div className="app-brand">
          <p>TimeSince</p>
          <span>{viewLabel}</span>
        </div>
        <button
          type="button"
          className="search-trigger"
          onClick={(event) => onSearch(event.currentTarget)}
          aria-label="Search tasks"
        >
          <span>Search</span>
          <kbd aria-hidden="true">{shortcutLabel}</kbd>
        </button>
        <nav className="desktop-navigation" aria-label="Primary navigation">
          <NavigationLinks />
        </nav>
      </div>
      <nav className="mobile-navigation" aria-label="Primary navigation">
        <NavigationLinks />
      </nav>
    </header>
  );
}
