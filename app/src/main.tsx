import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./tokens.css"
import "./app.css"
import { App } from "./App"
import { sdk } from "./sdk"
import { demo } from "./demo"

if (demo.wallet) void sdk.wallet.connect(demo.wallet)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
