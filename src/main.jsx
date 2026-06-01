import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import StoryboardTool from "./StoryboardTool.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <StoryboardTool />
  </StrictMode>
);
