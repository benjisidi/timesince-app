import { useEffect, useState } from "react";

import type { HealthResponse } from "../shared/health";

type ConnectionState = "checking" | "connected" | "unavailable";

export function App() {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("checking");

  useEffect(() => {
    const abortController = new AbortController();

    async function checkConnection() {
      try {
        const response = await fetch("/api/health", {
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error(`Health check failed with status ${response.status}`);
        }

        const health = (await response.json()) as HealthResponse;
        setConnectionState(
          health.status === "ok" ? "connected" : "unavailable",
        );
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setConnectionState("unavailable");
        }
      }
    }

    void checkConnection();

    return () => abortController.abort();
  }, []);

  const connectionMessage = {
    checking: "Checking the server…",
    connected: "Frontend and backend are connected.",
    unavailable: "The backend is unavailable.",
  }[connectionState];

  return (
    <main className="foundation-page">
      <section className="foundation-card" aria-labelledby="page-title">
        <p className="eyebrow">Project foundation</p>
        <h1 id="page-title">TimeSince</h1>
        <p>A calm place for recurring tasks without deadlines.</p>
        <p className="connection-status" role="status" aria-live="polite">
          <span aria-hidden="true" data-state={connectionState} />
          {connectionMessage}
        </p>
      </section>
    </main>
  );
}
