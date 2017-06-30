const fs = require("fs-extra")
const Promise = require("bluebird")
const glob = Promise.promisify(require("glob"))
const parseTemplate = require("json-templates")
const path = require("path")
const exec = Promise.promisify(require("child_process").exec)
const debug = require("debug")("meshblu-connector-installer-debian")
const tmp = require("tmp")
const map = require("lodash.map")
const find = require("lodash.find")
const uniqBy = require("lodash.uniqby")
const union = require("lodash.union")

class MeshbluConnectorInstaller {
  constructor({ connectorPath, certPassword, spinner, destinationPath, encryptionPassword, encryptedGpgKeyPath }) {
    this.connectorPath = connectorPath
    this.certPassword = certPassword
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
    return exec(`dpkg --build ${this.debianPackageName}`, options)
  }

  copyTemplates() {
    this.spinner.text = "Processing templates"
    debug("processing templates")
    const packageTemplatePath = path.resolve(path.join(this.connectorPath, ".installer", "debian", "templates", "**/*"))
    const defaultTemplatePath = path.resolve(path.join(__dirname, "..", "templates", "**/*"))
    return this.findTemplatesFromPaths({ packageTemplatePath, defaultTemplatePath }).then(templates => {
      return this.processTemplates(templates)
    })
  }

  findTemplatesFromPaths({ packageTemplatePath, defaultTemplatePath }) {
    return glob(packageTemplatePath, { nodir: true }).then(packageTemplatePaths => {
      const packageTemplates = this.mapFilePaths(packageTemplatePaths)
      return glob(defaultTemplatePath, { nodir: true }).then(defaultTemplatePaths => {
        const defaultTemplates = this.mapFilePaths(defaultTemplatePaths)
        const templates = this.mergeTemplates({ defaultTemplates, packageTemplates })
        return Promise.resolve(templates)
      })
    })
  }

  mergeTemplates({ defaultTemplates, packageTemplates }) {
    return uniqBy(
      map(union(defaultTemplates, packageTemplates), template => {
        const { destPath } = template
        const packageTemplate = find(packageTemplates, { destPath })
        return packageTemplate || template
      }),
      "destPath"
    )
  }

  mapFilePaths(files) {
    return files.map(srcPath => {
      return {
        srcPath,
        destPath: this.getDestPath(srcPath),
        dirname: path.dirname(srcPath),
        isTemplate: path.basename(srcPath).indexOf("_") === 0,
      }
    })
  }

  processTemplates(templates) {
    return Promise.map(templates, template => {
      if (template.isTemplate) return this.processTemplate(template)
      return this.copyFile(template)
    })
  }

  getDestPath(file) {
    const fileRegex = new RegExp(`${path.sep}templates${path.sep}(.*)$`)
    const matches = file.match(fileRegex)
    const filePartial = matches[matches.length - 1]
    const filePath = path.join(this.debianDeployPath, filePartial)
    const { base, dir } = path.parse(filePath)
    const newBase = base.replace(/^_/, "")
    return path.join(dir, newBase)
  }

  processTemplate(file) {
    const template = parseTemplate(fs.readFileSync(file.srcPath, "utf-8"))
    const results = template(this.templateData)
    return fs.outputFile(file.destPath, results)
  }

  copyFile(file) {
    return fs.ensureDir(file.dirname).then(() => {
      return fs.copy(file, file.destPath, { overwrite: true })
    })
  }

  decryptGPGKey() {
    return this.exec(`openssl aes-256-cbc -pass pass:${this.encryptionPassword} -in ${this.encryptedGpgKeyPath} -out ${this.tempGpgKey} -d`)
  }

  importGPGKey() {
    return this.exec(`gpg --import ${this.tempGpgKey}`)
  }

  dpkgSign() {
    return this.exec(`dpkg-sig --gpgoptions '--no-tty --passphrase ${this.certPassword}' --sign builder ${this.debianPackageName}`)
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
