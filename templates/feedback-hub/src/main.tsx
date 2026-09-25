import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import appConfig from "../app.json";
import App from "./App.tsx";
import "./styles.css";

document.title = appConfig.name;
const root = document.getElementById("root");
if (!root) throw new Error("App root was not found.");
createRoot(root).render(<StrictMode><App /></StrictMode>);
