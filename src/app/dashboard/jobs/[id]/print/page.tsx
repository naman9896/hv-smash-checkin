import ClientPage from "./client-page";

// Rendered only after DashboardShell's client-side session check, so there is
// nothing for instant-navigation validation to render on the server.
export const instant = false;

export default function Page() {
  return <ClientPage />;
}
