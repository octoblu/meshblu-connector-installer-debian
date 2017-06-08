#!/usr/bin/env node
const dashdash = require("dashdash")
const path = require("path")
const util = require("util")
const fs = require("fs")
const chalk = require("chalk")
const ora = require("ora")
const { MeshbluConnectorInstaller } = require("./src/installer")

const CLI_OPTIONS = [
  {
    name: "version",
    type: "bool",
    help: "Print connector version and exit.",
  },
  {
    names: ["help", "h"],
    type: "bool",
    help: "Print this help and exit.",
  },
  {
    names: ["connector-path"],
    type: "string",
    env: "MESHBLU_CONNECTOR_PATH",
    help: "Path to connector package.json and assets",
    helpArg: "PATH",
  },
]

class MeshbluConnectorInstallerDebianCommand {
  constructor(options) {
    if (!options) options = {}
    var { argv, cliOptions } = options
    if (!cliOptions) cliOptions = CLI_OPTIONS
    if (!argv) return this.die(new Error("MeshbluConnectorInstallerDebianCommand requires options.argv"))
    this.argv = argv
    this.cliOptions = cliOptions
    this.parser = dashdash.createParser({ options: this.cliOptions })
  }

  parseArgv({ argv }) {
    try {
      var opts = this.parser.parse(argv)
    } catch (e) {
      return {}
    }

    if (!opts.connector_path) {
      opts.connector_path = process.cwd()
    }

    opts.connector_path = path.resolve(opts.connector_path)

    if (opts.help) {
      console.log(`usage: meshblu-connector-installer-debian [OPTIONS]\noptions:\n${this.parser.help({ includeEnv: true })}`)
      process.exit(0)
    }

    if (opts.version) {
      console.log(this.packageJSON.version)
      process.exit(0)
    }

    return opts
  }

  async run() {
    const options = this.parseArgv({ argv: this.argv })
    const { connector_path } = options
    var errors = []
    if (!connector_path) errors.push(new Error("MeshbluConnectorInstallerDebianCommand requires --connector-path or MESHBLU_CONNETOR_PATH"))

    if (errors.length) {
      console.log(`usage: meshblu-connector-installer-debian [OPTIONS]\noptions:\n${this.parser.help({ includeEnv: true })}`)
      errors.forEach(error => {
        console.error(chalk.red(error.message))
      })
      process.exit(1)
    }

    const spinner = ora("Building package").start()

    const installer = new MeshbluConnectorInstaller({ connectorPath: connector_path, spinner })
    try {
      await installer.build()
    } catch (error) {
      return spinner.fail(error.message)
    }
    spinner.succeed("Ship it!")
  }

  die(error) {
    console.error("Meshblu Connector Installer Debian Command: error: %s", error.message)
    process.exit(1)
  }
}

const command = new MeshbluConnectorInstallerDebianCommand({ argv: process.argv })
command.run().catch(error => {
  console.error(error)
})
