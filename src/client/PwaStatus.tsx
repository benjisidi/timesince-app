import { useRegisterSW } from "virtual:pwa-register/react";

interface PwaStatusProps {
  appearsOffline: boolean;
  backendUnavailable: boolean;
}

export function PwaStatus({
  appearsOffline,
  backendUnavailable,
}: PwaStatusProps) {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!appearsOffline && !backendUnavailable && !needRefresh) return null;

  return (
    <div className="app-status-stack" aria-live="polite">
      {appearsOffline || backendUnavailable ? (
        <div className="app-status app-status-connection" role="status">
          <p>
            {appearsOffline
              ? backendUnavailable
                ? "You appear to be offline. TimeSince couldn’t reach its server, so changes won’t be saved."
                : "You appear to be offline. TimeSince needs its server to load and save changes."
              : "TimeSince can’t reach its server. Changes won’t be saved until it reconnects."}
          </p>
        </div>
      ) : null}
      {needRefresh ? (
        <div className="app-status app-status-update" role="status">
          <p>An updated version of TimeSince is ready.</p>
          <div className="app-status-actions">
            <button
              type="button"
              onClick={() => void updateServiceWorker(true)}
            >
              Reload
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
