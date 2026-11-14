import { useEffect, type ReactElement } from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import Landing from "./pages/Landing";
import Lab from "./pages/Lab";
import Connect from "./pages/Connect";
import Jobs from "./pages/Jobs";
import NewJob from "./pages/NewJob";
import LiveJob from "./pages/LiveJob";
import Results from "./pages/Results";
import ProviderSetup from "./pages/ProviderSetup";
import Earnings from "./pages/Earnings";
import Machines from "./pages/Machines";

const ROUTES: { path: string; title: string; element: ReactElement }[] = [
  { path: "/", title: "Nova Compute", element: <Landing /> },
  { path: "/lab", title: "Simulation lab", element: <Lab /> },
  { path: "/connect", title: "Connect wallet", element: <Connect /> },
  { path: "/jobs", title: "My jobs", element: <Jobs /> },
  { path: "/jobs/new", title: "New job", element: <NewJob /> },
  { path: "/jobs/live", title: "Live job", element: <LiveJob /> },
  { path: "/results", title: "Result", element: <Results /> },
  { path: "/provider", title: "Set up your GPU", element: <ProviderSetup /> },
  { path: "/provider/earnings", title: "Earnings", element: <Earnings /> },
  { path: "/provider/machines", title: "Connect a GPU machine", element: <Machines /> },
];

/** Sets the tab title and scrolls to the top on each navigation (unless jumping to an anchor). */
function Page({ title, children }: { title: string; children: ReactElement }) {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    document.title = title === "Nova Compute" ? title : `${title} · Nova Compute`;
  }, [title]);
  useEffect(() => {
    if (!hash) window.scrollTo(0, 0);
  }, [pathname, hash]);
  return children;
}

function NotFound() {
  return (
    <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 24, textAlign: "center" }}>
      <h1 style={{ margin: 0, fontSize: 40, letterSpacing: "-0.04em" }}>Page not found</h1>
      <Link to="/" style={{ fontWeight: 600 }}>Back to Nova</Link>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      {ROUTES.map((r) => (
        <Route key={r.path} path={r.path} element={<Page title={r.title}>{r.element}</Page>} />
      ))}
      <Route path="*" element={<Page title="Not found"><NotFound /></Page>} />
    </Routes>
  );
}
