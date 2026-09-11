import { createRoot } from "react-dom/client";
import { PrototypeApp } from "./prototype/PrototypeApp";

const params = new URLSearchParams(window.location.search);
const container = document.getElementById("root");
if (!container) throw new Error("#root is missing from the page");

createRoot(container).render(
  <PrototypeApp initialView={params.get("view") || "overview"} />,
);
