// server.js

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const cors = require('cors');
const os = require('os');

const app = express();
app.use(cors());
const upload = multer({ dest: 'uploads/' });
const PORT = process.env.PORT || 3000;

const PROJECT_DIR = path.join(__dirname, 'project');

function cleanProjectDir() {
  if (fs.existsSync(PROJECT_DIR)) {
    fs.rmSync(PROJECT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(PROJECT_DIR);
}

function installDependencies(targetDir) {
  try {
    if (fs.existsSync(path.join(targetDir, 'package.json'))) {
      console.log('✅ package.json encontrado. Instalando dependências automaticamente...');
      execSync('npm install', { cwd: targetDir, stdio: 'inherit' });
    } else {
      console.log('⚠️ Nenhum package.json encontrado. Nenhuma dependência será instalada.');
    }
  } catch (err) {
    console.error('Erro ao instalar dependências:', err);
    throw new Error(`Falha ao instalar dependências: ${err.message}`);
  }
}

function runProject(res, sandboxDir, type, entryPoint) {
  const entryFile = path.join(sandboxDir, entryPoint);
  if (!fs.existsSync(entryFile)) {
    fs.rmSync(sandboxDir, { recursive: true, force: true });
    return res.status(400).send('Ponto de entrada não encontrado.');
  }

  const args = type === 'module' ? ['--input-type=module', entryPoint] : [entryPoint];
  const child = spawn('node', args, { cwd: sandboxDir, timeout: 30000 });

  child.stdout.on('data', (data) => {
    res.write(data);
  });

  child.stderr.on('data', (data) => {
    res.write(`ERROR: ${data}`);
  });

  child.on('error', (err) => {
    res.write(`ERROR: ${err.message}`);
  });

  child.on('close', (code) => {
    res.end(`\nProcesso finalizado com código ${code}`);
    fs.rmSync(sandboxDir, { recursive: true, force: true });
  });
}

app.post('/execute', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).send('Nenhum arquivo enviado.');
  }

  try {
    cleanProjectDir();

    const exnContent = fs.readFileSync(req.file.path, 'utf8');
    if (!exnContent.trim()) {
      return res.status(400).send('Arquivo vazio.');
    }

    let exn;
    try {
      exn = JSON.parse(exnContent);
      if (typeof exn !== 'object' || Array.isArray(exn)) {
        return res.status(400).send('Estrutura de arquivo inválida.');
      }
      if (!exn.files || typeof exn.files !== 'object') {
        return res.status(400).send('Estrutura de arquivos inválida.');
      }
    } catch (err) {
      return res.status(400).send('Formato de arquivo inválido: ' + err.message);
    }

    const embeddedFiles = exn.files;

    for (const [filename, content] of Object.entries(embeddedFiles)) {
      const filePath = path.join(PROJECT_DIR, filename);
      const dirPath = path.dirname(filePath);
      fs.mkdirSync(dirPath, { recursive: true });
      fs.writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content), 'utf8');
    }

    installDependencies(PROJECT_DIR);

    const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-'));

    function copyRecursiveSync(src, dest) {
      const stat = fs.statSync(src);
      if (stat.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        fs.readdirSync(src).forEach(child => {
          if (child === '.git') return; // Ignora .git
          copyRecursiveSync(path.join(src, child), path.join(dest, child));
        });
      } else if (stat.isFile()) {
        fs.copyFileSync(src, dest);
      }
    }

    copyRecursiveSync(PROJECT_DIR, sandboxDir);

    let projectType = exn.metadata?.type || 'commonjs';
    let entryPoint = exn.metadata?.entryPoint || 'main.js';

    runProject(res, sandboxDir, projectType, entryPoint);

  } catch (err) {
    console.error(err);
    res.status(500).send(`Erro no processamento: ${err.message}`);
  } finally {
    fs.unlinkSync(req.file.path);
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
