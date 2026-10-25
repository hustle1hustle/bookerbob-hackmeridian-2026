import { Shell } from "./Shell"
import { useRoute } from "./store"
import { Empty } from "./ui"
import { PlacesScreen } from "./screens/Places"
import { PlaceScreen } from "./screens/Place"
import { DiscloseScreen, DiscountScreen, ReviewScreen, StayScreen, StaysScreen } from "./screens/Stays"

// Hash routes (static hosting):
//   #/                 guest: places
//   #/place/:id        guest: place page
//   #/stays            guest: my stays (+ start a stay)
//   #/stays/:i         guest: stay code and QR
//   #/stays/:i/review | /discount | /disclose
export function App() {
  const { path } = useRoute()
  return <Shell>{render(path)}</Shell>
}

function render(path: string[]) {
  const n = (i: number) => Number(path[i])
  switch (path[0] ?? "") {
    case "":
      return <PlacesScreen />
    case "place":
      return <PlaceScreen key={path[1]} id={n(1)} />
    case "stays": {
      if (path[1] === undefined) return <StaysScreen />
      const i = n(1)
      if (path[2] === "review") return <ReviewScreen key={i} i={i} />
      if (path[2] === "discount") return <DiscountScreen key={i} i={i} />
      if (path[2] === "disclose") return <DiscloseScreen key={i} i={i} />
      return <StayScreen key={i} i={i} />
    }
    default:
      return (
        <Empty title="page not found">
          <a href="#/">back to places</a>
        </Empty>
      )
  }
}
