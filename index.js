import { parseDiagramAndSaveToGrist } from './src/index.js'
import argsParser from 'args-parser'
const args = argsParser(process.argv)

parseDiagramAndSaveToGrist({ 
  updateGrist: args.u,
  logFile: args.o,
  inputFile: args.i
})