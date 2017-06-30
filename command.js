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
  {
    names: ["encrypted-gpg-key-path"],
    type: "string",
    env: "MESHBLU_CONNECTOR_ENCRYPTED_GPG_KEY_PATH",
    help: "Path to encrypted gpg key",
    helpArg: "PATH",
    completionType: "file",
    default: path.join(__dirname, "key.gpg.enc"),
  },
  {
    names: ["gpg-key-id"],
    type: "string",
    env: "MESHBLU_CONNECTOR_GPG_KEY_ID",
    help: "GPG key id or name",
    helpArg: "KEYID",
    default: "445C1350",
  },
  {
    names: ["cert-password"],
    type: "string",
    env: "MESHBLU_CONNECTOR_CERT_PASSWORD",
    help: "Password to unlock .p12 certificate",
    helpArg: "PASSWORD",
  },
  {
    names: ["encryption-password"],
    type: "string",
    env: "MESHBLU_CONNECTOR_ENCRYPTION_PASSWORD",
    help: "Password to decrypt GPG key",
    helpArg: "PASSWORD",
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
    const { connectorPath, certPassword, destinationPath, encryptionPassword, encryptedGpgKeyPath, gpgKeyId } = this.octoDash.parseOptions()
    const spinner = ora("Building package").start()
    const installer = new MeshbluConnectorInstaller({
      connectorPath: path.resolve(connectorPath),
      destinationPath: destinationPath,
      spinner,
      certPassword,
      encryptionPassword,
      encryptedGpgKeyPath,
      gpgKeyId,
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
