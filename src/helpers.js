const YAML = require("yaml")
const settings = require("./settings")
const propertyList = require("./data/properties.json")

export function copyToClipboard(str) {
  const temp = document.createElement("textarea")
  temp.value = str
  document.body.appendChild(temp)
  temp.select()
  document.execCommand("copy")
  document.body.removeChild(temp)
  return
}
export function parseYAML(yamlSTR) {
  try {
    yamlSTR = yamlSTR.replace("!Flow", "")
    const data = YAML.parse(yamlSTR)
    return { data }
  } catch (error) {
    alert("Error Parsing YAML:\n" + error)
    return { error }
  }
}
export function formatForFlowchart(pods, canvas) {
  const formatted = {
    offset: {
      x: 0,
      y: 0,
    },
    nodes: {},
    links: {},
    selected: {},
    hovered: {},
  }

  let nodes = {}
  let links = {}

  let prevNode = false

  Object.keys(pods).map(id => {
    const pod = pods[id] || {}
    let node = {
      id,
      label: id,
      ports: {},
      needs: {},
      send_to: {},
      position: {},
      properties: { ...pod },
    }

    if (node.properties.needs) delete node.properties.needs

    node.ports["inPort"] = { id: "inPort", type: "input" }
    node.ports["outPort"] = { id: "outPort", type: "output" }

    if (prevNode && !pod.needs) pod.needs = prevNode

    if (pod.needs) {
      let parents = Array.isArray(pod.needs) ? pod.needs : [pod.needs]

      for (let i = 0; i < parents.length; ++i) {
        let nodeFrom = parents[i]
        node.needs[nodeFrom] = true

        let linkId = `${nodeFrom}-to-${id}`
        let link = {
          color: "red",
          id: linkId,
          from: { nodeId: nodeFrom, portId: "outPort" },
          to: { nodeId: id, portId: "inPort" },
        }
        links[linkId] = link
      }
    }

    if (canvas && canvas[id]) {
      const { x, y } = canvas[id]
      node.position = { x: parseInt(x), y: parseInt(y) }
    }

    nodes[id] = node
    prevNode = id
  })

  const depthPopulation = {} //how many nodes at each depth
  const offsetX = settings.nodeOffset.x
  const offsetY = settings.nodeOffset.y

  //fallback: if no position encoded on canvas portion of YAML, infer the position using depth and order
  Object.keys(nodes).map(id => {
    let depth = getNodeDepth(nodes, id, 0)
    nodes[id].depth = depth

    if (depthPopulation[depth] >= 0) depthPopulation[depth]++
    else depthPopulation[depth] = 0

    if (!nodes[id].position.x)
      nodes[id].position = {
        y: depth * offsetY + offsetY,
        x: depthPopulation[depth] * offsetX + offsetX,
      }
  })

  formatted.nodes = nodes
  formatted.links = links

  return formatted
}

const propertyTypes = propertyList.reduce((acc, curr) => {
  acc[curr.name] = curr.type
  return acc
}, {})

const getNeededBy = ({ to: { nodeId } }) => nodeId
const getNeed = ({ from: { nodeId } }) => nodeId
const decodePropValue = (propName, propValue) =>
  propertyTypes[propName] === "bool" ? propValue === "true" : propValue
const unpackIfLengthOne = arr =>
  Array.isArray(arr) && arr.length === 1 ? arr[0] : arr

export function formatAsYAML(chart) {
  console.log("formatAsYAML input: ", chart)
  const { with: chartWith, nodes, links } = chart

  const needsByPodLabel = Object.values(links).reduce((acc, curr) => {
    const neededBy = getNeededBy(curr)
    if (!acc[neededBy]) {
      acc[neededBy] = []
    }
    acc[neededBy].push(getNeed(curr))
    return acc
  }, {})

  const pods = Object.values(nodes).reduce((acc, node) => {
    const { label } = node
    if (!label) return acc

    const podProperties = Object.entries(node.properties).reduce(
      (acc, [key, propValue]) => {
        acc[key] = decodePropValue(key, propValue)
        return acc
      },
      {}
    )
    if (needsByPodLabel[label]) {
      podProperties.needs = unpackIfLengthOne(needsByPodLabel[label])
    }

    acc[label] = { ...podProperties }
    return acc
  }, {})

  const canvas = Object.values(nodes).reduce((acc, node) => {
    const {
      position: { x, y },
    } = node
    acc[node.label] = { x, y }
    return acc
  }, {})

  const output = { with: { ...chartWith, board: { canvas } }, pods }
  return `!Flow\n${YAML.stringify(output)}`
}

export function formatSeconds(numSeconds) {
  let minute = 60
  let hour = 60 * 60

  if (numSeconds < minute) return `${numSeconds}s`
  if (numSeconds < hour)
    return `${parseInt(numSeconds / minute)}m ${parseInt(numSeconds % minute)}s`
  else
    return `${parseInt(numSeconds / hour)}h ${parseInt(
      (numSeconds % hour) / minute
    )}m ${parseInt(numSeconds % minute)}s`
}

export function formatBytes(numBytes) {
  if (numBytes < 1024) return `${numBytes} Bytes`
  if (numBytes < 1024 ** 2) return `${parseFloat(numBytes).toFixed(1)} KB`
  if (numBytes < 1024 ** 3)
    return `${parseFloat(numBytes / 1024 ** 2).toFixed(1)} MB`
  return `${parseFloat(numBytes / 1024 ** 3).toFixed(1)} GB`
}

function getNodeDepth(nodes, currentId, currentDepth) {
  let parents = Object.keys(nodes[currentId].needs)
  let longestDepth = 0

  for (let i = 0; i < parents.length; ++i) {
    let parent = parents[i]
    let depth
    if (nodes[parent].depth) depth = nodes[parent].depth + 1
    else depth = getNodeDepth(nodes, parent, 1)
    if (depth > longestDepth) longestDepth = depth
  }

  return currentDepth + longestDepth
}
