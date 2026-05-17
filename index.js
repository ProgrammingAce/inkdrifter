// inkdrifter — hex map generator. Source split across src/.
// Public surface is preserved for back-compat (server/, gen_*.js, tests).

const constants = require('./src/constants.js');
const rng = require('./src/rng.js');
const hex = require('./src/hex.js');
const rivers = require('./src/rivers.js');
const ocean = require('./src/ocean.js');
const grid = require('./src/grid.js');
const terrain = require('./src/terrain.js');
const cities = require('./src/cities.js');
const { renderMap } = require('./src/renderMap.js');

if (require.main === module) require('./src/cli.js').main();

module.exports = {
  // constants
  HEX_SIZE: constants.HEX_SIZE,
  HEX_W: constants.HEX_W,
  HEX_H: constants.HEX_H,
  DEFAULT_GRID_ORIGIN_X: constants.DEFAULT_GRID_ORIGIN_X,
  DEFAULT_GRID_ORIGIN_Y: constants.DEFAULT_GRID_ORIGIN_Y,
  MIN_GRID: constants.MIN_GRID,
  MAX_GRID: constants.MAX_GRID,
  gridCanvasSize: constants.gridCanvasSize,
  // hex
  hexCenter: hex.hexCenter,
  hexVertices: hex.hexVertices,
  buildVertexGraph: hex.buildVertexGraph,
  hexNeighbors: hex.hexNeighbors,
  hexNeighborsBounded: hex.hexNeighborsBounded,
  // rng / math
  createRng: rng.createRng,
  gaussianFilter1D: rng.gaussianFilter1D,
  jitter: rng.jitter,
  blotSignal: rng.blotSignal,
  weightedChoice: rng.weightedChoice,
  // paths
  randomRiverPath: rivers.randomRiverPath,
  hexEdgeCenterline: rivers.hexEdgeCenterline,
  tributaryPath: rivers.tributaryPath,
  tributaryCenterline: rivers.tributaryCenterline,
  generateRivers: rivers.generateRivers,
  defaultRiverCount: rivers.defaultRiverCount,
  densifyAndSmooth: rivers.densifyAndSmooth,
  resampleByArcLength: rivers.resampleByArcLength,
  // ocean
  pickSides: ocean.pickSides,
  selectWaterHexes: ocean.selectWaterHexes,
  buildCoastlineSegments: ocean.buildCoastlineSegments,
  stitchSegments: ocean.stitchSegments,
  drawOcean: ocean.drawOcean,
  // rendering
  drawRiver: rivers.drawRiver,
  drawHexGrid: grid.drawHexGrid,
  paintParchment: grid.paintParchment,
  renderMap,
  drawMountains: terrain.drawMountains,
  drawHills: terrain.drawHills,
  drawCities: cities.drawCities,
};
