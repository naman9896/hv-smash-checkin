import ClientPage from "./client-page";

// The kiosk is client-only (idle timers, live settings), so there is nothing for
// instant-navigation validation to render on the server.
export const instant = false;

export default function Page() {
  return <ClientPage />;
}
