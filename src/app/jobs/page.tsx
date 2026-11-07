import ClientPage from "./client-page";

// Thin server entry so the route segment renders on the server; the screen itself is a Client Component.
export default function Page() {
  return <ClientPage />;
}
