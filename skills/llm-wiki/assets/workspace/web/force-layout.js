import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from "d3-force"

function hashText(value) {
  return Array.from(String(value)).reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0)
}

function finitePoint(value) {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y)
}

function restoredPoint(saved, id, extent) {
  if (!finitePoint(saved)) return null
  const limit = extent * .72
  if (Math.abs(saved.x) <= limit && Math.abs(saved.y) <= limit) return { x: saved.x, y: saved.y }

  const hash = Math.abs(hashText(id))
  const baseAngle = Math.atan2(saved.y, saved.x)
  const angle = baseAngle + ((hash % 37) - 18) / 90
  const radius = limit * (.72 + (hash % 17) / 100)
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
}

function forceBounds(limit) {
  let nodes = []
  function force() {
    for (const node of nodes) {
      const nextX = node.x + node.vx
      const nextY = node.y + node.vy
      if (nextX > limit) node.vx = limit - node.x
      else if (nextX < -limit) node.vx = -limit - node.x
      if (nextY > limit) node.vy = limit - node.y
      else if (nextY < -limit) node.vy = -limit - node.y
    }
  }
  force.initialize = (nextNodes) => { nodes = nextNodes }
  return force
}

// A Quartz-style force model adapted to the existing Sigma renderer. D3 owns
// the physics state; Sigma only paints the positions produced on each tick.
export function createForceLayout(nodes, edges, savedPositions = {}, viewport = {}) {
  if(!savedPositions || typeof savedPositions!=="object" || Array.isArray(savedPositions))savedPositions={}
  const count = Math.max(nodes.length, 1)
  const largeGraph = count > 1_500
  const extent = largeGraph
    ? Math.min(920, Math.max(420, Math.sqrt(count) * 12))
    : Math.max(78, Math.min(420, Math.sqrt(count) * 40))
  const clusterRadius = Math.min(extent * .42, 24 + Math.sqrt(count) * 5)

  const physicsNodes = nodes.map((node, index) => {
    const id = String(node.id)
    const importance = Math.max(0, Math.min(1, Number(node.visualImportance ?? node.importance ?? 0)))
    const saved = savedPositions[id]
    const restored = restoredPoint(saved, id, extent)
    const hash = Math.abs(hashText(id))
    const angle = (hash % 6283) / 1000 + index * 2.3999632297
    const radius = restored ? 0 : 3 + Math.sqrt(index + 1) * 2.6
    return {
      id,
      importance,
      community: Number(node.community || 0),
      radius: Number(node.finalSize || 7),
      x: restored ? restored.x : Math.cos(angle) * radius,
      y: restored ? restored.y : Math.sin(angle) * radius,
    }
  })
  const nodeById = new Map(physicsNodes.map((node) => [node.id, node]))
  const physicsLinks = edges
    .filter((edge) => nodeById.has(String(edge.source)) && nodeById.has(String(edge.target)))
    .map((edge) => ({
      source: String(edge.source),
      target: String(edge.target),
      weight: Number(edge.weight || 1),
    }))

  const clusterAngle = (node) => (node.community * 2.3999632297) % (Math.PI * 2)
  const clusterDistance = (node) => clusterRadius * (1 - node.importance * .84)
  const targetX = (node) => Math.cos(clusterAngle(node)) * clusterDistance(node)
  const targetY = (node) => Math.sin(clusterAngle(node)) * clusterDistance(node)
  const gravity = (node) => .018 + node.importance * .045

  const simulation = forceSimulation(physicsNodes)
    .alpha(1)
    .alphaMin(.002)
    .alphaDecay(largeGraph ? .09 : count > 260 ? .042 : .027)
    .velocityDecay(largeGraph ? .42 : .34)
    .force("charge", forceManyBody()
      .strength((node) => -58 - Math.sqrt(count) * 2.2 - node.importance * 72)
      .distanceMax(extent * 1.8))
    .force("link", forceLink(physicsLinks)
      .id((node) => node.id)
      .distance((link) => 48 + Math.max(0, 14 - link.weight * 1.8))
      .strength((link) => Math.min(.42, .11 + link.weight * .035)))
    .force("center", forceCenter(0, 0).strength(.18))
    .force("cluster-x", forceX(targetX).strength(gravity))
    .force("cluster-y", forceY(targetY).strength(gravity))
    .force("bounds", forceBounds(extent * .92))

  // Collision checks are useful on ordinary graphs but needlessly expensive
  // across thousands of nodes. Sigma/WebGL can paint the complete vault while
  // the cheaper forces preserve clustering, links, dragging and zooming.
  function resizeViewport(nextViewport) {
    if (largeGraph) return
    const worldPerPixel = extent * 2 / Math.max(180, Math.min(nextViewport.width || 665, nextViewport.height || 600) - 48)
    simulation.force("collide", forceCollide()
      .radius((node) => Math.max(7 + node.radius * 1.18, (node.radius + 8) * worldPerPixel))
      .strength(.82)
      .iterations(2))
  }
  resizeViewport(viewport)

  // A short hidden warm-up prevents the first rendered frame from being an
  // unreadable pile, while leaving enough energy for the visible drift.
  simulation.stop()
  const warmupTicks = largeGraph ? 8 : count > 300 ? 80 : 110
  for (let index = 0; index < warmupTicks; index += 1) simulation.tick()

  return { simulation, nodeById, extent, resizeViewport }
}
