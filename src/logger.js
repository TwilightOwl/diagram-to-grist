import fs from 'fs'

class Logger {
  initialize(logFile) {
    if (logFile) {
      this.stream = fs.createWriteStream(logFile, { flags: 'a' });
      this.write('\n' + new Date().toLocaleString() + ' :\n')
    }
  }

  write(line) {
    this.stream && this.stream.write(`${line}\n`)
    // console.log(line)
  }

  error(line) {
    this.write('ERROR: ' + line)
  }

  warning(line) {
    this.write('WARNING: ' + line)
  }

  finalize() {
    this.write('\n')
    this.stream && this.stream.end()
  }
}

export const logger = new Logger()