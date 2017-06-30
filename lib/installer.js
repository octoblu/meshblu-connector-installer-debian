const fs = require("fs-extra")
const Promise = require("bluebird")
const path = require("path")
const { exec } = require("child_process")
const debug = require("debug")("meshblu-connector-installer-debian")
const tmp = require("tmp")
const JSONTemplateFiles = require("json-template-files")

class MeshbluConnectorInstaller {
  constructor({ connectorPath, certPassword, spinner, destinationPath, encryptionPassword, encryptedGpgKeyPath, gpgKeyId }) {
    this.connectorPath = connectorPath
    this.certPassword = certPassword
    this.gpgKeyId = gpgKeyId
    this.spinner = spinner
    this.encryptionPassword = encryptionPassword
    this.encryptedGpgKeyPath = encryptedGpgKeyPath
    this.packageJSON = fs.readJsonSync(path.join(this.connectorPath, "package.json"))
    this.type = this.packageJSON.name
    this.version = this.packageJSON.version
    this.arch = this.getArch()
    this.target = this.getTarget()
    this.tempGpgKey = tmp.tmpNameSync()
    this.debianPackageName = `${this.type}_${this.version}-1_${this.arch}`
    this.deployPath = path.join(this.connectorPath, "deploy", this.target)
    this.deployInstallersPath = path.join(this.deployPath, "installers")
    this.debianDeployPath = path.join(this.deployInstallersPath, this.debianPackageName)
    this.destinationPath = destinationPath || `usr/share/meshblu-connectors/connectors/${this.type}`
    this.templateData = {
      type: this.type,
      version: this.version,
      arch: this.arch,
      description: this.packageJSON.description,
      homepage: this.packageJSON.homepage,
      license: this.packageJSON.license,
    }
  }

  getArch() {
    const arch = process.arch
    if (arch == "ia32") return "i386"
    if (arch == "x64") return "amd64"
    if (arch == "arm") return "armhf"
    return "unsupported"
  }

  getTarget() {
    let { arch, platform } = process
    if (platform === "darwin") platform = "macos"
    if (platform === "win32") platform = "win"
    if (arch === "ia32") arch = "x86"
    if (arch === "arm") arch = "armv7"

    const nodeVersion = "8"
    return `node${nodeVersion}-${platform}-${arch}`
  }

  build() {
    return this.copyTemplates().then(() => this.copyAssets()).then(() => this.buildPackage()).then(() => this.signPackage()).then(() => this.cleanup())
  }

  cleanup() {
    if (!this.debianDeployPath) return
    return fs.remove(this.debianDeployPath)
  }

  copyAssets() {
    this.spinner.text = "Copying pkg assets"
    debug("copying pkg assets")
    const destination = path.join(this.debianDeployPath, this.destinationPath)
    const source = path.join(this.deployPath, "bin")
    return fs
      .pathExists(source)
      .then(exists => {
        if (!exists) {
          return Promise.reject(new Error(`Source path does not exist: ${source}`))
        }
        return fs.ensureDir(destination)
      })
      .then(() => {
        return fs.copy(source, destination)
      })
  }

  buildPackage() {
    this.spinner.text = "Building package"
    const options = {
      cwd: this.deployInstallersPath,
    }
    debug("building package")
    return this.exec(`dpkg --build ${this.debianPackageName}`, options)
  }

  copyTemplates() {
    this.spinner.text = "Processing templates"
    debug("processing templates")
    const packageTemplatePath = path.resolve(path.join(this.connectorPath, ".installer", "debian", "templates", "**/*"))
    const defaultTemplatePath = path.resolve(path.join(__dirname, "..", "templates", "**/*"))
    const { templateData } = this
    return new JSONTemplateFiles({
      packageTemplatePath,
      defaultTemplatePath,
      templateData,
      outputPath: this.debianDeployPath,
    }).process()
  }

  exec(cmd, options) {
    return new Promise((resolve, reject) => {
      exec(cmd, options, (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout
          error.stderr = stderr
          return reject(error)
        }
        return resolve(stdout, stderr)
      })
    })
  }

  decryptGPGKey() {
    return this.exec(`openssl aes-256-cbc -pass pass:${this.encryptionPassword} -in ${this.encryptedGpgKeyPath} -out ${this.tempGpgKey} -d`)
  }

  importGPGKey() {
    return this.exec(`gpg --import ${this.tempGpgKey}`)
  }

  dpkgSign() {
    const options = {
      cwd: this.deployInstallersPath,
    }
    debug("signing package")
    return this.exec(`dpkg-sig -k "${this.gpgKeyId}" -g '--no-tty --passphrase ${this.certPassword}' --sign builder ${this.debianPackageName}.deb`, options)
  }

  signPackage() {
    return fs.pathExists(this.encryptedGpgKeyPath).then(exists => {
      if (!exists) {
        return Promise.resolve()
      }
      return this.decryptGPGKey().then(() => this.importGPGKey()).then(() => this.dpkgSign())
    })
  }
}

module.exports.MeshbluConnectorInstaller = MeshbluConnectorInstaller
