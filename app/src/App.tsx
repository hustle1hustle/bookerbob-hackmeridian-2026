import { Shell } from "./Shell"
import { useRoute } from "./store"
import { Empty } from "./ui"

export function App() {
  const { path } = useRoute()
  return <Shell>{render(path)}</Shell>
}

function render(path: string[]) {
  switch (path[0]) {
    default:
      return <Empty title="this page is on its way" />
  }
}
