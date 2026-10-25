// "what each party sees": the security model, drawn simply.
import { Explainer } from "../views/explainer"

export function AboutScreen() {
  return (
    <>
      <h1>how proof of stay keeps you private</h1>
      <p className="muted">
        guests prove they stayed without saying who they are. the proof is checked on Stellar, so reviews are honest and discounts need no personal data.
      </p>
      <div className="section">
        <Explainer />
      </div>
    </>
  )
}
