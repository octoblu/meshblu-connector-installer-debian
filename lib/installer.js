const fs = require("fs-extra")
const Promise = require("bluebird")
const glob = Promise.promisify(require("glob"))
const parseTemplate = require("json-templates")
const path = require("path")
const exec = Promise.promisify(require("child_process").exec)

class MeshbluConnectorInstaller {
  constructor({ connectorPath, spinner, destinationPath }) {
    this.destinationPath = destinationPath || `usr/share/meshblu-connectors/connectors/${this.type}`
    this.connectorPath = path.resolve(connectorPath)
    this.spinner = spinner
    this.packageJSON = fs.readJsonSync(path.join(this.connectorPath, "package.json"))
    this.type = this.packageJSON.name
    this.version = this.packageJSON.version
    this.arch = this.getArch()
    this.target = this.getTarget()
    this.debianPackageName = `${this.type}_${this.version}-1-${this.arch}`
    this.deployPath = path.join(this.connectorPath, "deploy", this.target)
    this.deployInstallersPath = path.join(this.deployPath, "installers")
    this.debianDeployPath = path.join(this.deployInstallersPath, this.debianPackageName)
    this.templateData = {
      type: this.type,
      version: this.version,
      arch: this.arch,
      description: this.packageJSON.description,
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
    return this.copyTemplates().then(() => this.copyAssets()).then(() => this.buildPackage()).then(() => this.cleanup())
  }

  cleanup() {
    if (!this.debianDeployPath) return
    return fs.remove(this.debianDeployPath)
  }

  copyAssets() {
    this.spinner.text = "Copying pkg assets"
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
    return exec(`dpkg --build ${this.debianPackageName}`, options)
  }

  copyTemplates() {
    this.spinner.text = "Processing templates"
    const packageTemplatePath = path.resolve(path.join(this.connectorPath, ".installer", "debian", "templates", "**/*"))
    const defaultTemplatePath = path.resolve(path.join(__dirname, "..", "templates", "**/*"))
    return this.findTemplatesFromPaths([packageTemplatePath, defaultTemplatePath]).each(templates => {
      return this.processTemplates(templates)
    })
  }

  findTemplatesFromPaths(templatePaths) {
    return Promise.map(templatePaths, templatePath => {
      return glob(templatePath, { nodir: true })
    })
  }

  processTemplates(templates) {
    return Promise.map(templates, template => {
      const filename = path.basename(template)
      if (filename.indexOf("_") == 0) {
        return this.processTemplate(template)
      }
      return this.copyFile(template)
    })
  }

  getFilePath(file) {
    const fileRegex = new RegExp(`${path.sep}templates${path.sep}(.*)$`)
    const matches = file.match(fileRegex)
    const filePartial = matches[matches.length - 1]
    const filePath = path.join(this.debianDeployPath, filePartial)
    const { base, dir } = path.parse(filePath)
    const newBase = base.replace(/^_/, "")
    return path.join(dir, newBase)
  }

  processTemplate(file) {
    const template = parseTemplate(fs.readFileSync(file, "utf-8"))
    const results = template(this.templateData)
    const filePath = this.getFilePath(file)
    return fs.outputFile(filePath, results)
  }

  copyFile(file) {
    const filePath = this.getFilePath(file)
    const fileDirPath = path.dirname(filePath)
    return fs.ensureDir(fileDirPath).then(() => {
      return fs.copy(file, filePath, { overwrite: true })
    })
  }
}

module.exports.MeshbluConnectorInstaller = MeshbluConnectorInstaller
