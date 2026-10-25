import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./tokens.css"
import "./app.css"
import { App } from "./App"
import { getPlaceReviews, sdk } from "./sdk"
import { demo } from "./demo"
import { seedDisputes } from "./disputes"

if (sdk.mode === "mock") void seedDisputes(getPlaceReviews)

const render = () =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )

// Demo/screenshot mode: connect first so ?auto= actions start with a wallet.
if (demo.wallet) sdk.wallet.connect(demo.wallet).finally(render)
else render()
