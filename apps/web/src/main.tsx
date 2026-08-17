import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "./app.js"
import "./styles.css"

const rootElement = document.querySelector("#root")

if (!(rootElement instanceof HTMLElement)) {
  throw new TypeError("Expected the Vite root element")
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
