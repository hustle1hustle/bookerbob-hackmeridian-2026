import { Shell } from "./Shell"
import { useRoute } from "./store"
import { Empty } from "./ui"
import { PlacesScreen } from "./screens/Places"
import { PlaceScreen } from "./screens/Place"

// Hash routes (static hosting):
//   #/                 guest: places
//   #/place/:id        guest: place page
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
    default:
      return (
        <Empty title="page not found">
          <a href="#/">back to places</a>
        </Empty>
      )
  }
}
