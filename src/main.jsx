import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import StoryboardTool from "./StoryboardTool.jsx";
import VideoToGkonti from "./VideoToGkonti.jsx";

const path = window.location.pathname;
const App = path.startsWith("/video") ? VideoToGkonti : StoryboardTool;

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
