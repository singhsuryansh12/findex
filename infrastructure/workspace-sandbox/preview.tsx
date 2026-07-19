import React from "react";
import { createRoot } from "react-dom/client";
import App from "./src/App";
import "./src/styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing workspace root element.");
createRoot(root).render(<App />);
