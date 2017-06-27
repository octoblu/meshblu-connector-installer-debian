#!/usr/bin/env node

const OctoDash = require("octodash")
const path = require("path")
const ora = require("ora")
const { MeshbluConnectorInstaller } = require("./lib/installer")
const packageJSON = require("./package.json")

const CLI_OPTIONS = [
  {
    names: ["connector-path"],
    type: "string",
    required: true,
    env: "MESHBLU_CONNECTOR_PATH",
    help: "Path to connector package.json and assets",
    helpArg: "PATH",
    default: ".",
    completionType: "file",
  },
  {
    names: ["destination-path"],
    type: "string",
    env: "MESHBLU_DESTINATION_PATH",
    help: "Path for bin files to be placed in installer",
    helpArg: "PATH",
  },
]

class MeshbluConnectorInstallerDebianCommand {
  constructor({ argv, cliOptions = CLI_OPTIONS } = {}) {
    this.octoDash = new OctoDash({
      argv,
      cliOptions,
      name: packageJSON.name,
      version: packageJSON.version,
    })
  }

  run() {
    const { connectorPath, destinationPath } = this.octoDash.parseOptions()
    const spinner = ora("Building package").start()
    const installer = new MeshbluConnectorInstaller({
      connectorPath: path.resolve(connectorPath),
      destinationPath: destinationPath,
      spinner,
    })
    return installer
      .build()
      .then(() => {
        spinner.succeed("Ship it!")
      })
      .catch(error => {
        spinner.fail(error.message)
        throw error
      })
  }

  die(error) {
    this.octoDash.die(error)
  }
}

const command = new MeshbluConnectorInstallerDebianCommand({ argv: process.argv })
command
  .run()
  .catch(error => {
    command.die(error)
  })
  .then(() => {
    process.exit(0)
  })
